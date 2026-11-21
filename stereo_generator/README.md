# POV-to-stereo worker

Convert one streamer's clipped 2D POV MP4 into one rectilinear stereo MP4 for a VR viewer. The left half is the left eye; the right half is the right eye. This is **full side-by-side**, not half-width SBS, 180°/360° video, or a shared 3D scene. Generate each streamer's POV separately.

## Run

From the repository root on Linux with Python 3.10–3.12, FFmpeg/ffprobe with libx264, git, curl, and sha256sum:

```sh
python3 -m venv stereo_generator/.venv
source stereo_generator/.venv/bin/activate
# CPU installation. For GPU, install the matching PyTorch/CUDA wheels instead.
python -m pip install torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cpu
python -m pip install -r stereo_generator/requirements.txt
bash stereo_generator/setup-model.sh
python -m stereo_generator ./clip.mp4 ./clip-stereo.mp4
```

The setup downloads the pinned [Video Depth Anything Small](https://github.com/DepthAnything/Video-Depth-Anything#license) (Apache-2.0) source and verifies the roughly 112 MiB checkpoint. Weights are not committed. The worker uses CUDA when available or CPU otherwise; use `--device cpu` to force CPU.

**Gemini:** Set `GEMINI_API_KEY` in the worker's environment to enable automatic framing. `gemini-4-hydrogen` sees up to five sampled JPEGs, not the entire video or audio. It returns a subject box and a bounded stereo preset. The depth at that subject sets the fixed screen plane for the clip. Use only clips whose sample frames may be sent to Google; use `--offline` to guarantee no request. Missing credentials, API failures, or invalid responses use a conservative local preset. Override the model with `STEREO_GEMINI_MODEL` or `--gemini-model`.

## Worker/viewer contract

- **Input:** a local MP4 (up to 30 seconds). Landscape and portrait are supported, including rotated camera metadata.
- **Output:** H.264 `yuv420p` MP4 with AAC when the source has audio. For processed eye dimensions `W × H`, the output is `2W × H`. The browser/VR player should explicitly select **full SBS, left eye first**. Source frame rate is normalized to constant rate, capped at 30 fps; `--max-side` controls the per-eye long-side cap (1280 by default).
- **Integration:** run the command off the request path or call `stereo_generator.pipeline.generate(input_path, output_path, gemini_api_key=…)`. The CLI prints one JSON result with `layout: "full_sbs_left_first"` and `framing_source: "gemini" | "offline" | "fallback"`. No streaming, clipping, or viewer files are changed.

The generator estimates temporally consistent relative depth, then shifts pixels horizontally in opposite directions. It cannot see behind foreground objects: fast camera moves and thin structures can still cause edge warping. Use short, continuous POVs for the demo and validate comfort on hardware before shipping.

## Optional RGB+depth export for the look-around viewer

```sh
python -m stereo_generator ./clip.mp4 ./clip-stereo.mp4 --rgb-depth ./clip-rgb-depth.mp4
```

The additional MP4 has the same dimensions, frame timestamps, and audio policy as SBS. Its left half is the unwarped source RGB at the processed eye size; its right half is the pixel-aligned grayscale depth map (**white = near, black = far**). Depth is relative and normalized across the whole clip, not a distance in meters. Both outputs use the same decoded frames and a single depth inference pass. Omit `--rgb-depth` to keep the existing SBS-only behavior.

For Python callers, pass `rgb_depth_mp4=output_path` to `generate()`. With the CLI flag, the JSON result also includes `rgb_depth_path` and `rgb_depth_layout: "rgb_left_depth_right_white_near"`.

## Tests

```sh
python -m unittest discover -s stereo_generator/tests -v
```

Tests use synthetic clips and mock depth/Gemini where appropriate; they need FFmpeg but neither a model download nor credentials. For a live smoke test, try the [MDN CC0 flower clip](https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4) with and without Gemini enabled.
