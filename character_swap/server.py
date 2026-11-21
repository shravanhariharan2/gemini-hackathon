"""Small, single-process API for local character-swap experiments."""

import ast
import io
import os
from pathlib import Path
import threading
import time
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from google import genai
from PIL import Image, UnidentifiedImageError

from .core import describe_person, prepare_clip, swap_character


def _job_error(exc):
    message = getattr(exc, 'message', None) or str(exc)
    details = getattr(exc, 'details', None)
    if message.startswith('Error code:') and ' - ' in message:
        try:
            details = ast.literal_eval(message.split(' - ', 1)[1])
        except (ValueError, SyntaxError):
            pass
    if isinstance(details, dict):
        error = details.get('error', details)
        if isinstance(error, dict):
            message = error.get('message') or message
    signals = f'{message} {details or ""}'.lower()
    if any(term in signals for term in (
            'content_blocked', 'safety', 'input blocked', 'output blocked',
            'blocked by', 'responsible ai', 'prohibited_content', 'content_filtered',
            'content_filter', 'rai_media_filtered',
            'no video; the request may have been filtered')):
        return {
            'error': "Gemini blocked this swap: Omni won't edit clips or photos showing "
                     'recognizable real people (e.g. public figures). Try a different clip or photo.',
            'error_code': 'content_blocked',
        }
    return {'error': message}


def create_app(work_dir=None, client_factory=None):
    app = FastAPI()
    root = Path(work_dir or os.environ.get('CHARACTER_SWAP_WORK_DIR',
                                           Path(__file__).parent / '.work'))
    root.mkdir(parents=True, exist_ok=True)
    clips, jobs = {}, {}
    lock = threading.Lock()

    def client():
        if client_factory:
            return client_factory()
        if not os.environ.get('GEMINI_API_KEY'):
            raise RuntimeError('GEMINI_API_KEY is required for live calls')
        return genai.Client()

    def clip_info(clip_id):
        if clip_id not in clips:
            raise HTTPException(404, 'Clip not found')
        return clips[clip_id]

    def save_upload(upload, path, limit, types):
        try:
            if upload.content_type not in types:
                raise HTTPException(415, 'Unsupported upload content type')
            total = 0
            with path.open('wb') as out:
                while chunk := upload.file.read(1024 * 1024):
                    total += len(chunk)
                    if total > limit:
                        raise HTTPException(413, 'Upload exceeds size limit')
                    out.write(chunk)
            if not total:
                raise HTTPException(400, 'Upload is empty')
        except Exception:
            path.unlink(missing_ok=True)
            raise
        finally:
            upload.file.close()

    def validate_image(path, formats):
        try:
            with Image.open(path) as image:
                if image.format not in formats or image.width * image.height > 30_000_000:
                    raise ValueError('Invalid image format or dimensions')
                image.verify()
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
            path.unlink(missing_ok=True)
            raise HTTPException(400, 'Invalid image')

    @app.post('/api/clips')
    def upload_clip(video: UploadFile = File(...)):
        clip_id = uuid4().hex
        src, dst = root / f'{clip_id}.upload', root / f'{clip_id}.mp4'
        save_upload(video, src, 200 * 1024 * 1024,
                    {'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'})
        try:
            info = prepare_clip(src, dst)
        except ValueError as exc:
            dst.unlink(missing_ok=True)
            raise HTTPException(400, str(exc)) from exc
        finally:
            src.unlink(missing_ok=True)
        clips[clip_id] = {**info, 'path': dst}
        return {'clip_id': clip_id, **info, 'url': f'/api/clips/{clip_id}/video'}

    @app.get('/api/clips/{clip_id}/video')
    def get_clip(clip_id: str):
        return FileResponse(clip_info(clip_id)['path'], media_type='video/mp4')

    @app.post('/api/clips/{clip_id}/describe')
    def describe(clip_id: str, frame: UploadFile = File(...),
                 x: float = Form(..., ge=0, le=1), y: float = Form(..., ge=0, le=1)):
        clip_info(clip_id)
        path = root / f'{uuid4().hex}.jpg'
        save_upload(frame, path, 15 * 1024 * 1024, {'image/jpeg'})
        try:
            validate_image(path, {'JPEG'})
            try:
                api_client = client()
            except Exception:
                api_client = None
            return {'description': describe_person(path.read_bytes(), x, y, api_client)}
        finally:
            path.unlink(missing_ok=True)

    def run_job(job_id, clip, photos, target, output):
        start = time.monotonic()
        with lock:
            jobs[job_id]['status'] = 'running'
        try:
            result = swap_character(clip, photos, target, output, client())
            with lock:
                jobs[job_id].update(status='done', seconds=result['seconds'],
                                    video_url=f'/api/swaps/{job_id}/video')
        except Exception as exc:
            with lock:
                jobs[job_id].update(status='error', seconds=time.monotonic()-start,
                                    **_job_error(exc))
        finally:
            for photo in photos:
                photo.unlink(missing_ok=True)

    @app.post('/api/swaps')
    def create_swap(photo: list[UploadFile] = File(...), clip_id: str = Form(...),
                    target: str = Form(..., min_length=1, max_length=1000)):
        clip = clip_info(clip_id)
        if not target.strip():
            raise HTTPException(422, 'Target description is required')
        if not 1 <= len(photo) <= 3:
            raise HTTPException(422, 'Provide 1 to 3 reference photos of the same person')
        job_id = uuid4().hex
        suffix = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp'}
        paths = []
        try:
            for index, upload in enumerate(photo):
                path = root / f'{job_id}-{index}{suffix.get(upload.content_type, ".image")}'
                paths.append(path)
                save_upload(upload, path, 15 * 1024 * 1024, set(suffix))
                validate_image(path, {'JPEG', 'PNG', 'WEBP'})
        except Exception:
            for path in paths:
                path.unlink(missing_ok=True)
            raise
        finally:
            for upload in photo:
                upload.file.close()
        with lock:
            jobs[job_id] = {'status': 'queued', 'seconds': None,
                            'error': None, 'video_url': None}
        threading.Thread(target=run_job,
                         args=(job_id, clip['path'], paths, target.strip(),
                               root / f'{job_id}-output.mp4'), daemon=True).start()
        return {'job_id': job_id}

    @app.get('/api/swaps/{job_id}')
    def get_job(job_id: str):
        with lock:
            if job_id not in jobs:
                raise HTTPException(404, 'Job not found')
            return dict(jobs[job_id])

    @app.get('/api/swaps/{job_id}/video')
    def get_output(job_id: str):
        job = get_job(job_id)
        if job['status'] != 'done':
            raise HTTPException(409, 'Video is not ready')
        return FileResponse(root / f'{job_id}-output.mp4', media_type='video/mp4')

    app.mount('/', StaticFiles(directory=Path(__file__).parent / 'web', html=True))
    return app


app = create_app()
