import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { ClipLibrary, clipOwner } from './clipLibrary';
import { qualifies } from '../shared/clipping';
import { ClipError, decodeWebm, parseClipRequest } from './clipDecisions';
import { clipEditorModel, createClipAnalyzer } from './clipEditor';
import { mediaAvailable, normalizeMedia } from './clipMedia';

export function createClipRouter(judge = createClipAnalyzer(), normalize = normalizeMedia, library = new ClipLibrary()) {
  const router = express.Router();
  let active = 0;
  const buckets = new Map<string, { since: number; count: number }>();
  router.get('/status', async (_req, res) => res.json({ configured: !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY', mediaReady: await mediaAvailable(), model: 'gemini-decision-1', editorModel: clipEditorModel() }));
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const origin = req.get('origin');
    if (origin && new URL(origin).host !== req.get('host')) { res.status(403).json({ error: 'Clip requests must come from this studio.' }); return; }
    next();
  });
  router.get('/library', async (req, res) => { try { res.json({ clips: await library.list(clipOwner(req,res)) }); } catch(e) { respondError(res,e); } });
  router.get('/library/:id/media', async (req,res) => { try { const owner=clipOwner(req,res); const clip=await library.get(owner,req.params.id); if(!clip) { res.sendStatus(404);return; } if(req.query.download==='1') res.attachment(`clipthat-${clip.id.slice(0,8)}.webm`); res.sendFile(library.mediaPath(owner,clip.id)); } catch(e) { respondError(res,e); } });
  router.delete('/library/:id', async (req,res) => { try { await library.remove(clipOwner(req,res),req.params.id);res.sendStatus(204); } catch(e) { respondError(res,e); } });
  router.get('/imports',async(_req,res)=>{try{res.json({runs:await listImports()});}catch(e){respondError(res,e);}});
  router.use((req,res,next)=>{
    const now = Date.now();
    for (const [key, bucket] of buckets) if (now - bucket.since >= 60_000) buckets.delete(key);
    const ip = req.ip || 'local';
    const bucket = buckets.get(ip) || { since: now, count: 0 };
    if (active >= 2 || bucket.count >= 15 || (!buckets.has(ip) && buckets.size >= 1000)) { res.setHeader('Retry-After', '60'); res.status(429).json({ error: 'Clip processing is busy. Wait a minute and retry.' }); return; }
    bucket.count++; buckets.set(ip, bucket);
    next();
  });
  router.use(express.json({ limit: '23mb' }));
  router.post('/analyze', async (req, res) => {
    if (active >= 2) { res.status(429).json({ error: 'Clip processing is busy.' }); return; }
    active++;
    try {
      const request = parseClipRequest(req.body);
      const normalized = await normalize(decodeWebm(request.media), request.durationSec, { tail: request.stage === 'judge' ? request.targetSeconds : 15 });
      const result=await judge(request, normalized.media, normalized.durationSec, normalized.sourceOffsetSec);
      if(request.capture && request.stage !== 'probe') {
        const c=request.capture;
        const manual=['manual','voice','manual-flush'].includes(c.source);
        if(manual || qualifies(result.answers,c.thresholds)) {
          const trimmed=await normalize(normalized.media,normalized.durationSec,result.trim);
          result.savedClip=await library.save(clipOwner(req,res),{id:c.id,capturedAt:Date.now(),roomId:c.roomId,source:c.source,startedAt:c.startedAt+normalized.sourceOffsetSec*1000,durationSec:trimmed.durationSec,originalDurationSec:normalized.durationSec,trim:result.trim,edit:result.edit,answers:result.answers,usage:result.usage},trimmed.media);
          result.selection='saved';
        } else result.selection='below-threshold';
        delete result.media;
      }
      res.json(result);
    } catch (e) { respondError(res, e); } finally { active--; }
  });
  router.post('/library/import',async(req,res)=>{
    if(active>=2){res.status(429).json({error:'Clip processing is busy.'});return;}active++;
    try{
      const {runId,clipId}=req.body||{};
      if(typeof runId!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(runId)||!Number.isInteger(clipId))throw new ClipError('Invalid saved run.');
      const report=JSON.parse(await readFile(path.join(importRoot,runId,'results.json'),'utf8'));
      const clip=report.clips?.find((c:any)=>c.id===clipId);
      if(!clip || typeof clip.webm!=='string'||path.basename(clip.webm)!==clip.webm)throw new ClipError('Clip not found.',404);
      const candidate=report.candidates.find((c:any)=>c.id===clipId);
      if(!candidate?.result?.answers)throw new ClipError('Saved analysis is missing its scores.');
      const bytes=await readFile(path.join(importRoot,runId,clip.webm));
      const id=offlineClipId(runId,clipId);
      const saved=await library.save(clipOwner(req,res),{id,capturedAt:Date.now(),roomId:'imported-video',source:report.sourceName,startedAt:0,durationSec:clip.end-clip.start,originalDurationSec:report.duration,trim:{start:clip.start,end:clip.end},edit:candidate.result.edit,answers:candidate.result.answers,usage:candidate.result.usage},bytes);
      res.json({clip:saved});
    }catch(e){respondError(res,e);}finally{active--;}
  });
  router.post('/trim', async (req, res) => {
    if (active >= 2) { res.status(429).json({ error: 'Clip processing is busy.' }); return; }
    active++;
    try {
      const { media, start, end, durationSec } = req.body || {};
      if (![start, end, durationSec].every(Number.isFinite) || start < 0 || end <= start || end > durationSec + .1 || durationSec > 61) throw new ClipError('Invalid trim bounds.');
      const result = await normalize(decodeWebm(media), durationSec, { start, end });
      res.type('video/webm').setHeader('Content-Disposition', 'attachment; filename="clipthat-highlight.webm"');
      res.send(result.media);
    } catch (e) { respondError(res, e); } finally { active--; }
  });
  router.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'Invalid clip request or recording larger than 16 MB.' });
  });
  return router;
}
function respondError(res: express.Response, error: unknown) {
  res.status(error instanceof ClipError ? error.status : 500).json({ error: error instanceof ClipError ? error.message : 'Clip processing failed.' });
}

function offlineClipId(runId:string,clipId:number){return crypto.createHash('sha256').update(`${runId}:${clipId}`).digest('hex').slice(0,32).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');}
const importRoot=path.resolve('.data/clip-runs');
async function listImports(){
  let dirs:string[];try{dirs=await readdir(importRoot);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
  const runs=[];
  for(const runId of dirs.filter(d=>/^[-a-zA-Z0-9_]{1,100}$/.test(d))){
    try{const report=JSON.parse(await readFile(path.join(importRoot,runId,'results.json'),'utf8'));for(const clip of report.clips||[])runs.push({id:offlineClipId(runId,clip.id),runId,clipId:clip.id,title:report.sourceName,start:clip.start,end:clip.end});}catch{/* Ignore incomplete offline runs. */}
  }return runs;
}
