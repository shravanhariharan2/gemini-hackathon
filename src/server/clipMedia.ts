import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ClipError, MAX_MEDIA_BYTES } from './clipDecisions';
const exec = promisify(execFile);
export async function mediaAvailable() {
  try { await Promise.all([exec(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { timeout: 3000 }), exec(process.env.FFPROBE_PATH || 'ffprobe', ['-version'], { timeout: 3000 })]); return true; } catch { return false; }
}
/** Remux whole recordings; decode and re-encode cuts for accurate boundaries. */
export async function normalizeMedia(bytes: Buffer, duration: number, window: { tail?: number; start?: number; end?: number }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'clipthat-'));
  try {
    const input = path.join(dir, 'input.webm');
    const output = path.join(dir, 'clip.webm');
    await writeFile(input, bytes);
    // MediaRecorder WebM often has no duration. FFmpeg decodes the complete header-bearing
    // recording; wall-clock timestamps bound the requested window until the output is probed.
    const start = window.tail !== undefined ? Math.max(0, duration - window.tail) : window.start || 0;
    const length = Math.min(60, (window.end ?? duration) - start);
    if (length <= 0) throw new ClipError('The selected clip is empty.');
    // A complete MediaRecorder window already has VP8/VP9 + Opus. Rewriting the
    // container makes it seekable without encoding a minute of live video again.
    // Actual cuts still re-encode so their boundaries do not depend on keyframes.
    const wholeRecording = window.tail !== undefined && window.tail >= duration && duration <= 60;
    await exec(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-i', input,
      '-ss', String(start), '-t', String(length), '-map', '0:v:0', '-map', '0:a:0?',
      ...(wholeRecording ? ['-c', 'copy'] : [
      '-vf', 'scale=960:540:force_original_aspect_ratio=decrease:force_divisible_by=2',
      '-r', '20', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1000k',
      '-c:a', 'libopus', '-b:a', '64k', '-threads', '2']), '-y', output,
    ], { timeout: 45_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
    const media = await readFile(output);
    if (media.length > MAX_MEDIA_BYTES) throw new ClipError('Encoded clip exceeds 16 MB.');
    const { stdout } = await exec(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', output], { timeout: 5000 });
    const actual = Number(JSON.parse(stdout).format?.duration);
    if (!Number.isFinite(actual) || actual < .1 || actual > 61) throw new ClipError('Recording contained no usable video.');
    return { media, durationSec: actual, sourceOffsetSec: start };
  } catch (error) {
    if (error instanceof ClipError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ClipError('Install ffmpeg and ffprobe locally to prepare playable clips.', 503);
    throw new ClipError('Could not decode this recording. Restart the buffer and try again.', 422);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
