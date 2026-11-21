"""Run the pinned Video Depth Anything Small checkpoint."""

import os
from pathlib import Path
import sys

import numpy as np


MODEL_DIR = Path(__file__).resolve().parent / ".models"


def infer_depth(
    frames: np.ndarray, fps: float, *, assets: Path = MODEL_DIR, device: str = "auto"
) -> np.ndarray:
    source = assets / "video-depth-anything"
    checkpoint = assets / "video_depth_anything_vits.pth"
    if not (source / "video_depth_anything" / "video_depth.py").is_file() or not checkpoint.is_file():
        raise ValueError("Missing depth model. Run bash stereo_generator/setup-model.sh first.")

    import torch

    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cuda" and not torch.cuda.is_available():
        raise ValueError("CUDA was requested but is unavailable.")
    if device == "cpu":
        torch.set_num_threads(min(8, os.cpu_count() or 1))

    sys.path.insert(0, str(source.resolve()))
    try:
        from video_depth_anything.video_depth import VideoDepthAnything
    finally:
        sys.path.pop(0)

    model = VideoDepthAnything(
        encoder="vits", features=64, out_channels=[48, 96, 192, 384]
    )
    model.load_state_dict(torch.load(checkpoint, map_location="cpu", weights_only=True))
    model.eval().to(device)
    depth, _ = model.infer_video_depth(
        frames, fps, input_size=252, device=device, fp32=device == "cpu"
    )
    return depth
