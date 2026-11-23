"""One exact WeChat HWND, one WGC frame, one short-lived child process.

Importing this module never reads a window. Only capture_window starts a child;
the Windows/native imports and capture run exclusively in that child process.
"""
from __future__ import annotations

import argparse
import io
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Any, TYPE_CHECKING

from group_names import valid_group_name

if TYPE_CHECKING:
    from PIL import Image

CAPTURE_TIMEOUT_SECONDS = 15
MAX_FRAME_PIXELS = 20_000_000
MAX_PNG_BYTES = 40_000_000
ERROR_CODES = frozenset((
    "WGC_INVALID_TARGET", "WGC_WINDOWS_REQUIRED", "WGC_DEPENDENCIES_MISSING",
    "WGC_WINDOW_NOT_UNIQUE", "WGC_WINDOW_CHANGED", "WGC_DESKTOP_UNAVAILABLE",
    "WGC_INVALID_FRAME", "WGC_NO_FRAME", "WGC_CAPTURE_FAILED",
))


class WindowCaptureError(RuntimeError):
    pass


def _validate_target(hwnd: int, group: str) -> None:
    if type(hwnd) is not int or not 0 < hwnd < 2**64 or not valid_group_name(group):
        raise WindowCaptureError("WGC_INVALID_TARGET: requires a positive HWND and an approved exact group name")


def _safe_child_error(stderr: bytes) -> str:
    for line in reversed(stderr.decode("utf-8", errors="replace").splitlines()):
        try:
            payload = json.loads(line)
        except ValueError:
            continue
        if isinstance(payload, dict) and isinstance(payload.get("code"), str) and payload["code"] in ERROR_CODES:
            return payload["code"]
    return "WGC_CAPTURE_FAILED"


def capture_window(hwnd: int, group: str, enabled_groups) -> "Image.Image":
    """Return a fully detached RGB PIL image; never falls back to a monitor.

    A fresh child isolates each native WGC start, including native crashes. The
    child is killed and reaped on timeout, cancellation, or unexpected failure.
    """
    _validate_target(hwnd, group)
    if group not in enabled_groups:
        raise WindowCaptureError("WGC_INVALID_TARGET: requested group is not enabled")
    command = [sys.executable, "-X", "utf8", str(Path(__file__).resolve()),
               "--child", "--hwnd", str(hwnd), "--group=" + group]
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        with subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, creationflags=flags) as process:
            try:
                png, diagnostics = process.communicate(timeout=CAPTURE_TIMEOUT_SECONDS)
            except subprocess.TimeoutExpired as exc:
                process.kill()
                process.communicate()
                raise WindowCaptureError("WGC_TIMEOUT: no complete window frame within 15 seconds") from exc
            except BaseException:
                process.kill()
                process.communicate()
                raise
            if process.returncode != 0:
                raise WindowCaptureError(f"{_safe_child_error(diagnostics)}: window capture child rejected this frame")
    except WindowCaptureError:
        raise
    except OSError as exc:
        raise WindowCaptureError("WGC_CHILD_START_FAILED: could not start isolated capture") from exc
    if not png.startswith(b"\x89PNG\r\n\x1a\n") or len(png) > MAX_PNG_BYTES:
        raise WindowCaptureError("WGC_INVALID_FRAME: child did not return a bounded PNG")
    try:
        from PIL import Image
        with Image.open(io.BytesIO(png)) as image:
            if image.format != "PNG" or not 0 < image.width * image.height <= MAX_FRAME_PIXELS:
                raise WindowCaptureError("WGC_INVALID_FRAME: invalid image format or dimensions")
            image.load()
            return image.convert("RGB").copy()
    except WindowCaptureError:
        raise
    except Exception as exc:
        raise WindowCaptureError("WGC_INVALID_FRAME: PNG could not be decoded") from exc


def _validate_window(hwnd: int, group: str):
    from ocr_capture import (_matching_windows, _require_unlocked_desktop,
                             _wechat_process, _window_pid, _window_title, _windows_api)
    api = _windows_api()
    try:
        _require_unlocked_desktop(api)
    except Exception as exc:
        raise WindowCaptureError("WGC_DESKTOP_UNAVAILABLE") from exc
    try:
        windows = _matching_windows(api, [group])
    except Exception as exc:
        raise WindowCaptureError("WGC_WINDOW_NOT_UNIQUE") from exc
    if windows.get(group) != hwnd or _window_title(api, hwnd) != group or not _wechat_process(api, hwnd):
        raise WindowCaptureError("WGC_WINDOW_CHANGED")
    return _window_pid(api, hwnd)


def _first_frame(hwnd: int, factory: Any):
    """Native backend boundary. The factory is injectable for offline tests."""
    from PIL import Image
    result = []
    failures = []
    capture = factory(window_hwnd=hwnd, cursor_capture=False, monitor_index=None,
                      secondary_window=False, draw_border=None)

    @capture.event
    def on_frame_arrived(frame, control):
        try:
            if not result:
                # Native storage is valid only during the callback. Copy BGRA
                # bytes before stop/return, then explicitly reorder to RGB.
                data = frame.frame_buffer.copy()
                if (getattr(data, "ndim", None) != 3 or data.shape[2] != 4
                        or data.shape[0] != frame.height or data.shape[1] != frame.width
                        or not 0 < frame.width * frame.height <= MAX_FRAME_PIXELS
                        or str(data.dtype) != "uint8"):
                    raise WindowCaptureError("WGC_INVALID_FRAME")
                result.append(Image.fromarray(data[:, :, [2, 1, 0]].copy()))
        except Exception:
            failures.append("WGC_INVALID_FRAME")
        finally:
            control.stop()

    @capture.event
    def on_closed():
        pass

    capture.start()  # Blocking; parent owns the hard timeout and process cleanup.
    if failures:
        raise WindowCaptureError(failures[0])
    if not result:
        raise WindowCaptureError("WGC_NO_FRAME")
    return result[0]


def _capture_child(hwnd: int, group: str):
    _validate_target(hwnd, group)
    if os.name != "nt":
        raise WindowCaptureError("WGC_WINDOWS_REQUIRED")
    pid = _validate_window(hwnd, group)
    try:
        from windows_capture import WindowsCapture
    except ImportError as exc:
        raise WindowCaptureError("WGC_DEPENDENCIES_MISSING") from exc
    image = _first_frame(hwnd, WindowsCapture)
    if not pid or _validate_window(hwnd, group) != pid:
        raise WindowCaptureError("WGC_WINDOW_CHANGED")
    return image


def _child_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--child", action="store_true", required=True)
    parser.add_argument("--hwnd", type=int, required=True)
    parser.add_argument("--group", required=True)
    args = parser.parse_args(argv)
    # Preserve a separate binary output pipe, then redirect FD 1 as well as the
    # Python stdout wrapper so native/Python diagnostic prints cannot corrupt PNG.
    output_fd = os.dup(sys.stdout.fileno())
    if os.name == "nt":
        import msvcrt
        msvcrt.setmode(output_fd, os.O_BINARY)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    if os.name == "nt":
        # Rust/native stdout may use GetStdHandle directly instead of CRT FD 1.
        # Redirect both views; the separately duplicated PNG FD stays untouched.
        import ctypes
        from ctypes import wintypes
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.SetStdHandle.argtypes = [wintypes.DWORD, wintypes.HANDLE]
        kernel32.SetStdHandle.restype = wintypes.BOOL
        if not kernel32.SetStdHandle(wintypes.DWORD(-11), msvcrt.get_osfhandle(sys.stderr.fileno())):
            os.close(output_fd)
            return 1
    sys.stdout = sys.stderr
    with os.fdopen(output_fd, "wb") as output:
        try:
            image = _capture_child(args.hwnd, args.group)
            image.save(output, format="PNG")
            output.flush()
            return 0
        except WindowCaptureError as exc:
            code = str(exc).split(":", 1)[0]
            print(json.dumps({"code": code if code in ERROR_CODES else "WGC_CAPTURE_FAILED"}), file=sys.stderr)
            return 1
        except Exception:
            print(json.dumps({"code": "WGC_CAPTURE_FAILED"}), file=sys.stderr)
            return 1


if __name__ == "__main__":
    sys.exit(_child_main())
