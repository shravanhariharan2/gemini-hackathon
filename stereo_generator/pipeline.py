"""File-in, file-out POV-to-stereo worker."""

from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from tempfile import TemporaryDirectory

import cv2
import numpy as np

from . import framing, media
from .depth import MODEL_DIR, infer_depth
from .warp import StereoWarper


@dataclass(frozen=True)
class Result:
    width: int
    height: int
    fps: Fraction
    frames: int
    framing: framing.Framing


def generate(
    input_mp4: Path | str,
    output_mp4: Path | str,
    *,
    gemini_api_key: str | None = None,
    gemini_model: str = framing.DEFAULT_MODEL,
    assets: Path = MODEL_DIR,
    device: str = "auto",
    max_side: int = 1280,
) -> Result:
    """Write left-first full-width stereo, atomically replacing output on success."""
    source, target = Path(input_mp4).resolve(), Path(output_mp4).resolve()
    if source.suffix.lower() != ".mp4" or target.suffix.lower() != ".mp4":
        raise ValueError("Input and output must be local .mp4 paths.")
    if source == target:
        raise ValueError("Input and output must be different paths.")
    if not source.is_file() or not target.parent.is_dir():
        raise ValueError("Input MP4 and output directory must exist.")
    if not 160 <= max_side <= 1920:
        raise ValueError("max_side must be between 160 and 1920 pixels.")
    if device not in ("auto", "cpu", "cuda"):
        raise ValueError("device must be auto, cpu, or cuda.")

    spec = media.inspect(source)
    w, h = spec.fit(max_side)
    small = media.analysis_frames(source, spec, spec.fit(min(max_side, 560)))
    guidance = framing.choose(small, float(spec.rate), api_key=gemini_api_key, model=gemini_model)
    depth = infer_depth(small, float(spec.rate), assets=assets, device=device)
    if depth.shape != small.shape[:3] or not np.all(np.isfinite(depth)):
        raise ValueError("Depth inference did not return a finite map for every frame.")
    del small

    low, high = np.percentile(depth[:, ::4, ::4], (2, 98))
    range_ = high - low
    strength = framing.STRENGTHS[guidance.strength] if range_ >= 1e-6 else 0
    focus = framing.convergence(depth, guidance, low, max(range_, 1e-6))
    warper = StereoWarper(h, w)

    def render(index, frame):
        near = cv2.resize(depth[index], (w, h), interpolation=cv2.INTER_LINEAR)
        near = np.clip((near - low) / max(range_, 1e-6), 0, 1)
        return warper.stereo(frame, near, strength, focus)

    with TemporaryDirectory(dir=target.parent, prefix=".stereo-") as directory:
        staged = Path(directory) / "stereo.mp4"
        media.encode(source, staged, (w, h), spec.rate, len(depth), render)
        staged.replace(target)
    return Result(w * 2, h, spec.rate, len(depth), guidance)
