import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeMedia, mediaAvailable } from './clipMedia';
const exec = promisify(execFile);
test('FFmpeg produces a decodable, timestamped WebM tail and an accurately trimmed download', async t => {
  if (!await mediaAvailable()) { t.skip('FFmpeg is not installed'); return; }
  const dir = await mkdtemp(path.join(tmpdir(), 'clip-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'sample.webm');
  await exec(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=20', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-c:v', 'libvpx', '-deadline', 'realtime', '-c:a', 'libopus', file]);
  const full = await normalizeMedia(await readFile(file), 3, { tail: 60 });
  assert.equal(full.sourceOffsetSec, 0);
  assert.ok(Math.abs(full.durationSec - 3) < .15);
  const remuxed = path.join(dir, 'remuxed.webm');
  await writeFile(remuxed, full.media);
  await exec(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-i', remuxed, '-f', 'null', '-']);
  const fullCut = await normalizeMedia(full.media, full.durationSec, { start: .5, end: 1.5 });
  assert.ok(Math.abs(fullCut.durationSec - 1) < .15);
  const normalized = await normalizeMedia(await readFile(file), 3, { tail: 2 });
  assert.equal(normalized.media.readUInt32BE(0), 0x1a45dfa3); assert.equal(normalized.sourceOffsetSec, 1);
  assert.ok(Math.abs(normalized.durationSec - 2) < .15);
  const cut = await normalizeMedia(normalized.media, normalized.durationSec, { start: .5, end: 1.5 });
  assert.ok(Math.abs(cut.durationSec - 1) < .15);
  await assert.rejects(normalizeMedia(Buffer.from('broken'), 3, { tail: 2 }), /decode/);
});
