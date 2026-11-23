"""Read-only, calibrated OCR adapter for standalone WeChat chat windows.

No navigation, clipboard, keyboard, mouse, injection, or database access. An OCR
snapshot is a viewport containing potentially several speakers, NOT a message.
Live capture is deliberately separate from the pure helpers used in tests.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class OcrCaptureError(RuntimeError):
    pass


class CalibrationError(OcrCaptureError):
    def __init__(self, code, *, window_size=None, available_sizes=()):
        super().__init__(code)
        self.details = {"availableSizes": sorted(map(list, available_sizes))}
        if window_size is not None:
            self.details["windowSize"] = list(window_size)


def profile_for(config: dict[str, Any], group: str) -> dict[str, Any]:
    profile = config.get("capture", {}).get("profiles", {}).get(group)
    if not isinstance(profile, dict):
        raise OcrCaptureError(f"OCR_NOT_CALIBRATED: {group} 尚未校准独立窗口的截图区域。")
    size = profile.get("windowSize")
    if not isinstance(size, list) or len(size) != 2 or any(type(v) is not int or v < 100 for v in size):
        raise OcrCaptureError("OCR_PROFILE_INVALID: windowSize 必须是实测截图宽高。")
    for field in ("messageRegion", "titleRegion"):
        region = profile.get(field)
        if (not isinstance(region, list) or len(region) != 4
                or any(type(v) is not int for v in region)):
            raise OcrCaptureError(f"OCR_PROFILE_INVALID: {field} 必须是四个整数。")
        left, top, right, bottom = region
        if not (0 <= left < right <= size[0] and 0 <= top < bottom <= size[1]):
            raise OcrCaptureError(f"OCR_PROFILE_INVALID: {field} 超出截图范围。")
    a, b = profile["messageRegion"], profile["titleRegion"]
    if min(a[2], b[2]) > max(a[0], b[0]) and min(a[3], b[3]) > max(a[1], b[1]):
        raise OcrCaptureError("OCR_PROFILE_INVALID: 标题与消息区域不能重叠。")
    column = profile.get("incomingBubbleLeft")
    if column is not None and (type(column) is not int or not 0 <= column < size[0]):
        raise OcrCaptureError("OCR_PROFILE_INVALID: incomingBubbleLeft 必须是窗口内实测的消息气泡左坐标。")
    return profile


def normalize_title(value: str) -> str:
    value = re.sub(r"\s+", "", value)
    # OCR may split an opening bracket into two overlapping detections. Only
    # the numeric member-count decoration is removed; group text stays exact.
    return re.sub(r"[（(]+\d+[)）]+$", "", value)


def ocr_lines(output: Any, minimum_score: float = 0.80,
              annotate_uncertain: bool = False) -> list[str]:
    """Keep uncertain body text visibly marked; group titles remain strict."""
    texts = getattr(output, "txts", None)
    scores = getattr(output, "scores", None)
    boxes = getattr(output, "boxes", None)
    if texts is None or scores is None or boxes is None:
        return []
    if len(texts) != len(scores) or len(texts) != len(boxes):
        raise OcrCaptureError("OCR_OUTPUT_INVALID: OCR 返回的文字、坐标与置信度不一致。")
    rows = []
    uncertain = 0
    for text, score, box in zip(texts, scores, boxes):
        text = str(text).strip()
        if not text:
            continue
        score = float(score)
        if not math.isfinite(score) or not 0 <= score <= 1:
            raise OcrCaptureError("OCR_OUTPUT_INVALID: OCR 返回的置信度无效。")
        if score < minimum_score:
            # Never silently discard a price while retaining its model. Bodies
            # preserve the text with a warning, and can only enter review drafts.
            if not annotate_uncertain:
                raise OcrCaptureError("OCR_LOW_CONFIDENCE: 截图存在识别不确定的文字，本次不入队。")
            uncertain += 1
            text = f"【OCR待核对 {score:.0%}】{text}"
        points = list(box)
        if len(points) != 4:
            raise OcrCaptureError("OCR_OUTPUT_INVALID: 文字边界格式不正确。")
        rows.append((min(float(p[1]) for p in points), min(float(p[0]) for p in points), text))
    if annotate_uncertain and uncertain and uncertain / len(rows) > 0.25:
        raise OcrCaptureError("OCR_TOO_UNCERTAIN: 超过四分之一的文字识别不确定，本次不入队。")
    return [row[2] for row in sorted(rows, key=lambda row: (round(row[0] / 6), row[1]))]


def snapshot_message(group: str, lines: list[str], observed_at: str) -> dict[str, Any] | None:
    text = "\n".join(line.strip() for line in lines if line.strip())
    if not text:
        return None
    if len(text.encode("utf-16-le", errors="surrogatepass")) // 2 > 20_000:
        raise OcrCaptureError("OCR_TOO_LARGE: 单次聊天区域识别超过 20000 字符。")
    fingerprint = hashlib.sha256(json.dumps([group, text], ensure_ascii=False).encode("utf-8")).hexdigest()
    return {
        "messageId": f"ocr_{fingerprint}", "chatName": group,
        "sender": "未识别（截图识别）", "sentAt": None,
        "observedAt": observed_at, "text": text, "captureMode": "OCR_SNAPSHOT",
        "captureUnit": "VIEWPORT_REMAINDER",
    }


def ocr_title_text(output: Any) -> str:
    # The calibrated title region is one line. Chinese glyphs and the numeric
    # count can have different top coordinates, so read left-to-right rather
    # than treating the count as a separate earlier row.
    validated = ocr_lines(output, 0.80)
    if not validated:
        return ""
    rows = [(min(float(point[0]) for point in box), str(text).strip())
            for text, box in zip(output.txts, output.boxes) if str(text).strip()]
    return "".join(text for _, text in sorted(rows, key=lambda row: row[0]))


def _windows_api():
    if os.name != "nt":
        raise OcrCaptureError("OCR_WINDOWS_REQUIRED: 现场截图采集只支持 Windows。")
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsIconic.argtypes = [wintypes.HWND]
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    return ctypes, wintypes, user32, kernel32


def _require_unlocked_desktop(api) -> None:
    ctypes, wintypes, user32, _ = api
    user32.OpenInputDesktop.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    user32.OpenInputDesktop.restype = wintypes.HANDLE
    user32.GetUserObjectInformationW.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    user32.CloseDesktop.argtypes = [wintypes.HANDLE]
    desktop = user32.OpenInputDesktop(0, False, 0x0001)  # DESKTOP_READOBJECTS
    if not desktop:
        raise OcrCaptureError("OCR_DESKTOP_UNAVAILABLE: 桌面可能锁定，停止本次采集。")
    try:
        buffer = ctypes.create_unicode_buffer(256)
        required = wintypes.DWORD()
        if not user32.GetUserObjectInformationW(desktop, 2, buffer, ctypes.sizeof(buffer), ctypes.byref(required)) or buffer.value.lower() != "default":
            raise OcrCaptureError("OCR_DESKTOP_UNAVAILABLE: 当前不是普通解锁桌面。")
    finally:
        user32.CloseDesktop(desktop)


def _window_title(api, hwnd: int) -> str:
    ctypes, _, user32, _ = api
    buffer = ctypes.create_unicode_buffer(user32.GetWindowTextLengthW(hwnd) + 1)
    user32.GetWindowTextW(hwnd, buffer, len(buffer))
    return buffer.value


def _window_pid(api, hwnd: int) -> int:
    ctypes, wintypes, user32, _ = api
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return int(pid.value)


def _wechat_process(api, hwnd: int) -> bool:
    ctypes, wintypes, _, kernel32 = api
    handle = kernel32.OpenProcess(0x1000, False, _window_pid(api, hwnd))
    if not handle:
        return False
    try:
        buffer = ctypes.create_unicode_buffer(32768)
        count = wintypes.DWORD(len(buffer))
        return bool(kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(count))) and Path(buffer.value).name.lower() in {"weixin.exe", "wechat.exe"}
    finally:
        kernel32.CloseHandle(handle)


def _matching_windows(api, groups: list[str]) -> dict[str, int]:
    ctypes, wintypes, user32, _ = api
    result: dict[str, list[int]] = {group: [] for group in groups}
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def visit(hwnd, _):
        title = _window_title(api, hwnd)
        if title in result and user32.IsWindowVisible(hwnd) and _wechat_process(api, hwnd):
            result[title].append(int(hwnd))
        return True
    callback = callback_type(visit)
    user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    if not user32.EnumWindows(callback, 0):
        raise OcrCaptureError("OCR_WINDOW_ENUMERATION_FAILED: 无法枚举群聊窗口。")
    for group, windows in result.items():
        if not windows:
            raise OcrCaptureError(f"OCR_WINDOW_NOT_FOUND: 未找到 {group} 的独立群聊窗口。")
        if len(windows) != 1:
            raise OcrCaptureError(f"OCR_WINDOW_NOT_UNIQUE: 请将 {group} 打开为唯一的独立群聊窗口。")
        if user32.IsIconic(windows[0]):
            raise OcrCaptureError(f"OCR_WINDOW_MINIMIZED: {group} 窗口已最小化，本次不采集。")
    return {group: windows[0] for group, windows in result.items()}


_engine = None


def create_engine(factory):
    # RapidOCR otherwise discards low-confidence lines before we can reject the
    # whole snapshot. A missing price must never leave a confident model behind.
    return factory(params={"Global.text_score": 0.0})


def title_matches_image(image, profile, group, engine):
    import numpy as np
    title = image.crop(tuple(profile["titleRegion"]))
    title = title.resize((title.width * 2, title.height * 2))
    read = ocr_title_text(engine(np.asarray(title)))
    expected = re.sub(r"\s+", "", group)
    return re.sub(r"\s+", "", read) == expected or normalize_title(read) == expected


@contextmanager
def _calibration_frame(api, hwnd, group, groups, templates):
    from window_capture import capture_window
    sizes = [tuple(p["windowSize"]) for p in templates]
    auto_size = os.environ.get("HUOJI_DESKTOP_TEST") == "1"
    original = None
    confirmed = False
    try:
        for attempt in range(3):
            with capture_window(hwnd, group, groups) as frame:
                if frame.size in sizes or not auto_size or attempt == 2:
                    yield frame
                    confirmed = True
                    return
                width, height = frame.size
            ctypes, wintypes, user32, _ = api
            if _matching_windows(api, [group])[group] != hwnd or user32.IsZoomed(hwnd):
                raise CalibrationError("OCR_CALIBRATION_NO_TEMPLATE", available_sizes=sizes)
            rect = wintypes.RECT()
            user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))
            user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
            user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
                                            ctypes.c_int, ctypes.c_int, wintypes.UINT]
            if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
                raise CalibrationError("OCR_WINDOW_CHANGED")
            outer = (rect.right - rect.left, rect.bottom - rect.top)
            original = original or outer
            goal = min(sizes, key=lambda s: abs(s[0] - width) + abs(s[1] - height))
            if not user32.SetWindowPos(hwnd, 0, 0, 0, outer[0] + goal[0] - width,
                                       outer[1] + goal[1] - height, 0x16):
                raise CalibrationError("OCR_CALIBRATION_NO_TEMPLATE", available_sizes=sizes)
            time.sleep(.3)
    finally:
        if original and not confirmed and _window_title(api, hwnd) == group and _wechat_process(api, hwnd):
            api[2].SetWindowPos(hwnd, 0, 0, 0, *original, 0x16)


def calibrate_group(config, group):
    """Return verified geometry for the exact window. No message OCR, writes or scrolling."""
    if group not in config["groups"]:
        raise CalibrationError("OCR_GROUP_NOT_ALLOWED")
    templates = []
    for name in config.get("capture", {}).get("profiles", {}):
        profile = profile_for(config, name)
        geometry = {k: profile[k] for k in ("windowSize", "titleRegion", "messageRegion", "incomingBubbleLeft") if k in profile}
        if geometry not in templates:
            templates.append(geometry)
    if not templates and os.environ.get("HUOJI_DESKTOP_TEST") == "1":
        # Measured standalone-window layouts. They grant no group access and
        # are saved for a selected group only after confirming its on-screen title.
        templates = [
            {"windowSize": [823, 961], "titleRegion": [12, 51, 541, 111],
             "messageRegion": [90, 121, 800, 796], "incomingBubbleLeft": 100},
        ]
    if not templates:
        raise CalibrationError("OCR_CALIBRATION_NO_TEMPLATE")
    from rapidocr import RapidOCR
    api = _windows_api()
    _require_unlocked_desktop(api)
    hwnd = _matching_windows(api, [group])[group]
    with _calibration_frame(api, hwnd, group, config["groups"], templates) as image:
        candidates = [p for p in templates if p["windowSize"] == list(image.size)]
        if not candidates:
            raise CalibrationError("OCR_CALIBRATION_NO_TEMPLATE", window_size=image.size,
                                   available_sizes={tuple(p["windowSize"]) for p in templates})
        engine = create_engine(RapidOCR)
        matches = []
        for candidate in candidates:
            try:
                if title_matches_image(image, candidate, group, engine):
                    matches.append(candidate)
            except OcrCaptureError as exc:
                if not str(exc).startswith("OCR_LOW_CONFIDENCE:"):
                    raise
        if not matches:
            raise CalibrationError("OCR_TITLE_MISMATCH")
        if len(matches) != 1:
            raise CalibrationError("OCR_CALIBRATION_AMBIGUOUS")
    _require_unlocked_desktop(api)
    if _matching_windows(api, [group])[group] != hwnd:
        raise CalibrationError("OCR_WINDOW_CHANGED")
    return matches[0]


def read_snapshot_image(config: dict[str, Any], group: str, image: Any,
                        engine: Any, observed_at: str) -> dict[str, Any] | None:
    """Validate and OCR a previously captured window image without accessing UI.

    Keeping this path separate lets calibration and integration tests use a
    bounded screenshot from the desktop tool rather than a second capture API.
    No image or recognized text is logged or transmitted by this function.
    """
    crop, output = _validated_crop_output(config, group, image, engine)
    return snapshot_message(group, ocr_lines(output, 0.80, annotate_uncertain=True), observed_at)


def _validated_crop_output(config: dict[str, Any], group: str, image: Any, engine: Any):
    if group not in config.get("groups", []):
        raise OcrCaptureError("OCR_GROUP_NOT_ALLOWED: 该群不在配置的采集范围内。")
    profile = profile_for(config, group)
    if list(image.size) != profile["windowSize"]:
        raise OcrCaptureError(f"OCR_WINDOW_RESIZED: {group} 截图实际为 {image.size[0]}×{image.size[1]}，配置为 {profile['windowSize'][0]}×{profile['windowSize'][1]}，请重新校准。")
    from PIL import ImageStat
    import numpy as np
    if not title_matches_image(image, profile, group, engine):
        raise OcrCaptureError(f"OCR_TITLE_MISMATCH: {group} 的画面标题未通过核验。")
    crop = image.crop(tuple(profile["messageRegion"]))
    if max(ImageStat.Stat(crop.convert("RGB")).stddev) < 2:
        raise OcrCaptureError("OCR_EMPTY_CAPTURE: 截图为空白或黑屏，本次不采集。")
    return crop, engine(np.array(crop))


def read_messages_image(config: dict[str, Any], group: str, image: Any,
                        engine: Any, observed_at: str) -> list[dict[str, Any]]:
    """Strict live path: verify title/size, then pair visible names and bubbles."""
    from ocr_messages import messages_from_crop
    crop, output = _validated_crop_output(config, group, image, engine)
    profile = profile_for(config, group)
    left = profile["messageRegion"][0]
    column = max(0, profile.get("incomingBubbleLeft", left) - left)
    return messages_from_crop(group, crop, output, observed_at, incoming_bubble_left=column,
                              center_x=profile["windowSize"][0] / 2 - left)


def capture_snapshots(config: dict[str, Any]) -> list[dict[str, Any]]:
    """Called only by the user-run collector, never starts a background service."""
    groups = config.get("groups")
    if not isinstance(groups, list) or not groups or any(not isinstance(group, str) or not group.strip() for group in groups):
        raise OcrCaptureError("OCR_GROUPS_REQUIRED: 必须明确指定采集群。")
    for group in groups:
        profile_for(config, group)
    api = _windows_api()
    _require_unlocked_desktop(api)
    windows = _matching_windows(api, groups)
    try:
        from window_capture import capture_window, WindowCaptureError
        from rapidocr import RapidOCR
    except ImportError as exc:
        raise OcrCaptureError("OCR_DEPENDENCIES_MISSING: 请先安装 requirements-ocr.txt。") from exc
    global _engine
    if _engine is None:
        _engine = create_engine(RapidOCR)
    messages = []
    for group, hwnd in windows.items():
        try:
            image = capture_window(hwnd, group, groups)
            observed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        except WindowCaptureError as exc:
            raise OcrCaptureError(str(exc)) from exc
        if _window_title(api, hwnd) != group or not _wechat_process(api, hwnd) or api[2].IsIconic(hwnd):
            raise OcrCaptureError("OCR_WINDOW_CHANGED: 截图期间窗口身份发生变化，本次不采集。")
        messages.extend(read_messages_image(config, group, image, _engine, observed_at))
    _require_unlocked_desktop(api)
    return messages
