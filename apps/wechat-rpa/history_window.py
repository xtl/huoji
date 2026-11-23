"""Exact-HWND history scrolling for this project's user-run RPA product.

No keyboard, clipboard, foreground activation, input-field click, or global
mouse wheel. Every wheel message targets a verified child of the approved chat.
Importing this module does not access the desktop.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import time
from typing import Any


class HistoryError(RuntimeError):
    pass


@dataclass
class Viewport:
    fingerprint: str
    messages: list[dict[str, Any]]
    at_bottom: bool = False
    line_height: float = 24.0
    crop: Any = field(default=None, repr=False)
    body_error: str | None = None
    date_events: list = field(default_factory=list, repr=False)
    captured_at: datetime | None = None


class HistoryWindow:
    def __init__(self, config: dict[str, Any], group: str):
        from ocr_capture import profile_for
        if group not in config.get("groups", []):
            raise HistoryError("BACKFILL_GROUP_NOT_ALLOWED")
        self.config = config
        self.group = group
        self.profile = profile_for(config, group)
        self.hwnd: int | None = None
        self.pid: int | None = None
        self.last: Viewport | None = None
        self.scroll_attempted = False

    def _guard(self):
        from ocr_capture import (OcrCaptureError, _matching_windows, _require_unlocked_desktop,
                                 _wechat_process, _window_title, _windows_api)
        try:
            api = _windows_api()
            _require_unlocked_desktop(api)
            hwnd = _matching_windows(api, [self.group])[self.group]
            if self.hwnd is None:
                self.hwnd = hwnd
            if hwnd != self.hwnd or _window_title(api, hwnd) != self.group or not _wechat_process(api, hwnd):
                raise HistoryError("BACKFILL_TARGET_CHANGED")
            ctypes, wintypes, user32, _ = api
            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if self.pid is None:
                self.pid = int(pid.value)
            if not self.pid or pid.value != self.pid:
                raise HistoryError("BACKFILL_PROCESS_CHANGED")
            return api
        except HistoryError:
            raise
        except OcrCaptureError as exc:
            raise HistoryError(str(exc).partition(":")[0]) from exc
        except Exception as exc:
            raise HistoryError("BACKFILL_TARGET_UNAVAILABLE") from exc

    def capture(self) -> Viewport:
        from window_capture import capture_window
        from ocr_capture import create_engine, title_matches_image
        import ocr_capture
        import numpy as np
        from rapidocr import RapidOCR
        self._guard()
        image = capture_window(self.hwnd, self.group, self.config["groups"])
        captured_at = datetime.now(timezone.utc)
        self._guard()
        if ocr_capture._engine is None:
            ocr_capture._engine = create_engine(RapidOCR)
        if list(image.size) != self.profile["windowSize"]:
            raise HistoryError("BACKFILL_WINDOW_RESIZED")
        if not title_matches_image(image, self.profile, self.group, ocr_capture._engine):
            raise HistoryError("BACKFILL_TITLE_MISMATCH")
        # Scroll/restore only depends on safe identity/title/size validation.
        # Body OCR and uncertainty failures must never strand a historical view.
        crop = image.crop(tuple(self.profile["messageRegion"]))
        raw = np.asarray(crop.convert("L").resize((128, 192))) // 8
        digest = hashlib.sha256(raw.tobytes()).hexdigest()
        line_height = self.last.line_height if self.last else 24.0
        self._guard()
        self.last = Viewport(digest, [], self._native_bottom(), line_height, crop=crop, captured_at=captured_at)
        return self.last

    def read(self, frame: Viewport, *, date_mode: bool = False) -> list[dict[str, Any]]:
        from ocr_capture import OcrCaptureError
        from ocr_messages import messages_from_crop
        import ocr_capture
        import numpy as np
        if frame.crop is None:
            return frame.messages
        frame.date_events = []
        frame.body_error = None
        try:
            output = ocr_capture._engine(np.asarray(frame.crop))
            boxes = getattr(output, "boxes", None)
            heights = [max(float(p[1]) for p in box) - min(float(p[1]) for p in box)
                       for box in (boxes if boxes is not None else []) if len(box) == 4]
            valid = [height for height in heights if 10 <= height <= 100]
            if valid:
                frame.line_height = float(np.median(valid))
            left = self.profile["messageRegion"][0]
            column = max(0, self.profile.get("incomingBubbleLeft", left) - left)
            observed_at = (frame.captured_at or datetime.now(timezone.utc)).isoformat().replace("+00:00", "Z")
            frame.messages = messages_from_crop(self.group, frame.crop, output, observed_at,
                                               incoming_bubble_left=column,
                                               history_events=frame.date_events if date_mode else None,
                                               center_x=self.profile["windowSize"][0] / 2 - left)
        except Exception as exc:
            frame.messages = []
            if date_mode:
                frame.date_events = [("unknown", None)]
            frame.body_error = str(exc).split(":", 1)[0] if isinstance(exc, OcrCaptureError) else "BACKFILL_BODY_OCR_FAILED"
        return frame.messages

    @contextmanager
    def _wheel_target(self, api):
        """Keep physical screen coordinates valid through cross-process wheel delivery."""
        ctypes, wintypes, user32, _ = api
        user32.SetThreadDpiAwarenessContext.argtypes = [wintypes.HANDLE]
        user32.SetThreadDpiAwarenessContext.restype = wintypes.HANDLE
        previous = user32.SetThreadDpiAwarenessContext(wintypes.HANDLE(-4))
        if not previous:
            raise HistoryError("BACKFILL_DPI_CONTEXT_FAILED")
        try:
            user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
            rectangle = wintypes.RECT()
            if not user32.GetWindowRect(self.hwnd, ctypes.byref(rectangle)):
                raise HistoryError("BACKFILL_WINDOW_RECT_FAILED")
            left, top, right, bottom = self.profile["messageRegion"]
            width, height = self.profile["windowSize"]
            x = round(rectangle.left + (left + right) / 2 / width * (rectangle.right - rectangle.left))
            y = round(rectangle.top + (top + bottom) / 2 / height * (rectangle.bottom - rectangle.top))
            if not -32768 <= x <= 32767 or not -32768 <= y <= 32767:
                raise HistoryError("BACKFILL_COORDINATE_RANGE")
            user32.ScreenToClient.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.POINT)]
            user32.ChildWindowFromPointEx.argtypes = [wintypes.HWND, wintypes.POINT, wintypes.UINT]
            user32.ChildWindowFromPointEx.restype = wintypes.HWND
            user32.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
            user32.GetAncestor.restype = wintypes.HWND
            target = self.hwnd
            for _ in range(12):
                point = wintypes.POINT(x, y)
                if not user32.ScreenToClient(target, ctypes.byref(point)):
                    raise HistoryError("BACKFILL_COORDINATE_MAPPING_FAILED")
                child = user32.ChildWindowFromPointEx(target, point, 7)
                if not child or child == target:
                    break
                target = int(child)
            from ocr_capture import _wechat_process
            if int(user32.GetAncestor(target, 2) or 0) != self.hwnd or not _wechat_process(api, target):
                raise HistoryError("BACKFILL_SCROLL_CHILD_MISMATCH")
            child_pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(target, ctypes.byref(child_pid))
            if self.pid is not None and child_pid.value != self.pid:
                raise HistoryError("BACKFILL_SCROLL_CHILD_PROCESS_MISMATCH")
            yield target, x, y
        finally:
            user32.SetThreadDpiAwarenessContext(previous)

    def _coordinates(self, api):
        with self._wheel_target(api) as target:
            return target

    def _native_bottom(self) -> bool:
        # Qt custom renderers often expose no Win32 scroll state. Missing state
        # is unknown, never evidence that the window is at the latest message.
        try:
            api = self._guard()
            ctypes, wintypes, user32, _ = api
            target, _, _ = self._coordinates(api)
            class ScrollInfo(ctypes.Structure):
                _fields_ = [("cbSize", wintypes.UINT), ("fMask", wintypes.UINT),
                            ("nMin", ctypes.c_int), ("nMax", ctypes.c_int),
                            ("nPage", wintypes.UINT), ("nPos", ctypes.c_int), ("nTrackPos", ctypes.c_int)]
            user32.GetScrollInfo.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.POINTER(ScrollInfo)]
            info = ScrollInfo(cbSize=ctypes.sizeof(ScrollInfo), fMask=0x17)
            if not user32.GetScrollInfo(target, 1, ctypes.byref(info)) or info.nMax <= info.nMin or not info.nPage:
                return False
            return info.nPos + int(info.nPage) - 1 >= info.nMax
        except HistoryError:
            raise
        except Exception:
            return False

    def scroll(self, direction: str, fraction: float = 0.25) -> Viewport:
        if direction not in ("up", "down") or not 0 < fraction <= 4:
            raise HistoryError("BACKFILL_SCROLL_ARGUMENT_INVALID")
        before = self.capture()  # exact OCR title/size before sending any input
        api = self._guard()
        ctypes, wintypes, user32, _ = api
        region = self.profile["messageRegion"]
        scroll_lines = wintypes.UINT(3)
        user32.SystemParametersInfoW(104, 0, ctypes.byref(scroll_lines), 0)  # SPI_GETWHEELSCROLLLINES
        if scroll_lines.value == 0:
            raise HistoryError("BACKFILL_WHEEL_SCROLL_DISABLED")
        units = max(1, round((region[3] - region[1]) * fraction / max(1, before.line_height * scroll_lines.value))) if scroll_lines.value != 0xFFFFFFFF else 1
        units = min(40, units)
        if direction == "up":
            # Tiny text inside photos must not enlarge a history step. The two
            # calibrated 467px chat panes move 37px per standard notch; five
            # leaves more than half a pane overlapping for body/name pairing.
            units = min(5, units)
        elif fraction >= 3:
            # Large text inside a historical photo can inflate the last OCR
            # line height. Keep fast restoration independent of that estimate:
            # 53 steps minus two stable confirmations cover 200 * 5 up-notches.
            units = max(20, units)
        # This WeChat renderer advances once per wheel event even when the
        # delta contains several notches. Send standard notches individually
        # so a return-to-latest step really travels farther than an up step.
        delta = 120 * (1 if direction == "up" else -1)
        wparam = (delta & 0xFFFF) << 16
        result = ctypes.c_size_t()
        user32.SendMessageTimeoutW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM,
                                              wintypes.LPARAM, wintypes.UINT, wintypes.UINT,
                                              ctypes.POINTER(ctypes.c_size_t)]
        user32.SendMessageTimeoutW.restype = wintypes.LPARAM
        for index in range(units):
            self._guard()
            with self._wheel_target(api) as (target, x, y):
                # Windows translates WM_MOUSEWHEEL coordinates between sender
                # and receiver DPI contexts, including for SendMessageTimeoutW.
                lparam = ((y & 0xFFFF) << 16) | (x & 0xFFFF)
                # A timed-out send may still have moved the chat.
                self.scroll_attempted = True
                if not user32.SendMessageTimeoutW(target, 0x020A, wparam, lparam, 0x22, 750, ctypes.byref(result)):
                    raise HistoryError("BACKFILL_SCROLL_MESSAGE_FAILED")
            if index + 1 < units:
                time.sleep(0.04)
        self._guard()
        time.sleep(0.45)
        return self.capture()  # exact OCR title/size and window identity after input
