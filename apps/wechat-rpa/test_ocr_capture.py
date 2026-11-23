import unittest
import sys
from types import SimpleNamespace
from unittest.mock import Mock, patch

from ocr_capture import OcrCaptureError, create_engine, normalize_title, ocr_lines, ocr_title_text, profile_for, read_snapshot_image, snapshot_message


class OcrTests(unittest.TestCase):
    def test_fresh_desktop_bootstraps_only_after_matching_selected_title(self):
        from ocr_capture import calibrate_group
        from PIL import Image
        group = "测试群"
        config = {"groups": [group], "capture": {"profiles": {}}}
        with patch.dict("os.environ", {"HUOJI_DESKTOP_TEST": "1"}), \
                patch("ocr_capture._windows_api"), patch("ocr_capture._require_unlocked_desktop"), \
                patch("ocr_capture._matching_windows", return_value={group: 5}), \
                patch("window_capture.capture_window", side_effect=lambda *a: Image.new("RGB", (823, 961))), \
                patch("ocr_capture.create_engine"), patch("ocr_capture.title_matches_image", side_effect=[False, True]):
            with self.assertRaisesRegex(OcrCaptureError, "TITLE_MISMATCH"):
                calibrate_group(config, group)
            self.assertEqual(calibrate_group(config, group)["windowSize"], [823, 961])
            with self.assertRaisesRegex(OcrCaptureError, "GROUP_NOT_ALLOWED"):
                calibrate_group(config, "别的群")

    def test_calibration_reuses_only_unique_matching_geometry_and_reads_only_title(self):
        from ocr_capture import calibrate_group
        from PIL import Image
        group = "华南 GPU (2)"
        template = {"windowSize": [500, 600], "titleRegion": [10, 10, 180, 40], "messageRegion": [50, 50, 450, 510]}
        profiles = {"原群": template, "相同布局": {**template}}
        config = {"groups": [group], "capture": {"profiles": profiles}}
        def read_title(crop):
            self.assertEqual(crop.shape, (60, 340, 3))
            return SimpleNamespace(txts=[group + "(36)"], scores=[.99], boxes=[[[0,0]]*4])
        def frame():
            return Image.new("RGB", (500, 600))
        with patch.dict(sys.modules, rapidocr=SimpleNamespace(RapidOCR=Mock(return_value=read_title))), \
                patch("ocr_capture._windows_api"), patch("ocr_capture._require_unlocked_desktop"), \
                patch("ocr_capture._matching_windows", return_value={group: 98}), \
                patch("window_capture.capture_window", side_effect=lambda *args: frame()) as capture:
            self.assertEqual(calibrate_group(config, group), template)
            capture.assert_called_once_with(98, group, [group])
            profiles["不同消息区"] = {**template, "messageRegion": [35, 50, 430, 510]}
            with self.assertRaisesRegex(OcrCaptureError, "AMBIGUOUS"):
                calibrate_group(config, group)
            with self.assertRaisesRegex(OcrCaptureError, "GROUP_NOT_ALLOWED"):
                calibrate_group(config, "原群")
            capture.side_effect = lambda *args: Image.new("RGB", (360, 600))
            with self.assertRaisesRegex(OcrCaptureError, "NO_TEMPLATE") as no_template:
                calibrate_group(config, group)
            self.assertEqual(no_template.exception.details["windowSize"], [360, 600])
            self.assertEqual(no_template.exception.details["availableSizes"], [[500, 600]])

    def test_calibration_does_not_use_a_different_window_or_unreadable_title(self):
        from ocr_capture import calibrate_group
        from PIL import Image
        template = {"windowSize": [500, 600], "titleRegion": [10, 10, 180, 40], "messageRegion": [50, 50, 450, 510]}
        config = {"groups": ["新目标"], "capture": {"profiles": {"旧群": template}}}
        with patch.dict(sys.modules, rapidocr=SimpleNamespace(RapidOCR=Mock())), \
                patch("ocr_capture._windows_api"), patch("ocr_capture._require_unlocked_desktop"), \
                patch("ocr_capture._matching_windows", side_effect=[{"新目标":8},{"新目标":8},{"新目标":9}]), \
                patch("ocr_capture.title_matches_image", side_effect=[False, True]), \
                patch("window_capture.capture_window", side_effect=lambda *args: Image.new("RGB", (500,600))):
            with self.assertRaisesRegex(OcrCaptureError, "TITLE_MISMATCH"):
                calibrate_group(config, "新目标")
            with self.assertRaisesRegex(OcrCaptureError, "WINDOW_CHANGED"):
                calibrate_group(config, "新目标")

    def test_image_reader_rejects_unapproved_group_and_changed_size_before_ocr(self):
        config = {"groups": ["B300真实交易群"], "capture": {"profiles": {"B300真实交易群": {
            "windowSize": [601, 641], "titleRegion": [8, 30, 365, 76],
            "messageRegion": [65, 78, 586, 522]}}}}
        def forbidden_engine(_):
            self.fail("OCR must not run on an unauthorized or differently sized image")
        image = SimpleNamespace(size=(601, 642))
        with self.assertRaisesRegex(OcrCaptureError, "GROUP_NOT_ALLOWED"):
            read_snapshot_image(config, "其他群", image, forbidden_engine, "2026-10-31T00:00:00Z")
        with self.assertRaisesRegex(OcrCaptureError, "WINDOW_RESIZED"):
            read_snapshot_image(config, "B300真实交易群", image, forbidden_engine, "2026-10-31T00:00:00Z")

    def test_engine_retains_uncertain_lines_for_whole_snapshot_validation(self):
        calls = []
        sentinel = object()
        def factory(**kwargs):
            calls.append(kwargs)
            return sentinel
        self.assertIs(create_engine(factory), sentinel)
        self.assertEqual(calls, [{"params": {"Global.text_score": 0.0}}])

    def test_viewport_is_not_claimed_as_individual_message(self):
        message = snapshot_message("B300真实交易群", ["甲：B300 2台", "乙：价格待确认"], "2026-10-21T10:00:00Z")
        self.assertEqual(message["captureMode"], "OCR_SNAPSHOT")
        self.assertIsNone(message["sentAt"])
        self.assertEqual(message["sender"], "未识别（截图识别）")
        again = snapshot_message("B300真实交易群", ["甲：B300 2台", "乙：价格待确认"], "2026-10-21T11:00:00Z")
        self.assertEqual(message["messageId"], again["messageId"])
        other = snapshot_message("真实货源群", ["甲：B300 2台", "乙：价格待确认"], "2026-10-21T10:00:00Z")
        self.assertNotEqual(message["messageId"], other["messageId"])

    def test_snapshot_uses_the_servers_utf16_size_limit(self):
        with self.assertRaisesRegex(OcrCaptureError, "OCR_TOO_LARGE"):
            snapshot_message("B300真实交易群", ["🧪" * 10001], "2026-10-31T00:00:00Z")

    def test_uncertain_number_rejects_entire_snapshot(self):
        result = SimpleNamespace(txts=["B300", "1850"], scores=[0.99, 0.5], boxes=[[[0, 0]] * 4, [[0, 20]] * 4])
        with self.assertRaisesRegex(OcrCaptureError, "OCR_LOW_CONFIDENCE"):
            ocr_lines(result)

    def test_review_mode_preserves_uncertain_price_without_silently_dropping_it(self):
        result = SimpleNamespace(txts=["B300", "1850", "深圳", "2台"], scores=[0.99, 0.5, 0.99, 0.99],
                                 boxes=[[[0, y]] * 4 for y in (0, 20, 40, 60)])
        self.assertEqual(ocr_lines(result, annotate_uncertain=True),
                         ["B300", "【OCR待核对 50%】1850", "深圳", "2台"])

    def test_review_mode_rejects_a_largely_unreadable_body(self):
        result = SimpleNamespace(txts=["B300", "1850"], scores=[0.2, 0.3],
                                 boxes=[[[0, 0]] * 4, [[0, 20]] * 4])
        with self.assertRaisesRegex(OcrCaptureError, "OCR_TOO_UNCERTAIN"):
            ocr_lines(result, annotate_uncertain=True)

    def test_lines_are_sorted_and_empty_output_is_safe(self):
        result = SimpleNamespace(txts=["第二行", "第一行"], scores=[0.98, 0.99], boxes=[[[0, 20]] * 4, [[0, 0]] * 4])
        self.assertEqual(ocr_lines(result), ["第一行", "第二行"])
        self.assertEqual(ocr_lines(SimpleNamespace(txts=None)), [])
        self.assertIsNone(snapshot_message("群", [], "2026-10-21T10:00:00Z"))

    def test_crop_requires_explicit_calibration(self):
        with self.assertRaisesRegex(OcrCaptureError, "NOT_CALIBRATED"):
            profile_for({}, "群")
        config = {"capture": {"profiles": {"群": {"windowSize": [600, 641], "titleRegion": [8, 30, 365, 76], "messageRegion": [65, 78, 586, 522]}}}}
        self.assertEqual(profile_for(config, "群")["windowSize"], [600, 641])
        config["capture"]["profiles"]["群"]["messageRegion"] = [65, 50, 586, 522]
        with self.assertRaisesRegex(OcrCaptureError, "不能重叠"):
            profile_for(config, "群")

    def test_title_count_is_not_part_of_group_name(self):
        self.assertEqual(normalize_title("B300真实交易群 (88)"), "B300真实交易群")
        self.assertEqual(normalize_title("B300真实交易群((88)"), "B300真实交易群")
        self.assertNotEqual(normalize_title("其他群(88)"), "B300真实交易群")

    def test_single_line_title_uses_horizontal_order_and_still_requires_exact_name(self):
        result=SimpleNamespace(txts=["(92)", "B300真实交易群("], scores=[0.99,0.99],
                               boxes=[[[200,0]]*4, [[0,12]]*4])
        self.assertEqual(normalize_title(ocr_title_text(result)), "B300真实交易群")
        result.txts=["(92)", "B300其他交易群("]
        self.assertNotEqual(normalize_title(ocr_title_text(result)), "B300真实交易群")


if __name__ == "__main__":
    unittest.main()
