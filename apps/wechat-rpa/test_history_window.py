"""Scroll delivery contract, with no native windows or inputs."""
import ctypes
from ctypes import wintypes
from contextlib import nullcontext
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from history_window import HistoryWindow, HistoryError, Viewport


class WheelTests(unittest.TestCase):
    def adapter(self, scroll_lines=3):
        user32 = SimpleNamespace(SendMessageTimeoutW=Mock(return_value=1))
        user32.SystemParametersInfoW = Mock(side_effect=lambda _a, _b, target, _d: setattr(target._obj, 'value', scroll_lines))
        adapter = HistoryWindow.__new__(HistoryWindow)
        adapter.scroll_attempted = False
        adapter.profile = {'messageRegion': [65, 78, 533, 545]}
        adapter.capture = Mock(side_effect=[Viewport('before', [], line_height=18), Viewport('after', [])])
        api = (ctypes, wintypes, user32, None)
        adapter._guard = Mock(return_value=api)
        adapter._wheel_target = Mock(side_effect=lambda _api: nullcontext((123, 100, 200)))
        return adapter, user32

    def test_large_scroll_is_delivered_as_individual_standard_notches(self):
        distances = []
        for direction, fraction in [('up', .7), ('down', 3)]:
            adapter, user32 = self.adapter()
            with patch('history_window.time.sleep'):
                self.assertEqual(adapter.scroll(direction, fraction).fingerprint, 'after')
            deliveries = user32.SendMessageTimeoutW.call_args_list
            self.assertGreater(len(deliveries), 1)
            deltas = [ctypes.c_short((call.args[2] >> 16) & 0xFFFF).value for call in deliveries]
            self.assertEqual(set(deltas), {120 if direction == 'up' else -120})
            self.assertTrue(all(call.args[0] == 123 and call.args[1] == 0x020A for call in deliveries))
            self.assertGreaterEqual(adapter._guard.call_count, len(deliveries))
            distances.append(len(deliveries))
        self.assertGreater(distances[1], distances[0] * 3, 'restoration must travel farther even when an app ignores delta magnitude')

    def test_failed_notch_stops_further_delivery(self):
        adapter, user32 = self.adapter()
        user32.SendMessageTimeoutW.side_effect = [1, 0]
        with patch('history_window.time.sleep'), self.assertRaisesRegex(HistoryError, 'SCROLL_MESSAGE_FAILED'):
            adapter.scroll('down', 3)
        self.assertEqual(user32.SendMessageTimeoutW.call_count, 2)
        self.assertEqual(adapter.capture.call_count, 1)
        self.assertTrue(adapter.scroll_attempted)

    def test_small_ocr_rows_preserve_measured_viewport_overlap(self):
        for row_height in (10, 17, 24):
            for scroll_lines in (1, 3):
                with self.subTest(row_height=row_height, scroll_lines=scroll_lines):
                    adapter, user32 = self.adapter(scroll_lines)
                    adapter.capture.side_effect = [Viewport('before', [], line_height=row_height), Viewport('after', [])]
                    with patch('history_window.time.sleep'):
                        adapter.scroll('up', .7)
                    # Live calibration in each approved pane measured 37px
                    # per notch. Keep at least half a pane for overlapping OCR.
                    self.assertLess(user32.SendMessageTimeoutW.call_count * 37, 467 / 2)

    def test_large_photo_ocr_rows_cannot_shrink_fast_restore_below_its_budget(self):
        from backfill import restore_budget
        adapter, user32 = self.adapter(3)
        adapter.capture.side_effect = [Viewport('before', [], line_height=100), Viewport('after', [])]
        with patch('history_window.time.sleep'):
            adapter.scroll('down', 3)
        down_notches = user32.SendMessageTimeoutW.call_count
        self.assertEqual(down_notches, 20)
        budget = restore_budget(200, True)
        self.assertEqual(budget, 53)
        self.assertGreaterEqual((budget - 2) * down_notches, 200 * 5,
                                'the bounded return must cover every permitted up-notch plus two stable checks')

    def test_small_manual_down_step_is_not_forced_to_twenty_notches(self):
        adapter, user32 = self.adapter(3)
        adapter.capture.side_effect = [Viewport('before', [], line_height=100), Viewport('after', [])]
        with patch('history_window.time.sleep'):
            adapter.scroll('down', .25)
        self.assertEqual(user32.SendMessageTimeoutW.call_count, 1)

    def test_target_change_between_notches_stops_without_more_input(self):
        adapter, user32 = self.adapter()
        api = adapter._guard.return_value
        adapter._guard.side_effect = [api, api, HistoryError('BACKFILL_TARGET_CHANGED')]
        with patch('history_window.time.sleep'), self.assertRaisesRegex(HistoryError, 'TARGET_CHANGED'):
            adapter.scroll('up', .7)
        self.assertEqual(user32.SendMessageTimeoutW.call_count, 1)

    def test_cross_process_wheel_uses_physical_dpi_until_send_returns(self):
        for success in (True, False):
            with self.subTest(success=success):
                adapter, user32 = self.adapter()
                del adapter._wheel_target  # use production geometry and DPI guard
                adapter.hwnd, adapter.pid = 123, None
                adapter.profile = {"messageRegion": [100, 100, 400, 400], "windowSize": [548, 640]}
                prior = 17
                current = prior
                physical = wintypes.HANDLE(-4).value
                def set_context(value):
                    nonlocal current
                    previous = current
                    current = getattr(value, "value", value)
                    return previous
                def window_rect(_hwnd, rect):
                    self.assertEqual(current, physical)
                    rect._obj.left, rect._obj.top = 1000, 10
                    rect._obj.right, rect._obj.bottom = 1822, 970
                    return True
                def send(hwnd, _msg, _wp, coords, *_rest):
                    self.assertEqual(current, physical)
                    self.assertEqual((hwnd, coords & 0xffff, coords >> 16), (123, 1375, 385))
                    return success
                user32.SetThreadDpiAwarenessContext = Mock(side_effect=set_context)
                user32.GetWindowRect = Mock(side_effect=window_rect)
                user32.ScreenToClient = Mock(return_value=True)
                user32.ChildWindowFromPointEx = Mock(return_value=123)
                user32.GetAncestor = Mock(return_value=123)
                user32.GetWindowThreadProcessId = Mock()
                user32.SendMessageTimeoutW.side_effect = send
                with patch("ocr_capture._wechat_process", return_value=True), patch("history_window.time.sleep"):
                    if success:
                        adapter.scroll("up", 0.25)
                    else:
                        with self.assertRaisesRegex(HistoryError, "SCROLL_MESSAGE_FAILED"):
                            adapter.scroll("up", 0.25)
                self.assertEqual(current, prior)

    def test_disabled_wheel_and_invalid_direction_send_nothing(self):
        adapter, user32 = self.adapter(0)
        with self.assertRaisesRegex(HistoryError, 'WHEEL_SCROLL_DISABLED'):
            adapter.scroll('up', .7)
        user32.SendMessageTimeoutW.assert_not_called()
        self.assertFalse(adapter.scroll_attempted)
        adapter, user32 = self.adapter()
        with self.assertRaisesRegex(HistoryError, 'SCROLL_ARGUMENT_INVALID'):
            adapter.scroll('sideways', .7)
        adapter.capture.assert_not_called()

    def test_guard_preserves_window_diagnosis_without_exposing_details(self):
        from ocr_capture import OcrCaptureError
        adapter = HistoryWindow.__new__(HistoryWindow)
        adapter.group = "真实货源群"
        for code in ("OCR_WINDOW_NOT_FOUND", "OCR_WINDOW_NOT_UNIQUE", "OCR_WINDOW_MINIMIZED"):
            with self.subTest(code=code), patch("ocr_capture._windows_api"), patch("ocr_capture._require_unlocked_desktop"), patch(
                "ocr_capture._matching_windows", side_effect=OcrCaptureError(code + ": private details")
            ), self.assertRaises(HistoryError) as error:
                adapter._guard()
            self.assertEqual(str(error.exception), code)


if __name__ == '__main__':
    unittest.main()
