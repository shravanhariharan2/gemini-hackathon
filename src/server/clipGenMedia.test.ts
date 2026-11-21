import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prepareClip, validateImage } from './clipGen';
import { getFfmpegPath, getFfprobePath } from './clipMedia';

test('Clip Gen prepares sample without system tools and rejects empty or invalid media', async t => {
  await mkdir('.data', { recursive: true });
  const dir = await mkdtemp(path.resolve('.data/clip-gen-tools-'));
  const previous = { PATH: process.env.PATH, FFMPEG_PATH: process.env.FFMPEG_PATH, FFPROBE_PATH: process.env.FFPROBE_PATH };
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });
  process.env.PATH = '/nonexistent';
  delete process.env.FFMPEG_PATH; delete process.env.FFPROBE_PATH;
  assert.ok(path.isAbsolute(getFfmpegPath()));
  assert.ok(path.isAbsolute(getFfprobePath()));
  const result = await prepareClip('public/dancers.mp4', path.join(dir, 'out.mp4'));
  assert.ok(result.duration >= 3 && result.duration <= 10);
  assert.equal(result.aspect_ratio, '9:16');
  for (const [name, bytes] of [['empty', ''], ['invalid', 'not media']] as const) {
    const input = path.join(dir, name); await writeFile(input, bytes);
    await assert.rejects(prepareClip(input, path.join(dir, 'bad.mp4')), /Could not read media metadata/);
    await assert.rejects(validateImage(input), /Could not read media metadata/);
  }
  process.env.FFPROBE_PATH = path.join(dir, 'missing-ffprobe');
  assert.equal(getFfprobePath(), process.env.FFPROBE_PATH);
  await assert.rejects(prepareClip('public/dancers.mp4', path.join(dir, 'bad.mp4')), /Media tools unavailable/);
  process.env.FFMPEG_PATH = '/custom/ffmpeg';
  assert.equal(getFfmpegPath(), '/custom/ffmpeg');
});
