"""POV-to-stereo worker with optional RGB+depth output."""

from contextlib import ExitStack
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
    rgb_depth_mp4: Path | str | None = None,
    gemini_api_key: str | None = None,
    gemini_model: str = framing.DEFAULT_MODEL,
    assets: Path = MODEL_DIR,
    device: str = "auto",
    max_side: int = 1280,
) -> Result:
    """Write left-first SBS and optionally a synchronized RGB-left, depth-right MP4."""
    source, target = Path(input_mp4).resolve(), Path(output_mp4).resolve()
    outputs = (target,) if rgb_depth_mp4 is None else (target, Path(rgb_depth_mp4).resolve())
    paths = (source, *outputs)
    if any(path.suffix.lower() != ".mp4" for path in paths):
        raise ValueError("Input and output must be local .mp4 paths.")
    if len(set(paths)) != len(paths):
        raise ValueError("Input and outputs must be different paths.")
    if not source.is_file() or any(not path.parent.is_dir() for path in outputs):
        raise ValueError("Input MP4 and output directory must exist.")
    if any(path.exists() and not path.is_file() for path in outputs):
        raise ValueError("Output MP4 paths must be files.")
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
        yield warper.stereo(frame, near, strength, focus)
        if rgb_depth_mp4 is not None:
            gray = np.rint(near * 255).astype(np.uint8)
            yield np.hstack((frame, cv2.cvtColor(gray, cv2.COLOR_GRAY2RGB)))

    with ExitStack() as stack:
        staged = tuple(
            Path(stack.enter_context(TemporaryDirectory(dir=path.parent, prefix=".stereo-"))) / "clip.mp4"
            for path in outputs
        )
        media.encode(source, staged, (w, h), spec.rate, len(depth), render)
        for temporary, path in zip(staged, outputs, strict=True):
            temporary.replace(path)
    return Result(w * 2, h, spec.rate, len(depth), guidance)
