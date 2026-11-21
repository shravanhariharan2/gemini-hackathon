import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ClipGenError, createClipGenClient, describePerson, imageTypes, jobError, prepareClip, swapCharacter, validateImage, validateUpload, videoTypes } from './clipGen';

export function createClipGenRouter(deps = { prepareClip, validateImage, describePerson, swapCharacter, client: createClipGenClient }, workDir = process.env.CLIP_GEN_WORK_DIR || '.data/clip-gen') {
  const root = path.resolve(workDir);
  mkdirSync(root, { recursive: true });
  const router = express.Router();
  const clips = new Map<string, { path: string; duration: number; aspect_ratio: string }>();
  const jobs = new Map<string, { status: string; seconds: number | null; error: string | null; error_code?: string; video_url: string | null }>();
  const media = multer({ dest: root, limits: { fileSize: 200 * 1024 * 1024, files: 1, fields: 4 } });
  const photos = multer({ dest: root, limits: { fileSize: 15 * 1024 * 1024, files: 3, fields: 4 } });
  const remove = (file: string) => unlink(file).catch(() => {});
  const clip = (id: string) => { const value = clips.get(id); if (!value) throw new ClipGenError(404, 'Clip not found'); return value; };
  router.post('/clips', media.single('video'), async (req, res, next) => {
    const id = randomUUID(), dst = path.join(root, `${id}.mp4`);
    try {
      if (!req.file) throw new ClipGenError(422, 'Video is required');
      validateUpload(req.file.size, req.file.mimetype, 200 * 1024 * 1024, videoTypes);
      const info = await deps.prepareClip(req.file.path, dst);
      clips.set(id, { ...info, path: dst });
      res.json({ clip_id: id, ...info, url: `/api/clip-gen/clips/${id}/video` });
    } catch (e) { await remove(dst); next(e); }
    finally { if (req.file) await remove(req.file.path); }
  });
  router.get('/clips/:id/video', (req, res, next) => { try { res.type('mp4').sendFile(clip(req.params.id).path); } catch (e) { next(e); } });
  router.post('/clips/:id/describe', photos.single('frame'), async (req, res, next) => {
    try {
      clip(req.params.id);
      const x = Number(req.body.x), y = Number(req.body.y);
      if (req.body.x === undefined || req.body.y === undefined || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) throw new ClipGenError(422, 'Coordinates must be between 0 and 1');
      if (!req.file) throw new ClipGenError(422, 'Frame is required');
      validateUpload(req.file.size, req.file.mimetype, 15 * 1024 * 1024, ['image/jpeg']);
      await deps.validateImage(req.file.path, ['image/jpeg']);
      res.json({ description: await deps.describePerson(req.file.path, x, y, deps.client) });
    } catch (e) { next(e); }
    finally { if (req.file) await remove(req.file.path); }
  });
  router.post('/swaps', photos.array('photo', 3), async (req, res, next) => {
    const files = (req.files || []) as Express.Multer.File[];
    let started = false;
    try {
      const source = clip(req.body.clip_id);
      const target = req.body.target;
      if (typeof target !== 'string' || !target.trim() || target.length > 1000) throw new ClipGenError(422, 'Target description is required (1–1000 characters)');
      if (files.length < 1 || files.length > 3) throw new ClipGenError(422, 'Provide 1 to 3 reference photos of the same person');
      for (const file of files) {
        validateUpload(file.size, file.mimetype, 15 * 1024 * 1024, imageTypes);
        await deps.validateImage(file.path);
      }
      const client = deps.client();
      const id = randomUUID(), output = path.join(root, `${id}-output.mp4`);
      const job = { status: 'queued', seconds: null as number | null, error: null as string | null, video_url: null as string | null };
      jobs.set(id, job); started = true;
      void (async () => {
        const start = Date.now(); job.status = 'running';
        try { const result = await deps.swapCharacter(source.path, files, target.trim(), output, client); Object.assign(job, { status: 'done', seconds: result.seconds, video_url: `/api/clip-gen/swaps/${id}/video` }); }
        catch (e) { Object.assign(job, { status: 'error', seconds: (Date.now() - start) / 1000 }, jobError(e)); await remove(output); }
        finally { await Promise.all(files.map(f => remove(f.path))); }
      })();
      res.json({ job_id: id });
    } catch (e) { next(e); }
    finally { if (!started) await Promise.all(files.map(f => remove(f.path))); }
  });
  router.get('/swaps/:id', (req, res) => { const job = jobs.get(req.params.id); if (!job) { res.status(404).json({ error: 'Job not found' }); return; } res.json(job); });
  router.get('/swaps/:id/video', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
    if (job.status !== 'done') { res.status(409).json({ error: 'Video is not ready' }); return; }
    res.type('mp4').sendFile(path.join(root, `${req.params.id}-output.mp4`));
  });
  router.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err instanceof ClipGenError ? err.status : err instanceof multer.MulterError ? (err.code === 'LIMIT_FILE_SIZE' ? 413 : 422) : 500;
    res.status(status).json(jobError(err));
  });
  return router;
}
