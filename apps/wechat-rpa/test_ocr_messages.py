from __future__ import annotations

from types import SimpleNamespace
import unittest

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from ocr_capture import OcrCaptureError
from ocr_messages import messages_from_crop

NOW = "2026-11-01T00:00:00Z"
GROUP = "B300真实交易群"


class Scene:
    def __init__(self, size=(640, 470)):
        self.image = Image.new("RGB", size, (30, 30, 31))
        self.draw = ImageDraw.Draw(self.image)
        self.texts, self.scores, self.boxes = [], [], []

    def text(self, text, xy, color=(225, 225, 229), score=0.999, size=24):
        font = ImageFont.load_default(size=size)
        self.draw.text(xy, text, font=font, fill=color)
        left, top, right, bottom = self.draw.textbbox(xy, text, font=font)
        self.texts.append(text)
        self.scores.append(score)
        self.boxes.append([[left, top], [right, top], [right, bottom], [left, bottom]])
        return len(self.texts) - 1

    def bubble(self, top=60, author="Nora", author_score=0.999, body=("H200 servers 32 pcs", "stock confirmed"), left=80):
        bottom = top + 45 + len(body) * 27
        self.draw.rounded_rectangle((left, top, 565, bottom), radius=12, fill=(47, 47, 48))
        if author is not None:
            self.text(author, (left + 8, top - 35), color=(129, 129, 132), score=author_score, size=18)
        for index, text in enumerate(body):
            self.text(text, (left + 18, top + 16 + index * 27))
        return bottom

    def output(self):
        return SimpleNamespace(txts=self.texts, scores=self.scores, boxes=np.asarray(self.boxes, dtype=float))

    def messages(self, **kwargs):
        return messages_from_crop(GROUP, self.image, self.output(), NOW, incoming_bubble_left=80, **kwargs)


class PairingTests(unittest.TestCase):
    def short_scene(self, text="CX7"):
        scene = Scene()
        scene.draw.rounded_rectangle((80, 60, 132, 104), radius=8, fill=(47, 47, 48))
        scene.text("Nora", (88, 25), color=(129, 129, 132), size=18)
        scene.text(text, (90, 74), size=18)
        return scene

    def test_short_cx7_bubble_is_countable_with_unchanged_completeness_rules(self):
        scene = self.short_scene()
        messages = scene.messages()
        self.assertEqual(messages[0]["captureUnit"], "TEXT_BUBBLE")
        self.assertEqual(messages[0]["text"], "CX7")
        self.assertEqual(messages[0]["sender"], "Nora")

    def test_small_colored_image_is_not_promoted_by_lower_width_threshold(self):
        scene = self.short_scene()
        scene.draw.rectangle((118, 85, 130, 99), fill=(180, 25, 120))
        messages = scene.messages()
        self.assertTrue(all(m["captureUnit"] == "VIEWPORT_REMAINDER" for m in messages))

    def test_fragmented_nickname_is_not_promoted_from_its_left_word(self):
        scene = self.short_scene()
        scene.text("Suffix", (130, 25), color=(129, 129, 132), size=18)
        messages = scene.messages()
        bubble = next(m for m in messages if m["captureUnit"] == "TEXT_BUBBLE")
        self.assertEqual(bubble["text"], "CX7")
        self.assertEqual(bubble["captureMode"], "OCR_SNAPSHOT")
        self.assertEqual(bubble["sender"], "未识别（截图识别）")

    def test_pure_emoji_or_symbol_bubble_does_not_count_as_complete_text(self):
        scene = self.short_scene(text="X")
        scene.texts[-1] = "🙂"
        messages = scene.messages()
        self.assertTrue(all(m["captureUnit"] == "VIEWPORT_REMAINDER" for m in messages))

    def test_separated_body_gap_cannot_create_false_adjacent_sender_evidence(self):
        scene = Scene()
        scene.bubble(author="Alice", author_score=0.90, body=("separated body A",))
        scene.text("later unpaired body B", (100, 300))
        messages = scene.messages()
        bubble = next(m for m in messages if m["captureUnit"] == "TEXT_BUBBLE")
        remainder = next(m for m in messages if m["captureUnit"] == "VIEWPORT_REMAINDER")
        self.assertEqual(bubble["sender"], "未识别（截图识别）")
        self.assertIn("Alice\n【已分离消息】\nlater unpaired body B", remainder["text"])
        self.assertNotIn("Alice\nlater unpaired body B", remainder["text"])
        self.assertNotIn("separated body A", remainder["text"])

    def test_visible_external_nickname_is_paired_and_not_repeated_in_fallback(self):
        scene = Scene()
        scene.bubble()
        messages = scene.messages()
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["captureMode"], "OCR_MESSAGE")
        self.assertEqual(messages[0]["captureUnit"], "TEXT_BUBBLE")
        self.assertEqual(messages[0]["messageId"], "ocrmsg_v1_7e5923eeb765942e334958adef9ef6dd752abe4e89f6b50ffe100451abebf4eb")
        self.assertEqual(messages[0]["sender"], "Nora")
        self.assertIsNone(messages[0]["sentAt"])
        self.assertEqual(messages[0]["text"], "H200 servers 32 pcs\nstock confirmed")
        again = messages_from_crop(GROUP, scene.image, scene.output(), "2026-11-02T00:00:00Z", incoming_bubble_left=80)
        self.assertEqual(messages[0]["messageId"], again[0]["messageId"])

    def test_two_adjacent_people_remain_separate(self):
        scene = Scene()
        scene.bubble(top=60, author="Alice", body=("H200 stock 2 pcs",))
        scene.bubble(top=210, author="Bob", body=("B300 stock 4 pcs",))
        messages = scene.messages()
        self.assertEqual([(m["sender"], m["text"]) for m in messages],
                         [("Alice", "H200 stock 2 pcs"), ("Bob", "B300 stock 4 pcs")])

    def test_same_person_multiple_visible_names_pair_separately(self):
        scene = Scene()
        scene.bubble(top=60, author="Alice", body=("H200 stock 2 pcs",))
        scene.bubble(top=210, author="Alice", body=("B300 stock 4 pcs",))
        messages = scene.messages()
        self.assertEqual([m["sender"] for m in messages], ["Alice", "Alice"])
        self.assertNotEqual(messages[0]["messageId"], messages[1]["messageId"])

    def test_author_is_never_inherited_by_next_bubble(self):
        scene = Scene()
        scene.bubble(top=60, author="Alice", body=("H200 stock 2 pcs",))
        scene.bubble(top=210, author=None, body=("B300 stock 4 pcs",))
        messages = scene.messages()
        paired = [m for m in messages if m["captureMode"] == "OCR_MESSAGE"]
        unknown = [m for m in messages if m["captureMode"] == "OCR_SNAPSHOT"]
        self.assertEqual(len(paired), 1)
        self.assertEqual(paired[0]["sender"], "Alice")
        self.assertEqual(unknown[0]["text"], "B300 stock 4 pcs")
        self.assertEqual(unknown[0]["captureUnit"], "TEXT_BUBBLE")
        self.assertEqual(unknown[0]["sender"], "未识别（截图识别）")
        self.assertNotIn("H200", unknown[0]["text"])

    def test_low_confidence_name_falls_back_unknown(self):
        scene = Scene()
        scene.bubble(author_score=0.90)
        messages = scene.messages()
        bubbles = [m for m in messages if m["captureUnit"] == "TEXT_BUBBLE"]
        remainders = [m for m in messages if m["captureUnit"] == "VIEWPORT_REMAINDER"]
        self.assertEqual(len(bubbles), 1)
        self.assertEqual(bubbles[0]["captureMode"], "OCR_SNAPSHOT")
        self.assertEqual(bubbles[0]["sender"], "未识别（截图识别）")
        self.assertEqual(bubbles[0]["text"], "H200 servers 32 pcs\nstock confirmed")
        self.assertTrue(bubbles[0]["messageId"].startswith("ocrbubble_v1_"))
        self.assertEqual(len(remainders), 1)
        self.assertIn("Nora", remainders[0]["text"])
        self.assertNotIn("H200", remainders[0]["text"])

    def test_two_complete_bubbles_without_names_remain_separate_unknown_units(self):
        scene = Scene()
        scene.bubble(top=60, author=None, body=("H200 stock 2 pcs",))
        scene.bubble(top=210, author=None, body=("B300 stock 4 pcs",))
        messages = scene.messages()
        self.assertEqual([m["text"] for m in messages], ["H200 stock 2 pcs", "B300 stock 4 pcs"])
        self.assertTrue(all(m["captureUnit"] == "TEXT_BUBBLE" for m in messages))
        self.assertTrue(all(m["captureMode"] == "OCR_SNAPSHOT" for m in messages))
        self.assertTrue(all(m["sender"] == "未识别（截图识别）" for m in messages))
        self.assertTrue(all(m["sentAt"] is None for m in messages))
        self.assertNotEqual(messages[0]["messageId"], messages[1]["messageId"])
        later = messages_from_crop(GROUP, scene.image, scene.output(), "2026-11-03T00:00:00Z", incoming_bubble_left=80)
        self.assertEqual([m["messageId"] for m in messages], [m["messageId"] for m in later])

    def test_price_line_is_not_a_nickname(self):
        scene = Scene()
        scene.bubble(author="1850")
        messages = scene.messages()
        self.assertEqual(messages[0]["captureMode"], "OCR_SNAPSHOT")
        self.assertEqual(messages[0]["captureUnit"], "TEXT_BUBBLE")
        self.assertEqual(messages[0]["sender"], "未识别（截图识别）")
        self.assertNotIn("1850", messages[0]["text"])
        self.assertEqual(messages[1]["captureUnit"], "VIEWPORT_REMAINDER")
        self.assertIn("1850", messages[1]["text"])

    def test_uncertain_badge_does_not_erase_paired_messages_after_subset_reduction(self):
        scene = Scene()
        scene.bubble(body=("H200 stock 2 pcs", "price 1850 confirmed", "Shenzhen stock"))
        scene.text("badge", (400, 350), score=0.5, size=18)
        messages = scene.messages()
        self.assertEqual(messages[0]["sender"], "Nora")
        self.assertEqual(messages[1]["captureMode"], "OCR_SNAPSHOT")
        self.assertEqual(messages[1]["captureUnit"], "VIEWPORT_REMAINDER")
        self.assertIn("50%", messages[1]["text"])
        self.assertNotIn("H200", messages[1]["text"])

    def test_global_viewport_uncertainty_rule_is_preserved(self):
        scene = Scene()
        scene.bubble(author_score=0.2, body=("H200 stock",))
        with self.assertRaisesRegex(OcrCaptureError, "OCR_TOO_UNCERTAIN"):
            scene.messages()

    def test_overhanging_price_ocr_box_forces_whole_bubble_to_unknown(self):
        scene = Scene()
        scene.bubble()
        # A detector box that crosses the bubble boundary must not be excluded
        # while the other model/quantity rows are attributed to the nickname.
        scene.boxes[-1][0][0] = 68
        scene.boxes[-1][3][0] = 68
        self.assertEqual([m["captureMode"] for m in scene.messages()], ["OCR_SNAPSHOT"])
        self.assertTrue(all(m["captureUnit"] == "VIEWPORT_REMAINDER" for m in scene.messages()))

    def test_truncated_first_bubble_never_gets_an_author(self):
        scene = Scene()
        scene.bubble()
        crop_y = 70
        image = scene.image.crop((0, crop_y, scene.image.width, scene.image.height))
        output = scene.output()
        output.boxes = output.boxes - np.array([0, crop_y])
        messages = messages_from_crop(GROUP, image, output, NOW, incoming_bubble_left=80)
        self.assertTrue(all(m["captureMode"] == "OCR_SNAPSHOT" for m in messages))
        self.assertTrue(all(m["captureUnit"] == "VIEWPORT_REMAINDER" for m in messages))

    def test_left_cropped_bubble_can_pair_only_when_nickname_and_text_are_complete(self):
        scene = Scene()
        scene.bubble()
        crop_x = 82
        image = scene.image.crop((crop_x, 0, scene.image.width, scene.image.height))
        output = scene.output()
        output.boxes = output.boxes - np.array([crop_x, 0])
        messages = messages_from_crop(GROUP, image, output, NOW, incoming_bubble_left=0)
        self.assertEqual(messages[0]["sender"], "Nora")

    def test_grayscale_chat_inside_centered_image_is_not_promoted_to_author(self):
        scene = Scene()
        scene.bubble(left=180, author="Alice", body=("image text 1850",))
        messages = scene.messages()
        self.assertEqual([m["captureMode"] for m in messages], ["OCR_SNAPSHOT"])
        self.assertTrue(all(m["captureUnit"] == "VIEWPORT_REMAINDER" for m in messages))

    def test_colored_image_text_is_not_attributed(self):
        scene = Scene()
        scene.bubble(body=("image text 1850",))
        scene.draw.rectangle((400, 80, 530, 110), fill=(100, 30, 180))
        self.assertEqual([m["captureMode"] for m in scene.messages()], ["OCR_SNAPSHOT"])
        self.assertTrue(all(m["captureUnit"] == "VIEWPORT_REMAINDER" for m in scene.messages()))

    def test_dark_photo_below_does_not_demote_existing_message_or_repeat_it_in_fallback(self):
        scene = Scene()
        scene.bubble(author="MerchantA", body=("SK 64g6400 dc25 200 pcs",))
        before = scene.messages()
        scene.draw.rectangle((200, 260, 450, 400), fill=(15, 15, 15))
        scene.text("Photo label", (215, 300), size=18)
        after = scene.messages()
        self.assertEqual(after[0]["captureMode"], "OCR_MESSAGE")
        self.assertEqual(after[0]["sender"], "MerchantA")
        self.assertEqual(after[0]["messageId"], before[0]["messageId"])
        self.assertEqual(after[1]["captureMode"], "OCR_SNAPSHOT")
        self.assertIn("Photo label", after[1]["text"])
        self.assertNotIn("64g6400", after[1]["text"])

    def test_a_dominant_dark_photo_cannot_outvote_agreeing_canvas_edges(self):
        scene = Scene(size=(640, 800))
        scene.bubble(author="MerchantA", body=("SK 64g6400 dc25 200 pcs",))
        before = scene.messages()
        scene.draw.rectangle((10, 180, 630, 790), fill=(15, 15, 15))
        self.assertEqual(scene.messages()[0]["messageId"], before[0]["messageId"])

    def test_background_estimation_still_supports_a_genuinely_darker_canvas(self):
        scene = Scene()
        scene.bubble(author="MerchantA", body=("SK 64g6400 dc25 200 pcs",))
        pixels = np.asarray(scene.image).copy()
        pixels[(pixels == np.array([30, 30, 31])).all(axis=2)] = [15, 15, 15]
        scene.image = Image.fromarray(pixels)
        self.assertEqual(scene.messages()[0]["sender"], "MerchantA")

    def test_gray_quoted_name_inside_bubble_is_not_the_author(self):
        scene = Scene()
        scene.bubble(author=None, body=("quoted original text",))
        scene.text("Alice", (100, 85), color=(129, 129, 132), size=18)
        self.assertEqual([m["captureMode"] for m in scene.messages()], ["OCR_SNAPSHOT"])
        self.assertTrue(all(m["captureUnit"] == "VIEWPORT_REMAINDER" for m in scene.messages()))

    def test_straight_cropped_bottom_is_unknown_but_visible_rounded_edge_can_be_complete(self):
        scene = Scene()
        bottom = scene.bubble()
        straight = scene.image.crop((0, 0, scene.image.width, bottom - 15))
        messages = messages_from_crop(GROUP, straight, scene.output(), NOW, incoming_bubble_left=80)
        self.assertEqual([m["captureMode"] for m in messages], ["OCR_SNAPSHOT"])
        self.assertTrue(all(m["captureUnit"] == "VIEWPORT_REMAINDER" for m in messages))
        rounded = scene.image.crop((0, 0, scene.image.width, bottom + 1))
        messages = messages_from_crop(GROUP, rounded, scene.output(), NOW, incoming_bubble_left=80)
        self.assertEqual(messages[0]["sender"], "Nora")


if __name__ == "__main__":
    unittest.main()
