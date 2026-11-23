from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import collector
from backfill import BackfillFailure, run_backfill
from backfill_range import DateRangeScan
from history_window import Viewport


ZONE = timezone(timedelta(hours=8))
END = datetime(2026, 11, 22, 11, 20, 30, tzinfo=ZONE)
START = END - timedelta(days=1)
GROUP = "真实货源群"


def bubble(key, observed=END):
    return "message", {"chatName": GROUP, "messageId": key, "captureMode": "OCR_MESSAGE",
                       "text": key, "sender": "测试", "sentAt": None, "observedAt": observed.isoformat()}


class RangeTests(unittest.TestCase):
    def test_edge_minute_is_uncertain_and_upper_bound_can_be_exact_snapshot(self):
        scan = DateRangeScan(START, END)
        self.assertEqual(scan.read([("date", START.replace(second=0) - timedelta(minutes=1)), bubble("border"),
                                    ("date", START.replace(second=0) + timedelta(minutes=1)), bubble("tail")],
                                   observed_by_end=True)[0]["messageId"], "tail")
        self.assertTrue(scan.reached)
        self.assertEqual(scan.uncertain, {"border"})

    def test_observation_during_or_after_job_never_dates_old_or_new_messages(self):
        scan = DateRangeScan(START, END)
        page = [bubble("unknown"), ("date", START - timedelta(days=1)), bubble("old"),
                ("date", START - timedelta(hours=1)), bubble("crosses"), ("date", START + timedelta(hours=1)),
                bubble("new"), ("date", END - timedelta(minutes=5)), bubble("latest-unbounded")]
        self.assertEqual([m["messageId"] for m in scan.read(page)], ["new"])
        self.assertEqual(scan.uncertain, {"latest-unbounded", "crosses"})

    def test_same_day_clocks_and_clipped_edges_join_proven_chronology(self):
        scan = DateRangeScan(START, END)
        gap = ("unknown", None)
        newer = [gap, bubble("first"), bubble("second"), ("date", END.replace(hour=10, minute=55, second=0)),
                 bubble("tail")]
        self.assertEqual([m["messageId"] for m in scan.read(newer, observed_by_end=True)], ["tail"])
        events = [("date", START - timedelta(minutes=3)), ("date", START + timedelta(minutes=3)),
                  ("date", START.replace(hour=22, minute=0, second=0)), bubble("first"), bubble("second"), gap]
        result = scan.read(events)
        self.assertEqual({m["messageId"] for m in result}, {"first", "second"})
        self.assertTrue(all(m["sentAt"] is None for m in result))
        self.assertEqual(len(scan.uncertain), 0)

    def test_lone_repeated_post_or_ambiguous_pair_cannot_bridge(self):
        for newer in ([bubble("a"), bubble("tail")],
                      [bubble("a"), bubble("b"), bubble("x"), bubble("a"), bubble("b"), bubble("tail")]):
            scan = DateRangeScan(START, END)
            scan.read(newer, observed_by_end=True)
            older = [("date", START + timedelta(hours=1)), *newer[:1 if len(newer) == 2 else 2]]
            self.assertEqual(scan.read(older), [])
            self.assertEqual(len(scan.eligible), 0)

    def test_barriers_and_nonmonotonic_dates_are_not_used(self):
        scan = DateRangeScan(START, END)
        self.assertEqual(scan.read([("date", END), bubble("broken"), ("date", START-timedelta(minutes=3))]), [])
        self.assertFalse(scan.reached)
        self.assertEqual(scan.read([("date", START + timedelta(minutes=3)), ("unknown", None),
                                    bubble("ambiguous"), ("date", END - timedelta(hours=1))]), [])

    def test_today_clock_on_preflight_is_in_range_without_other_date_labels(self):
        from history_dates import separator_time

        scan = DateRangeScan(START, END)
        stamp = separator_time("10:00", END)
        result = scan.read([("date", stamp), bubble("today")], observed_by_end=True)
        self.assertEqual([message["messageId"] for message in result], ["today"])
        self.assertEqual(scan.uncertain, set())
        self.assertFalse(scan.reached)

    def test_date_only_boundary_stops_only_after_an_entire_day_is_before_cutoff(self):
        cutoff_day = START.date()
        scan = DateRangeScan(START, END)
        self.assertEqual(scan.read([("day", cutoff_day), bubble("may-be-too-old")],
                                   observed_by_end=True), [])
        self.assertFalse(scan.reached)
        self.assertTrue("may-be-too-old" in scan.uncertain)
        scan.read([("day", cutoff_day - timedelta(days=1)), bubble("older")])
        self.assertTrue(scan.reached)

    def test_shifted_active_chat_regains_its_preflight_boundary_without_admitting_new_arrivals(self):
        scan = DateRangeScan(START, END)
        preflight = [bubble("one"), bubble("two"), bubble("existing-tail")]
        scan.read(preflight, observed_by_end=True, allow_stop=False)
        scan.read([bubble("post-start-1"), bubble("post-start-2")])
        result = scan.read([("date", START+timedelta(hours=1)), bubble("one"), bubble("two")])
        self.assertEqual({m["messageId"] for m in result}, {"one", "two", "existing-tail"})
        self.assertEqual(scan.uncertain, {"post-start-1", "post-start-2"})

    def test_preflight_of_an_old_open_view_cannot_stop_the_latest_to_old_scan(self):
        scan = DateRangeScan(START, END)
        scan.read([("date", START - timedelta(hours=6)), bubble("old")],
                  observed_by_end=True, allow_stop=False)
        self.assertFalse(scan.reached)
        scan.read([bubble("newly-visible")])
        self.assertFalse(scan.reached)

    def test_all_three_ranges_report_partial_if_visible_history_has_no_dates(self):
        config = collector.load_config(Path(__file__).parent / "fixtures" / "config.json")
        class Window:
            def capture(self):
                return Viewport("static", [], at_bottom=True)
            def scroll(self, *args):
                return self.capture()
            def read(self, frame, **kwargs):
                frame.date_events = [bubble("undated")]
                return [frame.date_events[0][1]]
        with tempfile.TemporaryDirectory() as folder, patch("capture_lock.DESKTOP_LOCK_PATH", Path(folder) / "desktop.lock"):
            path = Path(folder) / "state.sqlite3"
            store = collector.StateStore(path)
            try:
                for days in (1, 3, 7):
                    result = run_backfill(config, store, path, days=days, groups=[GROUP],
                                          adapter_factory=lambda *_: Window(), utcnow=lambda: END, sleep=lambda _: None)
                    self.assertEqual(datetime.fromisoformat(result["rangeStart"]), END - timedelta(days=days))
                    self.assertEqual(result["status"], "FAILED")
                    self.assertFalse(result["targetReached"])
                    self.assertTrue(result["returnedToLatest"])
                    self.assertEqual(result["error"], "BACKFILL_DATE_RANGE_INCOMPLETE")
                    self.assertEqual(result["groups"][0]["stopReason"], "TOP_REACHED")
                    self.assertEqual((result["queued"], result["undatedSkipped"]), (0, 1))
            finally:
                store.close()

    def test_scan_stops_at_cap_or_cancellation_and_restores(self):
        config = collector.load_config(Path(__file__).parent / "fixtures" / "config.json")
        with tempfile.TemporaryDirectory() as folder, patch("capture_lock.DESKTOP_LOCK_PATH", Path(folder) / "desktop.lock"):
            path = Path(folder) / "state.sqlite3"
            cancelled = Path(folder) / "cancel"
            store = collector.StateStore(path)
            try:
                for cancel, status, reason, pages in ((False, "FAILED", "PAGE_LIMIT", 200), (True, "CANCELLED", "CANCELLED", 1)):
                    class Window:
                        pos = 0
                        def capture(self):
                            return Viewport(str(self.pos), [], at_bottom=self.pos == 0)
                        def scroll(self, direction, fraction):
                            if direction == "up":
                                self.pos += 1
                                if cancel:
                                    cancelled.touch()
                            else:
                                self.pos = 0
                            return self.capture()
                        def read(self, frame, **kwargs):
                            frame.date_events = [bubble(f"undated-{frame.fingerprint}")]
                            return [frame.date_events[0][1]]
                    result = run_backfill(config, store, path, days=7, groups=[GROUP], cancel_file=cancelled,
                                          adapter_factory=lambda *_: Window(), utcnow=lambda: END)
                    self.assertEqual((result["status"], result["groups"][0]["stopReason"]), (status, reason))
                    self.assertEqual((result["pagesCompleted"], result["queued"]), (pages, 0))
                    self.assertTrue(result["returnedToLatest"])
            finally:
                store.close()

    def test_real_entry_point_scopes_upload_and_restores_selected_chat(self):
        config = collector.load_config(Path(__file__).parent / "fixtures" / "config.json")
        config["upload"].update(enabled=True)
        config["token"] = "fixture"
        class Window:
            position = 0
            def capture(self):
                return Viewport(str(self.position), [], at_bottom=self.position == 0)
            def scroll(self, direction, fraction):
                self.position = int(direction == "up")
                return self.capture()
            def read(self, frame, *, date_mode):
                frame.date_events = ([("date", START-timedelta(minutes=5)), bubble("old"),
                                      ("date", START+timedelta(hours=1)), bubble("one"), bubble("two")]
                                     if self.position else [bubble("one"), bubble("two"), bubble("latest")])
                return [m for kind, m in frame.date_events if kind == "message"]

        calls = []
        def accept(_config, messages):
            calls.extend(messages)
            return {m["messageId"] for m in messages}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "state.sqlite3"
            store = collector.StateStore(path)
            try:
                store.bind_scope(config)
                store.enqueue_history(GROUP, [bubble("unrelated-pending")[1]])
                with patch("capture_lock.DESKTOP_LOCK_PATH", Path(folder) / "desktop.lock"), patch("collector.post_batch", accept):
                    result = run_backfill(config, store, path, days=1, groups=[GROUP], upload=True,
                                          adapter_factory=lambda *_: Window(), utcnow=lambda: END)
                self.assertEqual(result["status"], "COMPLETED")
                self.assertEqual(result["groups"][0]["stopReason"], "DATE_BOUNDARY_REACHED")
                self.assertTrue(result["returnedToLatest"])
                self.assertEqual(datetime.fromisoformat(result["rangeStart"]), START)
                self.assertEqual(datetime.fromisoformat(result["rangeEnd"]), END)
                self.assertEqual({m["messageId"] for m in calls}, {"one", "two", "latest"})
                self.assertEqual(result["undatedSkipped"], 1)
                self.assertEqual([json.loads(row["payload"])["messageId"] for row in store.pending(100)], ["unrelated-pending"])
                for kwargs in ({"days": 2}, {"days": True}, {"days": 1, "pages": 1}, {"days": 3, "messages_per_group": 1}):
                    with self.assertRaises(BackfillFailure):
                        run_backfill(config, store, path, **kwargs)
            finally:
                store.close()
