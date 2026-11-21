import dotenv from 'dotenv';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { clipEditorModel, createClipAnalyzer } from '../src/server/clipEditor';
import { probability, qualifies, type ClipResult, type ClipThresholds } from '../src/shared/clipping';

import { parseEvalConfig } from '../src/eval/config';
dotenv.config({ path: ['.env.local', '.env'], quiet: true });
const configIndex = process.argv.indexOf('--config');
const config = parseEvalConfig(configIndex >= 0 ? JSON.parse(await readFile(process.argv[configIndex + 1], 'utf8')) : {});
const { rules: DEFAULT_RULES, thresholds: DEFAULT_THRESHOLDS, intervalSec, postRollSec, cooldownSec } = config;
const exec = promisify(execFile);
const source = process.argv[2];
if (!source) throw new Error('Usage: npx tsx scripts/clip-video.ts <video> [output-directory]');
const output = path.resolve(process.argv[3] || `.data/clip-runs/${Date.now()}`);
const work = path.join(output, '.work');
await mkdir(work, { recursive: true });
const metadata = JSON.parse((await exec(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', source])).stdout);
const duration = Number(metadata.format.duration);
if (!Number.isFinite(duration) || duration <= 0) throw new Error('Cannot read video duration.');
const judge = createClipAnalyzer();
type Scores = Record<'worthy' | 'arc' | 'viral' | 'hook', number>;
type Result = Omit<ClipResult, 'media'>;
interface Candidate { id: number; triggerAt: number; triggerProbability: number; windowStart: number; windowEnd: number; start: number; end: number; approved: boolean; failed: string[]; scores: Scores; rank: number; result: Result }
interface ExportedClip extends Omit<Candidate, 'result'> { category: string; file: string; webm: string; poster: string }
interface Report { source: string; sourceName: string; duration: number; createdAt: string; model: string; editorModel: string; rules: typeof DEFAULT_RULES; thresholds: ClipThresholds; intervalSec: number; postRollSec: number; cooldownSec: number; probes: { start: number; end: number; trigger: number; scheduledJudge: boolean; result: Result }[]; candidates: Candidate[]; clips: ExportedClip[]; errors: unknown[]; completedAt?: string; usage?: { inputTokens: number; outputTokens: number } }
let report: Report = { source: path.resolve(source), sourceName: path.basename(source), duration, createdAt: new Date().toISOString(), model: 'gemini-decision-1', editorModel: clipEditorModel(), rules: DEFAULT_RULES, thresholds: DEFAULT_THRESHOLDS, intervalSec, postRollSec, cooldownSec, probes: [], candidates: [], clips: [], errors: [] };
if (process.argv.includes('--resume')) {
  const saved = JSON.parse(await readFile(path.join(output, 'results.json'), 'utf8')) as Report;
  if (saved.editorModel !== clipEditorModel() || saved.source !== path.resolve(source) || JSON.stringify(saved.rules) !== JSON.stringify(DEFAULT_RULES) || JSON.stringify(saved.thresholds) !== JSON.stringify(DEFAULT_THRESHOLDS) || saved.intervalSec !== intervalSec || saved.postRollSec !== postRollSec || saved.cooldownSec !== cooldownSec) throw new Error('Saved run uses a different source, rules, or thresholds.');
  report = saved;
}
const checkpoint = () => writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
async function extract(start: number, length: number, file: string, mp4 = false) {
  await exec(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', start.toFixed(3), '-i', source, '-t', length.toFixed(3), '-map', '0:v:0', '-map', '0:a:0?', '-vf', 'scale=960:540:force_original_aspect_ratio=decrease:force_divisible_by=2', '-r', '20', ...(mp4 ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart'] : ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '900k', '-c:a', 'libopus', '-b:a', '64k']), '-threads', '2', '-y', file], { timeout: 90_000, maxBuffer: 1024 * 1024 });
}
async function analyze(stage: 'probe' | 'judge', start: number, end: number) {
  const file = path.join(work, `${stage}.webm`);
  await extract(start, end - start, file);
  const bytes = await readFile(file);
  const result = await judge({ stage, resolution: stage === 'probe' ? 'low' : 'medium', media: '', durationSec: end - start, targetSeconds: end - start, chat: [], rules: DEFAULT_RULES }, bytes, end - start, 0);
  const { media, ...metadata } = result;
  return metadata;
}
const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
let lastTrigger = report.candidates.at(-1)?.triggerAt ?? -Infinity;
try {
  const ends = Array.from({ length: Math.floor(duration / intervalSec) }, (_, i) => (i + 1) * intervalSec);
  if (duration - ends.at(-1)! > .05) ends.push(duration);
  if (!ends.length) ends.push(duration);
  console.log(JSON.stringify({ event: 'start', source: report.sourceName, duration, windows: ends.length, output }));
  for (const end of ends) {
    if (report.probes.some(p => Math.abs(p.end - end) < .01)) continue;
    const start = Math.max(0, end - 15);
    let probe: Omit<ClipResult, 'media'>;
    try { probe = await analyze('probe', start, end); }
    catch (error) { report.errors.push({ stage: 'probe', start, end, error: (error as Error).message }); await checkpoint(); throw error; }
    const trigger = probability(probe.answers, 'trigger_detected')!;
    const eligible = trigger >= DEFAULT_THRESHOLDS.trigger && end - lastTrigger >= cooldownSec;
    report.probes.push({ start, end, trigger, scheduledJudge: eligible, result: probe });
    console.log(JSON.stringify({ event: 'probe', at: time(end), trigger: +trigger.toFixed(3), scheduledJudge: eligible }));
    await checkpoint();
    if (!eligible) continue;
    lastTrigger = end;
    const judgeEnd = Math.min(duration, end + postRollSec);
    const judgeStart = Math.max(0, judgeEnd - 60);
    let result: Omit<ClipResult, 'media'>;
    try { result = await analyze('judge', judgeStart, judgeEnd); }
    catch (error) { report.errors.push({ stage: 'judge', start: judgeStart, end: judgeEnd, error: (error as Error).message }); await checkpoint(); throw error; }
    const scores = Object.fromEntries(['worthy', 'arc', 'viral', 'hook'].map(key => [key, probability(result.answers, key)!])) as Scores;
    const failed = (Object.keys(scores) as (keyof Scores)[]).filter(key => scores[key] < DEFAULT_THRESHOLDS[key]);
    const candidate = { id: report.candidates.length + 1, triggerAt: end, triggerProbability: trigger, windowStart: judgeStart, windowEnd: judgeEnd, start: judgeStart + result.trim.start, end: judgeStart + result.trim.end, approved: qualifies(result.answers, DEFAULT_THRESHOLDS), failed, scores, rank: scores.worthy * .4 + scores.arc * .2 + scores.viral * .25 + scores.hook * .15, result };
    report.candidates.push(candidate);
    console.log(JSON.stringify({ event: 'judge', cut: `${time(candidate.start)}–${time(candidate.end)}`, approved: candidate.approved, failed, scores }));
    await checkpoint();
  }
  // Export the strongest non-duplicate suggestions, keeping the original approvals intact.
  const ranked = [...report.candidates].sort((a, b) => Number(b.approved) - Number(a.approved) || b.rank - a.rank);
  for (const candidate of process.argv.includes('--no-media') ? [] : ranked) {
    const duplicate = report.clips.some(c => Math.max(0, Math.min(c.end, candidate.end) - Math.max(c.start, candidate.start)) / Math.min(c.end - c.start, candidate.end - candidate.start) > .5);
    if (duplicate || report.clips.length >= 6) continue;
    const stem = `clip-${String(report.clips.length + 1).padStart(2, '0')}-${Math.floor(candidate.start)}s`;
    const file = `${stem}.mp4`; const webm = `${stem}.webm`; const poster = `${stem}.jpg`;
    await extract(candidate.start, candidate.end - candidate.start, path.join(output, file), true);
    await extract(candidate.start, candidate.end - candidate.start, path.join(output, webm));
    await exec(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(candidate.start + Math.min(2, (candidate.end - candidate.start) / 2)), '-i', source, '-frames:v', '1', '-vf', 'scale=640:-2', '-y', path.join(output, poster)], { timeout: 15000 });
    const { result, ...summary } = candidate;
    report.clips.push({ ...summary, category: result.answers.category?.type === 'choice' ? result.answers.category.choice : 'highlight', file, webm, poster });
    await checkpoint();
  }
  report.completedAt = new Date().toISOString();
  report.usage = [...report.probes.map(p => p.result), ...report.candidates.map(c => c.result)].reduce((total, result) => ({ inputTokens: total.inputTokens + (result.usage?.total_input_tokens || 0) + (result.edit?.usage?.promptTokenCount || 0), outputTokens: total.outputTokens + (result.usage?.total_output_tokens || 0) + (result.edit?.usage?.candidatesTokenCount || 0) + (result.edit?.usage?.thoughtsTokenCount || 0) }), { inputTokens: 0, outputTokens: 0 });
  await checkpoint();
  const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const approved = report.candidates.filter(c => c.approved).length;
  await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ClipThat · Video results</title><style>body{margin:0;background:#f6f7f9;color:#0f172a;font:16px system-ui}main{max-width:1100px;margin:auto;padding:40px 24px}small{font:12px monospace;color:#64748b}h1{font-size:38px;letter-spacing:-.04em;margin:12px 0}p{color:#475569;line-height:1.65}.stats{display:flex;gap:26px;flex-wrap:wrap;margin:28px 0}.stats strong{display:block;font-size:26px}.note{padding:18px;background:#fff1f2;border-left:3px solid #e11d48;border-radius:8px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:22px;margin-top:28px}article{background:white;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}video{width:100%;aspect-ratio:16/9;background:#0f172a}.body{padding:20px}h2{font-size:20px;margin:0 0 12px}a{color:#be123c;text-decoration:none;margin-right:18px}table{width:100%;font-size:13px;margin:18px 0;border-collapse:collapse}td{padding:6px 0;border-bottom:1px solid #f1f5f9}td:last-child{text-align:right;font-family:monospace}.tag{font-size:12px;background:#f1f5f9;padding:4px 8px;border-radius:5px}.fail{color:#be123c}.foot{font-size:13px;margin-top:28px}</style><main><small>CLIPTHAT / REAL GEMINI DECISIONS</small><h1>Clip results.</h1><p>${escape(report.sourceName)} · Full ${time(duration)} video scanned.</p><div class="stats"><div><strong>${report.probes.length}</strong>15-second probes</div><div><strong>${report.candidates.length}</strong>full-context candidates</div><div><strong>${approved}</strong>auto-approved</div><div><strong>${report.usage!.outputTokens}</strong>output tokens</div></div><div class="note">${approved ? 'Current approval thresholds applied to the recorded scores.' : 'No candidate passed every default threshold. These are the strongest highlight suggestions for review, not auto-approved clips.'}</div><div class="grid">${report.clips.map((clip, i) => `<article><video controls preload="metadata" poster="${clip.poster}" src="${clip.file}"></video><div class="body"><h2>${i + 1}. ${escape(clip.category)} · ${time(clip.start)}–${time(clip.end)}</h2><span class="tag">${clip.approved ? 'Auto-approved' : 'Needs review'}</span><p>${Math.round(clip.end - clip.start)} seconds · source timestamps</p><table>${Object.entries(clip.scores).map(([key, value]) => `<tr><td>${key}${clip.failed.includes(key) ? ' · below threshold' : ''}</td><td class="${clip.failed.includes(key) ? 'fail' : ''}">${Math.round(Number(value) * 100)}%</td></tr>`).join('')}</table><a download href="${clip.file}">Download MP4</a><a download href="${clip.webm}">WebM</a></div></article>`).join('')}</div><p class="foot">Current approval thresholds; ${postRollSec}s post-roll; no chat. Suggestions ranked by 40% clip-worthiness + 20% complete arc + 25% sharing potential + 15% hook strength. Cuts overlapping by more than half are suppressed. Trim boundaries are selected by the Gemini video editor; timing accuracy depends on model interpretation. <a href="results.json">Full results & API responses</a></p></main></html>`);
  console.log(JSON.stringify({ event: 'complete', probes: report.probes.length, candidates: report.candidates.length, approved, clips: report.clips, usage: report.usage, output }));
} finally { await rm(work, { recursive: true, force: true }); }
