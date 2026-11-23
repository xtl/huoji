"""List visible WeChat window titles when a user opens the local group picker."""
from collections import Counter
import json
from group_names import valid_group_name
from ocr_capture import _wechat_process, _window_title, _windows_api


def choices():
    api = _windows_api()
    ctypes, wintypes, user32, _ = api
    titles = Counter()
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def visit(hwnd, _):
        if user32.IsWindowVisible(hwnd) and not user32.IsIconic(hwnd) and _wechat_process(api, hwnd):
            title = _window_title(api, hwnd)
            if valid_group_name(title):
                titles[title] += 1
        return True
    cb = callback_type(visit)
    user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    if not user32.EnumWindows(cb, 0):
        raise OSError("Window enumeration failed")
    return sorted(title for title, count in titles.items() if count == 1)[:100]


if __name__ == "__main__":
    print(json.dumps(choices(), ensure_ascii=True))
