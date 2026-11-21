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

Open `/clip-gen` for isolated Gemini Omni character replacement (no studio imports).
Requires `ffmpeg`/`ffprobe` on PATH and server-side `GEMINI_API_KEY`.
Upload a video or use the sample, click a person, refine the description, add 1–3
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
- **Always-On Rolling Buffer & Hands-Free Clip Markers**: Going live automatically maintains a rolling 60-second in-memory `ClipRingBuffer` and listens for `"clip that"` while unmuted, alongside a manual **Clip That** button.
- **Pluggable Downstream Clipping Interface**: Downstream pipelines (e.g., Deepgram transcription + DaVinci Resolve MCP) can register a `ClipSinkAdapter` via `src/services/clipSink.ts` to receive `DownstreamClipPayload` events (`{ marker, mimeType, chunks, bufferedSeconds }`).
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
- `src/services/clipSink.ts`: Bounded `ClipRingBuffer<T>` and pluggable `registerClipSink()` hook (defaults to `NoopClipSink` so video stays strictly in-memory until a downstream clipper connects).

## Scripts

- `npm run dev` — Start Express + Vite dev server on port `3000`
- `npm test` — Run unit tests (`tsx --test src/utils/streamUtils.test.ts`)
- `npm run lint` — TypeScript strict type-check (`tsc --noEmit`)
- `npm run build` — Production client bundle (`vite build`)
- `npm start` — Run production server (`NODE_ENV=production node server.ts`)


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
