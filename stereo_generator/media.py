"""Decode local MP4 video and encode synchronized browser-compatible MP4s."""

from contextlib import ExitStack, contextmanager
from dataclasses import dataclass
from fractions import Fraction
import json
import math
from pathlib import Path
import subprocess

import numpy as np


MAX_DURATION = 30
MAX_FPS = 30
MP4_INPUT = ["-protocol_whitelist", "file", "-f", "mov"]
FFMPEG = ["ffmpeg", "-nostdin", "-v", "error", "-xerror"]


@dataclass(frozen=True)
class Video:
    width: float
    height: float
    rate: Fraction

    def fit(self, longest_side: int) -> tuple[int, int]:
        scale = min(1, longest_side / max(self.width, self.height))
        return tuple(max(2, 2 * round(side * scale / 2)) for side in (self.width, self.height))


def _fraction(value: str | None, default: Fraction) -> Fraction:
    try:
        fraction = Fraction(value.replace(":", "/"))
        return fraction if fraction > 0 else default
    except (AttributeError, ValueError, ZeroDivisionError):
        return default


def inspect(path: Path) -> Video:
    output = subprocess.check_output([
        "ffprobe", "-v", "error", *MP4_INPUT, "-select_streams", "V:0",
        "-show_streams", "-of", "json", str(path),
    ])
    streams = json.loads(output)["streams"]
    if not streams:
        raise ValueError("The MP4 must contain a video track.")
    stream = streams[0]
    width = stream["width"] * float(_fraction(stream.get("sample_aspect_ratio"), Fraction(1)))
    height = stream["height"]
    rotation = int(next(
        (item["rotation"] for item in stream.get("side_data_list", []) if "rotation" in item),
        stream.get("tags", {}).get("rotate", 0),
    ))
    if rotation % 90:
        raise ValueError("Only right-angle camera rotation is supported.")
    if rotation % 180:
        width, height = height, width
    if min(width, height) < 16 or max(width, height) / min(width, height) > 4:
        raise ValueError("Video must be at least 16 pixels per side and within a 4:1 aspect ratio.")
    duration = stream.get("duration")
    if duration not in (None, "N/A") and float(duration) > MAX_DURATION + 0.05:
        raise ValueError(f"Trim the input clip to {MAX_DURATION} seconds or less.")
    fallback = _fraction(stream.get("r_frame_rate"), Fraction(MAX_FPS))
    rate = min(Fraction(MAX_FPS), _fraction(stream.get("avg_frame_rate"), fallback))
    if rate < 1:
        rate = Fraction(1)
    return Video(width, height, rate)


def _decode_command(path, size, rate, max_frames):
    w, h = size
    return [
        *FFMPEG, *MP4_INPUT, "-i", str(path), "-map", "0:V:0",
        "-filter_threads", "2", "-vf", f"fps={rate}:start_time=0,scale={w}:{h}:flags=bicubic",
        "-frames:v", str(max_frames), "-threads", "2",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
    ]


def analysis_frames(path: Path, spec: Video, size: tuple[int, int]) -> np.ndarray:
    limit = math.ceil(MAX_DURATION * spec.rate)
    pixels = subprocess.check_output(_decode_command(path, size, spec.rate, limit + 1))
    width, height = size
    frames = np.frombuffer(pixels, dtype=np.uint8).reshape(-1, height, width, 3)
    if len(frames) > limit:
        raise ValueError(f"Trim the input clip to {MAX_DURATION} seconds or less.")
    if not len(frames):
        raise ValueError("The MP4 contained no decodable frames.")
    return frames


@contextmanager
def _pipe(command, *, stdin=None, stdout=None):
    with subprocess.Popen(command, stdin=stdin, stdout=stdout) as process:
        try:
            yield process
        except BaseException:
            process.kill()
            raise
        if process.wait() != 0:
            raise RuntimeError("FFmpeg could not process the video.")


def encode(
    source: Path,
    targets: tuple[Path, ...],
    size: tuple[int, int],
    rate: Fraction,
    frame_count: int,
    render_frame,
) -> None:
    w, h = size
    frame_bytes = w * h * 3
    command = [
        *FFMPEG, "-y", "-f", "rawvideo", "-pixel_format", "rgb24",
        "-video_size", f"{w * 2}x{h}", "-framerate", str(rate), "-i", "pipe:0",
        *MP4_INPUT, "-i", str(source), "-map", "0:v:0", "-map", "1:a:0?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-movflags", "+faststart",
        "-t", f"{float(frame_count / rate):.6f}",
    ]
    with ExitStack() as stack:
        decoder = stack.enter_context(
            _pipe(_decode_command(source, size, rate, frame_count + 1), stdout=subprocess.PIPE)
        )
        encoders = [
            stack.enter_context(_pipe([*command, str(target)], stdin=subprocess.PIPE))
            for target in targets
        ]
        for index in range(frame_count):
            raw = decoder.stdout.read(frame_bytes)
            if len(raw) != frame_bytes:
                raise RuntimeError("The full-resolution stream ended before its depth maps.")
            frame = np.frombuffer(raw, dtype=np.uint8).reshape(h, w, 3)
            for encoder, packed in zip(encoders, render_frame(index, frame), strict=True):
                encoder.stdin.write(packed.tobytes())
        if decoder.stdout.read(1):
            raise RuntimeError("The full-resolution stream has more frames than its depth maps.")
        for encoder in encoders:
            encoder.stdin.close()
