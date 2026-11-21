"""Command line for the stereo worker."""

import argparse
import json
import os
from pathlib import Path
import subprocess

from .depth import MODEL_DIR
from .framing import DEFAULT_MODEL
from .pipeline import generate


def main() -> None:
    parser = argparse.ArgumentParser(description="Render a POV clip to left-first full SBS stereo MP4.")
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--offline", action="store_true", help="Never send sample frames to Gemini.")
    parser.add_argument("--gemini-model", default=os.getenv("STEREO_GEMINI_MODEL", DEFAULT_MODEL))
    parser.add_argument("--assets", type=Path, default=MODEL_DIR)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--max-side", type=int, default=1280, help="Maximum long side in pixels per eye.")
    args = parser.parse_args()
    try:
        result = generate(
            args.input, args.output, assets=args.assets, device=args.device, max_side=args.max_side,
            gemini_model=args.gemini_model, gemini_api_key=None if args.offline else os.getenv("GEMINI_API_KEY"),
        )
    except (ValueError, OSError, RuntimeError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Stereo generation failed: {error}\n")
    print(json.dumps({
        "path": str(args.output), "layout": "full_sbs_left_first", "width": result.width,
        "height": result.height, "fps": float(result.fps), "frames": result.frames,
        "framing_source": result.framing.source, "subject": result.framing.subject,
        "strength": result.framing.strength,
    }))


if __name__ == "__main__":
    main()
