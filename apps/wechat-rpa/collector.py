"""Read-only, visible-message WeChat collector. No live UI import during replay/tests."""
from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
import threading
from typing import Any, Iterable
import urllib.error
import urllib.parse
import urllib.request

from group_names import valid_group_name

MAX_BATCH_TEXT = 200_000
MAX_MESSAGE_TEXT = 20_000
SELECTOR_KEYS = {"controlType", "name", "automationId", "className", "maxDepth"}
REQUIRED_SELECTORS = ("window", "title", "messageList", "messageItem", "sender", "text")


class CollectorError(Exception):
    """A safe, non-content-bearing error suitable for CLI output."""


class UnsupportedUIA(CollectorError):
    """The client does not expose the explicitly configured chat controls."""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def wire_text_length(text: str) -> int:
    # The TypeScript API validates String.length (UTF-16 code units), so an
    # emoji counts as two units even though Python len counts one code point.
    return len(text.encode("utf-16-le", errors="surrogatepass")) // 2


def validate_base_url(value: str) -> str:
    try:
        parts = urllib.parse.urlsplit(value)
        _ = parts.port
    except ValueError as exc:
        raise CollectorError("apiBaseUrl is invalid") from exc
    if parts.username or parts.password or parts.query or parts.fragment or not parts.hostname:
        raise CollectorError("apiBaseUrl must not contain credentials, query, or fragment")
    loopback = parts.hostname.lower() == "localhost"
    try:
        loopback = loopback or ipaddress.ip_address(parts.hostname).is_loopback
    except ValueError:
        pass
    if parts.scheme != "https" and not (parts.scheme == "http" and loopback):
        raise CollectorError("apiBaseUrl requires HTTPS, or HTTP on localhost/loopback")
    if parts.path not in ("", "/"):
        raise CollectorError("apiBaseUrl must be the server origin, without an API path")
    return value.rstrip("/")


def load_config(path: Path) -> dict[str, Any]:
    try:
        config = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        raise CollectorError("cannot read valid JSON config") from exc
    validate_config(config)
    config["_configDir"] = str(path.resolve().parent)
    return config


def apply_calibration(config: dict[str, Any], path: Path, *, required_groups=None) -> dict[str, Any]:
    try:
        calibration = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        raise CollectorError("cannot read valid JSON calibration file") from exc
    if (not isinstance(calibration, dict) or calibration.get("schemaVersion") != 1
            or set(calibration) - {"schemaVersion", "profiles"}
            or not isinstance(calibration.get("profiles"), dict)
            or not all(valid_group_name(name) for name in calibration["profiles"])):
        raise CollectorError("calibration requires schemaVersion 1 and profiles keyed by exact group names")
    from ocr_capture import OcrCaptureError, profile_for
    merged = dict(config)
    capture = dict(config.get("capture", {}))
    if not isinstance(capture.get("profiles", {}), dict):
        raise CollectorError("capture.profiles must be an object")
    profiles = dict(capture.get("profiles", {}))
    profiles.update(calibration["profiles"])
    capture.update(mode="ocr", profiles=profiles)
    merged["capture"] = capture
    validate_config(merged)
    try:
        # Saved templates may also belong to paused groups. They grant no capture access.
        for group in (set(merged["groups"]) if required_groups is None else set(required_groups)):
            if group not in merged["groups"]:
                raise CollectorError("requested group is not enabled in the connection")
            profile_for(merged, group)
    except OcrCaptureError as exc:
        raise CollectorError(str(exc)) from exc
    return merged


def validate_config(config: dict[str, Any]) -> None:
    if not isinstance(config, dict) or config.get("schemaVersion") != 1:
        raise CollectorError("schemaVersion must be 1")
    if config.get("captureMode", "UIA_MESSAGE") not in ("UIA_MESSAGE", "OCR_SNAPSHOT", "OCR_MESSAGE"):
        raise CollectorError("captureMode must be UIA_MESSAGE, OCR_SNAPSHOT or OCR_MESSAGE")
    capture = config.get("capture", {})
    if not isinstance(capture, dict) or capture.get("mode", "uia") not in ("uia", "ocr"):
        raise CollectorError("capture.mode must be uia or ocr")
    groups = config.get("groups")
    if (not isinstance(groups, list) or not all(valid_group_name(g) for g in groups)
            or len(groups) != len(set(groups))):
        raise CollectorError("groups must be a list of unique, exact standalone chat names")
    for key in ("deviceId", "apiBaseUrl", "statePath"):
        if not isinstance(config.get(key), str) or not config[key].strip():
            raise CollectorError(f"{key} must be a non-empty string")
    validate_base_url(config["apiBaseUrl"])
    scope = config.get("scope")
    if (not isinstance(scope, dict) or not all(isinstance(scope.get(k), str) and 1 <= len(scope[k].strip()) <= 200
                                              for k in ("userId", "workspaceId"))):
        raise CollectorError("scope requires the intended userId and workspaceId")
    if not isinstance(config.get("token", ""), str) or any(c in config.get("token", "") for c in "\r\n"):
        raise CollectorError("token is invalid")
    interval = config.get("pollIntervalSeconds", 10)
    if isinstance(interval, bool) or not isinstance(interval, (int, float)) or not 1 <= interval <= 3600:
        raise CollectorError("pollIntervalSeconds must be between 1 and 3600")
    upload = config.get("upload", {})
    if not isinstance(upload, dict) or not isinstance(upload.get("enabled", False), bool):
        raise CollectorError("upload.enabled must be boolean")
    batch_size = upload.get("batchSize", 50)
    if isinstance(batch_size, bool) or not isinstance(batch_size, int) or not 1 <= batch_size <= 50:
        raise CollectorError("upload.batchSize must be between 1 and 50")
    selectors = config.get("selectors", {})
    if not isinstance(selectors, dict):
        raise CollectorError("selectors must be an object")
    for role in REQUIRED_SELECTORS:
        selector = selectors.get(role)
        if not isinstance(selector, dict) or not selector.get("controlType") or set(selector) - SELECTOR_KEYS:
            raise CollectorError(f"selectors.{role} requires a controlType and supported exact-match properties")
        if not all(isinstance(v, str) and v for k, v in selector.items() if k != "maxDepth"):
            raise CollectorError(f"selectors.{role} properties must be non-empty strings")
        depth = selector.get("maxDepth", 1)
        if isinstance(depth, bool) or not isinstance(depth, int) or not 1 <= depth <= 12:
            raise CollectorError(f"selectors.{role}.maxDepth must be between 1 and 12")
    for role in ("window", "messageList", "sender", "text"):
        if not any(config["selectors"][role].get(k) for k in ("name", "automationId", "className")):
            raise CollectorError(f"selectors.{role} requires a specific name, automationId or className")
    if selectors["window"].get("controlType") != "WindowControl":
        raise CollectorError("window must select a top-level WindowControl")
    if selectors["title"].get("name") != "{chatName}":
        raise CollectorError("title.name must exactly match {chatName}; fuzzy title matching is forbidden")
    if selectors["messageList"]["controlType"] not in ("ListControl", "DataGridControl", "PaneControl"):
        raise CollectorError("messageList must be an explicitly identified list/grid/pane")
    if selectors["messageItem"]["controlType"] not in ("ListItemControl", "DataItemControl", "GroupControl"):
        raise CollectorError("messageItem must select individual message rows")


@dataclass
class Node:
    control_type: str
    name: str = ""
    automation_id: str = ""
    class_name: str = ""
    offscreen: bool = False
    children: list["Node"] = field(default_factory=list)

    @classmethod
    def from_json(cls, value: dict[str, Any], depth: int = 0, budget: list[int] | None = None) -> "Node":
        budget = budget if budget is not None else [0]
        budget[0] += 1
        if depth > 12 or budget[0] > 2000 or not isinstance(value, dict):
            raise CollectorError("fixture tree exceeds bounds or has invalid nodes")
        return cls(str(value.get("controlType", "")), str(value.get("name", "")),
                   str(value.get("automationId", "")), str(value.get("className", "")),
                   bool(value.get("offscreen", False)),
                   [cls.from_json(c, depth + 1, budget) for c in value.get("children", [])])


def matches(node: Node, selector: dict[str, Any], group: str) -> bool:
    props = {"controlType": node.control_type, "name": node.name,
             "automationId": node.automation_id, "className": node.class_name}
    return not node.offscreen and all(props[k] == v.replace("{chatName}", group)
                                      for k, v in selector.items() if k != "maxDepth")


def descendants(node: Node, max_depth: int) -> Iterable[Node]:
    if max_depth <= 0:
        return
    for child in node.children:
        if child.offscreen:
            continue
        yield child
        yield from descendants(child, max_depth - 1)


def find_nodes(parent: Node, selector: dict[str, Any], group: str) -> list[Node]:
    return [n for n in descendants(parent, selector.get("maxDepth", 1)) if matches(n, selector, group)]


def unique_node(parent: Node, selector: dict[str, Any], group: str, role: str) -> Node:
    nodes = find_nodes(parent, selector, group)
    if len(nodes) != 1:
        if not nodes and role in ("exact group title", "messageList"):
            raise UnsupportedUIA(f"{role} is not exposed/matched; this client may require a separately configured screenshot RPA adapter")
        raise CollectorError(f"{role} selector must match exactly one visible control (matched {len(nodes)})")
    return nodes[0]


def extract_window(window: Node, group: str, config: dict[str, Any], observed_at: str) -> list[dict[str, Any]]:
    selectors = config["selectors"]
    if group not in config["groups"] or window.name != group or not matches(window, selectors["window"], group):
        raise CollectorError("window does not match an approved group selector")
    unique_node(window, selectors["title"], group, "exact group title")
    message_list = unique_node(window, selectors["messageList"], group, "messageList")
    rows = find_nodes(message_list, selectors["messageItem"], group)
    if len(rows) > 200:
        raise CollectorError("visible message count exceeds 200; narrow selectors")
    messages = []
    occurrences: Counter[str] = Counter()
    for row in rows:
        sender_node = unique_node(row, selectors["sender"], group, "sender")
        text_node = unique_node(row, selectors["text"], group, "message text")
        if sender_node is text_node:
            raise CollectorError("sender and message text must be separate controls")
        sender, text = sender_node.name.strip(), text_node.name.strip()
        if not sender or not text or len(sender) > 200 or wire_text_length(text) > MAX_MESSAGE_TEXT:
            raise CollectorError("message sender/text is empty or exceeds allowed size")
        # UIA has no portable WeChat server message ID/time. Content occurrences are
        # conservative dedupe keys, not claims of a server ID or a known sentAt.
        signature = json.dumps([group, sender, None, text], ensure_ascii=False, separators=(",", ":"))
        occurrences[signature] += 1
        message_id = hashlib.sha256(f"{signature}\n{occurrences[signature]}".encode("utf-8")).hexdigest()
        messages.append({"messageId": message_id, "chatName": group, "sender": sender,
                         "sentAt": None, "observedAt": observed_at, "text": text})
    return messages


def windows_for_group(windows: list[Node], group: str, config: dict[str, Any]) -> Node | None:
    candidates = [w for w in windows if w.name == group and matches(w, config["selectors"]["window"], group)]
    if len(candidates) > 1:
        raise CollectorError("more than one matching top-level window; close the duplicate")
    return candidates[0] if candidates else None


def read_live_windows(config: dict[str, Any]) -> list[Node]:
    if sys.platform != "win32":
        raise CollectorError("live collection requires Windows; replay works without Windows")
    try:
        import uiautomation as auto  # Windows-only; never imported by fixture replay.
    except ImportError as exc:
        raise CollectorError("install requirements.txt before live collection") from exc
    budget = [0]

    def snapshot(control: Any, depth: int) -> Node:
        budget[0] += 1
        if budget[0] > 2000 or depth > 12:
            raise CollectorError("UI tree exceeds safety bounds; narrow selectors")
        offscreen = bool(control.IsOffscreen)
        node = Node(control.ControlTypeName, str(control.Name or ""), str(control.AutomationId or ""),
                    str(control.ClassName or ""), offscreen)
        if not offscreen:
            node.children = [snapshot(child, depth + 1) for child in control.GetChildren()]
        return node

    try:
        from ocr_capture import _wechat_process, _windows_api
        api = _windows_api()
        windows = []
        for control in auto.GetRootControl().GetChildren():
            # Only inspect descendants of an exact, configured top-level group window.
            window = Node(control.ControlTypeName, str(control.Name or ""), str(control.AutomationId or ""),
                          str(control.ClassName or ""), bool(control.IsOffscreen))
            if (window.name in config["groups"] and matches(window, config["selectors"]["window"], window.name)
                    and _wechat_process(api, control.NativeWindowHandle)):
                windows.append(snapshot(control, 0))
        return windows
    except CollectorError:
        raise
    except Exception as exc:
        # COM errors can contain window/message content. Do not echo their details.
        raise CollectorError("UI Automation read failed; no message from this snapshot was collected") from exc


def structural_probe(windows: list[Node], config: dict[str, Any]) -> dict[str, Any]:
    def structure(node: Node, index: str) -> dict[str, Any]:
        # Name is deliberately absent, including sender/message/window labels.
        redact = lambda value: re.sub(r"\d{5,}|[^\s@]+@[^\s@]+", "[redacted]", value[:120])
        return {"path": index, "controlType": node.control_type,
                "automationId": redact(node.automation_id), "className": redact(node.class_name),
                "offscreen": node.offscreen,
                "children": [structure(c, f"{index}/{i}") for i, c in enumerate(node.children)]}
    result: dict[str, Any] = {"redacted": True, "groups": []}
    for group in config["groups"]:
        window = windows_for_group(windows, group, config)
        result["groups"].append({"chatName": group, "windowFound": window is not None,
                                 "structure": structure(window, "0") if window else None})
    return result


class StateStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS state_metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS groups_initialized(chat_name TEXT PRIMARY KEY, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS seen(message_id TEXT PRIMARY KEY, chat_name TEXT NOT NULL, first_seen_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS outbox(
                message_id TEXT PRIMARY KEY, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
                next_attempt_at REAL NOT NULL DEFAULT 0, delivered_at TEXT, last_error TEXT);
            CREATE TABLE IF NOT EXISTS publication_updates(message_id TEXT PRIMARY KEY);
        """)

    def bind_scope(self, config: dict[str, Any]) -> None:
        binding = json.dumps({"apiBaseUrl": validate_base_url(config["apiBaseUrl"]),
                              "deviceId": config["deviceId"], "scope": config["scope"]}, sort_keys=True)
        existing = self.db.execute("SELECT value FROM state_metadata WHERE key='scope'").fetchone()
        if existing and existing["value"] != binding:
            raise CollectorError("statePath belongs to a different account/workspace/server/device; use a separate statePath")
        if not existing:
            count = self.db.execute("SELECT count(*) FROM seen").fetchone()[0]
            if count:
                raise CollectorError("statePath has unbound existing records; use a new separate statePath")
            with self.db:
                self.db.execute("INSERT INTO state_metadata VALUES('scope',?)", (binding,))

    def close(self) -> None:
        self.db.close()

    def _refine_observation(self, message: dict[str, Any]) -> None:
        """A repeated sender/body hash is not evidence about the earlier posting."""
        from history_dates import stronger_time
        evidence = message.get("publishedTime")
        if not evidence:
            return
        row = self.db.execute("SELECT payload,delivered_at FROM outbox WHERE message_id=?",
                              (message["messageId"],)).fetchone()
        if row is None:
            return  # do not release a baseline-only observation
        saved = json.loads(row["payload"])
        fields = ("chatName", "sender", "text", "sentAt", "observedAt", "captureMode", "captureUnit")
        if any(saved.get(key) != message.get(key) for key in fields):
            return
        if not stronger_time(saved.get("publishedTime"), evidence, saved["observedAt"]):
            return
        saved["publishedTime"] = evidence
        self.db.execute("UPDATE outbox SET payload=?, attempts=0, next_attempt_at=0, last_error=NULL WHERE message_id=?",
                        (json.dumps(saved, ensure_ascii=False), message["messageId"]))
        if row["delivered_at"] is not None:
            self.db.execute("INSERT OR IGNORE INTO publication_updates VALUES(?)", (message["messageId"],))

    def observe(self, group: str, messages: list[dict[str, Any]], capture_mode: str = "UIA_MESSAGE") -> dict[str, Any]:
        if not messages:
            return {"baseline": False, "visible": 0, "queued": 0}
        queued = 0
        baseline_scope = f"{capture_mode}:{group}"
        with self.db:
            initialized = self.db.execute("SELECT 1 FROM groups_initialized WHERE chat_name=?", (baseline_scope,)).fetchone()
            for message in messages:
                inserted = self.db.execute("INSERT OR IGNORE INTO seen VALUES(?,?,?)",
                                           (message["messageId"], group, message["observedAt"])).rowcount
                if inserted and initialized:
                    self.db.execute("INSERT INTO outbox(message_id,payload) VALUES(?,?)",
                                    (message["messageId"], json.dumps(message, ensure_ascii=False)))
                    queued += 1
                elif not inserted and message.get("publishedTime"):
                    self._refine_observation(message)
            if not initialized:
                self.db.execute("INSERT INTO groups_initialized VALUES(?,?)", (baseline_scope, now_iso()))
        return {"baseline": not bool(initialized), "visible": len(messages), "queued": queued}

    def pending(self, limit: int, current_time: float | None = None, only_ids=None, groups=None) -> list[sqlite3.Row]:
        query = "SELECT * FROM outbox WHERE (delivered_at IS NULL OR message_id IN publication_updates) AND next_attempt_at<=?"
        params = [time.time() if current_time is None else current_time]
        if groups is not None:
            query += " AND message_id IN (SELECT message_id FROM seen WHERE chat_name IN (SELECT value FROM json_each(?)))"
            params.append(json.dumps(groups))
        if only_ids is not None:
            if not only_ids:
                return []
            query += " AND message_id IN (SELECT value FROM json_each(?))"
            params.append(json.dumps(list(only_ids)))
        return self.db.execute(query + " ORDER BY rowid LIMIT ?", [*params, limit]).fetchall()

    def enqueue_history(self, group: str, messages: list[dict[str, Any]]) -> int:
        queued = 0
        with self.db:
            for message in messages:
                self.db.execute("INSERT OR IGNORE INTO seen VALUES(?,?,?)",
                                (message["messageId"], group, message["observedAt"]))
                # 'seen' includes baseline-only records. Only the durable outbox
                # distinguishes never queued history from pending/delivered data.
                inserted = self.db.execute("INSERT OR IGNORE INTO outbox(message_id,payload) VALUES(?,?)",
                                           (message["messageId"], json.dumps(message, ensure_ascii=False))).rowcount
                if not inserted and message.get("publishedTime"):
                    self._refine_observation(message)
                queued += inserted
            if messages:
                self.db.execute("INSERT OR IGNORE INTO groups_initialized VALUES(?,?)",
                                (f"OCR_SEGMENTS_V1:{group}", now_iso()))
        return queued

    def delivered(self, rows: list[sqlite3.Row]) -> None:
        with self.db:
            for r in rows:
                # A concurrent refinement must remain pending if this receipt
                # acknowledged an earlier version of the payload.
                matched = self.db.execute("UPDATE outbox SET delivered_at=coalesce(delivered_at,?),last_error=NULL WHERE message_id=? AND payload=?",
                                          (now_iso(), r["message_id"], r["payload"])).rowcount
                if matched:
                    self.db.execute("DELETE FROM publication_updates WHERE message_id=?", (r["message_id"],))

    def delivered_count(self, group: str) -> int:
        return self.db.execute("SELECT count(*) FROM outbox o JOIN seen s ON s.message_id=o.message_id WHERE o.delivered_at IS NOT NULL AND s.chat_name=?", (group,)).fetchone()[0]

    def failed(self, rows: list[sqlite3.Row], safe_error: str, current_time: float | None = None) -> None:
        timestamp = time.time() if current_time is None else current_time
        with self.db:
            self.db.executemany("UPDATE outbox SET attempts=attempts+1,next_attempt_at=?,last_error=? WHERE message_id=? AND payload=?",
                                [(timestamp + min(3600, 5 * 2 ** min(r["attempts"], 10)), safe_error, r["message_id"], r["payload"]) for r in rows])

    def status(self) -> dict[str, int]:
        return {"baselineGroups": self.db.execute("SELECT count(*) FROM groups_initialized").fetchone()[0],
                "seen": self.db.execute("SELECT count(*) FROM seen").fetchone()[0],
                "pending": self.db.execute("SELECT count(*) FROM outbox WHERE delivered_at IS NULL OR message_id IN publication_updates").fetchone()[0],
                "delivered": self.db.execute("SELECT count(*) FROM outbox WHERE delivered_at IS NOT NULL").fetchone()[0]}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> None:
        # Never forward bearer credentials through a redirect (even same-origin).
        return None


def post_batch(config: dict[str, Any], messages: list[dict[str, Any]]) -> set[str]:
    if not config.get("upload", {}).get("enabled", False):
        raise CollectorError("upload is disabled in config")
    token = config.get("token", "").strip()
    if not token:
        raise CollectorError("upload requires token in config")
    origin = validate_base_url(config["apiBaseUrl"])
    url = origin + "/api/rpa/messages"
    opener = urllib.request.build_opener(NoRedirect())
    try:
        scope_request = urllib.request.Request(origin + "/api/rpa/config",
                                                headers={"Authorization": f"Bearer {token}"}, method="GET")
        with opener.open(scope_request, timeout=20) as response:
            scope_payload = json.loads(response.read(1024 * 1024).decode("utf-8"))
            scope_data = scope_payload.get("data", scope_payload) if isinstance(scope_payload, dict) else None
            if (not 200 <= response.status < 300 or not isinstance(scope_data, dict)
                    or scope_data.get("scope") != config.get("scope")):
                raise CollectorError("server account/workspace does not match config.scope; queued messages retained")
            if "allowedGroups" in scope_data:
                enabled = scope_data["allowedGroups"]
                if not isinstance(enabled, list) or not all(valid_group_name(g) for g in enabled):
                    raise CollectorError("server enabled group list is invalid; queued messages retained")
                messages = [m for m in messages if m.get("chatName") in enabled]
                if not messages:
                    return set()
        body = json.dumps({"deviceId": config["deviceId"], "messages": messages}, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(url, data=body, headers={"Authorization": f"Bearer {token}",
                                          "Content-Type": "application/json"}, method="POST")
        with opener.open(request, timeout=20) as response:
            payload = json.loads(response.read(1024 * 1024).decode("utf-8"))
            if (not 200 <= response.status < 300 or not isinstance(payload, dict)
                    or payload.get("success") is False):
                raise CollectorError("server did not acknowledge successful import")
            data = payload.get("data", payload)
            if not isinstance(data, dict) or not isinstance(data.get("accepted"), list):
                raise CollectorError("server response did not include per-message acknowledgements")
            sent_ids = {message["messageId"] for message in messages}
            accepted = {entry["messageId"] for entry in data["accepted"]
                        if isinstance(entry, dict) and isinstance(entry.get("messageId"), str)
                        and entry["messageId"] in sent_ids and isinstance(entry.get("id"), str)
                        and bool(entry["id"])
                        and entry.get("status") in ("PENDING", "PROCESSING", "READY", "FAILED", "DISMISSED")}
            return accepted
    except urllib.error.HTTPError as exc:
        raise CollectorError(f"upload HTTP {exc.code}; queued messages retained") from exc
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        raise CollectorError("upload failed or response was invalid; queued messages retained") from exc


def upload_pending(store: StateStore, config: dict[str, Any], *, only_ids=None) -> dict[str, Any]:
    limit = config.get("upload", {}).get("batchSize", 50)
    rows = store.pending(limit, only_ids=only_ids, groups=config["groups"])
    if not rows:
        return {"uploaded": 0}
    selected = []
    messages = []
    text_length = 0
    for row in rows:
        message = json.loads(row["payload"])
        length = wire_text_length(message["text"])
        if text_length + length > MAX_BATCH_TEXT:
            break
        selected.append(row)
        messages.append(message)
        text_length += length
    if not selected:
        return {"uploaded": 0, "uploadError": "queued message exceeds batch text limit; queued messages retained"}
    rows = selected
    try:
        accepted = post_batch(config, messages)
    except CollectorError as exc:
        store.failed(rows, str(exc))
        return {"uploaded": 0, "uploadError": str(exc)}
    delivered = [row for row in rows if row["message_id"] in accepted]
    retained = [row for row in rows if row["message_id"] not in accepted]
    store.delivered(delivered)
    if retained:
        store.failed(retained, "server did not acknowledge this messageId; queued message retained")
    updates = sum(row["delivered_at"] is not None for row in delivered)
    return {"uploaded": len(delivered) - updates, "unacknowledged": len(retained),
            **({"publicationUpdates": updates} if updates else {})}


def collect_snapshot(windows: list[Node], store: StateStore, config: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {"groups": []}
    observed_at = now_iso()
    for group in config["groups"]:
        try:
            window = windows_for_group(windows, group, config)
            if window is None:
                result["groups"].append({"chatName": group, "status": "WINDOW_NOT_OPEN"})
                continue
            messages = extract_window(window, group, config, observed_at)
            result["groups"].append({"chatName": group, "status": "OK", **store.observe(group, messages)})
        except CollectorError as exc:
            result["groups"].append({"chatName": group,
                                     "status": "UNSUPPORTED_UIA" if isinstance(exc, UnsupportedUIA) else "FAILED_CLOSED",
                                     "error": str(exc)})
    result["queue"] = store.status()
    return result


def use_ocr(config: dict[str, Any]) -> bool:
    return config.get("capture", {}).get("mode") == "ocr" or config.get("captureMode") in ("OCR_SNAPSHOT", "OCR_MESSAGE")


def collect_ocr_snapshots(store: StateStore, config: dict[str, Any]) -> dict[str, Any]:
    try:
        from ocr_capture import capture_snapshots, OcrCaptureError
    except ImportError as exc:
        raise CollectorError("OCR adapter unavailable; install requirements-ocr.txt") from exc
    outcomes = []
    for group in config["groups"]:
        one = {**config, "groups": [group]}
        try:
            snapshots = capture_snapshots(one)
            result = enqueue_ocr_snapshots(snapshots, store, one)
            outcomes.extend(result["groups"])
        except OcrCaptureError as exc:
            outcomes.append({"chatName": group, "status": "FAILED_CLOSED", "error": str(exc).partition(":")[0]})
        except CollectorError:
            raise
        except ImportError as exc:
            raise CollectorError("OCR adapter dependencies unavailable; install requirements-ocr.txt") from exc
        except Exception as exc:
            raise CollectorError("OCR_CAPTURE_REJECTED: check group window, calibration, title, and unlocked desktop") from exc
    return {"captureMode": "OCR_SEGMENTS_V1", "groups": outcomes, "queue": store.status()}


def validate_ocr_messages(snapshots: list[dict[str, Any]], config: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    from history_dates import valid_publication_time
    if not isinstance(snapshots, list):
        raise CollectorError("OCR provider returned invalid snapshots")
    grouped: dict[str, list[dict[str, Any]]] = {}
    # Validate the entire provider response before any local state mutation.
    for message in snapshots:
        if (not isinstance(message, dict) or message.get("chatName") not in config["groups"]
                or message.get("captureMode") not in ("OCR_SNAPSHOT", "OCR_MESSAGE") or message.get("sentAt") is not None
                or not isinstance(message.get("messageId"), str) or not 1 <= len(message["messageId"]) <= 200
                or not isinstance(message.get("sender"), str) or wire_text_length(message["sender"]) > 200
                or (message.get("captureMode") == "OCR_MESSAGE" and not message["sender"].strip())
                or not isinstance(message.get("text"), str)
                or not 1 <= wire_text_length(message["text"].strip()) <= MAX_MESSAGE_TEXT
                or not isinstance(message.get("observedAt"), str) or not message["observedAt"]):
            raise CollectorError("OCR provider snapshot failed message contract validation")
        mode = message["captureMode"]
        unit = message.get("captureUnit", "TEXT_BUBBLE" if mode == "OCR_MESSAGE" else "VIEWPORT_REMAINDER")
        if unit not in ("TEXT_BUBBLE", "VIEWPORT_REMAINDER") or (mode == "OCR_MESSAGE" and unit != "TEXT_BUBBLE"):
            raise CollectorError("OCR provider returned an invalid captureUnit")
        if "publishedTime" in message and (unit != "TEXT_BUBBLE" or not valid_publication_time(message["publishedTime"], message["observedAt"])):
            raise CollectorError("OCR provider returned invalid publication time evidence")
        group = message["chatName"]
        grouped.setdefault(group, []).append(message)
        if len(grouped[group]) > 200 or sum(m["captureMode"] == "OCR_SNAPSHOT" and m.get("captureUnit", "VIEWPORT_REMAINDER") == "VIEWPORT_REMAINDER" for m in grouped[group]) > 1:
            raise CollectorError("OCR provider returned too many messages or duplicate fallback snapshots")
    return grouped


def enqueue_ocr_snapshots(snapshots: list[dict[str, Any]], store: StateStore,
                          config: dict[str, Any]) -> dict[str, Any]:
    grouped = validate_ocr_messages(snapshots, config)
    result: dict[str, Any] = {"captureMode": "OCR_SEGMENTS_V1", "groups": []}
    for group in config["groups"]:
        messages = grouped.get(group)
        if messages is None:
            result["groups"].append({"chatName": group, "status": "NO_CALIBRATED_WINDOW"})
        else:
            result["groups"].append({"chatName": group, "status": "OK", **store.observe(group, messages, "OCR_SEGMENTS_V1")})
    result["queue"] = store.status()
    return result


def fixture_frames(path: Path) -> list[list[Node]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        if not isinstance(data, dict) or not isinstance(data.get("frames"), list):
            raise ValueError("frames missing")
        return [[Node.from_json(window) for window in frame["windows"]] for frame in data["frames"]]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise CollectorError("fixture must contain frames, each with a windows array") from exc


def emit(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False), flush=True)


def state_file(config):
    return (Path(config["_configDir"]) / config["statePath"]).resolve()


def calibrate_command(config, group):
    from capture_lock import CaptureBusy, CaptureLock
    from ocr_capture import CalibrationError, OcrCaptureError, calibrate_group
    from window_capture import WindowCaptureError
    import contextlib
    try:
        with CaptureLock(state_file(config)), contextlib.redirect_stdout(sys.stderr):
            profile = calibrate_group(config, group)
        emit({"profile": profile})
        return 0
    except CalibrationError as exc:
        emit({"error": str(exc), **exc.details})
    except (CaptureBusy, WindowCaptureError, OcrCaptureError) as exc:
        emit({"error": str(exc).partition(":")[0]})
    except ImportError:
        emit({"error": "OCR_DEPENDENCIES_MISSING"})
    except Exception:
        emit({"error": "OCR_CALIBRATION_FAILED"})
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("config.local.json"))
    parser.add_argument("--calibration", type=Path, help="explicit OCR calibration JSON, merged in memory only")
    commands = parser.add_subparsers(dest="command", required=True)
    calibrate = commands.add_parser("calibrate", help="verify existing geometry against one enabled group window title")
    calibrate.add_argument("--group", required=True)
    probe = commands.add_parser("probe", help="redacted structure only; never prints control names")
    probe.add_argument("--fixture", type=Path)
    collect = commands.add_parser("collect", help="baseline first, then enqueue new visible text locally")
    collect.add_argument("--once", action="store_true")
    collect.add_argument("--supervised", action="store_true", help="stop at a safe polling boundary when the parent closes stdin")
    collect.add_argument("--upload", action="store_true", help="explicitly permit upload; config must also enable it")
    backfill = commands.add_parser("backfill", help="bounded history scrolling with verified return to latest")
    backfill.add_argument("--pages", type=int, default=None)
    backfill.add_argument("--messages-per-group", type=int)
    backfill.add_argument("--days", type=int, choices=(1, 3, 7),
                          help="scan the last 24, 72 or 168 hours, using verified chat time labels")
    backfill.add_argument("--group", action="append", dest="groups")
    backfill.add_argument("--upload", action="store_true")
    backfill.add_argument("--cancel-file", type=Path)
    replay = commands.add_parser("replay", help="offline fixture replay; never reads UI or uploads")
    replay.add_argument("fixture", type=Path)
    commands.add_parser("status", help="local queue counts only")
    args = parser.parse_args(argv)
    store = None
    backfill_reported = False
    try:
        config = load_config(args.config)
        if args.command == "calibrate":
            if args.calibration and args.calibration.exists():
                config = apply_calibration(config, args.calibration, required_groups=[])
            return calibrate_command(config, args.group)
        if args.calibration and args.command != "collect":
            required = args.groups if args.command == "backfill" else None
            config = apply_calibration(config, args.calibration, required_groups=required)
        if args.command == "probe":
            windows = fixture_frames(args.fixture)[0] if args.fixture else read_live_windows(config)
            emit(structural_probe(windows, config))
            return 0
        if args.command in ("collect", "backfill") and args.upload:
            if not config.get("upload", {}).get("enabled", False) or not config.get("token", "").strip():
                raise CollectorError("--upload requires upload.enabled=true and a token in config")
        state_path = state_file(config)
        store = StateStore(state_path)
        store.bind_scope(config)
        if args.command == "status":
            emit(store.status())
        elif args.command == "backfill":
            from backfill import run_backfill, BackfillFailure
            import contextlib
            output = sys.stdout
            def report(payload):
                nonlocal backfill_reported
                backfill_reported = True
                output.write(json.dumps(payload, ensure_ascii=False) + "\n")
                output.flush()
            try:
                # OCR/native diagnostics must not pollute the supervisor's JSON
                # progress stream; never print page text, sender or credentials.
                with contextlib.redirect_stdout(sys.stderr):
                    result = run_backfill(config, store, state_path, pages=args.pages, groups=args.groups,
                                          messages_per_group=args.messages_per_group, days=args.days,
                                          upload=args.upload, cancel_file=args.cancel_file, progress=report)
            except BackfillFailure as exc:
                result = {"event": "backfill", "status": "FAILED", "chatName": "", "pagesRequested": args.pages,
                          "pagesCompleted": 0, "groupIndex": 0, "groupCount": 0, "queued": 0,
                          "uploaded": 0, "returnedToLatest": False, "error": str(exc), "groups": [],
                          **({} if backfill_reported else {"restoreRequired": False})}
                report(result)
            return 0 if result["status"] in ("COMPLETED", "CANCELLED") else 1
        elif args.command == "replay":
            for index, windows in enumerate(fixture_frames(args.fixture)):
                emit({"frame": index, **collect_snapshot(windows, store, config), "upload": "DISABLED_OFFLINE_REPLAY"})
        else:
            from capture_lock import CaptureLock, CaptureBusy
            shutdown = threading.Event()
            if args.supervised:
                def watch_parent():
                    try:
                        os.read(sys.stdin.fileno(), 1)
                    finally:
                        shutdown.set()
                threading.Thread(target=watch_parent, daemon=True).start()
            while not shutdown.is_set():
                try:
                    with CaptureLock(state_path):
                        # Management updates the connection and calibration atomically. Re-read
                        # both at each poll so paused groups stop without a process restart.
                        current = load_config(args.config)
                        if state_file(current) != state_path:
                            raise CollectorError("collector statePath changed; restart with the new connection")
                        store.bind_scope(current)
                        if args.calibration:
                            if args.calibration.exists():
                                current = apply_calibration(current, args.calibration, required_groups=[])
                            else:
                                current["capture"] = {**current.get("capture", {}), "mode": "ocr"}
                        config = current
                        if not config["groups"]:
                            result = {"status": "NO_ENABLED_GROUPS", "groups": [], "queue": store.status()}
                        elif use_ocr(config):
                            result = collect_ocr_snapshots(store, config)
                        else:
                            result = collect_snapshot(read_live_windows(config), store, config)
                        if args.upload and config.get("upload", {}).get("enabled"):
                            result.update(upload_pending(store, config))
                        else:
                            result["upload"] = "DISABLED_LOCAL_ONLY"
                except CaptureBusy:
                    result = {"status": "PAUSED_FOR_BACKFILL", "capture": "CAPTURE_LOCK_BUSY"}
                except CollectorError as exc:
                    result = {"status": "FAILED_CLOSED", "error": str(exc)}
                emit(result)
                if args.once:
                    break
                if args.supervised:
                    shutdown.wait(config.get("pollIntervalSeconds", 10))
                else:
                    time.sleep(config.get("pollIntervalSeconds", 10))
        return 0
    except KeyboardInterrupt:
        return 0
    except (CollectorError, sqlite3.Error, OSError) as exc:
        error = str(exc) if isinstance(exc, CollectorError) else "local state operation failed"
        if args.command == "backfill":
            emit({"event": "backfill", "status": "FAILED", "chatName": "", "pagesRequested": args.pages,
                  "pagesCompleted": 0, "groupIndex": 0, "groupCount": 0, "queued": 0, "uploaded": 0,
                  "skippedScreens": 0, "returnedToLatest": False, "error": error, "groups": [],
                  **({} if backfill_reported else {"restoreRequired": False})})
        else:
            emit({"status": "ERROR", "error": error})
        return 1
    finally:
        if store:
            store.close()


if __name__ == "__main__":
    sys.exit(main())
