# Character swap backend

Python 3.10+ and `ffmpeg`/`ffprobe` on PATH are required.

```sh
python -m venv character_swap/.venv
character_swap/.venv/bin/pip install -r character_swap/requirements.txt
export GEMINI_API_KEY=your-key
character_swap/.venv/bin/python -m character_swap
```

With your virtual environment activated, run
`GEMINI_API_KEY=... python -m character_swap` and open **http://localhost:8090**.
Choose a video or try the bundled sample; click a person on a paused frame,
refine “Who to replace”, add 1–3 photos of the same person (or capture camera selfies),
then Swap. The result has synchronized original/swapped playback, a swapped-only
toggle, and an MP4 download. Camera access requires localhost or HTTPS and permission.
Use clear, well-lit front, 3/4 and side views for a better likeness. Remove a
thumbnail to replace it. Clips are trimmed to the first 10 seconds.

Known limit: Omni replaces the head/identity; the original body and clothing stay.
Generation takes about 50 seconds per 8-second clip (allow roughly a minute).
The bundled demo is by [Anna Shvets, Pexels](https://www.pexels.com/video/two-women-dancing-and-hugging-4800574/),
used under the [Pexels license](https://www.pexels.com/license/).

Runs on 0.0.0.0:8090 (`PORT` overrides). `CHARACTER_SWAP_WORK_DIR` overrides
`character_swap/.work/`; `CHARACTER_SWAP_DESCRIBE_MODEL` overrides
`gemini-4-hydrogen`. Swap model defaults to `gemini-omni-1.2-flash`.

API: `POST /api/clips` multipart `video`; POST returned clip ID to
`/api/clips/{clip_id}/describe` with JPEG `frame` and normalized form `x`, `y`;
`POST /api/swaps` with 1–3 repeated `photo` fields (JPEG/PNG/WebP), `clip_id`, `target`;
poll `GET /api/swaps/{job_id}` and fetch `video_url` when done.
Clip response `url` serves the normalized video. OpenAPI: `/docs`.

Videos: <=200 MiB, at least 3 seconds; first 10 seconds retained, H.264,
long side <=1280. Each photo/frame: <=15 MiB, <=30 megapixels. Audio removed from
input. Output may include generated audio. Replacement keeps target clothes
and choreography, not necessarily their facial expression or exact pixels.
Description failures fall back to click position.

Jobs and clip IDs are in memory: use one server process, no reload/workers.
Restart loses IDs; work files remain. Remove the work directory manually when
finished. Uploads are sent to Gemini Files API and subject to its retention.
This lean hackathon service has no auth, quotas or durable queue; run only in
a trusted environment, not as a public upload service.

Offline tests (no key/network):
```sh
character_swap/.venv/bin/python -m unittest discover -s character_swap/tests -v
```
