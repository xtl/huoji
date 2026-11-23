"""WeChat timestamp evidence on synthetic chat images with mocked OCR."""
from datetime import date, datetime, timezone
import unittest
from unittest.mock import patch

from PIL import ImageFont

from history_dates import SHANGHAI, attach_publication_times, separator_time, separator_value, stronger_time
from history_window import HistoryWindow, Viewport
from test_ocr_messages import GROUP, Scene


class DateParserTests(unittest.TestCase):
    def test_labels_resolve_in_shanghai_including_after_midnight(self):
        # UTC is still the 21st. The WeChat window shows Sunday the 22nd.
        captured = datetime(2026, 11, 21, 16, 15, tzinfo=timezone.utc)
        dates = {
            "00：03": "2026-11-22T00:03",
            "凌晨12:05": "2026-11-22T00:05",
            "今天 0:09": "2026-11-22T00:09",
            "昨天 晚上 11：18": "2026-11-21T23:18",
            "周五 上午9:01": "2026-11-20T09:01",
            "星期四 中午12:00": "2026-11-19T12:00",
            "星期天 09:01": "2026-11-15T09:01",
            "昨天 凌晨12:05": "2026-11-21T00:05",
            "昨天 下午1:05": "2026-11-21T13:05",
            "前天 ０８：２１": "2026-11-20T08:21",
            "11月19日 13:09": "2026-11-19T13:09",
            "2026年11月19日 星期四 13:09": "2026-11-19T13:09",
            "2026-11-21 9:08": "2026-11-21T09:08",
            "2026/11/2 19:08": "2026-11-02T19:08",
        }
        for text, stamp in dates.items():
            with self.subTest(text=text):
                self.assertEqual(separator_time(text, captured), datetime.fromisoformat(stamp).replace(tzinfo=SHANGHAI))

    def test_ambiguous_impossible_future_and_date_only_do_not_provide_an_instant(self):
        captured = datetime(2027, 1, 1, 0, 5, tzinfo=SHANGHAI)
        for text in ("11:00", "今天 00:06", "2027年1月2日 12:00", "昨天", "2026年12月31日",
                     "昨天 晚上12:05", "昨天 早上12:05", "昨天 上午12:05", "昨天 下午12:05",
                     "昨天 24:00", "昨天 12:61", "昨天 下午19:00", "12月0日 09:00", "2026-12-3123:11",
                     "2026年12月31日 星期二 10:20", "交货时间 昨天 09:00", "2026/12.31 12:00"):
            with self.subTest(text=text):
                self.assertIsNone(separator_time(text, captured))
        with self.assertRaises(ValueError):
            separator_time("昨天 23:59", datetime(2027, 1, 1))

    def test_new_year_and_same_weekday_use_the_capture_calendar(self):
        # Friday in Beijing, still Thursday in UTC. Today's messages have a bare clock.
        captured = datetime(2026, 12, 31, 16, 5, tzinfo=timezone.utc)
        cases = {
            "00:01": (2027, 1, 1, 0, 1),
            "星期五 00:01": (2026, 12, 25, 0, 1),
            "周四 23:59": (2026, 12, 31, 23, 59),
            "昨天 23:59": (2026, 12, 31, 23, 59),
            "12月31日 23:59": (2026, 12, 31, 23, 59),
            "12/31 23:59": (2026, 12, 31, 23, 59),
            "2025年12月31日 23:59": (2025, 12, 31, 23, 59),
        }
        for label, parts in cases.items():
            with self.subTest(label=label):
                self.assertEqual(separator_time(label, captured), datetime(*parts, tzinfo=SHANGHAI))

    def test_date_only_separator_has_day_precision(self):
        captured = datetime(2026, 12, 31, 16, 5, tzinfo=timezone.utc)
        labels = {
            "昨天": date(2026, 12, 31),
            "星期五": date(2026, 12, 25),
            "12月31日": date(2026, 12, 31),
            "12-31": date(2026, 12, 31),
            "2024年2月29日": date(2024, 2, 29),
            "2026-12-30": date(2026, 12, 30),
        }
        for label, day in labels.items():
            with self.subTest(label=label):
                self.assertEqual(separator_value(label, captured), day)
                self.assertIsNone(separator_time(label, captured))
        for label in ("2027年1月2日", "2025年2月29日", "12月32日", "昨天到货", "2026年12月31日 星期五"):
            with self.subTest(label=label):
                self.assertIsNone(separator_value(label, captured))


class HistoryPageTests(unittest.TestCase):
    def add_label(self, scene, y, text, *, display="Yesterday 11:18", x=None, color=(130, 130, 132), score=.99):
        font = ImageFont.load_default(size=18)
        left, _, right, _ = scene.draw.textbbox((0, 0), display, font=font)
        width = scene.image.width
        if x is None:
            x = (width - (right - left)) // 2 - left
        index = scene.text(display, (x, y), color=color, size=18, score=score)
        scene.texts[index] = text  # precise OCR response, no Chinese font dependency

    def read(self, scene, left=80):
        window = HistoryWindow.__new__(HistoryWindow)
        window.profile = {"windowSize": [800, 500], "messageRegion": [left, 20, left + 640, 490], "incomingBubbleLeft": left + 80}
        window.group = GROUP
        frame = Viewport("sample", [], crop=scene.image, captured_at=datetime(2026, 11, 21, 16, 15, tzinfo=timezone.utc))
        with patch("ocr_capture._engine", return_value=scene.output()) as engine:
            messages = window.read(frame, date_mode=True)
            engine.assert_called_once()
        self.assertIsNone(frame.body_error)
        return messages, frame.date_events

    def test_messages_and_markers_stay_in_reading_order_and_capture_time_is_not_sent_time(self):
        scene = Scene()
        self.add_label(scene, 4, "昨天 11:18")
        scene.bubble(top=75, author="Alice", body=("Memory offer",))
        self.add_label(scene, 175, "00:05", display="00:05")
        scene.bubble(top=260, author="Bob", body=("Other offer",))
        self.add_label(scene, 380, "今天 00:08")
        messages, events = self.read(scene)
        self.assertEqual([kind for kind, _ in events], ["date", "message", "date", "message", "date"])
        self.assertEqual(events[0][1], datetime(2026, 11, 21, 11, 18, tzinfo=SHANGHAI))
        self.assertEqual(events[2][1], datetime(2026, 11, 22, 0, 5, tzinfo=SHANGHAI))
        self.assertEqual(events[4][1], datetime(2026, 11, 22, 0, 8, tzinfo=SHANGHAI))
        self.assertEqual([m["text"] for m in messages], ["Memory offer", "Other offer"])
        self.assertTrue(all(m["sentAt"] is None for m in messages))
        self.assertTrue(all(m["observedAt"] == "2026-11-21T16:15:00Z" for m in messages))
        self.assertEqual(messages[0]["publishedTime"], {"kind": "WECHAT_MARKER", "at": "2026-11-21T03:18:00Z"})
        self.assertEqual(messages[1]["publishedTime"], {"kind": "WECHAT_MARKER", "at": "2026-11-21T16:05:00Z"})

    def test_live_clock_only_uses_capture_day_and_snapshot_does_not_inherit_it(self):
        scene = Scene()
        # Realtime Scene captures at 08:00 on Nov 1, independently of the system clock.
        self.add_label(scene, 8, "07:48", display="07:48")
        scene.bubble(top=85, author="Alice", body=("Offer",))
        scene.bubble(top=275, author="Bob", body=("Second",))
        original = scene.messages()
        result = scene.messages(center_x=320)
        self.assertEqual([m["messageId"] for m in result], [m["messageId"] for m in original])
        self.assertEqual(result[0]["publishedTime"], {"kind": "WECHAT_MARKER", "at": "2026-10-31T23:48:00Z"})
        self.assertNotIn("publishedTime", result[1])
        self.assertEqual(result[-1]["captureUnit"], "VIEWPORT_REMAINDER")
        self.assertNotIn("publishedTime", result[-1])

    def test_future_bare_clock_cannot_silently_slide_back_to_yesterday(self):
        scene = Scene()
        self.add_label(scene, 8, "23:48", display="23:48")
        scene.bubble(top=85, author="Alice", body=("Offer",))
        messages, events = self.read(scene)
        self.assertEqual(events[0], ("unknown", None))
        self.assertTrue(all("publishedTime" not in message for message in messages))

    def test_date_only_divider_retains_just_the_day_on_its_bubble(self):
        scene = Scene()
        self.add_label(scene, 8, "昨天", display="Yesterday")
        scene.bubble(top=85, author="Alice", body=("Offer",))
        messages, events = self.read(scene)
        self.assertEqual(events[0], ("day", date(2026, 11, 21)))
        self.assertEqual(messages[0]["publishedTime"], {"kind": "WECHAT_DATE", "date": "2026-11-21"})
        self.assertIsNone(messages[0]["sentAt"])

    def test_unreadable_photo_between_divider_and_bubble_blocks_publication_time(self):
        scene = Scene()
        self.add_label(scene, 8, "昨天 20:18")
        scene.draw.rectangle((83, 57, 262, 141), fill=(59, 134, 81))
        scene.bubble(top=260, author="Alice", body=("Offer",))
        messages, events = self.read(scene)
        self.assertEqual([kind for kind, _ in events], ["date", "unknown", "message"])
        self.assertNotIn("publishedTime", messages[0])


    def test_split_date_and_time_boxes_share_one_verified_center(self):
        scene = Scene()
        self.add_label(scene, 80, "昨天", display="Left", x=275)
        self.add_label(scene, 80, "11:18", display="11:18", x=313)
        _, events = self.read(scene)
        self.assertEqual(events, [("date", datetime(2026, 11, 21, 11, 18, tzinfo=SHANGHAI))])

    def test_asymmetric_crop_uses_window_center_not_local_image_center(self):
        scene = Scene()
        self.add_label(scene, 60, "今天 0:02", display="00:02", x=256)  # global center = 120 + 280
        self.add_label(scene, 110, "今天 0:03", display="00:03")  # centered on the crop only
        _, events = self.read(scene, left=120)
        self.assertEqual(events, [("date", datetime(2026, 11, 22, 0, 2, tzinfo=SHANGHAI)), ("unknown", None)])

    def test_product_text_time_or_nickname_never_creates_historical_date(self):
        scene = Scene()
        scene.bubble(top=80, author="Yesterday", body=("Yesterday 11:18",))
        scene.texts[0] = scene.texts[1] = "昨天 11:18"
        self.add_label(scene, 225, "昨天 13:07", x=25)
        self.add_label(scene, 310, "昨天 13:07", color=(227, 227, 230))
        self.add_label(scene, 360, "昨天 13:07", score=.83)
        self.add_label(scene, 400, "微信交货昨天 13:07")
        _, events = self.read(scene)
        self.assertNotIn("date", [kind for kind, _ in events])
        self.assertNotIn("clock", [kind for kind, _ in events])
        self.assertIn(("unknown", None), events)

    def test_embedded_timestamp_in_dark_photo_is_not_a_separator(self):
        scene = Scene()
        scene.draw.rectangle((90, 50, 550, 220), fill=(49, 48, 51))
        self.add_label(scene, 90, "昨天 10:18")
        self.assertEqual(self.read(scene)[1], [("unknown", None)])


class PublicationBoundsTests(unittest.TestCase):
    def message(self, key):
        return {"messageId": key, "sentAt": None, "observedAt": "2026-11-22T09:00:00Z"}

    def date(self, local):
        return ("date", datetime.fromisoformat(local).replace(tzinfo=SHANGHAI))

    def test_date_only_can_be_refined_by_a_time_or_range_on_the_same_beijing_day(self):
        day = {"kind": "WECHAT_DATE", "date": "2026-11-22"}
        start = "2026-11-21T16:00:00Z"
        after = "2026-11-21T16:01:00Z"
        before = "2026-11-21T15:59:00Z"
        self.assertTrue(stronger_time(day, {"kind": "WECHAT_MARKER", "at": start}))
        self.assertTrue(stronger_time(day, {"kind": "WECHAT_RANGE", "from": start, "to": after}))
        self.assertFalse(stronger_time(day, {"kind": "WECHAT_MARKER", "at": before}))
        self.assertFalse(stronger_time(day, {"kind": "WECHAT_RANGE", "from": before, "to": after}))
        self.assertFalse(stronger_time({"kind": "WECHAT_MINUTE", "at": start}, day))

    def test_shared_dividers_bound_later_bubbles_and_same_minute_is_provable(self):
        first, later, precise = (self.message(n) for n in ("one", "two", "three"))
        before = self.date("2026-11-21T23:57")
        after = self.date("2026-11-22T00:04")
        attach_publication_times([before, ("message", first), ("message", later), after,
                                  ("message", precise), after], same_screen=True)
        self.assertEqual(first["publishedTime"], {"kind":"WECHAT_MARKER", "at":"2026-11-21T15:57:00Z"})
        self.assertEqual(later["publishedTime"], {"kind":"WECHAT_RANGE", "from":"2026-11-21T15:57:00Z", "to":"2026-11-21T16:04:00Z"})
        self.assertEqual(precise["publishedTime"], {"kind":"WECHAT_MINUTE", "at":"2026-11-21T16:04:00Z"})
        self.assertIsNone(precise["sentAt"])

    def test_joined_events_do_not_assign_adjacency_or_use_observation_as_publication(self):
        row = self.message("one")
        early = self.date("2026-11-21T11:10")
        late = self.date("2026-11-21T11:55")
        observed = datetime.fromisoformat(row["observedAt"])
        attach_publication_times([early, ("message",row), ("upper",observed)], same_screen=False)
        self.assertNotIn("publishedTime", row)
        attach_publication_times([early, ("message",row), late], same_screen=False)
        self.assertEqual(row["publishedTime"]["kind"], "WECHAT_RANGE")

    def test_contradiction_repeated_id_and_unknown_rows_never_supply_a_time(self):
        early = self.date("2026-11-21T11:10")
        late = self.date("2026-11-21T11:55")
        for kinds in ("out-of-order", "duplicate", "unknown"):
            row = self.message("same")
            if kinds == "out-of-order":
                events = [late, ("message",row), early]
            elif kinds == "duplicate":
                events = [early, ("message",row), late, ("message",self.message("same"))]
            else:
                events = [early, ("unknown",None), ("message",row), late]
            attach_publication_times(events, same_screen=True)
            self.assertNotIn("publishedTime", row)


if __name__ == "__main__":
    unittest.main()
