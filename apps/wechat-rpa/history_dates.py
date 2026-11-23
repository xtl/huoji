"""Read time separators on the calibrated dark WeChat chat canvas."""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
import math
import re
import unicodedata

from ocr_messages import _foreground_luma


# China's civil time is UTC+8 throughout the history this collector supports.
# An explicit offset also works on Windows without an installed IANA database.
SHANGHAI = timezone(timedelta(hours=8))
_WEEKDAYS = "一二三四五六日"
_WEEKDAY = r"(?:星期|礼拜|周)([一二三四五六日天])"
_PERIOD = r"凌晨|早上|上午|中午|下午|晚上"
_CLOCK = rf"({_PERIOD})?([0-9]{{1,2}}):([0-9]{{2}})"


def _clock(parts) -> time | None:
    period, hour, minute = parts
    hour, minute = int(hour), int(minute)
    if period:
        if not 1 <= hour <= 12:
            return None
        if hour == 12 and period not in ("凌晨", "中午"):
            return None  # noon/midnight is ambiguous with a general period label
        if period == "中午":
            if hour not in (11, 12, 1):
                return None
            hour = 13 if hour == 1 else hour
        else:
            hour = hour % 12 + (12 if period in ("下午", "晚上") else 0)
    try:
        return time(hour, minute)
    except ValueError:
        return None


def _label_day(label: str, today: date) -> date | None:
    if label in ("今天", "昨天", "前天"):
        return today - timedelta(days={"今天": 0, "昨天": 1, "前天": 2}[label])
    weekday = re.search(_WEEKDAY + "$", label)
    if weekday:
        index = _WEEKDAYS.index(weekday[1].replace("天", "日"))
        label = label[:weekday.start()]
        if not label:
            # WeChat uses just the time for today. Its named weekday is in the past.
            return today - timedelta(days=(today.weekday() - index) % 7 or 7)
    chinese = re.fullmatch(r"(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日", label)
    numeric = re.fullmatch(r"(\d{4})([-/.])(\d{1,2})\2(\d{1,2})", label)
    short = re.fullmatch(r"(\d{1,2})[-/.](\d{1,2})", label)
    if chinese:
        year, month, number = chinese.groups()
    elif numeric:
        year, _, month, number = numeric.groups()
    elif short:
        year = None
        month, number = short.groups()
    else:
        return None
    month, number = int(month), int(number)
    year = int(year) if year else today.year - int((month, number) > (today.month, today.day))
    try:
        day = date(year, month, number)
    except ValueError:
        return None
    if weekday and day.weekday() != index:
        return None
    return day if day <= today else None


def separator_value(text: str, observed_at: datetime) -> date | datetime | None:
    """Resolve the WeChat divider at capture time, preserving its displayed precision."""
    if observed_at.tzinfo is None:
        raise ValueError("An aware capture time is required for WeChat date labels")
    now = observed_at.astimezone(SHANGHAI)
    normalized = unicodedata.normalize("NFKC", text).strip()
    label = re.sub(r"\s+", "", normalized)
    if ":" not in label:
        return _label_day(label, now.date())
    # Numeric day and hour must have a visible delimiter: stripping the space
    # in '11-2 19:00' would also fit the 21st at 09:00.
    if re.match(r"^[0-9]+[-/.]", label) and not re.search(_WEEKDAY, label) and not re.search(_PERIOD, label):
        parts = re.fullmatch(r"((?:[0-9]{4}[-/.])?[0-9]{1,2}[-/.][0-9]{1,2})\s+" + _CLOCK, normalized)
    else:
        parts = re.fullmatch("(.*?)" + _CLOCK, label)
    if not parts:
        return None
    clock = _clock(parts.groups()[1:])
    day = _label_day(parts[1], now.date()) if parts[1] else now.date()
    if clock is None or day is None:
        return None
    stamp = datetime.combine(day, clock, SHANGHAI)
    return stamp if stamp <= now else None


def separator_time(text: str, observed_at: datetime) -> datetime | None:
    """Only dividers that include a clock provide an instant."""
    value = separator_value(text, observed_at)
    return value if isinstance(value, datetime) else None


def _iso_minute(stamp):
    return stamp.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:00Z")


def _saved_clock(clock, observed_at):
    if not isinstance(clock, str) or not re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", clock):
        return None
    try:
        return separator_time(clock, datetime.fromisoformat(observed_at.replace("Z", "+00:00")))
    except (AttributeError, TypeError, ValueError):
        return None


def valid_publication_time(value, observed_at):
    if not isinstance(value, dict):
        return False
    kind = value.get("kind")
    if kind == "WECHAT_CLOCK":
        return set(value) == {"kind", "clock"} and _saved_clock(value["clock"], observed_at) is not None
    if kind == "WECHAT_DATE":
        if set(value) != {"kind", "date"}:
            return False
        try:
            day = date.fromisoformat(value["date"])
            bound = datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
            return (value["date"] == day.isoformat() and bound.tzinfo is not None
                    and day <= bound.astimezone(SHANGHAI).date())
        except (AttributeError, TypeError, ValueError):
            return False
    if kind in ("WECHAT_MINUTE", "WECHAT_MARKER"):
        fields = ("at",)
    elif kind == "WECHAT_RANGE":
        fields = ("from", "to")
    else:
        return False
    if set(value) != {"kind", *fields}:
        return False
    try:
        bound = datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
        instants = []
        for key in fields:
            stamp = datetime.strptime(value[key], "%Y-%m-%dT%H:%M:00Z").replace(tzinfo=timezone.utc)
            if _iso_minute(stamp) != value[key] or stamp > bound:
                return False
            instants.append(stamp)
        return len(instants) == 1 or instants[0] < instants[1]
    except (AttributeError, TypeError, ValueError):
        return False


def stronger_time(old, new, observed_at=None):
    """Only refine compatible observations. A different posting can have the same content ID."""
    if not new:
        return False
    if not old:
        return True
    if old == new:
        return False
    kind = new["kind"]
    if old["kind"] == "WECHAT_CLOCK":
        first = new.get("at") or new.get("from")
        stamp = _saved_clock(old["clock"], observed_at)
        return bool(first and stamp is not None and datetime.fromisoformat(first.replace("Z", "+00:00")) == stamp)
    if old["kind"] == "WECHAT_DATE":
        stamps = (new["from"], new["to"]) if kind == "WECHAT_RANGE" else (new.get("at"),)
        return all(stamp and datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone(SHANGHAI).date().isoformat() == old["date"]
                   for stamp in stamps)
    if old["kind"] == "WECHAT_RANGE":
        if kind == "WECHAT_RANGE":
            return old["from"] <= new["from"] <= new["to"] <= old["to"]
        if kind == "WECHAT_MINUTE":
            return old["from"] <= new["at"] <= old["to"]
        return kind == "WECHAT_MARKER" and new["at"] == old["from"]
    return old["kind"] == "WECHAT_MARKER" and kind == "WECHAT_MINUTE" and new["at"] >= old["at"]


def divider_bounds(kind, value):
    """Bounds of a visible divider, inclusive to the displayed minute."""
    if kind == "day":
        return datetime.combine(value, time.min, SHANGHAI), datetime.combine(value, time(23, 59), SHANGHAI)
    if kind == "date":
        return value, value
    return None


def ordered_dividers(events):
    lower = None
    for kind, value in events:
        bounds = divider_bounds(kind, value)
        if bounds is not None:
            if lower is not None and lower > bounds[1]:
                return False
            lower = max(lower, bounds[0]) if lower is not None else bounds[0]
    return True


def _minute_bounds(events, *, backwards):
    """Keep only minute bounds backed by actual displayed clocks."""
    bound = None
    result = []
    for kind, value in (reversed(events) if backwards else events):
        if kind == "date":
            bound = value.astimezone(SHANGHAI).replace(second=0, microsecond=0)
        elif kind in ("unknown", "day"):
            bound = None
        result.append(bound)
    return result[::-1] if backwards else result


def attach_publication_times(events, *, same_screen):
    """Attach evidence to complete bubbles without asserting a native sentAt.

    The virtual 'upper' event used by range selection is an observation, never
    a WeChat clock. Only a single physical screenshot may establish adjacency.
    """
    if not ordered_dividers(events):
        return
    lower = _minute_bounds(events, backwards=False)
    upper = _minute_bounds(events, backwards=True)
    if any(a is not None and b is not None and a > b for a, b in zip(lower, upper)):
        return
    counts = Counter(value["messageId"] for kind, value in events if kind == "message")
    for i, (kind, message) in enumerate(events):
        if kind != "message" or counts[message["messageId"]] != 1:
            continue
        observed = datetime.fromisoformat(message["observedAt"].replace("Z", "+00:00"))
        a, b = lower[i], upper[i]
        candidate = None
        if a is not None and b is not None and b <= observed:
            if a == b:
                candidate = {"kind": "WECHAT_MINUTE", "at": _iso_minute(a)}
            else:
                candidate = {"kind": "WECHAT_RANGE", "from": _iso_minute(a), "to": _iso_minute(b)}
        prev, value = events[i - 1] if i else (None, None)
        old = message.get("publishedTime")
        if candidate is None or candidate["kind"] != "WECHAT_MINUTE":
            if same_screen and prev == "date" and value <= observed:
                candidate = {"kind": "WECHAT_MARKER", "at": _iso_minute(value)}
            elif same_screen and prev == "day" and value <= observed.astimezone(SHANGHAI).date():
                candidate = {"kind": "WECHAT_DATE", "date": value.isoformat()}
        if stronger_time(old, candidate, message["observedAt"]):
            message["publishedTime"] = candidate


def _on_timestamp_background(line, pixels, background, center_x):
    """Require one complete muted label centered on bare chat canvas."""
    import numpy as np
    if background is None:
        return False
    height, width = pixels.shape[:2]
    left, right = min(r.left for r in line), max(r.right for r in line)
    top, bottom = min(r.top for r in line), max(r.bottom for r in line)
    h = bottom - top
    if not 7 <= h <= min(64, height / 5) or abs((left + right) / 2 - center_x) > max(9, h * 0.8):
        return False
    pad = max(3, round(h * 0.32))
    if left < pad or top < pad or right + pad > width or bottom + pad > height:
        return False
    if any(b.left - a.right > h * 1.4 for a, b in zip(line, line[1:])):
        return False
    x0, x1, y0, y1 = math.floor(left), math.ceil(right), math.floor(top), math.ceil(bottom)
    patch = pixels[y0-pad:y1+pad, x0-pad:x1+pad].astype(int)
    canvas = (np.abs(patch.mean(axis=2) - background) <= 5) & (np.ptp(patch, axis=2) <= 10)
    if any(np.mean(strip) < 0.92 for strip in (canvas[:pad], canvas[-pad:], canvas[:, :pad], canvas[:, -pad:])):
        return False
    if canvas.mean() < 0.6:
        return False
    # A centered clock inside a dark image or card can share its local canvas
    # color. WeChat separators occupy a row of their own across the chat.
    for side in (pixels[y0:y1, :x0-pad], pixels[y0:y1, x1+pad:]):
        if not side.size:
            return False
        side = side.astype(int)
        if ((np.abs(side.mean(axis=2) - background) <= 5) & (np.ptp(side, axis=2) <= 10)).mean() < .97:
            return False
    for row in line:
        tone = _foreground_luma(pixels, row, background)
        if tone is None or not background + 25 <= tone <= min(200, background + 155):
            return False
    return True


def date_events(rows, consumed, bubbles, positioned_messages, pixels, background, center_x, observed_at):
    """Return visible evidence in reading order; unmatched OCR rows form gaps."""
    # Positioned messages have already passed the regular text bubble and
    # sender checks. A bubble time or nickname must never become a separator.
    ordered = [(y, "message", message) for y, message in positioned_messages]
    label_bottoms = {}
    remaining = sorted((row for row in rows if row.index not in consumed), key=lambda r: (r.top, r.left))
    while remaining:
        first = remaining[0]
        line = [r for r in remaining if min(first.bottom, r.bottom) - max(first.top, r.top)
                >= min(first.height, r.height) * .55]
        if not line:  # degenerate OCR box
            line = [first]
        selected = {r.index for r in line}
        remaining = [r for r in remaining if r.index not in selected]
        line.sort(key=lambda r: r.left)
        marker = None
        if (all(r.score >= .92 and r.height > 0 for r in line)
                and not any(first.top < bubble.bottom and first.bottom > bubble.top for bubble in bubbles)
                and _on_timestamp_background(line, pixels, background, center_x)):
            text = " ".join(r.text for r in line)
            marker = separator_value(text, observed_at)
            label_bottoms[first.top] = max(r.bottom for r in line)
        kind = "date" if isinstance(marker, datetime) else "day" if marker is not None else "unknown"
        ordered.append((first.top, kind, marker))
    if not ordered:
        return [("unknown", None)]  # no trustworthy text on this viewport
    import numpy as np
    result = []
    prev_bottom = None
    for y, kind, value in sorted(ordered, key=lambda event: event[0]):
        if kind == "message" and prev_bottom is not None:
            gap = pixels[math.ceil(prev_bottom)+2:math.floor(y)-1]
            if gap.size:
                # Photos/stickers may have no OCR boxes. A visible object
                # between a divider and the next readable bubble breaks adjacency.
                ink = (np.abs(gap.mean(axis=2) - background) > 7) | (np.ptp(gap, axis=2) > 12)
                if np.count_nonzero(ink.sum(axis=1) >= max(8, gap.shape[1] * .025)) >= 5:
                    result.append(("unknown", None))
        result.append((kind, value))
        prev_bottom = label_bottoms.get(y) if kind in ("date", "day") else None
    return result
