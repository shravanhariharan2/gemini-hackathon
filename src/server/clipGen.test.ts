import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { buildPrompt, createClipGenClient, describePerson, jobError, validateUpload } from './clipGen';
import { createClipGenRouter } from './clipGenRoutes';

test('Clip Gen uses v1beta for both Files and Interactions requests', async (t) => {
  const key = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'offline-test-key';
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    urls.push(input instanceof Request ? input.url : String(input));
    return new Response(JSON.stringify({ error: { code: 400, message: 'offline test' } }), { status: 400, headers: { 'content-type': 'application/json' } });
  });
  try {
    const client = createClipGenClient();
    await assert.rejects(client.files.get({ name: 'files/test' }));
    await assert.rejects(client.interactions.create({ model: 'gemini-omni-1.2-flash', input: 'test', store: false }));
    assert.deepEqual(urls.map(url => new URL(url).pathname), ['/v1beta/files/test', '/v1beta/interactions']);
  } finally {
    if (key === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = key;
    t.mock.restoreAll();
  }
});

test('maps safety errors including nested details and preserves other failures', () => {
  for (const error of [new Error('CONTENT_BLOCKED'), { details: { error: { message: 'responsible AI' } } }, new Error('Gemini returned no video; the request may have been filtered')]) assert.equal(jobError(error).error_code, 'content_blocked');
  assert.deepEqual(jobError(new Error('network unavailable')), { error: 'network unavailable' });
});
test('prompt preserves original scene and names only the selected target', () => {
  const prompt = buildPrompt('the dancer on the left');
  assert.ok(prompt.startsWith('Edit the supplied video. Replace ONLY the dancer on the left with the person in the reference images'));
  for (const text of ['Replace the ENTIRE person, not just their face or head', 'gender presentation, full body shape and build, chest', "clothing must follow the reference person", "Match the reference person's skin tone and complexion across ALL visible skin", 'face, neck, chest, torso, arms, hands and legs', "Do not carry over the original target's skin tone", 'ONLY a locator', 'Keep the original motion, pose and body choreography']) assert.ok(prompt.includes(text), text);
  assert.ok(!prompt.includes('Keep the target clothing'));
  assert.ok(prompt.includes('wrists, fingers, ankles, feet and toes'));
  assert.ok(prompt.includes('no original skin patches or original limbs may remain'));
  assert.ok(prompt.includes('full-length bottoms and closed shoes appropriate to that outfit'));
  assert.ok(prompt.endsWith('Do not add people or cuts.'));
});
test('upload validation covers normal, empty, oversized and unsupported input', () => {
  assert.doesNotThrow(() => validateUpload(10, 'video/mp4', 10, ['video/mp4']));
  for (const [size, type] of [[0, 'video/mp4'], [11, 'video/mp4'], [1, 'text/html']] as const) assert.throws(() => validateUpload(size, type, 10, ['video/mp4']));
});
test('description falls back on missing client and empty model response', async () => {
  assert.equal(await describePerson('missing', .25, .5, () => { throw new Error('offline'); }), 'the person at about 25% from the left and 50% from the top of the frame');
});
test('isolated routes validate uploads and run background jobs with stubbed media and Gemini', async () => {
  await mkdir('.data', { recursive: true });
  const root = await mkdtemp(path.resolve('.data/clip-gen-test-'));
  const app = express();
  app.use('/api/clip-gen', createClipGenRouter({ prepareClip: async () => ({ duration: 8, aspect_ratio: '16:9' }), validateImage: async () => {}, describePerson: async () => 'left dancer', client: () => ({} as never), swapCharacter: async () => ({ seconds: 1 }) }, root));
  const server = app.listen(0); await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/clip-gen`;
  try {
    assert.equal((await fetch(`${base}/swaps/missing`)).status, 404);
    assert.equal((await fetch(`${base}/clips`, { method: 'POST', body: new FormData() })).status, 422);
    const upload = new FormData(); upload.append('video', new Blob(['video'], { type: 'video/mp4' }), 'test.mp4');
    const response = await fetch(`${base}/clips`, { method: 'POST', body: upload }); assert.equal(response.status, 200);
    const clip = await response.json(); assert.equal(clip.duration, 8);
    const bad = new FormData(); bad.append('clip_id', clip.clip_id); bad.append('target', ' ');
    assert.equal((await fetch(`${base}/swaps`, { method: 'POST', body: bad })).status, 422);
    const form = new FormData(); form.append('clip_id', clip.clip_id); form.append('target', 'left dancer'); form.append('photo', new Blob(['photo'], { type: 'image/jpeg' }), 'face.jpg');
    const { job_id } = await (await fetch(`${base}/swaps`, { method: 'POST', body: form })).json();
    const job = await (await fetch(`${base}/swaps/${job_id}`)).json(); assert.equal(job.status, 'done'); assert.equal(job.seconds, 1);
  } finally { await new Promise<void>(r => server.close(() => r())); await rm(root, { recursive: true, force: true }); }
});
