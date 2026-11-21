import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

import numpy as np

from stereo_generator import framing


class FramingTests(unittest.TestCase):
    def setUp(self):
        self.frames = np.zeros((9, 32, 32, 3), dtype=np.uint8)
        self.result = {
            "subject": "skateboard", "strength": "balanced", "frame_index": 4,
            "box_2d": [200, 250, 600, 750],
        }

    def test_validates_structured_gemini_response_and_sends_only_sample_images(self):
        reply = {"steps": [
            {"type": "thought", "content": []},
            {"type": "model_output", "content": [{"type": "text", "text": json.dumps(self.result)}]},
        ]}
        with patch.object(framing.request, "urlopen", return_value=io.BytesIO(json.dumps(reply).encode())) as call:
            guide = framing.choose(self.frames, 10, api_key="test-key", model=framing.DEFAULT_MODEL)
        self.assertEqual(guide, framing.Framing("gemini", "balanced", "skateboard", 4, (200, 250, 600, 750)))
        req = call.call_args.args[0]
        body = json.loads(req.data)
        self.assertFalse(body["store"])
        self.assertEqual(body["model"], framing.DEFAULT_MODEL)
        self.assertEqual([item["mime_type"] for item in body["input"] if item["type"] == "image"], ["image/jpeg"] * 5)

    def test_rejects_out_of_range_subject_and_unbounded_strength(self):
        for invalid in (
            {"frame_index": 99}, {"frame_index": True}, {"strength": "maximum"},
            {"box_2d": [500, 0, 400, 100]}, {"box_2d": [0, 0, 1001, 900]},
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                framing._parse(self.result | invalid, {4})

    def test_offline_never_calls_api_and_http_failure_is_nonfatal(self):
        with patch.object(framing.request, "urlopen") as urlopen:
            guide = framing.choose(self.frames, 10, api_key=None, model=framing.DEFAULT_MODEL)
            self.assertEqual(guide, framing.Framing("offline"))
            urlopen.assert_not_called()
            urlopen.side_effect = HTTPError(framing._ENDPOINT, 429, "rate limit", None, None)
            with self.assertLogs(level="WARNING"):
                guide = framing.choose(self.frames, 10, api_key="test-key", model=framing.DEFAULT_MODEL)
            self.assertEqual(guide, framing.Framing("fallback"))

    def test_bad_model_output_uses_fallback(self):
        with patch.object(framing.request, "urlopen", return_value=io.BytesIO(b'{"steps":[]}')):
            with self.assertLogs(level="WARNING"):
                guide = framing.choose(self.frames, 10, api_key="test-key", model=framing.DEFAULT_MODEL)
        self.assertEqual(guide, framing.Framing("fallback"))

    def test_subject_depth_controls_clip_wide_convergence(self):
        guide = framing._parse(self.result, {4})
        depth = np.full((9, 100, 100), 1.0)
        depth[4, 20:60, 25:75] = 7.0
        self.assertAlmostEqual(framing.convergence(depth, guide, 1.0, 10.0), 0.60)
        self.assertEqual(framing.convergence(depth, framing.Framing("offline"), 1.0, 10.0), 0.65)
