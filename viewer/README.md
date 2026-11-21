# Spatial clip viewer

An isolated Vite/Three.js app for **full-width side-by-side stereo MP4**, left eye
on the left. No dependency on the rest of the platform and no backend required.

```sh
cd viewer
npm ci
npm run dev
# Build a static deployment:
npm run build
npm run preview
# Run signal/eye-mapping regression tests:
npm test
```

Node 22.12+ is required. Deploy `dist/` to a static HTTPS host. The relative Vite
base supports hosting at `/viewer/` as well as `/`; link to the trailing slash.
There are no repository pre-commit hooks to configure.

## Platform / generator integration

Link from a clip card to:

```js
const viewer = new URL('/viewer/', window.location.origin);
viewer.searchParams.set('src', clip.stereo_mp4_url);
viewer.searchParams.set('title', clip.title);
window.location.href = viewer;
```

Example: `/viewer/?src=https%3A%2F%2Fcdn.example.com%2Fclip-sbs.mp4&title=Highlight`.
The link points to a directly playable file, not a web page or an HLS playlist.
The viewer also opens local files (not uploaded). It opens with the real five-second
flower clip converted by this project's AI-depth stereo generator. The calibration
cube button opens the original six-second synthetic stereo camera pair. No AI
provider calls are made by the viewer itself.

Media contract:

- Full-width SBS, even pixel width, left eye then right, equal eye dimensions.
- Example: **3840×1080** means two **1920×1080** eye images. Not half-SBS.
- H.264 MP4 with `yuv420p`, finite duration, optional AAC audio, fast-start metadata.
- Same-origin video or a server returning `Access-Control-Allow-Origin` for this
  app's origin (or `*`). Cross-origin video uses anonymous CORS; cookie-authenticated
  files need a signed URL or same-origin endpoint. HTTPS pages require HTTPS media.
- Keep source orientation upright. The viewer does not infer stereo layout,
  stereo eye order, or lens corrections.

## No-headset checks

- **2D preview:** crops the left eye at its correct aspect ratio.
- **Wiggle (default):** alternates the same frame's eyes every 170ms; works while
  paused too. Reduced-motion users start in 2D and can explicitly choose wiggle.
- **Red / cyan:** grayscale anaglyph, red lens on the left eye. Without inexpensive
  filter glasses it shows stereo offsets but cannot give binocular depth perception.
- **Check frame:** detects duplicate eyes, searches textured patches for horizontal
  displacement, and looks for varying disparity. It deliberately leaves uniform
  translations and unrelated imagery inconclusive. This is only a signal heuristic,
  not validation of geometry, eye order, temporal stability, or comfort. Check several
  representative moments, including motion and occlusion edges.

## WebXR

Use an HTTPS top-level page in a WebXR-capable headset browser. `Enter VR` and
`Open in AR` enable only for supported immersive modes. In an iframe, the host
must permit `xr-spatial-tracking` (a top-level page is recommended).

Both eyes sample a **single HTML video element**, so playback, seeking and audio
remain synchronized. Each eye sees its own half of a virtual screen 3.2m ahead;
the right half is never drawn into the left eye. AR leaves the background clear.
Controller trigger toggles playback. Devices with DOM-overlay support also show
pause/play, recenter and exit controls; otherwise use the system exit control.

The screen is a stereo video plane, **not 360° video or a volumetric scene**.
Changing head position does not reveal new camera viewpoints. Multiple streamer
POVs do not become one navigable scene simply by feeding them to this viewer.

Desktop WebXR emulation can verify API flow and eye routing, but a real headset
is still needed to judge perceived depth and comfort. Actual headset validation
must be recorded separately; do not interpret automated tests as hardware results.

## Rebuild sample (optional)

`python3 scripts/generate-demo.py` needs Pillow and ffmpeg. Normal app development
and playback use the committed MP4 and do not need those tools.
