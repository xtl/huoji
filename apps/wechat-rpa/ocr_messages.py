"""Conservative nickname-to-bubble pairing for the calibrated dark WeChat UI.

This module only analyzes caller-provided pixels and OCR boxes. Unmatched text
stays an unknown-author snapshot; no author is inherited from a previous row.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
import re
from typing import Any


@dataclass(frozen=True)
class TextRow:
    index: int
    text: str
    score: float
    left: float
    top: float
    right: float
    bottom: float

    @property
    def height(self) -> float:
        return self.bottom - self.top


@dataclass(frozen=True)
class Bubble:
    left: int
    top: int
    right: int
    bottom: int
    label: int


def _rows(output: Any) -> list[TextRow]:
    from ocr_capture import OcrCaptureError
    texts, scores, boxes = (getattr(output, key, None) for key in ("txts", "scores", "boxes"))
    if texts is None or scores is None or boxes is None:
        return []
    if len(texts) != len(scores) or len(texts) != len(boxes):
        raise OcrCaptureError("OCR_OUTPUT_INVALID: OCR coordinates do not match text")
    result = []
    for index, (text, score, box) in enumerate(zip(texts, scores, boxes)):
        text = str(text).strip()
        if not text:
            continue
        try:
            score = float(score)
            points = [(float(p[0]), float(p[1])) for p in box]
            valid = len(points) == 4 and all(math.isfinite(v) for p in points for v in p)
        except (TypeError, ValueError, IndexError) as exc:
            raise OcrCaptureError("OCR_OUTPUT_INVALID: invalid OCR geometry") from exc
        if not valid or not math.isfinite(score) or not 0 <= score <= 1:
            raise OcrCaptureError("OCR_OUTPUT_INVALID: invalid OCR geometry or confidence")
        xs, ys = zip(*points)
        result.append(TextRow(index, text, score, min(xs), min(ys), max(xs), max(ys)))
    return result


def _canvas_background(luma, neutral):
    """Estimate chat canvas from agreement across its borders, not photo tones.

    The darkest frequent color anywhere in a viewport can belong to an image.
    Its selection would put the real canvas into the bubble mask and merge the
    entire page. Normalize the four borders separately so a large photo/long
    bubble along one edge cannot outweigh several agreeing canvas edges.
    """
    import numpy as np
    height, width = luma.shape
    thickness = max(1, min(3, height // 10, width // 10))
    bins = (luma // 4).astype(int)
    total = np.bincount(bins[neutral], minlength=64)
    candidates = [i for i in range(3, 21) if total[i] >= height * width * 0.025]
    if not candidates:
        return None
    strips = [(bins[:thickness], neutral[:thickness]), (bins[-thickness:], neutral[-thickness:]),
              (bins[:, :thickness], neutral[:, :thickness]), (bins[:, -thickness:], neutral[:, -thickness:])]
    fractions = [np.bincount(values[mask], minlength=64) / values.size for values, mask in strips]
    scores = {i: (sum(fraction[i] >= 0.20 for fraction in fractions),
                  sum(float(fraction[i]) for fraction in fractions)) for i in candidates}
    best = max(candidates, key=lambda i: scores[i])
    if scores[best][0] < 2:
        return None  # no corroborated canvas; retain an unknown snapshot
    return best * 4 + 2


def _dark_bubbles(pixels):
    import cv2
    import numpy as np
    luma = pixels.astype(np.float32).mean(axis=2)
    spread = pixels.max(axis=2).astype(int) - pixels.min(axis=2).astype(int)
    neutral = spread <= 10
    background = _canvas_background(luma, neutral)
    if background is None:
        return [], None, None
    mask = (neutral & (luma >= background + 8) & (luma <= min(125, background + 55))).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), dtype=np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    bubbles = []
    height, width = luma.shape
    for label in range(1, count):
        left, top, w, h, area = (int(v) for v in stats[label])
        if w < 24 or h < 24 or area < 600 or area / (w * h) < 0.70:
            continue
        if w > width * 0.95 and h > height * 0.95:
            continue
        # Photos/cards generally contain colored pixels. Their recognized text
        # is not promoted to a text-bubble message even with a nearby nickname.
        if (spread[top:top + h, left:left + w] > 16).mean() > 0.012:
            continue
        bubbles.append(Bubble(left, top, left + w, top + h, label))
    return bubbles, labels, background


def _inside(row: TextRow, bubble: Bubble) -> bool:
    return (row.left >= bubble.left - 1 and row.right <= bubble.right + 1
            and row.top >= bubble.top - 1 and row.bottom <= bubble.bottom + 1)


def _intersects(row: TextRow, bubble: Bubble) -> bool:
    return min(row.right, bubble.right) - max(row.left, bubble.left) > 2 and min(row.bottom, bubble.bottom) - max(row.top, bubble.top) > 2


def _foreground_luma(pixels, row: TextRow, background: float) -> float | None:
    import numpy as np
    height, width = pixels.shape[:2]
    left, top = max(0, int(row.left)), max(0, int(row.top))
    right, bottom = min(width, math.ceil(row.right)), min(height, math.ceil(row.bottom))
    if right <= left or bottom <= top:
        return None
    patch = pixels[top:bottom, left:right]
    luma = patch.astype(np.float32).mean(axis=2)
    spread = patch.max(axis=2).astype(int) - patch.min(axis=2).astype(int)
    ink = luma[(luma > background + 25) & (spread <= 16)]
    return float(np.quantile(ink, 0.80)) if ink.size >= 3 else None


def _nickname_text(text: str) -> bool:
    if not 1 <= len(text) <= 64 or not re.search(r"[A-Za-z\u3400-\u9fff]", text):
        return False
    if re.search(r"[\n:：;；，,。!?！？<>\[\]【】「」“”]", text):
        return False
    if re.search(r"价格|报价|含税|现货|求购|出货|提货|到手|剩余|图片|视频|语音|文件|引用|回复", text):
        return False
    if re.search(r"(?:\d\s*(?:元|万|台|张|条|片|块|套)|[¥￥$€]|\d{1,2}[:：]\d{2})", text):
        return False
    if re.fullmatch(r"(?:[A-Za-z]{0,4}\s*)?\d{2,6}[A-Za-z]?", text):
        return False
    return True


def _nickname_geometry(row: TextRow, bubble: Bubble, bodies: list[TextRow], bubbles: list[Bubble],
                       pixels, background: float) -> bool:
    import numpy as np
    line_height = float(np.median([r.height for r in bodies]))
    if (row.score < 0.95 or not _nickname_text(row.text) or row.top <= 1 or row.left <= 1
            or row.right >= pixels.shape[1] - 1 or row.height < 8
            or row.height > line_height * 1.15 or row.bottom > bubble.top + 1
            or bubble.top - row.bottom > max(18, line_height * 1.0)
            or not bubble.left - 8 <= row.left <= bubble.left + max(20, line_height * 0.9)
            or any(_inside(row, other) for other in bubbles)):
        return False
    tone = _foreground_luma(pixels, row, background)
    if tone is None or not background + 35 <= tone <= background + 150:
        return False
    # A nickname must actually sit on the chat canvas, not in a quote/image.
    top, bottom = max(0, int(row.top) - 2), min(pixels.shape[0], math.ceil(row.bottom) + 2)
    left, right = max(0, int(row.left) - 2), min(pixels.shape[1], math.ceil(row.right) + 2)
    patch = pixels[top:bottom, left:right].astype(float).mean(axis=2)
    return bool((np.abs(patch - background) <= 6).mean() >= 0.58)


def _complete_body(bubble: Bubble, rows: list[TextRow], pixels, labels, background: float,
                   incoming_bubble_left: float | None) -> bool:
    import numpy as np
    height, width = pixels.shape[:2]
    if not rows or bubble.top <= 1 or bubble.right >= width - 1:
        return False
    line_height = float(np.median([r.height for r in rows]))
    if incoming_bubble_left is None:
        # Uncalibrated saved crops still need the visible incoming column at
        # the left canvas edge (avatar + gap, scaled by the text size). This
        # excludes a quoted/grayscale chat image centered inside a message.
        if bubble.left > max(24, line_height * 3.5):
            return False
    elif abs(bubble.left - incoming_bubble_left) > max(8, line_height * 0.60):
        return False
    if any(r.score < 0.90 or r.height < 8 or r.left <= 1 or r.right >= width - 1
           or r.left < bubble.left + 2 or r.right > bubble.right - 2
           or r.top < bubble.top + 2 or r.bottom > bubble.bottom - max(4, line_height * 0.20)
           for r in rows):
        return False
    for index, row in enumerate(rows):
        for other in rows[index + 1:]:
            overlap = max(0, min(row.right, other.right) - max(row.left, other.left)) * max(0, min(row.bottom, other.bottom) - max(row.top, other.top))
            smaller = min((row.right - row.left) * row.height, (other.right - other.left) * other.height)
            if smaller > 0 and overlap / smaller > 0.20:
                return False  # overlapping quote/image labels are not a complete plain-text bubble
    if bubble.bottom >= height - 1:
        # A crop may touch an outer rounded edge while leaving the whole text
        # visible. Require both narrowing lower corners and the text padding
        # checked above; a straight/clipped body edge never proves completeness.
        spans = (labels[bubble.top:bubble.bottom] == bubble.label).sum(axis=1)
        if not len(spans) or int(spans.max()) - int(spans[-1]) < max(5, line_height * 0.25):
            return False
    for row in rows:
        tone = _foreground_luma(pixels, row, background)
        if tone is None or tone < background + 150:
            return False
        if re.search(r"^(?:引用|回复)(?:[:：\s]|$)|^\[(?:图片|视频|语音|文件|表情|动图)\]$", row.text):
            return False
    if not any(re.search(r"[A-Za-z0-9\u3400-\u9fff]", row.text) for row in rows):
        return False  # a pure symbol/emoji is not a separable text-message count
    return True


def _body_text(rows: list[TextRow]) -> str:
    # OCR can split one visual line into several boxes; restore visual rows.
    lines: list[list[TextRow]] = []
    for row in sorted(rows, key=lambda r: ((r.top + r.bottom) / 2, r.left)):
        center = (row.top + row.bottom) / 2
        matching = next((line for line in lines if abs(center - (line[0].top + line[0].bottom) / 2)
                         <= min(row.height, line[0].height) * 0.45), None)
        if matching is None:
            lines.append([row])
        else:
            matching.append(row)
    result = []
    for line in lines:
        text = ""
        for row in sorted(line, key=lambda r: r.left):
            gap = " " if text and text[-1].isascii() and text[-1].isalnum() and row.text[0].isascii() and row.text[0].isalnum() else ""
            text += gap + re.sub(r"[ \t]+", " ", row.text)
        result.append(text.strip())
    return "\n".join(result)


def _message(group: str, sender: str, text: str, observed_at: str) -> dict[str, Any]:
    from ocr_capture import OcrCaptureError
    if len(text.encode("utf-16-le", errors="surrogatepass")) // 2 > 20_000:
        raise OcrCaptureError("OCR_TOO_LARGE: one text bubble exceeds the message limit")
    fingerprint = hashlib.sha256(json.dumps([group, sender, text], ensure_ascii=False,
                                          separators=(",", ":")).encode("utf-8")).hexdigest()
    return {"messageId": f"ocrmsg_v1_{fingerprint}", "chatName": group, "sender": sender,
            "sentAt": None, "observedAt": observed_at, "text": text, "captureMode": "OCR_MESSAGE",
            "captureUnit": "TEXT_BUBBLE"}


def _unknown_bubble(group: str, text: str, observed_at: str) -> dict[str, Any]:
    from ocr_capture import OcrCaptureError
    if len(text.encode("utf-16-le", errors="surrogatepass")) // 2 > 20_000:
        raise OcrCaptureError("OCR_TOO_LARGE: one text bubble exceeds the message limit")
    fingerprint = hashlib.sha256(json.dumps([group, text], ensure_ascii=False,
                                          separators=(",", ":")).encode("utf-8")).hexdigest()
    return {"messageId": f"ocrbubble_v1_{fingerprint}", "chatName": group,
            "sender": "未识别（截图识别）", "sentAt": None, "observedAt": observed_at,
            "text": text, "captureMode": "OCR_SNAPSHOT", "captureUnit": "TEXT_BUBBLE"}


def messages_from_crop(group: str, image: Any, output: Any, observed_at: str,
                       *, incoming_bubble_left: float | None = None,
                       history_events: list | None = None, center_x: float | None = None) -> list[dict[str, Any]]:
    """Pair only high-confidence external nicknames with complete text bubbles.

    The same geometry checks apply to calibrated windows and saved attachments.
    """
    import numpy as np
    from ocr_capture import ocr_lines, snapshot_message
    # Keep the original viewport-wide uncertainty denominator. Removing a good
    # bubble must not make a single uncertain remaining badge reject everything.
    ocr_lines(output, 0.80, annotate_uncertain=True)
    pixels = np.asarray(image.convert("RGB"))
    rows = _rows(output)
    bubbles, labels, background = _dark_bubbles(pixels)
    consumed: set[int] = set()
    messages = []
    positioned = []
    for bubble in sorted(bubbles, key=lambda b: (b.top, b.left)):
        body = [row for row in rows if _inside(row, bubble)]
        if any(_intersects(row, bubble) and not _inside(row, bubble) for row in rows):
            continue
        if not _complete_body(bubble, body, pixels, labels, background, incoming_bubble_left):
            continue
        names = [row for row in rows if _nickname_geometry(row, bubble, body, bubbles, pixels, background)]
        if len(names) == 1:
            name = names[0]
            # Emoji and mixed-script nicknames are sometimes returned as several
            # OCR boxes. Never promote only the confident left fragment to a
            # complete sender; the body can still be an unknown text bubble.
            fragments = [row for row in rows if row.index != name.index and not _inside(row, bubble)
                         and min(row.bottom, name.bottom) - max(row.top, name.top) >= min(row.height, name.height) * 0.50
                         and max(0, max(row.left, name.left) - min(row.right, name.right)) <= max(20, name.height * 3)]
            if fragments:
                names = []
        if any(row.index in consumed for row in body):
            continue
        if len(names) == 1 and names[0].index not in consumed:
            nickname = names[0]
            messages.append(_message(group, nickname.text, _body_text(body), observed_at))
            consumed.add(nickname.index)
            message_top = nickname.top
        else:
            # Body completeness is independently proven. Missing/uncertain
            # names do not turn a whole text bubble into a multi-message screen.
            messages.append(_unknown_bubble(group, _body_text(body), observed_at))
            message_top = bubble.top
        if center_x is not None:
            positioned.append((message_top, messages[-1]))
        consumed.update(row.index for row in body)
    if history_events is not None and center_x is None:
        raise ValueError("A calibrated window center is required for history dates")
    if center_x is not None:
        from datetime import datetime
        from history_dates import attach_publication_times, date_events
        events = date_events(rows, consumed, bubbles, positioned, pixels, background,
                             center_x, datetime.fromisoformat(observed_at.replace("Z", "+00:00")))
        attach_publication_times(events, same_screen=True)
        if history_events is not None:
            history_events.extend(events)
            return messages
    remaining = [row for row in rows if row.index not in consumed]
    if remaining:
        lines = []
        gap = False
        for row in sorted(rows, key=lambda item: (round(item.top / 6), item.left)):
            if row.index in consumed:
                if lines:
                    gap = True
                continue
            if gap:
                lines.append("【已分离消息】")
                gap = False
            lines.append(f"【OCR待核对 {row.score:.0%}】{row.text}" if row.score < 0.80 else row.text)
        # Preserve an explicit boundary where independent bubbles were removed;
        # an orphan nickname must never become adjacent evidence for later text.
        fallback = snapshot_message(group, lines, observed_at)
        if fallback:
            messages.append(fallback)
    return messages
