from __future__ import annotations

import io
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

import numpy as np
from PIL import Image

import window_capture as w


def png_bytes():
    output = io.BytesIO()
    Image.new("RGB", (3, 2), (12, 34, 56)).save(output, format="PNG")
    return output.getvalue()


class ProcessTests(unittest.TestCase):
    def process(self, output=None, stderr=b"", returncode=0):
        process = MagicMock(returncode=returncode)
        process.__enter__.return_value = process
        process.communicate.return_value = (png_bytes() if output is None else output, stderr)
        return process

    def test_parent_uses_same_interpreter_and_exact_handle_without_shell(self):
        process = self.process()
        with patch.object(w.subprocess, "Popen", return_value=process) as popen:
            image = w.capture_window(12345, "设备询价群", ["设备询价群"])
        command = popen.call_args.args[0]
        self.assertEqual(command[0], sys.executable)
        self.assertEqual(command[-3:], ["--hwnd", "12345", "--group=设备询价群"])
        self.assertNotIn("shell", popen.call_args.kwargs)
        self.assertEqual(process.communicate.call_args.kwargs["timeout"], 15)
        self.assertEqual(image.mode, "RGB")
        self.assertEqual(image.getpixel((0, 0)), (12, 34, 56))
        image.close()

    def test_timeout_kills_and_reaps_child(self):
        process = self.process()
        process.communicate.side_effect = [subprocess.TimeoutExpired("child", 15), (b"", b"")]
        with patch.object(w.subprocess, "Popen", return_value=process), self.assertRaisesRegex(w.WindowCaptureError, "WGC_TIMEOUT"):
            w.capture_window(12345, "设备询价群", ["设备询价群"])
        process.kill.assert_called_once()
        self.assertEqual(process.communicate.call_count, 2)

    def test_cancellation_kills_and_reaps_child(self):
        process = self.process()
        process.communicate.side_effect = [KeyboardInterrupt(), (b"", b"")]
        with patch.object(w.subprocess, "Popen", return_value=process), self.assertRaises(KeyboardInterrupt):
            w.capture_window(12345, "设备询价群", ["设备询价群"])
        process.kill.assert_called_once()
        self.assertEqual(process.communicate.call_count, 2)

    def test_native_failure_reports_fixed_code_without_echoing_diagnostics(self):
        process = self.process(returncode=1, stderr=b'private native details\n{"code":"WGC_WINDOW_CHANGED"}\n')
        with patch.object(w.subprocess, "Popen", return_value=process), self.assertRaisesRegex(w.WindowCaptureError, "WGC_WINDOW_CHANGED") as error:
            w.capture_window(12345, "设备询价群", ["设备询价群"])
        self.assertNotIn("private", str(error.exception))

    def test_invalid_png_is_rejected_without_any_capture_fallback(self):
        process = self.process(output=b"not an image")
        with patch.object(w.subprocess, "Popen", return_value=process) as popen, self.assertRaisesRegex(w.WindowCaptureError, "WGC_INVALID_FRAME"):
            w.capture_window(12345, "设备询价群", ["设备询价群"])
        popen.assert_called_once()

    def test_unapproved_target_starts_no_process(self):
        with patch.object(w.subprocess, "Popen") as popen:
            for hwnd, group in ((0, "B300真实交易群"), (True, "B300真实交易群"), (123, "其他群")):
                with self.subTest(hwnd=hwnd, group=group), self.assertRaises(w.WindowCaptureError):
                    w.capture_window(hwnd, group, ["B300真实交易群"])
            popen.assert_not_called()


class FrameTests(unittest.TestCase):
    def test_child_checks_identity_before_and_after_exact_handle_capture(self):
        image = Image.new("RGB", (2, 2))
        factory = object()
        with patch.object(w.os, "name", "nt"), patch.object(w, "_validate_window") as validate, \
                patch.dict(sys.modules, {"windows_capture": SimpleNamespace(WindowsCapture=factory)}), \
                patch.object(w, "_first_frame", return_value=image) as first:
            self.assertIs(w._capture_child(123, "B300真实交易群"), image)
        self.assertEqual(validate.call_args_list, [unittest.mock.call(123, "B300真实交易群")] * 2)
        first.assert_called_once_with(123, factory)

    def test_changed_handle_is_rejected_without_a_native_capture(self):
        import ocr_capture
        with patch.object(ocr_capture, "_windows_api", return_value=object()), \
                patch.object(ocr_capture, "_require_unlocked_desktop"), \
                patch.object(ocr_capture, "_matching_windows", return_value={"B300真实交易群": 456}), \
                patch.object(ocr_capture, "_window_title", return_value="B300真实交易群"), \
                patch.object(ocr_capture, "_wechat_process", return_value=True):
            with self.assertRaisesRegex(w.WindowCaptureError, "WGC_WINDOW_CHANGED"):
                w._validate_window(123, "B300真实交易群")

    def test_only_hwnd_backend_and_first_frame_copy_bgra_to_rgb(self):
        factories = []
        controls = []
        pixels = np.array([[[1, 2, 3, 255], [4, 5, 6, 255]]], dtype=np.uint8)

        class Capture:
            def __init__(self, **kwargs):
                factories.append(kwargs)
                self.events = {}

            def event(self, handler):
                self.events[handler.__name__] = handler
                return handler

            def start(self):
                control = MagicMock()
                controls.append(control)
                self.events["on_frame_arrived"](SimpleNamespace(frame_buffer=pixels, width=2, height=1), control)
                pixels[:] = 0  # The native view is no longer valid after callback.
                self.events["on_closed"]()

        image = w._first_frame(123, Capture)
        self.assertEqual(factories, [{"window_hwnd": 123, "cursor_capture": False, "monitor_index": None,
                                     "secondary_window": False, "draw_border": None}])
        self.assertEqual(image.getpixel((0, 0)), (3, 2, 1))
        controls[0].stop.assert_called_once()

    def test_closed_without_frame_fails(self):
        class Capture:
            def __init__(self, **kwargs):
                self.events = {}

            def event(self, handler):
                self.events[handler.__name__] = handler
                return handler

            def start(self):
                self.events["on_closed"]()

        with self.assertRaisesRegex(w.WindowCaptureError, "WGC_NO_FRAME"):
            w._first_frame(123, Capture)


if __name__ == "__main__":
    unittest.main()
