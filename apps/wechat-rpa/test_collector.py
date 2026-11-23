from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import MagicMock, patch

import collector as c

HERE = Path(__file__).resolve().parent


def config():
    return c.load_config(HERE / "fixtures" / "config.json")


def window(texts=("old",), group="B300真实交易群"):
    return c.Node("WindowControl", group, children=[
        c.Node("TextControl", group),
        c.Node("TextControl", "PRIVATE unrelated content"),
        c.Node("ListControl", "消息", children=[c.Node("ListItemControl", children=[
            c.Node("TextControl", "merchant", "sender"), c.Node("TextControl", text, "messageText")
        ]) for text in texts])])


class CollectorTests(unittest.TestCase):
    def test_backfill_missing_config_has_no_desktop_restoration(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(c, "emit") as emit:
            missing = Path(directory) / "missing.json"
            self.assertEqual(c.main(["--config", str(missing), "backfill", "--pages", "1"]), 1)
        event = emit.call_args.args[0]
        self.assertEqual(event["status"], "FAILED")
        self.assertFalse(event["restoreRequired"])
        self.assertEqual(event["groups"], [])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.lock_patch = patch("capture_lock.DESKTOP_LOCK_PATH", Path(self.temp.name) / "desktop.capture.lock")
        self.lock_patch.start()
        self.path = Path(self.temp.name) / "state.sqlite3"
        self.store = c.StateStore(self.path)
        self.config = config()
        self.store.bind_scope(self.config)

    def tearDown(self):
        self.store.close()
        self.lock_patch.stop()
        self.temp.cleanup()

    def observe(self, texts):
        return c.collect_snapshot([window(texts)], self.store, self.config)

    def test_supervised_worker_stops_at_end_of_cycle_on_parent_eof(self):
        file = Path(self.temp.name) / "connection.json"
        settings = {**self.config, "groups": [], "statePath": "supervised.sqlite3", "pollIntervalSeconds": 60}
        file.write_text(json.dumps(settings), encoding="utf-8")
        checked = threading.Event()

        def parent_eof(_fd, _size):
            checked.wait(5)
            return b""

        with patch.object(c.sys, "stdin") as pipe, patch.object(c.os, "read", side_effect=parent_eof), \
                patch.object(c, "emit", side_effect=lambda result: checked.set()) as emit:
            pipe.fileno.return_value = 3
            self.assertEqual(c.main(["--config", str(file), "collect", "--supervised"]), 0)
        emit.assert_called_once()
        self.assertEqual(emit.call_args.args[0]["status"], "NO_ENABLED_GROUPS")

    def test_baseline_only_then_queue_dedupe_and_restart(self):
        first = self.observe(("old",))
        self.assertTrue(first["groups"][0]["baseline"])
        self.assertEqual(self.store.status()["pending"], 0)
        self.observe(("old", "new"))
        self.observe(("old", "new"))
        self.assertEqual(self.store.status()["pending"], 1)
        self.store.close()
        self.store = c.StateStore(self.path)
        self.observe(("old", "new", "newer"))
        self.assertEqual(self.store.status()["pending"], 2)

    def test_publication_refinement_retries_same_observation_without_changing_first_delivery(self):
        group = self.config["groups"][0]
        original = {"messageId": "stable", "chatName": group, "captureMode": "OCR_MESSAGE",
                    "captureUnit": "TEXT_BUBBLE", "sender": "Fixture", "text": "one quote",
                    "sentAt": None, "observedAt": "2026-11-21T07:00:00Z"}
        self.assertEqual(self.store.enqueue_history(group, [original]), 1)
        self.store.delivered(self.store.pending(1))
        delivered_at = self.store.db.execute("SELECT delivered_at FROM outbox").fetchone()[0]
        clock = {**original, "publishedTime": {"kind": "WECHAT_CLOCK", "clock": "11:00"}}
        # Identical content on a different day was not the same observation.
        self.store.enqueue_history(group, [{**clock, "observedAt": "2026-11-22T08:00:00Z"}])
        self.assertEqual(self.store.pending(1), [])
        self.assertEqual(self.store.enqueue_history(group, [clock]), 0)
        superseded = self.store.pending(1)
        self.assertEqual(len(superseded), 1)
        dated = {**original, "publishedTime": {"kind": "WECHAT_MARKER", "at": "2026-11-21T03:00:00Z"}}
        self.store.observe(group, [dated], "OCR_SEGMENTS_V1")
        self.store.delivered(superseded)
        self.store.failed(superseded, "obsolete reply")
        pending = self.store.pending(1)
        self.assertEqual(json.loads(pending[0]["payload"])["publishedTime"], dated["publishedTime"])
        self.assertEqual(pending[0]["attempts"], 0)
        self.assertEqual(pending[0]["delivered_at"], delivered_at)
        with patch.object(c, "post_batch", return_value={"stable"}):
            result = c.upload_pending(self.store, self.config)
        self.assertEqual(result, {"uploaded": 0, "unacknowledged": 0, "publicationUpdates": 1})
        self.assertEqual(self.store.pending(1), [])
        self.assertEqual(self.store.delivered_count(group), 1)
        self.assertEqual(self.store.db.execute("SELECT delivered_at FROM outbox").fetchone()[0], delivered_at)
        self.store.enqueue_history(group, [clock])
        self.assertEqual(self.store.pending(1), [])

    def test_whole_screens_and_malformed_markers_cannot_claim_message_time(self):
        group = self.config["groups"][0]
        message = {"messageId": "x", "chatName": group, "sender": "Fixture", "text": "example",
                   "sentAt": None, "observedAt": "2026-11-21T05:00:00Z", "captureMode": "OCR_MESSAGE"}
        for value in ({"kind":"WECHAT_MARKER", "at":"2026-11-21T11:00:00Z"},
                      {"kind":"WECHAT_CLOCK", "clock":"25:30"},
                      {"kind":"WECHAT_DATE", "date":"2026-11-22"},
                      {"kind":"WECHAT_DATE", "date":"2026-02-29"},
                      {"kind":"WECHAT_DATE", "date":"2026-11-21", "clock":"00:00"},
                      {"kind":"WECHAT_MINUTE", "at":"2026-11-21T01:02:54Z"},
                      {"kind":"WECHAT_RANGE", "from":"2026-11-21T01:02:00Z", "to":"2026-11-21T00:04:00Z"}):
            with self.subTest(value=value), self.assertRaises(c.CollectorError):
                c.validate_ocr_messages([{**message, "publishedTime": value}], self.config)
        with self.assertRaises(c.CollectorError):
            c.validate_ocr_messages([{**message, "captureMode":"OCR_SNAPSHOT", "captureUnit":"VIEWPORT_REMAINDER",
                                      "publishedTime":{"kind":"WECHAT_CLOCK", "clock":"11:00"}}], self.config)

    def test_state_binding_rejects_account_workspace_server_and_device_changes(self):
        for field, value in (("scope", {"userId": "other", "workspaceId": "fixture-workspace"}),
                             ("scope", {"userId": "fixture-user", "workspaceId": "other"}),
                             ("apiBaseUrl", "https://other.invalid"), ("deviceId", "other-device")):
            cfg = deepcopy(self.config)
            cfg[field] = value
            with self.subTest(field=field), self.assertRaises(c.CollectorError):
                self.store.bind_scope(cfg)

    def calibration_file(self, profiles, **extra):
        path = Path(self.temp.name) / "calibration.json"
        path.write_text(json.dumps({"schemaVersion": 1, "profiles": profiles, **extra}), encoding="utf-8")
        return path

    def calibrated_profile(self):
        return {"windowSize": [601, 641], "titleRegion": [8, 30, 365, 76], "messageRegion": [65, 78, 586, 522]}

    def test_explicit_calibration_merges_in_memory_without_mutating_auth_config(self):
        cfg = deepcopy(self.config)
        cfg["token"] = "fixture-token-unchanged"
        original = deepcopy(cfg)
        path = self.calibration_file({group: self.calibrated_profile() for group in cfg["groups"]})
        before = path.read_bytes()
        merged = c.apply_calibration(cfg, path)
        self.assertEqual(cfg, original)
        self.assertEqual(merged["token"], original["token"])
        self.assertEqual(merged["scope"], original["scope"])
        self.assertEqual(merged["capture"]["mode"], "ocr")
        self.assertEqual(path.read_bytes(), before)

    def test_calibration_rejects_unapproved_group_missing_profile_and_invalid_bounds(self):
        path = self.calibration_file({"other group": self.calibrated_profile()})
        with self.assertRaises(c.CollectorError):
            c.apply_calibration(self.config, path)
        path = self.calibration_file({self.config["groups"][0]: self.calibrated_profile()})
        with self.assertRaisesRegex(c.CollectorError, "NOT_CALIBRATED"):
            c.apply_calibration(self.config, path)
        profiles = {group: self.calibrated_profile() for group in self.config["groups"]}
        profiles[self.config["groups"][0]]["messageRegion"][2] = 602
        path = self.calibration_file(profiles)
        with self.assertRaisesRegex(c.CollectorError, "PROFILE_INVALID"):
            c.apply_calibration(self.config, path)
        profiles = {group: self.calibrated_profile() for group in self.config["groups"]}
        profiles[self.config["groups"][0]]["windowSize"] = [0, 641]
        path = self.calibration_file(profiles)
        with self.assertRaisesRegex(c.CollectorError, "PROFILE_INVALID"):
            c.apply_calibration(self.config, path)

    def test_calibration_cannot_override_token_or_server(self):
        path = self.calibration_file({group: self.calibrated_profile() for group in self.config["groups"]}, token="other")
        with self.assertRaises(c.CollectorError):
            c.apply_calibration(self.config, path)

    def test_token_renewal_keeps_same_scope_and_queue(self):
        self.observe(("old",))
        self.observe(("old", "new"))
        cfg = deepcopy(self.config)
        cfg["token"] = "renewed-token"
        self.store.bind_scope(cfg)
        self.assertEqual(self.store.status()["pending"], 1)

    def test_empty_snapshot_is_not_baseline(self):
        self.observe(())
        self.assertEqual(self.store.status()["baselineGroups"], 0)
        self.observe(("history appearing after empty",))
        self.assertEqual(self.store.status()["pending"], 0)

    def test_only_message_container_fields_and_unknown_sent_time(self):
        messages = c.extract_window(window(), "B300真实交易群", self.config, "2026-10-21T00:00:00Z")
        self.assertEqual(messages[0]["text"], "old")
        self.assertIsNone(messages[0]["sentAt"])
        self.assertNotIn("PRIVATE", json.dumps(messages))

    def test_exact_title_mismatch_fails_closed(self):
        tree = window()
        tree.children[0].name += " (80)"
        result = c.collect_snapshot([tree], self.store, self.config)
        self.assertEqual(result["groups"][0]["status"], "UNSUPPORTED_UIA")
        self.assertEqual(self.store.status()["seen"], 0)

    def test_missing_message_list_never_stitches_window(self):
        tree = window()
        tree.children = tree.children[:2]
        result = c.collect_snapshot([tree], self.store, self.config)
        self.assertEqual(result["groups"][0]["status"], "UNSUPPORTED_UIA")
        self.assertEqual(self.store.status()["seen"], 0)

    def test_ambiguous_list_or_sender_fails_closed(self):
        tree = window()
        tree.children.append(deepcopy(tree.children[-1]))
        result = c.collect_snapshot([tree], self.store, self.config)
        self.assertEqual(result["groups"][0]["status"], "FAILED_CLOSED")
        tree = window()
        tree.children[-1].children[0].children.append(c.Node("TextControl", "second merchant", "sender"))
        result = c.collect_snapshot([tree], self.store, self.config)
        self.assertEqual(result["groups"][0]["status"], "FAILED_CLOSED")
        self.assertEqual(self.store.status()["seen"], 0)

    def test_unapproved_window_and_offscreen_are_ignored(self):
        result = c.collect_snapshot([window(group="unapproved group")], self.store, self.config)
        self.assertEqual(result["groups"][0]["status"], "WINDOW_NOT_OPEN")
        tree = window()
        tree.offscreen = True
        result = c.collect_snapshot([tree], self.store, self.config)
        self.assertEqual(result["groups"][0]["status"], "WINDOW_NOT_OPEN")

    def test_probe_never_prints_names_or_message_text(self):
        output = json.dumps(c.structural_probe([window()], self.config), ensure_ascii=False)
        for private in ("merchant", "PRIVATE", '"old"'):
            self.assertNotIn(private, output)
        self.assertIn("automationId", output)

    def test_managed_exact_group_names_and_empty_selection(self):
        for groups in (["新显卡交流群", "-华南采购 ①"], []):
            cfg = {**self.config, "groups": groups}
            c.validate_config(cfg)
        for groups in ([None], [" A"], [""], ["A", "A"], ["A\nB"], ["A\x7fB"], ["Wechat"], ["微信"], ["🧪" * 101]):
            with self.subTest(groups=groups), self.assertRaises(c.CollectorError):
                c.validate_config({**self.config, "groups": groups})

    def test_no_broad_list(self):
        cfg = deepcopy(self.config)
        del cfg["selectors"]["messageList"]["name"]
        with self.assertRaises(c.CollectorError):
            c.validate_config(cfg)

    def test_selected_group_works_while_another_awaits_calibration(self):
        cfg = {**self.config, "groups": ["新群", "待校准群"]}
        path = self.calibration_file({"旧模板": self.calibrated_profile(), "新群": self.calibrated_profile()})
        merged = c.apply_calibration(cfg, path, required_groups=["新群"])
        self.assertEqual(merged["groups"], cfg["groups"])
        from backfill import BackfillFailure, selected_groups
        self.assertEqual(selected_groups(merged, ["新群"], 3), ["新群"])
        with self.assertRaises(BackfillFailure):
            selected_groups(merged, ["旧模板"], 3)

    def test_paused_outbox_rows_do_not_block_enabled_uploads(self):
        one, two = self.config["groups"]
        for group in (one, two):
            self.store.enqueue_history(group, [{"messageId": group, "chatName": group, "text": "one", "observedAt": c.now_iso()}])
        cfg = {**self.config, "groups": [two], "upload": {"enabled": True, "batchSize": 1}}
        with patch.object(c, "post_batch", return_value={two}) as post:
            self.assertEqual(c.upload_pending(self.store, cfg)["uploaded"], 1)
            self.assertEqual(post.call_args.args[1][0]["chatName"], two)
            self.assertEqual(c.upload_pending(self.store, {**cfg, "groups":[]})["uploaded"], 0)
        self.assertEqual([r["message_id"] for r in self.store.pending(10)], [one])

    def test_transport_origin_restrictions(self):
        for value in ("http://example.com", "https://user:secret@example.com", "https://example.com?q=x",
                      "https://example.com/api", "file:///tmp/x"):
            with self.subTest(value=value), self.assertRaises(c.CollectorError):
                c.validate_base_url(value)
        for value in ("https://example.com", "http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"):
            self.assertEqual(c.validate_base_url(value), value)

    def test_retry_backoff_retains_messages(self):
        self.observe(("old",))
        self.observe(("old", "new"))
        rows = self.store.pending(50)
        self.store.failed(rows, "failure", current_time=100)
        self.assertEqual(self.store.pending(50, 104), [])
        self.assertEqual(len(self.store.pending(50, 105)), 1)
        self.assertEqual(self.store.status()["pending"], 1)

    def test_partial_ack_only_removes_acknowledged_messages(self):
        self.observe(("old",))
        self.observe(("old", "new", "newer"))
        rows = self.store.pending(50)
        with patch.object(c, "post_batch", return_value={rows[0]["message_id"]}):
            result = c.upload_pending(self.store, self.config)
        self.assertEqual(result, {"uploaded": 1, "unacknowledged": 1})
        self.assertEqual(self.store.status()["pending"], 1)

    def test_long_queue_is_split_by_total_text_limit_without_losing_remaining_rows(self):
        self.observe(("old",))
        group = self.config["groups"][0]
        messages = [{"messageId": f"long-{i}", "chatName": group, "sender": "merchant", "sentAt": None,
                     "observedAt": "2026-10-31T00:00:00Z", "text": "货" * 20_000} for i in range(23)]
        self.store.observe(group, messages)
        batches = []

        def acknowledge(_config, batch):
            batches.append(batch)
            self.assertLessEqual(sum(c.wire_text_length(m["text"]) for m in batch), c.MAX_BATCH_TEXT)
            return {m["messageId"] for m in batch}

        with patch.object(c, "post_batch", side_effect=acknowledge):
            results = [c.upload_pending(self.store, self.config) for _ in range(3)]
        self.assertEqual([r["uploaded"] for r in results], [10, 10, 3])
        self.assertEqual(self.store.status()["pending"], 0)
        self.assertEqual(len({m["messageId"] for batch in batches for m in batch}), 23)

    def test_batch_limit_counts_emoji_like_the_typescript_server(self):
        self.observe(("old",))
        group = self.config["groups"][0]
        messages = [{"messageId": f"emoji-{i}", "chatName": group, "sender": "merchant", "sentAt": None,
                     "observedAt": "2026-10-31T00:00:00Z", "text": "😀" * 10_000} for i in range(11)]
        self.store.observe(group, messages)
        with patch.object(c, "post_batch", side_effect=lambda _, batch: {m["messageId"] for m in batch}) as post:
            result = c.upload_pending(self.store, self.config)
        self.assertEqual(result["uploaded"], 10)
        self.assertEqual(len(post.call_args.args[1]), 10)
        self.assertEqual(self.store.status()["pending"], 1)

    def test_overlong_emoji_snapshot_is_rejected_before_queue(self):
        message = {"messageId": "too-long", "chatName": self.config["groups"][0], "sender": "",
                   "sentAt": None, "observedAt": "2026-10-31T00:00:00Z", "text": "😀" * 10_001,
                   "captureMode": "OCR_SNAPSHOT"}
        with self.assertRaises(c.CollectorError):
            c.enqueue_ocr_snapshots([message], self.store, self.config)
        self.assertEqual(self.store.status()["seen"], 0)

    def test_upload_disabled_never_opens_network(self):
        with patch("urllib.request.build_opener") as opener:
            with self.assertRaises(c.CollectorError):
                c.post_batch(self.config, [])
            opener.assert_not_called()

    def test_fixture_replay_works_without_uia_dependency(self):
        frames = c.fixture_frames(HERE / "fixtures" / "messages.json")
        results = [c.collect_snapshot(f, self.store, self.config) for f in frames]
        self.assertEqual(results[1]["groups"][0]["queued"], 1)
        self.assertEqual(results[2]["groups"][0]["status"], "UNSUPPORTED_UIA")
        self.assertEqual(self.store.status()["pending"], 1)

    def test_ocr_provider_snapshots_use_same_baseline_queue(self):
        message = {"messageId": "ocr_baseline", "chatName": "B300真实交易群", "sender": "未识别（截图识别）",
                   "sentAt": None, "observedAt": "2026-10-21T00:00:00Z", "text": "visible region text",
                   "captureMode": "OCR_SNAPSHOT"}
        c.enqueue_ocr_snapshots([message], self.store, self.config)
        changed = {**message, "messageId": "ocr_changed", "text": "changed visible region text"}
        c.enqueue_ocr_snapshots([changed], self.store, self.config)
        c.enqueue_ocr_snapshots([changed], self.store, self.config)
        self.assertEqual(self.store.status()["pending"], 1)
        queued = json.loads(self.store.pending(50)[0]["payload"])
        self.assertEqual(queued["captureMode"], "OCR_SNAPSHOT")
        self.assertIsNone(queued["sentAt"])

    def test_segment_upgrade_baselines_whole_group_then_enqueues_every_new_message(self):
        group = self.config["groups"][0]
        legacy = {"messageId": "old-snapshot", "chatName": group, "sender": "未识别（截图识别）",
                  "sentAt": None, "observedAt": "2026-11-01T00:00:00Z", "text": "old viewport",
                  "captureMode": "OCR_SNAPSHOT"}
        self.store.observe(group, [legacy], "OCR_SNAPSHOT")
        current = [{**legacy, "messageId": f"ocrmsg_v1_{i}", "sender": sender, "text": f"old bubble {i}",
                    "captureMode": "OCR_MESSAGE"} for i, sender in enumerate(("Alice", "Bob"))]
        first = c.enqueue_ocr_snapshots(current, self.store, self.config)
        self.assertTrue(first["groups"][0]["baseline"])
        self.assertEqual(self.store.status()["pending"], 0)
        new = [{**m, "messageId": m["messageId"] + "_new", "text": m["text"] + " new"} for m in current]
        fallback = {**legacy, "messageId": "new-unknown", "text": "unpaired new text"}
        second = c.enqueue_ocr_snapshots(current + new + [fallback], self.store, self.config)
        self.assertEqual(second["groups"][0]["queued"], 3)
        self.assertEqual(self.store.status()["pending"], 3)
        c.enqueue_ocr_snapshots(current + new + [fallback], self.store, self.config)
        self.assertEqual(self.store.status()["pending"], 3)

    def test_multiple_unknown_text_bubbles_are_valid_but_multiple_viewport_remainders_are_not(self):
        group = self.config["groups"][0]
        base = {"messageId": "u1", "chatName": group, "sender": "未识别（截图识别）",
                "sentAt": None, "observedAt": "2026-11-02T00:00:00Z", "text": "body one",
                "captureMode": "OCR_SNAPSHOT", "captureUnit": "TEXT_BUBBLE"}
        validated = c.validate_ocr_messages([base, {**base, "messageId": "u2", "text": "body two"}], self.config)
        self.assertEqual(len(validated[group]), 2)
        with self.assertRaises(c.CollectorError):
            c.validate_ocr_messages([{**base, "captureUnit": "VIEWPORT_REMAINDER"},
                                     {**base, "messageId": "r2", "captureUnit": "VIEWPORT_REMAINDER"}], self.config)
        with self.assertRaises(c.CollectorError):
            c.validate_ocr_messages([{**base, "captureMode": "OCR_MESSAGE", "captureUnit": "VIEWPORT_REMAINDER"}], self.config)

    def test_ocr_provider_rejects_wrong_group_or_fake_sent_time_before_queue(self):
        message = {"messageId": "ocr_1", "chatName": "B300真实交易群", "sender": "",
                   "sentAt": "2026-10-21T00:00:00Z", "observedAt": "2026-10-21T00:00:00Z",
                   "text": "test", "captureMode": "OCR_SNAPSHOT"}
        with self.assertRaises(c.CollectorError):
            c.enqueue_ocr_snapshots([message], self.store, self.config)
        self.assertEqual(self.store.status()["seen"], 0)
        message.update(sentAt=None, chatName="unapproved group")
        with self.assertRaises(c.CollectorError):
            c.enqueue_ocr_snapshots([message], self.store, self.config)

    def test_collect_defaults_local_even_when_config_enables_upload(self):
        cfg = deepcopy(self.config)
        cfg.update(statePath=str(Path(self.temp.name) / "cli-state.sqlite3"), token="fixture-token")
        cfg["upload"]["enabled"] = True
        path = Path(self.temp.name) / "config.json"
        path.write_text(json.dumps(cfg), encoding="utf-8")
        with patch.object(c, "read_live_windows", return_value=[window()]), patch.object(c, "upload_pending") as upload:
            self.assertEqual(c.main(["--config", str(path), "collect", "--once"]), 0)
            upload.assert_not_called()

    def test_live_polling_reloads_connection_and_skips_desktop_when_all_paused(self):
        cfg = {**self.config, "statePath": str(Path(self.temp.name) / "reloaded.sqlite3"), "groups": ["新群"]}
        path = Path(self.temp.name) / "connection.json"
        path.write_text(json.dumps(cfg), encoding="utf-8")
        observations = []
        def on_poll(event):
            observations.append(event)
            if len(observations) == 1:
                path.write_text(json.dumps({**cfg, "groups": []}), encoding="utf-8")
            else:
                raise KeyboardInterrupt()
        with patch.object(c.time, "sleep"), patch.object(c, "emit", side_effect=on_poll), patch.object(c, "read_live_windows", return_value=[window(group="新群")]) as capture:
            self.assertEqual(c.main(["--config", str(path), "collect"]), 0)
        self.assertEqual(observations[0]["groups"][0]["chatName"], "新群")
        self.assertEqual(observations[1]["status"], "NO_ENABLED_GROUPS")
        capture.assert_called_once()

    def test_unopened_enabled_group_does_not_block_other_realtime_snapshots(self):
        from ocr_capture import OcrCaptureError
        def capture(config):
            group, = config["groups"]
            if group == "待校准":
                raise OcrCaptureError("OCR_NOT_CALIBRATED: fixture")
            return [{"messageId": "new", "sender": "fixture", "chatName": group, "sentAt": None, "text": "fixture",
                     "observedAt": c.now_iso(), "captureMode": "OCR_MESSAGE"}]
        with patch("ocr_capture.capture_snapshots", side_effect=capture):
            result = c.collect_ocr_snapshots(self.store, {**self.config, "groups": ["待校准", "新群"]})
        self.assertEqual([r["status"] for r in result["groups"]], ["FAILED_CLOSED", "OK"])
        self.assertEqual(self.store.status()["seen"], 1)


class TransportTests(unittest.TestCase):
    def test_server_pause_during_poll_filters_payload_before_sending(self):
        cfg = config()
        cfg.update(token="fixture-token", upload={"enabled": True})
        paused, enabled = cfg["groups"]
        def response(payload, status):
            result = MagicMock(status=status)
            result.__enter__.return_value = result
            result.read.return_value = json.dumps(payload).encode()
            return result
        opener = MagicMock()
        opener.open.side_effect = [
            response({"scope": cfg["scope"], "allowedGroups": [enabled]}, 200),
            response({"success": True, "accepted": [{"messageId": "new", "id": "id", "status": "PENDING"}]}, 202),
        ]
        messages = [{"chatName": paused, "messageId": "old"}, {"chatName": enabled, "messageId": "new"}]
        with patch("urllib.request.build_opener", return_value=opener):
            self.assertEqual(c.post_batch(cfg, messages), {"new"})
        self.assertEqual(json.loads(opener.open.call_args.args[0].data)["messages"], [messages[1]])

    def test_bearer_contract_and_redirect_never_forward_token(self):
        cfg = config()
        cfg.update(apiBaseUrl="http://127.0.0.1:3000", token="fixture-token")
        cfg["upload"]["enabled"] = True
        response = MagicMock(status=202)
        response.__enter__.return_value = response
        response.read.return_value = json.dumps({"success": True, "accepted": [
            {"id": "id1", "messageId": "m1", "status": "FAILED", "duplicate": True}]}).encode()
        opener = MagicMock()
        scope_response = MagicMock(status=200)
        scope_response.__enter__.return_value = scope_response
        scope_response.read.return_value = json.dumps({"scope": cfg["scope"]}).encode()
        opener.open.side_effect = [scope_response, response]
        with patch("urllib.request.build_opener", return_value=opener) as build:
            self.assertEqual(c.post_batch(cfg, [{"messageId": "m1"}]), {"m1"})
            self.assertIsInstance(build.call_args.args[0], c.NoRedirect)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, "http://127.0.0.1:3000/api/rpa/messages")
        self.assertEqual(request.get_header("Authorization"), "Bearer fixture-token")
        self.assertEqual(json.loads(request.data)["deviceId"], "offline-fixture-device")
        first_request = opener.open.call_args_list[0].args[0]
        self.assertEqual(first_request.get_method(), "GET")
        self.assertEqual(first_request.full_url, "http://127.0.0.1:3000/api/rpa/config")
        self.assertIsNone(c.NoRedirect().redirect_request(request, None, 307, "Redirect", {}, "https://other.invalid"))
        opener.open.side_effect = c.urllib.error.HTTPError(request.full_url, 307, "Redirect", {}, None)
        with patch("urllib.request.build_opener", return_value=opener), self.assertRaises(c.CollectorError):
            c.post_batch(cfg, [{"messageId": "m2"}])

    def test_server_scope_mismatch_sends_no_messages(self):
        cfg = config()
        cfg.update(token="token-for-another-user")
        cfg["upload"]["enabled"] = True
        response = MagicMock(status=200)
        response.__enter__.return_value = response
        response.read.return_value = json.dumps({"scope": {"userId": "other", "workspaceId": "other"}}).encode()
        opener = MagicMock()
        opener.open.return_value = response
        with patch("urllib.request.build_opener", return_value=opener), self.assertRaisesRegex(c.CollectorError, "scope"):
            c.post_batch(cfg, [{"messageId": "m1", "text": "private text"}])
        self.assertEqual(opener.open.call_count, 1)
        self.assertEqual(opener.open.call_args.args[0].get_method(), "GET")


if __name__ == "__main__":
    unittest.main()
