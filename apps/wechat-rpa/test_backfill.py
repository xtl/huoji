from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import collector as c
from backfill import BackfillFailure, BubbleCounter, restore_budget, run_backfill, selected_groups
from capture_lock import CaptureBusy, CaptureLock
from history_window import HistoryError, Viewport

HERE = Path(__file__).resolve().parent


def message(group, position):
    return {"messageId": f"test-history-{group}-{position}", "chatName": group, "sender": "Fixture Merchant",
            "sentAt": None, "observedAt": "2026-11-02T00:00:00Z", "text": f"fixture historical body {position}",
            "captureMode": "OCR_MESSAGE"}


class FakeWindow:
    def __init__(self, config, group, *, top=100, native_bottom=False, cancel=None,
                 fail_capture=False, fail_restore=False, changed_anchor=False, bad_body=None,
                 fresh_probe_unresponsive=False, changing_again=False):
        self.group, self.position, self.top = group, 0, top
        self.native_bottom = native_bottom
        self.calls = []
        self.cancel = cancel
        self.fail_capture = fail_capture
        self.fail_restore = fail_restore
        self.changed_anchor = changed_anchor
        self.did_up = False
        self.bad_body = bad_body
        self.restore_count = 0
        self.read_count = 0
        self.fresh_probe_unresponsive = fresh_probe_unresponsive
        self.changing_again = changing_again

    def capture(self):
        if self.fail_capture:
            raise HistoryError("BACKFILL_TARGET_CHANGED")
        suffix = "_changed" if self.changed_anchor and self.did_up and self.position == 0 else ""
        if suffix and self.changing_again:
            suffix += f"_{self.restore_count}"
        return Viewport(f"{self.group}-{self.position}{suffix}", [message(self.group, self.position)],
                        self.native_bottom and self.position == 0)

    def scroll(self, direction, fraction):
        self.calls.append((direction, fraction))
        if direction == "up":
            self.did_up = True
            if self.fresh_probe_unresponsive and self.restore_count:
                return self.capture()
            self.position = min(self.top, self.position + 1)
            if self.cancel:
                self.cancel.touch()
        else:
            if self.fail_restore and self.did_up:
                raise HistoryError("BACKFILL_TARGET_CHANGED")
            if 0 < self.position <= 10:
                self.restore_count += 1
            self.position = max(0, self.position - 10)
        return self.capture()

    def read(self, frame):
        self.read_count += 1
        if self.position == self.bad_body:
            frame.body_error = "OCR_TOO_UNCERTAIN"
            return []
        return frame.messages


class BackfillTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.lock_patch = patch("capture_lock.DESKTOP_LOCK_PATH", Path(self.temp.name) / "desktop.capture.lock")
        self.lock_patch.start()
        self.state_path = Path(self.temp.name) / "state.sqlite3"
        self.config = c.load_config(HERE / "fixtures" / "config.json")
        self.store = c.StateStore(self.state_path)
        self.store.bind_scope(self.config)
        self.progress = []
        self.adapters = []

    def tearDown(self):
        self.store.close()
        self.lock_patch.stop()
        self.temp.cleanup()

    def run_job(self, **kwargs):
        options = kwargs.pop("adapter_options", {})
        def factory(config, group):
            adapter = FakeWindow(config, group, **options)
            self.adapters.append(adapter)
            return adapter
        return run_backfill(self.config, self.store, self.state_path, adapter_factory=factory,
                            progress=self.progress.append, **kwargs)

    def run_count_frames(self, frames, *, target, **options):
        groups = options.pop("groups", [self.config["groups"][0]])
        adapter_options = options.pop("adapter_options", {})
        class Window(FakeWindow):
            def capture(inner):
                frame = super().capture()
                frame.messages = deepcopy(frames.get(inner.position, []))
                for item in frame.messages:
                    item["chatName"] = inner.group
                return frame
        def factory(config, group):
            adapter = Window(config, group, **adapter_options)
            self.adapters.append(adapter)
            return adapter
        return run_backfill(self.config, self.store, self.state_path, messages_per_group=target,
                            groups=groups, adapter_factory=factory, progress=self.progress.append,
                            sleep=lambda _: None, **options)

    def test_count_mode_defaults_to_bounded_200_pages_and_stops_at_target(self):
        result = self.run_job(messages_per_group=3, groups=[self.config["groups"][0]])
        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(result["pagesRequested"], 200)
        self.assertEqual(result["pagesCompleted"], 2)
        self.assertEqual(result["messagesCounted"], 3)
        self.assertEqual(result["matched"], 3)
        self.assertEqual(result["unknown"], 0)
        self.assertTrue(result["targetReached"])
        self.assertEqual(result["groups"][0]["stopReason"], "TARGET_REACHED")

    def test_both_groups_reach_two_hundred_without_sharing_their_counters(self):
        result = self.run_job(messages_per_group=200, adapter_options={"top": 500})
        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(result["messagesCounted"], 400)
        self.assertTrue(result["targetReached"])
        self.assertTrue(result["returnedToLatest"])
        self.assertEqual([entry["messagesCounted"] for entry in result["groups"]], [200, 200])
        self.assertEqual([entry["pagesCompleted"] for entry in result["groups"]], [199, 199])
        self.assertEqual(self.store.status()["pending"], 400)

    def test_complete_unknown_bubbles_count_but_do_not_acquire_a_sender(self):
        group = self.config["groups"][0]
        frames = {index: [{**message(group, index), "sender": "未识别（截图识别）",
                           "captureMode": "OCR_SNAPSHOT", "captureUnit": "TEXT_BUBBLE"}] for index in range(3)}
        result = self.run_count_frames(frames, target=3)
        self.assertTrue(result["targetReached"])
        self.assertEqual((result["matched"], result["unknown"]), (0, 3))
        self.assertTrue(all(json.loads(row["payload"])["sender"] == "未识别（截图识别）" for row in self.store.pending(50)))

    def test_each_count_group_gets_its_own_twenty_minute_collection_budget(self):
        elapsed = [0.0]
        class Timed(FakeWindow):
            def scroll(inner, direction, fraction):
                if direction == "up":
                    elapsed[0] += 20 * 60 + 1
                return super().scroll(direction, fraction)
        adapters = []
        def factory(config, group):
            adapter = Timed(config, group)
            adapters.append(adapter)
            return adapter
        result = run_backfill(self.config, self.store, self.state_path, messages_per_group=200,
                              adapter_factory=factory, progress=self.progress.append,
                              clock=lambda: elapsed[0], sleep=lambda _: None)
        self.assertEqual(len(adapters), 2)
        self.assertEqual([entry["stopReason"] for entry in result["groups"]], ["TIME_LIMIT", "TIME_LIMIT"])
        self.assertEqual(result["error"], "BACKFILL_TARGET_NOT_REACHED")
        self.assertTrue(result["returnedToLatest"])

    def test_count_limits_preserve_legacy_page_bounds(self):
        for target in (0, 201, True):
            with self.assertRaises(BackfillFailure):
                selected_groups(self.config, None, 200, target)
        self.assertEqual(selected_groups(self.config, None, 200, 200), self.config["groups"])
        with self.assertRaises(BackfillFailure):
            selected_groups(self.config, None, 31)
        with self.assertRaises(BackfillFailure):
            selected_groups(self.config, None, 201, 200)

    def test_count_upgrades_unknown_without_inheriting_author_and_cuts_old_tail(self):
        group = self.config["groups"][0]
        known_b = {**message(group, 1), "messageId": "known-b", "sender": "Bob", "text": "latest body B"}
        unknown_a = {**message(group, 2), "messageId": "unknown-a", "sender": "未识别（截图识别）",
                     "text": "body A", "captureMode": "OCR_SNAPSHOT", "captureUnit": "TEXT_BUBBLE"}
        known_a = {**unknown_a, "messageId": "known-a", "sender": "Alice", "captureMode": "OCR_MESSAGE"}
        wanted_c = {**message(group, 3), "messageId": "wanted-c", "text": "wanted older C"}
        too_old = {**message(group, 4), "messageId": "too-old", "text": "older beyond target"}
        remainder = {**message(group, 5), "messageId": "remainder", "text": "uncertain older viewport",
                     "captureMode": "OCR_SNAPSHOT", "captureUnit": "VIEWPORT_REMAINDER"}
        result = self.run_count_frames({0: [unknown_a, known_b], 1: [too_old, wanted_c, known_a, remainder]}, target=3)
        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(result["messagesCounted"], 3)
        self.assertEqual((result["matched"], result["unknown"]), (3, 0))
        queued = [json.loads(row["payload"]) for row in self.store.pending(50)]
        self.assertEqual({m["messageId"] for m in queued}, {"unknown-a", "known-b", "known-a", "wanted-c"})
        self.assertEqual(next(m for m in queued if m["messageId"] == "unknown-a")["sender"], "未识别（截图识别）")
        self.assertEqual(result["fallbackScreens"], 0)

    def test_count_duplicate_whitespace_variants_are_neither_counted_nor_queued_twice(self):
        group = self.config["groups"][0]
        first = {**message(group, 0), "text": "SK 64G 200 pcs", "sender": "Alice"}
        variant = {**first, "messageId": "whitespace-variant", "text": "SK64G\n200pcs", "sender": "A lice"}
        newer = {**message(group, 2), "text": "next unique text"}
        result = self.run_count_frames({0: [first], 1: [newer, variant]}, target=2)
        self.assertTrue(result["targetReached"])
        self.assertEqual(result["queued"], 2)
        self.assertFalse(self.store.db.execute("SELECT 1 FROM seen WHERE message_id='whitespace-variant'").fetchone())

    def test_same_text_from_two_known_senders_counts_separately(self):
        counter = BubbleCounter()
        base = message(self.config["groups"][0], 0)
        self.assertEqual(counter.consider({**base, "sender": "Alice"}), "new")
        self.assertEqual(counter.consider({**base, "sender": "Bob"}), "new")
        self.assertEqual((counter.count, counter.matched), (2, 2))

    def test_page_ceiling_with_remainder_only_reports_target_shortfall(self):
        group = self.config["groups"][0]
        remainder = {**message(group, 0), "captureMode": "OCR_SNAPSHOT", "captureUnit": "VIEWPORT_REMAINDER"}
        result = self.run_count_frames({0: [remainder], 1: [{**remainder, "messageId": "r1"}]},
                                       target=200, pages=1)
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["error"], "BACKFILL_TARGET_NOT_REACHED")
        self.assertEqual(result["messagesCounted"], 0)
        self.assertEqual(result["groups"][0]["stopReason"], "PAGE_LIMIT")
        self.assertEqual(result["fallbackScreens"], 2)
        self.assertTrue(result["returnedToLatest"])

    def test_restore_budget_scales_for_two_hundred_up_attempts(self):
        self.assertEqual(restore_budget(30, False), 12)
        self.assertEqual(restore_budget(200, True), 53)
        self.assertEqual(restore_budget(1000, True), 80)

    def test_new_latest_anchor_can_be_verified_once_without_reprocessing_messages(self):
        result = self.run_job(messages_per_group=3, groups=[self.config["groups"][0]],
                              adapter_options={"changed_anchor": True})
        self.assertEqual(result["status"], "COMPLETED")
        self.assertTrue(result["groups"][0]["restoreViewportStable"])
        self.assertFalse(result["groups"][0]["restoreAnchorMatched"])
        self.assertTrue(result["groups"][0]["restoreFreshAnchorVerified"])
        self.assertTrue(result["groups"][0]["restoreFreshAnchorUpMoved"])
        self.assertTrue(result["groups"][0]["restoreFreshAnchorDownMoved"])
        self.assertTrue(result["groups"][0]["restoreFreshAnchorMatched"])
        self.assertTrue(result["returnedToLatest"])
        self.assertEqual((result["pagesCompleted"], result["messagesCounted"], result["queued"]), (2, 3, 3))
        self.assertEqual(self.adapters[0].read_count, 3)
        self.assertEqual(sum(direction == "up" for direction, _ in self.adapters[0].calls), 3)
        self.assertEqual(self.store.status()["pending"], 3)

    def test_count_mode_waits_for_delayed_history_without_extra_up_attempt(self):
        group = self.config["groups"][0]
        class Delayed(FakeWindow):
            def __init__(inner, config, group):
                super().__init__(config, group)
                inner.pending = False
            def scroll(inner, direction, fraction):
                if direction == "up":
                    inner.calls.append((direction, fraction))
                    inner.pending = True
                    return super(Delayed, inner).capture()
                return super().scroll(direction, fraction)
            def capture(inner):
                if inner.pending:
                    inner.pending = False
                    inner.position += 1
                    inner.did_up = True
                return super().capture()
        adapter = Delayed(self.config, group)
        sleeps = []
        result = run_backfill(self.config, self.store, self.state_path, messages_per_group=2, pages=1,
                              groups=[group], adapter_factory=lambda *_: adapter, progress=self.progress.append,
                              sleep=sleeps.append)
        self.assertTrue(result["targetReached"])
        self.assertEqual(result["pagesCompleted"], 1)
        self.assertEqual(sleeps, [1.0])

    def test_page_limit_and_two_groups_are_bounded_and_restore(self):
        result = self.run_job(pages=2)
        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(result["pagesCompleted"], 4)
        self.assertEqual(result["queued"], 6)  # latest + two older views per group
        self.assertTrue(result["returnedToLatest"])
        for adapter in self.adapters:
            self.assertEqual([fraction for direction, fraction in adapter.calls if direction == "up"], [0.7, 0.7])
            self.assertEqual(adapter.position, 0)
        self.assertTrue(all(event["event"] == "backfill" for event in self.progress))
        self.assertNotIn("fixture historical body", json.dumps(self.progress))
        self.assertNotIn("Fixture Merchant", json.dumps(self.progress))

    def test_invalid_limits_or_group_choices_fail_before_any_adapter(self):
        for pages in (0, 31, True):
            with self.subTest(pages=pages), self.assertRaises(BackfillFailure):
                selected_groups(self.config, None, pages)
        for groups in ([], ["other"], [self.config["groups"][0]] * 2):
            with self.subTest(groups=groups), self.assertRaises(BackfillFailure):
                selected_groups(self.config, groups, 5)

    def test_seen_baseline_can_be_backfilled_but_pending_and_delivered_never_requeued(self):
        group = self.config["groups"][0]
        self.store.observe(group, [message(group, 0)], "OCR_SEGMENTS_V1")
        self.assertEqual(self.store.status()["pending"], 0)
        result = self.run_job(pages=1, groups=[group])
        self.assertEqual(result["queued"], 2)
        pending = self.store.pending(50)
        self.store.delivered(pending[:1])
        result = self.run_job(pages=1, groups=[group])
        self.assertEqual(result["queued"], 0)
        self.assertEqual(self.store.status()["pending"], 1)
        self.assertEqual(self.store.status()["delivered"], 1)

    def test_cancel_stops_new_up_steps_but_restores_latest(self):
        cancel = Path(self.temp.name) / "cancel"
        result = self.run_job(pages=30, groups=[self.config["groups"][0]], cancel_file=cancel,
                              adapter_options={"cancel": cancel})
        self.assertEqual(result["status"], "CANCELLED")
        self.assertEqual(result["pagesCompleted"], 1)
        self.assertTrue(result["returnedToLatest"])
        self.assertEqual(self.adapters[0].position, 0)
        self.assertIn("RESTORING", [event["status"] for event in self.progress])

    def test_cancel_before_start_never_constructs_or_scrolls_adapter(self):
        cancel = Path(self.temp.name) / "cancel"
        cancel.touch()
        result = self.run_job(cancel_file=cancel)
        self.assertEqual(result["status"], "CANCELLED")
        self.assertEqual(self.adapters, [])
        self.assertFalse(result["restoreRequired"])

    def test_cancel_between_groups_retains_confirmed_restore_of_touched_group(self):
        cancel = Path(self.temp.name) / "cancel"
        def report(event):
            self.progress.append(event)
            if event["groups"][0]["returnedToLatest"] is True:
                cancel.touch()
        def factory(config, group):
            adapter = FakeWindow(config, group)
            self.adapters.append(adapter)
            return adapter
        result = run_backfill(self.config, self.store, self.state_path, pages=1,
                              adapter_factory=factory, progress=report, cancel_file=cancel)
        self.assertEqual(result["status"], "CANCELLED")
        self.assertTrue(result["returnedToLatest"])
        self.assertEqual(len(self.adapters), 1)

    def test_restore_failure_is_failed_and_explicit_false(self):
        result = self.run_job(pages=2, groups=[self.config["groups"][0]], adapter_options={"fail_restore": True})
        self.assertEqual(result["status"], "FAILED")
        self.assertFalse(result["returnedToLatest"])
        self.assertFalse(result["groups"][0]["returnedToLatest"])
        self.assertEqual(result["error"], "BACKFILL_RESTORE_FAILED")
        self.assertTrue(result["restoreRequired"])
        self.assertEqual(result["groups"][0]["restoreError"], "BACKFILL_TARGET_CHANGED")

    def test_static_unresponsive_view_is_not_claimed_as_latest_or_top(self):
        result = self.run_job(pages=2, groups=[self.config["groups"][0]], adapter_options={"top": 0})
        self.assertEqual(result["status"], "FAILED")
        self.assertFalse(result["returnedToLatest"])
        self.assertEqual(result["pagesCompleted"], 1)

    def test_native_bottom_evidence_can_confirm_an_empty_history(self):
        result = self.run_job(pages=30, groups=[self.config["groups"][0]],
                              adapter_options={"top": 0, "native_bottom": True})
        self.assertEqual(result["status"], "COMPLETED")
        self.assertTrue(result["returnedToLatest"])
        self.assertEqual(result["groups"][0]["stopReason"], "TOP_REACHED")

    def test_anchor_changing_again_during_single_fresh_roundtrip_stays_unverified(self):
        result = self.run_job(pages=2, groups=[self.config["groups"][0]],
                              adapter_options={"changed_anchor": True, "changing_again": True})
        self.assertEqual(result["status"], "FAILED")
        self.assertFalse(result["returnedToLatest"])
        self.assertEqual(result["error"], "BACKFILL_RESTORE_UNVERIFIED")
        self.assertTrue(result["groups"][0]["restoreFreshAnchorAttempted"])
        self.assertFalse(result["groups"][0]["restoreFreshAnchorVerified"])
        self.assertFalse(result["groups"][0]["restoreFreshAnchorMatched"])
        self.assertEqual(self.adapters[0].read_count, 3)
        self.assertEqual(sum(direction == "up" for direction, _ in self.adapters[0].calls), 3)

    def test_stationary_fresh_probe_cannot_verify_a_changed_anchor(self):
        result = self.run_job(pages=2, groups=[self.config["groups"][0]],
                              adapter_options={"changed_anchor": True, "fresh_probe_unresponsive": True})
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["error"], "BACKFILL_RESTORE_UNVERIFIED")
        self.assertFalse(result["returnedToLatest"])
        self.assertTrue(result["groups"][0]["restoreFreshAnchorAttempted"])
        self.assertFalse(result["groups"][0]["restoreFreshAnchorUpMoved"])
        self.assertFalse(result["groups"][0]["restoreFreshAnchorVerified"])
        self.assertEqual(self.adapters[0].read_count, 3)

    def test_unrecognized_target_never_receives_scroll(self):
        result = self.run_job(pages=2, groups=[self.config["groups"][0]], adapter_options={"fail_capture": True})
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(self.adapters[0].calls, [])
        self.assertFalse(result["restoreRequired"])
        self.assertIsNone(result["groups"][0]["returnedToLatest"])
        self.assertFalse(result["groups"][0]["scrollAttempted"])
        self.assertEqual(result["groups"][0]["stopReason"], "BACKFILL_TARGET_CHANGED")
        self.assertEqual(self.store.status()["seen"], 0)

    def test_failure_before_first_native_send_skips_restore_and_keeps_error_code(self):
        from window_capture import WindowCaptureError
        class Window(FakeWindow):
            scroll_attempted = False
            def scroll(self, direction, fraction):
                self.calls.append(direction)
                raise WindowCaptureError("WGC_TIMEOUT: capture details")

        group = self.config["groups"][0]
        adapter = Window(self.config, group)
        result = run_backfill(self.config, self.store, self.state_path, pages=1, groups=[group],
                              adapter_factory=lambda *_: adapter, progress=self.progress.append)
        self.assertEqual(adapter.calls, ["down"])
        self.assertEqual(result["error"], "WGC_TIMEOUT")
        self.assertFalse(result["restoreRequired"])
        self.assertNotIn("RESTORING", [event["status"] for event in self.progress])

    def test_second_window_missing_does_not_undo_first_group_restore(self):
        first, second = self.config["groups"]
        def factory(config, group):
            if group == second:
                raise HistoryError("OCR_WINDOW_NOT_FOUND")
            return FakeWindow(config, group)
        result = run_backfill(self.config, self.store, self.state_path, pages=1, adapter_factory=factory)
        self.assertEqual((result["status"], result["error"]), ("FAILED", "OCR_WINDOW_NOT_FOUND"))
        self.assertTrue(result["restoreRequired"])
        self.assertTrue(result["returnedToLatest"])
        self.assertEqual([(row["chatName"], row["scrollAttempted"], row["returnedToLatest"])
                          for row in result["groups"]], [(first, True, True), (second, False, None)])

    def test_uncertain_body_is_skipped_without_blocking_restore_or_marking_seen(self):
        group = self.config["groups"][0]
        result = self.run_job(pages=2, groups=[group], adapter_options={"bad_body": 1})
        self.assertEqual(result["status"], "COMPLETED")
        self.assertTrue(result["returnedToLatest"])
        self.assertEqual(result["skippedScreens"], 1)
        self.assertEqual(result["groups"][0]["skippedScreens"], 1)
        self.assertEqual(result["queued"], 2)
        self.assertIsNone(self.store.db.execute("SELECT 1 FROM seen WHERE message_id=?", (message(group, 1)["messageId"],)).fetchone())

    def test_capture_lock_rejects_backfill_without_constructing_adapter(self):
        with CaptureLock(self.state_path):
            result = self.run_job(pages=2, lock_wait_seconds=0)
        self.assertEqual(result["error"], "CAPTURE_LOCK_BUSY")
        self.assertEqual(self.adapters, [])

    def test_backfill_waits_for_realtime_lock_then_proceeds(self):
        attempts = []
        class Contended:
            def __enter__(self):
                attempts.append(1)
                if len(attempts) <= 2:
                    raise CaptureBusy("CAPTURE_LOCK_BUSY")
                return self
            def __exit__(self, *args):
                pass
        sleeps = []
        with patch("backfill.CaptureLock", return_value=Contended()):
            result = self.run_job(pages=1, groups=[self.config["groups"][0]], sleep=sleeps.append)
        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(len(attempts), 3)
        self.assertEqual(sleeps, [0.2, 0.2])

    def test_waiting_for_realtime_lock_responds_to_cancel(self):
        cancel = Path(self.temp.name) / "cancel"
        class Contended:
            def __enter__(self):
                raise CaptureBusy("CAPTURE_LOCK_BUSY")
            def __exit__(self, *args):
                pass
        with patch("backfill.CaptureLock", return_value=Contended()):
            result = self.run_job(cancel_file=cancel, sleep=lambda _: cancel.touch())
        self.assertEqual(result["status"], "CANCELLED")
        self.assertEqual(self.adapters, [])


class LockTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.desktop_lock = Path(self.directory.name) / "desktop.capture.lock"
        self.lock_patch = patch("capture_lock.DESKTOP_LOCK_PATH", self.desktop_lock)
        self.lock_patch.start()

    def tearDown(self):
        self.lock_patch.stop()
        self.directory.cleanup()

    def test_scope_or_state_path_change_cannot_bypass_desktop_lock_and_release_works(self):
        with tempfile.TemporaryDirectory() as directory:
            a, b = Path(directory) / "a.sqlite3", Path(directory) / "b.sqlite3"
            with CaptureLock(a):
                with self.assertRaises(CaptureBusy):
                    with CaptureLock(b):
                        self.fail("different state paths must share the same desktop lock")
            with CaptureLock(b):
                pass

    def test_lock_is_visible_to_another_process(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "a.sqlite3"
            script = "from pathlib import Path\nfrom capture_lock import CaptureLock,CaptureBusy\nimport capture_lock,sys\ncapture_lock.DESKTOP_LOCK_PATH=Path(sys.argv[2])\ntry:\n with CaptureLock(Path(sys.argv[1])): print('FREE')\nexcept CaptureBusy: print('BUSY')"
            with CaptureLock(state):
                result = subprocess.run([sys.executable, "-c", script, str(Path(directory) / "b.sqlite3"), str(self.desktop_lock)],
                                        cwd=HERE, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout.strip(), "BUSY")

    def test_collect_once_pauses_when_backfill_holds_lock_without_reading_ui(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state.sqlite3"
            cfg = c.load_config(HERE / "fixtures" / "config.json")
            cfg["statePath"] = str(state)
            path = Path(directory) / "config.json"
            path.write_text(json.dumps(cfg), encoding="utf-8")
            with CaptureLock(state), patch.object(c, "read_live_windows") as read, patch.object(c, "emit") as output:
                self.assertEqual(c.main(["--config", str(path), "collect", "--once"]), 0)
                read.assert_not_called()
                self.assertEqual(output.call_args.args[0]["status"], "PAUSED_FOR_BACKFILL")


if __name__ == "__main__":
    unittest.main()
