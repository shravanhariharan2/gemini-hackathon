# Clip Gen

## 3D View

Open `/3d` for the isolated spatial viewer: bundled flower depth/stereo demos,
local files (never uploaded), URL loading (`?src=` stereo or `?rgbd=` RGB+depth),
look-around relief, 2D, wiggle, red/cyan glasses and frame signal checks.
The original vanilla Three.js modules run in an iframe to isolate styles and
release their document/listeners on unmount. WebGL and media resources are
also released on page exit. Chrome matches the studio's white/slate palette.
Enter VR / Open in AR enable only for a supported WebXR immersive session and
stereo media; use HTTPS or localhost and a compatible headset browser.
RGB+depth is 2.5D reprojection, not volumetric or 360° video. Headset perception,
comfort and physical phone tilt require real-device testing. Cross-origin
videos must permit CORS; stereo is full-width left-eye/right-eye SBS.

Open `/clip-gen` for isolated Gemini Omni character replacement.
Clip Gen uses packaged `ffmpeg-static`/`ffprobe-static` binaries (system fallback),
with optional `FFMPEG_PATH`/`FFPROBE_PATH` overrides and server-side `GEMINI_API_KEY`.
Production installs must include these dependencies and allow their binary installation scripts.
Upload a video, use the sample, or choose a saved video from **My clips** (the same
browser-owned `/api/clips/library` used by the studio). Then click a person, refine the description, add 1–3
reference photos or camera selfies, then swap. Compare synchronized results or download MP4.
The edit requests whole-person replacement: identity, body/build, chest, all visible
skin tone and clothing follow the references. Target outfit descriptions locate the
person only. Motion, pose and scene remain; generative results may need a retry.
Videos: at least 3 seconds, up to 200 MiB; first 10 seconds normalized to silent H.264.
Photos: JPEG/PNG/WebP, up to 15 MiB and 30 megapixels each. Public figures may be blocked.
Use photos you have permission to use; generation usually takes about a minute.
Camera requires localhost or HTTPS. Description failures fall back to click position.
`CLIP_GEN_WORK_DIR` defaults to gitignored `.data/clip-gen`; `CLIP_GEN_DESCRIBE_MODEL`
defaults to `gemini-4-hydrogen`. Jobs/IDs are in memory; restart loses them, files remain.
Remove work files manually when finished. Uploads go to Gemini Files API and its retention applies.
This trusted-environment prototype has no authentication, quotas or durable queue.
Sample: [Anna Shvets, Pexels](https://www.pexels.com/video/two-women-dancing-and-hugging-4800574/),
under the [Pexels license](https://www.pexels.com/license/).

# ClipThat

**ClipThat** is a modern multi-user live streaming studio built with React, TypeScript, Express, WebSockets, and WebRTC. Multiple hosts and co-hosts can stream audio, video, and screens together while viewers watch and interact in real-time chat.

## Key Features

- **Pre-Join Name & Animal Avatar Gate**: Participants enter their own display name before entering a room and receive a randomly assigned illustrated animal avatar (with one-click shuffle) shown cleanly whenever their camera is off.
- **Multi-User Live Stage**: Full-mesh WebRTC (`RTCPeerConnection` with Perfect Negotiation) plus an automatic WebSocket frame relay fallback for strict NATs or headless environments.
- **Always-On Rolling Buffer & Hands-Free Clips**: Going live starts header-preserving staggered WebM recordings of the local stage and WebRTC guests. Manual **Clip That** and the `"clip that"` voice trigger feed the Gemini judge after post-roll.
- **Gemini Decisions Auto-Clipper**: Low-resolution probes, a full-context judge, automatic saving to My Clips, trimmed WebM downloads, and JSON/CSV cut lists. The registered `ClipSinkAdapter` receives `{ marker }`; the clipping controller owns recording and post-roll.
- **Real-Time Stream Chat**: Live messages, stream timestamps, quick reactions, pinned messages, host moderation, and viewer slow mode.

## Local Multi-User Demo (No Deployment Needed)

1. Install dependencies and start the local server:
   ```bash
   npm install
   npm run dev
   ```
2. Open `http://localhost:3000` in one browser tab and enter your name to join `main-stage` as Host.
3. Click **Copy Link** and open it in a second tab, incognito window, or another device on the same Wi-Fi (using your machine's LAN IP, e.g., `http://<your-ip>:3000/?room=main-stage`).
4. Optional quick-join URL parameters for scripted demos:
   - `http://localhost:3000/?room=main-stage&name=Maya&role=host`
   - `http://localhost:3000/?room=main-stage&name=Jordan&role=cohost`
   - `http://localhost:3000/?room=main-stage&name=Sam&role=viewer`

## Architecture & Contracts

- `server.ts`: Express + `ws` signaling server with typed protocol frames, `/api/health`, `/api/rooms`, per-socket sliding-window rate limits, payload caps, avatar URL validation, empty-room garbage collection, and graceful shutdown.
- `src/shared/protocol.ts`: Shared discriminated unions (`ClientWsMessage`, `ServerWsMessage`), REST DTOs, and `ClipSinkAdapter` / `DownstreamClipPayload` interfaces.
- `src/services/clipSink.ts`: Pluggable `registerClipSink()` marker hook. `useAutoClipper` registers the Decisions pipeline; `rollingRecorder.ts` owns the live media buffer. The generic `ClipRingBuffer<T>` remains available for other bounded data.

## Scripts

- `npm run dev` — Start Express + Vite dev server on port `3000`
- `npm test` — Run unit tests for utilities, server routes, Decisions contracts, media trimming, and recording rollover
- `npm run lint` — TypeScript strict type-check (`tsc --noEmit`)
- `npm run build` — Production client bundle (`vite build`)
- `npm start` — Run production server (`NODE_ENV=production npm start` after building)


## Creator profile setup

Join as a host and select **Set up creator profile** above the stage. Add your
name, handle, bio, and optional gift delivery address, then save. No profiles or
addresses are preloaded. Use **Edit profile** in the same browser to change it.

Profiles persist across server restarts in ignored `.data/streamers.json`
(override the directory with `PROFILE_DATA_DIR`). Addresses stay on the server;
public profile responses and room broadcasts never include them. The private
settings endpoint requires the creator ownership cookie. This prototype uses
first-claim, browser-cookie ownership, not verified creator accounts; add actual
creator authentication before a public launch or real gifting.

Gifting remains disabled until Shop MCP recipient checkout is implemented and
verified. Saving an address does not activate purchases.

## Shop MCP catalog infrastructure

The Express backend calls `https://mcp.shop.com/` directly using Shop's MCP
protocol. No Shop API key, merchant store, or buyer sign-in is needed for these
anonymous catalog routes:

- `POST /api/shop/search`: `{ "catalog": { "query": "ceramic mug", "context": { "address_country": "US", "currency": "USD" }, "pagination": { "limit": 3 } } }`
- `POST /api/shop/lookup`: `{ "catalog": { "ids": ["<public product URL or identifier>"] } }`
- `POST /api/shop/product`: `{ "catalog": { "id": "<returned product ID>", "selected": [{ "name": "Color", "label": "Blue" }] } }`

Search accepts price, attribute, shop, and shipping-destination filters. Price
bounds use integer minor units and require `context.currency`. Copy returned IDs,
URLs, option names, and labels unchanged. Public product URLs only: never send
private cart, checkout, account, or signed URLs to lookup. This initial API
supports text search; image matching will be added with the clip-analysis flow.

Responses preserve Shop's structured product data, warnings, and pagination.
Catalog responses use `Cache-Control: no-store`; do not persist returned listings
or rehost merchant images. Fetch current data when needed and display source
images directly. The transport has a 12-second timeout, never automatically
retries, and does not follow redirects or accept a caller-selected endpoint.

This is catalog infrastructure only. Buyer OAuth, session-owned carts, purchase
confirmation and completion, and verified creator-recipient shipping remain to
be implemented. There is no payment endpoint in this change.

## Gemini item detection

`POST /api/shop/detect-items` analyzes one to three compressed frames from a live
stream or clip. Configure `GEMINI_API_KEY` in server secrets; optionally override
`GEMINI_ITEM_MODEL` (default `gemini-3.8-flash`). Missing credentials return a clear
503 without preventing the rest of the app from starting.

Request shape: `{ "frames": [{ "mimeType": "image/jpeg", "data": "<base64 image bytes, without data-URL prefix>", "timestampSec": 12.5 }] }`.
JPEG, PNG, and WebP are supported, up to 500,000 base64 characters per frame and
three frames per request. Timestamp is optional and supplied by the caller.
Compress/resize frames before sending them. The request body limit is 2 MB.

The result has `{ items, model }`. Each item includes its source frame index,
caller-supplied timestamp when present, visible description/evidence, nullable
brand/model, a Shop search phrase, and a bounding box `[top,left,bottom,right]`
normalized to 0..1000. Results are discovery candidates (`matchType: "similar"`),
not verified product matches. Gemini is instructed to report brands/models only
when readable, ignore instructions inside images, and return no items for unclear
scenes. Output is validated again on the server. No prices or catalog IDs are
accepted from Gemini.

Pass an item's `searchQuery` to `/api/shop/search` as `catalog.query`, with the
buyer's country/currency context. Verify returned products and exact options before
presenting a match or adding to cart. Detection does not create carts or purchases.

Frames and model responses are not saved or logged by this app. The SDK sends the
frames to Google for inference. Calls have a 20-second timeout with automatic SDK
retries disabled. The endpoint allows five valid requests per IP per minute and
two concurrent analyses per server process. These are prototype, process-local
limits. Live-frame capture, clip-trigger wiring, automatic scheduling, and product
cards are not connected yet; this endpoint is ready for those consumers.


### Profile saves behind hosting proxies

Profile writes accept browser-confirmed same-origin requests using the
browser-controlled `Sec-Fetch-Site` header, even when a hosting proxy rewrites the
internal scheme or Host. Direct same-origin requests and the configured `APP_URL`
origin are also accepted. Set `APP_URL` to the public app URL for clients that do
not send Fetch Metadata. Paths/trailing slashes in that setting are normalized.
Missing/opaque origins and cross-origin browser requests without an explicit
configured origin remain rejected. Creator ownership cookies are still required
when editing an existing profile. No global `trust proxy` setting is enabled.

## Local Gemini auto-clipping

1. Use Node 22+, install dependencies with `npm install`, and install **ffmpeg + ffprobe**
   (`brew install ffmpeg` on macOS). Optional binary overrides: `FFMPEG_PATH` / `FFPROBE_PATH`.
2. Create **`.env.local`** at the repository root with `GEMINI_API_KEY="your-key"`.
   This file is ignored by Git. `.env.local` takes precedence over `.env`; existing
   shell environment variables take precedence over both. The key is used only by Express.
3. Run `npm run dev`, open `http://localhost:3000`, join as a host, and **Go Live**.
4. **Auto-clip is on by default**: the first check runs after 15 seconds of live
   recording, then repeats every 15 seconds. The **My Clips** tab beside the stage
   shows the current analysis status, latest highlight signal, and playable cuts
   as they arrive. Use **Share Screen** to clip a live application or playing video
   (include tab/system audio in the browser picker if needed).
5. Press **Clip That** or say “clip that” to request a cut manually. Finished cuts save directly to **My Clips**; play or download them beside the stream. Open
   **Clipping studio** for thresholds, questions, exports, and API details.
   Toggle **Auto-clip** off to pause scheduled analysis; manual capture still works.
   You can turn it off before going live. Checks send recorded video/audio to Gemini.
   Setup errors appear in the Clips panel; missing credentials or FFmpeg prevent
   analysis. Restart the server and reload after changing the key.

### Recording and decisions

The browser composites up to six local/WebRTC participants at 1280×720, 20 fps,
with mixed audio. Changes to camera, screen sharing, or connected guests update
that composite without replacing its output tracks. Relay-only guest audio/video
is not included; recording requires the guest's WebRTC MediaStream. My Clips is persistent per browser, across rooms and reloads. Multiple broadcasters can run their
own clipper and incur separate API calls.

A new recorder starts every 15 seconds. Whole recordings expire after 60 seconds;
individual header chunks are never removed. A snapshot requests all chunks from
one recording's start, preserving WebM initialization. A warmed-up full snapshot
covers approximately 45–60 seconds; early captures use the available history.
Each recording is limited to 16 MB. Background-tab throttling can reduce capture
cadence; keep the recording tab active for reliable live capture.

- **Two-stage (default):** every 10 / 15 / 20 seconds, a low-resolution probe checks
  the latest 15 seconds (shorter during warm-up). Crossing the trigger threshold
  schedules a full-buffer judge after 10 seconds of post-roll measured from the
  probed window's end (API latency counts toward that wait). Triggers are coalesced
  while busy, with a 30-second cooldown. Manual and voice markers bypass the trigger
  threshold and schedule the same judge.
- **Single-stage:** disabling deep judge evaluates all highlight questions in each
  immediate 15-second probe. Manual flush judges the available full buffer immediately.
- **Chat:** off by default. When enabled, only messages inside the chosen recording
  window are included, with timestamps adjusted to the normalized video.
- **Cancellation:** stopping the stream, switching rooms, or leaving cancels pending
  post-roll and browser requests; late results are not shown as the current session’s analysis.
  An accepted server request can still finish and save to My Clips; the library
  refreshes every 15 seconds and on window focus. There is no durable job queue yet;
  restarting the server interrupts in-flight work.

Express normalizes the snapshot to a seekable WebM using FFmpeg (remuxing whole
recordings without re-encoding, and re-encoding partial cuts), trims probe inputs
to their last 15 seconds, and calls `ai.decisions.create` from `@google/genai` with
`apiVersion: 'v1beta'` and `model: 'gemini-decision-1'`. Resolution belongs to the
video input block. Noul returns `noul` (P(true)); choice returns a probability map;
score returns an expected 0–4 rubric score and its distribution. There is no
text-generation fallback or simulated scoring. Missing, blocked, malformed, or
non-zero-output-token responses are rejected. Requests time out and are not retried
automatically. An auto-probe failure pauses auto-probing until you re-enable it.

The API inspector shows the actual submitted payload (video bytes explicitly
omitted), the raw response, timing, and token counts. Successful results require
`usage.total_output_tokens === 0`. Questions are editable for future requests.
Thresholds apply to future automatic captures. Existing saved clips remain saved.
Automatic selection uses four checks:
clip-worthiness, complete arc, sharing potential, and hook strength.

Gemini Decisions supplies scores and an initial peak/duration hint. For selected
captures, a Gemini tool-calling editor watches the normalized video with audio and
chooses exact numeric start/end seconds via `trim_clip`, preserving setup, payoff,
and reaction. Express validates the bounds before FFmpeg renders and saves the cut.
Manual/voice captures bypass quality thresholds and still use the editor; probes
and rejected automatic captures do not call it. Invalid or failed edits never
fall back to heuristic cuts. Boundary quality depends on model interpretation;
this is not a guarantee of frame-level event detection.

The editor uses the same **`GEMINI_API_KEY`**, with `GEMINI_CLIP_EDITOR_MODEL`
defaulting to `gemini-3.8-flash`. No Vertex AI Agent Engine deployment or Cloud
credentials are required: Google hosts inference, while this app executes the
editing tool and renders locally. The editor uses the Gemini Developer API's
[function calling](https://ai.google.dev/gemini-api/docs/function-calling) and
[video understanding](https://ai.google.dev/gemini-api/docs/video-understanding).
It makes one additional call per selected capture, with a 45-second timeout and
no automatic retries. Editing generates output tokens, tracked separately in
`edit.usage`; the zero-output-token requirement applies only to Decisions scoring.
The API inspector includes the editor exchange with video bytes omitted, and
saved clips retain the model, edit reason, and usage. Offline video/eval runs use
the same editor for judge candidates (including review-only suggestions); their
total usage includes editing tokens. Existing rendered imports are not re-edited.

Finished files and metadata live in `.data/clips` (override with `CLIP_DATA_DIR`).
An opaque HttpOnly SameSite cookie identifies this browser's library; clearing
cookies or using a different browser loses access to that library. This is not
account authentication. Files survive reloads and server restarts, with a 2 GB
quota per browser and no automatic eviction. Playback supports range requests;
downloads serve the finished WebM without another encode. JSON/CSV exports include
all saved cuts. Open `/?view=clips` or **My Clips** on the join screen to browse
without going live. **Previous video clips** can import already-rendered local
`.data/clip-runs` results, without another Gemini call.

Endpoints: `GET /api/clips/status`, `POST /api/clips/analyze`,
`GET /api/clips/library`, `GET /api/clips/library/:id/media`,
`DELETE /api/clips/library/:id`, `GET /api/clips/imports`, and
`POST /api/clips/library/import`. The legacy `POST /api/clips/trim` remains for
the recorder test and independent clients. Requests without capture metadata
retain the analysis-only contract. Uploads are bounded, validated for WebM
headers, restricted to same-origin browser requests, and limited to two concurrent
processing jobs / 15 requests per IP per minute. Intermediate files are removed
in `finally`. Selected media and optional chat go to Google for inference.

This is local disk storage. Hosting requires durable storage, account ownership,
and persistent worker jobs; moving this development server onto an ephemeral
host would not preserve clips across instance replacement.

### Verification

`npm test` covers the Decisions payload/response contract, failure handling,
automatic selection, direct manual saving, owner isolation, persistence, quotas,
range playback, trim bounds, route limits, and staggered recorder
rollovers. FFmpeg integration tests decode generated video with audio, normalize
it, and trim a playable cut (skipped only when FFmpeg is absent). Test-only response
fixtures never enter the runtime pipeline. `npm run lint` checks TypeScript and
`npm run build` bundles the studio.

For a real browser recording check, open `/tests/recorder.html` on the dev server
and click **Start 65-second recording check**. It records generated shapes and a
quiet tone, crosses the buffer rollover, then normalizes and plays a three-second
cut using the local server. It uses neither camera/microphone nor Gemini and is
not included in the production build.

`/tests/auto-clipper.html` exercises the actual React controller and drawer with a
generated video-only feed. Its probe/flush controls **do call Gemini with your
configured key**. It is useful for checking post-roll, automatic saving, thresholds,
and downloads without sharing camera or microphone data. Stop the test recording
and turn off auto-probe when finished. Neither test page is shipped by Vite's
production entry point.

## Automated clip-quality eval set

The five local sample videos are registered in `evals/dataset.json` with source
fingerprints. Run `npm run eval:review` to label desired start/peak/end timestamps,
`npm run eval:run -- --video wimbledon` for a real pipeline run, and
`npm run eval:score -- --run <run.json>` to re-score cached predictions locally.
Use `npm run eval:run -- --all` for the full dataset. See [evals/README.md](evals/README.md)
for metrics, held-out splits, reference review, and run comparison. The imported
Wimbledon suggestion starts as a draft; quality metrics require reviewed references.
