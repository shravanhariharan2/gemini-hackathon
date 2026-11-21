import json
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import numpy as np

from stereo_generator import media
from stereo_generator.pipeline import generate
from stereo_generator.warp import StereoWarper


class WarpTests(unittest.TestCase):
    def test_crossed_foreground_and_uncrossed_background_with_left_eye_first(self):
        height, width = 32, 384
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        frame[6:14, 120:144, 0] = 255
        frame[20:26, 280:304, 2] = 255
        near = np.full((height, width), 0.1, dtype=np.float32)
        near[6:14, 120:144] = 0.9
        stereo = StereoWarper(height, width).stereo(frame, near, 0.025, 0.5)
        self.assertEqual(stereo.shape, (height, width * 2, 3))
        left, right = np.split(stereo, 2, axis=1)
        self.assertGreater(np.flatnonzero(left[10, :, 0] > 128).mean(), np.flatnonzero(right[10, :, 0] > 128).mean())
        self.assertLess(np.flatnonzero(left[22, :, 2] > 128).mean(), np.flatnonzero(right[22, :, 2] > 128).mean())
        np.testing.assert_array_equal(
            np.where(left[:, :, 0] > 128)[0].min(), np.where(right[:, :, 0] > 128)[0].min()
        )


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg is required")
class PipelineTests(unittest.TestCase):
    def setUp(self):
        tmp = TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.source = self.root / "test clip.mp4"
        self.target = self.root / "stereo.mp4"

    def _make_input(self, size="320x180", audio=False, rate="12"):
        sound = ["-f", "lavfi", "-i", "sine=frequency=440:duration=0.5", "-c:a", "aac"] if audio else []
        subprocess.run([
            "ffmpeg", "-v", "error", "-f", "lavfi", "-i", f"testsrc2=size={size}:rate={rate}:duration=1",
            *sound, "-c:v", "libx264", "-pix_fmt", "yuv420p", str(self.source),
        ], check=True)

    def _streams(self, path):
        completed = subprocess.check_output([
            "ffprobe", "-v", "error", "-count_frames", "-show_streams", "-of", "json", str(path),
        ])
        return json.loads(completed)["streams"]

    def _timestamps(self, path):
        completed = subprocess.check_output([
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", str(path),
        ])
        return [frame["best_effort_timestamp_time"] for frame in json.loads(completed)["frames"]]

    def _rgb_frames(self, path, width):
        raw = subprocess.check_output([
            "ffmpeg", "-v", "error", "-i", str(path), "-map", "0:v:0",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
        ])
        return np.frombuffer(raw, dtype=np.uint8).reshape(-1, 180, width, 3)

    @staticmethod
    def _fake_depth(frames, _fps, **_):
        return np.broadcast_to(np.linspace(0, 1, frames.shape[2], dtype=np.float32), frames.shape[:3])

    def test_encodes_full_sbs_at_original_rate_without_truncating_short_audio(self):
        self._make_input(audio=True)
        with patch("stereo_generator.pipeline.infer_depth", side_effect=self._fake_depth):
            result = generate(self.source, self.target)
        self.assertEqual((result.width, result.height, result.fps, result.frames), (640, 180, 12, 12))
        self.assertEqual(result.framing.source, "offline")
        video, audio = self._streams(self.target)
        self.assertEqual((video["codec_name"], video["pix_fmt"]), ("h264", "yuv420p"))
        self.assertEqual((video["width"], video["height"], video["nb_read_frames"]), (640, 180, "12"))
        self.assertEqual(audio["codec_name"], "aac")

    def test_honors_camera_rotation_and_missing_audio(self):
        self._make_input()
        rotated = self.root / "rotated.mp4"
        subprocess.run([
            "ffmpeg", "-v", "error", "-i", str(self.source), "-c", "copy",
            "-metadata:s:v:0", "rotate=90", str(rotated),
        ], check=True)
        with patch("stereo_generator.pipeline.infer_depth", side_effect=self._fake_depth):
            result = generate(rotated, self.target)
        self.assertEqual((result.width, result.height), (360, 320))
        video, = self._streams(self.target)
        self.assertEqual(video["nb_read_frames"], "12")

    def test_rgb_depth_preserves_color_polarity_and_sbs_frame_timestamps(self):
        self._make_input(audio=True, rate="30000/1001")
        rgb_depth = self.root / "rgb-depth.mp4"

        def changing_depth(frames, fps, **kwargs):
            maps = self._fake_depth(frames, fps, **kwargs).copy()
            maps[len(maps) // 2:] = maps[len(maps) // 2:, :, ::-1]
            return maps

        with patch("stereo_generator.pipeline.infer_depth", side_effect=changing_depth) as infer:
            result = generate(self.source, self.target, rgb_depth_mp4=rgb_depth)
        infer.assert_called_once()
        timestamps = self._timestamps(rgb_depth)
        self.assertEqual(timestamps, self._timestamps(self.target))
        self.assertEqual(timestamps, self._timestamps(self.source))
        self.assertEqual(len(timestamps), result.frames)
        video, audio = self._streams(rgb_depth)
        self.assertEqual((video["width"], video["height"], video["pix_fmt"]), (640, 180, "yuv420p"))
        self.assertEqual(audio["codec_name"], "aac")

        frames = self._rgb_frames(rgb_depth, 640)
        color, depth = np.split(frames, 2, axis=2)
        original = self._rgb_frames(self.source, 320)
        self.assertLess(np.abs(color.astype(np.int16) - original).mean(), 5)
        self.assertLess(np.ptp(depth[:, :, 4:-4, :], axis=3).mean(), 1)
        self.assertLess(depth[0, :, 8:32].mean(), 32)
        self.assertGreater(depth[0, :, -32:-8].mean(), 223)
        self.assertGreater(depth[-1, :, 8:32].mean(), 223)
        self.assertLess(depth[-1, :, -32:-8].mean(), 32)

    def test_failed_encode_does_not_replace_an_existing_output(self):
        self._make_input()
        self.target.write_bytes(b"original output")
        rgb_depth = self.root / "rgb-depth.mp4"
        rgb_depth.write_bytes(b"original depth")
        with patch("stereo_generator.pipeline.infer_depth", side_effect=self._fake_depth), patch.object(
            media, "encode", side_effect=RuntimeError("encoder failed")
        ):
            with self.assertRaisesRegex(RuntimeError, "encoder failed"):
                generate(self.source, self.target, rgb_depth_mp4=rgb_depth)
        self.assertEqual(self.target.read_bytes(), b"original output")
        self.assertEqual(rgb_depth.read_bytes(), b"original depth")
        self.assertFalse(list(self.root.glob(".stereo-*")))

    def test_refuses_same_input_and_output(self):
        with self.assertRaisesRegex(ValueError, "different paths"):
            generate(self.source, self.source)
        with self.assertRaisesRegex(ValueError, "different paths"):
            generate(self.source, self.target, rgb_depth_mp4=self.target)
