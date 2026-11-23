"""Bounded history backfill orchestration; native UI is an injectable adapter."""
from __future__ import annotations

from pathlib import Path
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import time
import math
import re
from typing import Any, Callable

from capture_lock import CaptureBusy, CaptureLock
from backfill_range import DateRangeScan


class BackfillFailure(RuntimeError):
    pass


class BackfillCancelled(RuntimeError):
    pass


class GroupTimeLimit(BackfillFailure):
    pass


class BubbleCounter:
    """Run-local conservative content count, never an author backfill cache."""
    def __init__(self):
        self.known: dict[str, set[str]] = {}
        self.unknown: set[str] = set()

    @property
    def matched(self):
        return sum(len(senders) for senders in self.known.values())

    @property
    def count(self):
        return self.matched + len(self.unknown)

    def consider(self, message):
        body = re.sub(r"\s+", "", message["text"])
        if message["captureMode"] == "OCR_MESSAGE":
            sender = re.sub(r"\s+", "", message["sender"])
            names = self.known.setdefault(body, set())
            if sender in names:
                return "duplicate"
            names.add(sender)
            # This only prevents counting an unknown/known observation twice.
            # The unknown payload is never assigned this sender or rewritten.
            if body in self.unknown:
                self.unknown.remove(body)
                return "upgrade"
            return "new"
        if body in self.known or body in self.unknown:
            return "duplicate"
        self.unknown.add(body)
        return "new"


def is_text_bubble(message):
    return message.get("captureUnit", "TEXT_BUBBLE" if message.get("captureMode") == "OCR_MESSAGE" else "VIEWPORT_REMAINDER") == "TEXT_BUBBLE"


def _failure_code(exc: Exception, fallback: str) -> str:
    from history_window import HistoryError
    from ocr_capture import OcrCaptureError
    from window_capture import WindowCaptureError
    if isinstance(exc, (BackfillFailure, HistoryError, OcrCaptureError, WindowCaptureError)):
        code = str(exc).partition(":")[0]
        if re.fullmatch(r"(?:BACKFILL|OCR|WGC)_[A-Z0-9_]{1,60}", code):
            return code
    return fallback


def restore_budget(up_attempts: int, count_mode: bool) -> int:
    return min(80, max(12, math.ceil(up_attempts * 0.7 / 3.0) + 6)) if count_mode else 12


@contextmanager
def wait_capture_lock(state_path, check_cancel, clock, sleep, wait_seconds=30):
    until = clock() + wait_seconds
    while True:
        check_cancel()
        lock = CaptureLock(state_path)
        try:
            lock.__enter__()
            break
        except CaptureBusy:
            if clock() >= until:
                raise
            sleep(0.2)
    try:
        yield lock
    finally:
        lock.__exit__()


def selected_groups(config: dict[str, Any], groups: list[str] | None, pages: int,
                    messages_per_group: int | None = None, days: int | None = None) -> list[str]:
    count_mode = messages_per_group is not None
    if days is not None and (count_mode or type(days) is not int or days not in (1, 3, 7)):
        raise BackfillFailure("BACKFILL_DAYS_INVALID")
    if count_mode and (type(messages_per_group) is not int or not 1 <= messages_per_group <= 200):
        raise BackfillFailure("BACKFILL_MESSAGE_TARGET_INVALID")
    if type(pages) is not int or not 1 <= pages <= (200 if count_mode or days is not None else 30):
        raise BackfillFailure("BACKFILL_PAGES_INVALID")
    selected = list(config["groups"] if groups is None else groups)
    if (not selected or len(set(selected)) != len(selected)
            or any(group not in config["groups"] for group in selected)):
        raise BackfillFailure("BACKFILL_GROUP_INVALID")
    return selected


def _down_to_stable(adapter, limit: int, initial=None, checkpoint=None):
    frame = adapter.capture() if initial is None else initial
    moved = False
    stable = 0
    for _ in range(limit):
        if checkpoint:
            checkpoint()
        following = adapter.scroll("down", 3.0)
        if following.fingerprint == frame.fingerprint:
            stable += 1
        else:
            moved = True
            stable = 0
        frame = following
        if checkpoint:
            checkpoint()
        if stable >= 2:
            return frame, moved
    raise BackfillFailure("BACKFILL_LATEST_NOT_STABLE")


def _fresh_anchor_roundtrip(adapter, anchor):
    """One bounded motion-only verification; never reads/enqueues body data."""
    result = {"verified": False, "upMoved": False, "downMoved": False, "anchorMatched": False}
    try:
        probe = adapter.scroll("up", 0.70)
        result["upMoved"] = probe.fingerprint != anchor.fingerprint
    except Exception:
        result["error"] = "BACKFILL_FRESH_ANCHOR_UP_FAILED"
    # Even an unchanged/failed up can have issued input. Always make a bounded
    # return attempt, without treating a stationary image as successful proof.
    try:
        returned, moved = _down_to_stable(adapter, 12)
        result["downMoved"] = bool(moved)
        result["anchorMatched"] = returned.fingerprint == anchor.fingerprint
    except Exception:
        result["error"] = "BACKFILL_FRESH_ANCHOR_DOWN_FAILED"
    result["verified"] = result["upMoved"] and result["downMoved"] and result["anchorMatched"] and "error" not in result
    return result


def run_backfill(config: dict[str, Any], store, state_path: Path, *, pages: int | None = None,
                 messages_per_group: int | None = None, days: int | None = None,
                 groups: list[str] | None = None, upload: bool = False, cancel_file: Path | None = None,
                 adapter_factory: Callable | None = None, progress: Callable | None = None,
                 clock: Callable = time.monotonic, sleep: Callable = time.sleep,
                 lock_wait_seconds: float = 30, utcnow: Callable = lambda: datetime.now(timezone.utc)) -> dict[str, Any]:
    from collector import validate_ocr_messages, upload_pending
    from history_window import HistoryWindow
    count_mode = messages_per_group is not None
    date_mode = days is not None
    bounded_target = date_mode or count_mode
    if date_mode and pages is not None:
        raise BackfillFailure("BACKFILL_DAYS_INVALID")
    pages = pages if pages is not None else (200 if bounded_target else 5)
    selected = selected_groups(config, groups, pages, messages_per_group, days)
    if upload and (not config.get("upload", {}).get("enabled", False) or not config.get("token", "").strip()):
        raise BackfillFailure("BACKFILL_UPLOAD_NOT_ENABLED")
    factory = adapter_factory or HistoryWindow
    report = progress or (lambda _: None)
    entries = [{"chatName": group, "pagesRequested": pages, "pagesCompleted": 0,
                "queued": 0, "uploaded": 0, "skippedScreens": 0,
                "messagesTarget": messages_per_group, "messagesCounted": 0, "matched": 0,
                "unknown": 0, "fallbackScreens": 0, "targetReached": False if bounded_target else None,
                "restoreFreshAnchorVerified": False,
                "scrollAttempted": False, "returnedToLatest": None, "stopReason": "NOT_STARTED"}
               for group in selected]
    payload: dict[str, Any] = {"event": "backfill", "status": "RUNNING", "chatName": selected[0],
                               "pagesRequested": pages, "pagesCompleted": 0, "groupIndex": 1,
                               "groupCount": len(selected), "queued": 0, "uploaded": 0,
                               "skippedScreens": 0, "returnedToLatest": False, "groups": entries}
    payload.update(messagesPerGroup=messages_per_group, messagesCounted=0, matched=0, unknown=0,
                   fallbackScreens=0, targetReached=False if bounded_target else None)
    if date_mode:
        payload.update(days=days, undatedSkipped=0)
        for entry in entries:
            entry["undatedSkipped"] = 0
    deadline = clock() + 12 * 60  # leave room for verified restoration before the 15m supervisor timeout
    failure = None
    cancelled = False

    def emit(status):
        payload["status"] = status
        if status in ("FAILED", "CANCELLED", "COMPLETED"):
            attempted = [entry for entry in entries if entry["scrollAttempted"]]
            payload["restoreRequired"] = bool(attempted)
            payload["returnedToLatest"] = bool(attempted) and all(entry["returnedToLatest"] is True for entry in attempted)
        # Snapshot lists so progress consumers cannot observe later mutations.
        report({**payload, "groups": [dict(entry) for entry in entries]})

    def check_cancel():
        if cancel_file is not None and cancel_file.exists():
            raise BackfillCancelled("BACKFILL_CANCELLED")
        if clock() >= deadline:
            if bounded_target:
                raise GroupTimeLimit("BACKFILL_GROUP_TIME_LIMIT")
            raise BackfillFailure("BACKFILL_DEADLINE_REACHED")

    def exact_frame_id(frame):
        if frame.crop is None:
            return frame.fingerprint
        return hashlib.sha256(frame.crop.tobytes()).digest()

    def save(frame, group, adapter, entry, counter, date_scan, *, allow_stop=True):
        reader = getattr(adapter, "read", None)
        if callable(reader):
            frame.messages = reader(frame, date_mode=True) if date_mode else reader(frame)
        if date_mode:
            check_cancel()
        if getattr(frame, "body_error", None):
            entry["bodyError"] = frame.body_error
            entry["skippedScreens"] += 1
            payload["skippedScreens"] += 1
        if any(message.get("chatName") != group for message in frame.messages):
            raise BackfillFailure("BACKFILL_PROVIDER_GROUP_MISMATCH")
        validated = validate_ocr_messages(frame.messages, config)
        messages = validated.get(group, [])
        if date_mode:
            approved = {m["messageId"]: m for m in messages if is_text_bubble(m)}
            events = [(kind, approved[value["messageId"]] if kind == "message" else value)
                      for kind, value in frame.date_events]
            observation = preflight.get(group)
            observed_by_end = observation is not None and exact_frame_id(frame) == observation[2]
            messages = date_scan.read(events, observed_by_end=observed_by_end, allow_stop=allow_stop)
            if not frame.body_error and any(kind == "unknown" for kind, _ in events):
                entry["skippedScreens"] += 1
                payload["skippedScreens"] += 1
            # Count eligible unique bubbles even if already present in the local outbox.
            entry["matched"] += sum(m["captureMode"] == "OCR_MESSAGE" for m in messages)
            entry.update(messagesCounted=len(date_scan.eligible), unknown=len(date_scan.eligible) - entry["matched"],
                         targetReached=date_scan.reached,
                         undatedSkipped=len(date_scan.uncertain))
            for key in ("messagesCounted", "matched", "unknown", "undatedSkipped"):
                payload[key] = sum(e[key] for e in entries)
        elif count_mode:
            chosen = []
            # Extractors emit complete bubbles in top-to-bottom order. Start at
            # the bottom so the final screen stops at the newest target items.
            for message in reversed([m for m in messages if is_text_bubble(m)]):
                if counter.count >= messages_per_group:
                    break
                if counter.consider(message) != "duplicate":
                    chosen.append(message)
            reached = counter.count >= messages_per_group
            if not reached:
                chosen.extend(m for m in messages if not is_text_bubble(m))
            messages = chosen
            entry.update(messagesCounted=counter.count, matched=counter.matched,
                         unknown=len(counter.unknown), targetReached=reached)
            payload.update(messagesCounted=sum(e["messagesCounted"] for e in entries),
                           matched=sum(e["matched"] for e in entries), unknown=sum(e["unknown"] for e in entries))
        entry["fallbackScreens"] += sum(not is_text_bubble(m) for m in messages)
        payload["fallbackScreens"] = sum(e["fallbackScreens"] for e in entries)
        queued = store.enqueue_history(group, messages + date_scan.time_updates if date_mode else messages)
        payload["queued"] += queued
        entry["queued"] += queued
        if upload:
            # Drain ready batches, respecting byte/character and ack rules. A
            # failed batch remains queued; do not block window restoration.
            for _ in range(20):
                check_cancel()
                before = store.delivered_count(group)
                result = upload_pending(store, config, only_ids=date_scan.eligible) if date_mode else upload_pending(store, config)
                payload["uploaded"] += result.get("uploaded", 0)
                entry["uploaded"] += store.delivered_count(group) - before
                if result.get("uploadError") or not (result.get("uploaded") or result.get("publicationUpdates")) or result.get("unacknowledged"):
                    if result.get("uploadError"):
                        payload["error"] = result["uploadError"]
                    break

    try:
        emit("RUNNING")
        with wait_capture_lock(state_path, check_cancel, clock, sleep, lock_wait_seconds):
            emit("RUNNING")
            preflight = {}
            if date_mode:
                # Pixels seen before the shared cutoff can prove an upper bound
                # for that exact screen, even while subsequent groups run later.
                for group in selected:
                    check_cancel()
                    try:
                        initial_adapter = factory(config, group)
                        initial_frame = initial_adapter.capture()
                        preflight[group] = (initial_adapter, initial_frame, exact_frame_id(initial_frame))
                    except Exception:
                        # Later capture/guard will report unavailable groups;
                        # never substitute a subsequent observation as evidence.
                        continue
                range_end = utcnow().astimezone(timezone.utc)
                range_start = range_end - timedelta(days=days)
                payload.update(rangeStart=range_start.isoformat(), rangeEnd=range_end.isoformat())
                emit("RUNNING")
            for index, entry in enumerate(entries):
                if bounded_target:
                    deadline = clock() + 20 * 60
                check_cancel()
                group = entry["chatName"]
                payload.update(chatName=group, groupIndex=index + 1)
                adapter = None
                touched = False
                responsive = False
                current = None
                latest_candidate = None
                counter = BubbleCounter()
                date_scan = DateRangeScan(range_start, range_end) if date_mode else None
                up_attempts = 0
                group_failure = None
                try:
                    observation = preflight.get(group)
                    adapter = observation[0] if observation else factory(config, group)
                    current = adapter.capture()  # unrecognized targets fail before any scroll
                    check_cancel()
                    touched = True
                    current, moved_down = _down_to_stable(adapter, 12, current, check_cancel)
                    entry["scrollAttempted"] = getattr(adapter, "scroll_attempted", touched)
                    responsive = moved_down or current.at_bottom
                    latest_candidate = current.fingerprint
                    if observation and exact_frame_id(current) != observation[2]:
                        save(observation[1], group, adapter, entry, counter, date_scan, allow_stop=False)
                    save(current, group, adapter, entry, counter, date_scan)
                    emit("RUNNING")
                    for _ in range(pages):
                        if bounded_target and entry["targetReached"]:
                            entry["stopReason"] = "DATE_BOUNDARY_REACHED" if date_mode else "TARGET_REACHED"
                            break
                        check_cancel()
                        up_attempts += 1
                        following = adapter.scroll("up", 0.70)
                        entry["pagesCompleted"] += 1
                        payload["pagesCompleted"] += 1
                        changed = following.fingerprint != current.fingerprint
                        if bounded_target and not changed:
                            # WeChat can load older history asynchronously after
                            # an unchanged wheel frame. Retry captures only,
                            # without exceeding the bounded up-scroll attempts.
                            for _ in range(2):
                                sleep(1.0)
                                check_cancel()
                                following = adapter.capture()
                                changed = following.fingerprint != current.fingerprint
                                if changed:
                                    break
                        responsive = responsive or changed
                        if changed or not date_mode:
                            save(following, group, adapter, entry, counter, date_scan)
                        emit("RUNNING")
                        current = following
                        if bounded_target and entry["targetReached"]:
                            entry["stopReason"] = "DATE_BOUNDARY_REACHED" if date_mode else "TARGET_REACHED"
                            break
                        if not changed:
                            entry["stopReason"] = "TOP_REACHED" if responsive else "SCROLL_UNVERIFIED"
                            if not responsive:
                                raise BackfillFailure("BACKFILL_SCROLL_UNRESPONSIVE")
                            break
                    else:
                        entry["stopReason"] = "PAGE_LIMIT"
                except GroupTimeLimit:
                    entry["stopReason"] = "TIME_LIMIT"
                except (BackfillCancelled, KeyboardInterrupt):
                    cancelled = True
                    entry["stopReason"] = "CANCELLED"
                except Exception as exc:
                    group_failure = _failure_code(exc, "BACKFILL_CAPTURE_FAILED")
                    entry["stopReason"] = group_failure
                finally:
                    # Native windows record the first actual wheel send. Other
                    # providers conservatively assume a scroll could have moved.
                    entry["scrollAttempted"] = getattr(adapter, "scroll_attempted", touched)
                    if entry["scrollAttempted"]:
                        emit("RESTORING")
                        try:
                            budget = restore_budget(up_attempts, bounded_target)
                            entry["restoreStepsLimit"] = budget
                            restored, moved = _down_to_stable(adapter, budget)
                            entry.update(restoreViewportStable=True, restoreMoved=bool(moved),
                                         restoreAnchorMatched=restored.fingerprint == latest_candidate,
                                         nativeBottomConfirmed=bool(restored.at_bottom))
                            # Still images alone cannot certify a Qt scroll
                            # target. Demand native bottom proof or demonstrated
                            # movement both in history and during return.
                            verified = restored.at_bottom or (latest_candidate is not None and responsive and moved
                                                              and restored.fingerprint == latest_candidate)
                            if (not verified and moved and latest_candidate is not None
                                    and restored.fingerprint != latest_candidate):
                                entry["restoreFreshAnchorAttempted"] = True
                                emit("RESTORING")
                                fresh = _fresh_anchor_roundtrip(adapter, restored)
                                entry.update(restoreFreshAnchorVerified=bool(fresh["verified"]),
                                             restoreFreshAnchorUpMoved=bool(fresh["upMoved"]),
                                             restoreFreshAnchorDownMoved=bool(fresh["downMoved"]),
                                             restoreFreshAnchorMatched=bool(fresh["anchorMatched"]))
                                if fresh.get("error"):
                                    entry["restoreFreshAnchorError"] = fresh["error"]
                                verified = bool(fresh["verified"])
                            entry["returnedToLatest"] = bool(verified)
                            if not verified:
                                group_failure = "BACKFILL_RESTORE_UNVERIFIED"
                        except Exception as exc:
                            entry["returnedToLatest"] = False
                            entry["restoreError"] = _failure_code(exc, "BACKFILL_RESTORE_CAPTURE_OR_SCROLL_FAILED")
                            group_failure = "BACKFILL_RESTORE_FAILED"
                if group_failure:
                    failure = group_failure
                    break
                if cancelled:
                    break
                emit("RUNNING")
            if bounded_target:
                payload["targetReached"] = all(entry["targetReached"] is True for entry in entries)
            if failure:
                payload["error"] = failure
                emit("FAILED")
            elif cancelled:
                emit("CANCELLED")
            elif date_mode and not payload["targetReached"]:
                payload["error"] = "BACKFILL_DATE_RANGE_INCOMPLETE"
                emit("FAILED")
            elif count_mode and not payload["targetReached"]:
                payload["error"] = "BACKFILL_TARGET_NOT_REACHED"
                emit("FAILED")
            else:
                emit("COMPLETED")
    except CaptureBusy:
        payload["error"] = "CAPTURE_LOCK_BUSY"
        emit("FAILED")
    except (BackfillCancelled, KeyboardInterrupt):
        emit("CANCELLED")
    except Exception as exc:
        payload["error"] = _failure_code(exc, "BACKFILL_FAILED")
        emit("FAILED")
    return payload
