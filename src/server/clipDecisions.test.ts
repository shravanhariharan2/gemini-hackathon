import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Decisions } from '@google/genai';
import { buildQuestions, createDecisionJudge, parseClipRequest, validateAnswers } from './clipDecisions';
import { createClipRouter } from './clipRoutes';
import { DEFAULT_RULES, DEFAULT_THRESHOLDS, qualifies, trimBounds, type ClipRequest } from '../shared/clipping';
const media = Buffer.concat([Buffer.from('1a45dfa3', 'hex'), Buffer.alloc(20)]);
const request: ClipRequest = { stage: 'judge', resolution: 'medium', durationSec: 60, targetSeconds: 60, media: media.toString('base64'), chat: [], rules: DEFAULT_RULES };
// Contract fixtures live only in tests. No fallback scores exist in the application.
function responseFor(questions: Record<string, Decisions.Question>): Decisions.CreateDecisionResponse {
  return { usage: { total_input_tokens: 123, total_output_tokens: 0 }, answers: Object.fromEntries(Object.entries(questions).map(([key, q]) => {
    if (q.type === 'noul') return [key, { type: 'noul', noul: .8, confidence: .8 }];
    const keys = q.type === 'choice' ? Object.keys(q.criteria) : q.criteria.map((_, i) => String(i));
    const probabilities = Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 1 : 0]));
    return [key, q.type === 'choice' ? { type: 'choice', choice: keys[0], confidence: 1, probabilities } : { type: 'score', score: 0, confidence: 1, probabilities, legend: Object.fromEntries(q.criteria.map((v, i) => [i, v])) }];
  })) as Decisions.CreateDecisionResponse['answers'] };
}
test('clip validation rejects broken headers, oversized windows, malformed chat and rules', () => {
  assert.deepEqual(parseClipRequest(request), request);
  assert.equal(parseClipRequest({ ...request, stage: 'probe', resolution: 'high' }).resolution, 'low');
  for (const change of [{ media: 'AAAA' }, { durationSec: 0 }, { durationSec: 80 }, { durationSec: NaN }, { targetSeconds: 90 }, { rules: { ...DEFAULT_RULES, trigger: '' } }, { chat: [{ name: 'A', text: 'hello', offsetSec: 61 }] }, { stage: 'made-up' }]) assert.throws(() => parseClipRequest({ ...request, ...change }));
});
test('one typed Decisions call shares video and aligned chat, preserves scores and redacts inspector media', async () => {
  let calls = 0;
  const judge = createDecisionJudge(async payload => {
    calls++;
    assert.equal(payload.model, 'gemini-decision-1');
    assert.ok(Array.isArray(payload.input));
    const [video, context] = payload.input as Decisions.DecisionInputContent[];
    assert.equal(video.type, 'video');
    if (video.type === 'video') { assert.equal(video.resolution, 'medium'); assert.equal(video.data, media.toString('base64')); }
    assert.equal(context.type, 'text');
    if (context.type === 'text') { assert.match(context.text!, /"offsetSec":5/); assert.doesNotMatch(context.text!, /outside/); }
    assert.equal(payload.questions.hook.type, 'score');
    assert.equal('safety' in payload.questions, false);
    return responseFor(payload.questions);
  });
  const result = await judge({ ...request, chat: [{ name: 'A', text: 'outside', offsetSec: 1 }, { name: 'A', text: 'reaction', offsetSec: 20 }] }, media, 45, 15);
  assert.equal(calls, 1);
  assert.equal(result.usage?.total_output_tokens, 0);
  assert.equal(result.answers.worthy.type === 'noul' && result.answers.worthy.noul, .8);
  assert.equal(result.media, media.toString('base64'));
  assert.doesNotMatch(JSON.stringify(result.inspection.request), new RegExp(media.toString('base64')));
});
test('blocked, missing, nonzero-token, malformed and unnormalized results never become clips', () => {
  const questions = buildQuestions('judge');
  const valid = responseFor(questions);
  for (const change of [{ usage: undefined }, { usage: { total_output_tokens: 1 } }, { answers: {} }, { answers: { ...valid.answers, worthy: { type: 'noul', noul: NaN, confidence: .8 } } }, { answers: { ...valid.answers, category: { type: 'choice', choice: 'made-up', probabilities: {}, confidence: 1 } } }]) assert.throws(() => validateAnswers({ ...valid, ...change } as Decisions.CreateDecisionResponse, questions));
  assert.throws(() => validateAnswers({ ...valid, prompt_feedback: { block_reason: 'SAFETY' } } as any, questions));
});
test('thresholds reclassify locally, missing scores fail closed, and trim stays inside warm-up recordings', () => {
  const answers = responseFor(buildQuestions('judge')).answers!;
  assert.equal(qualifies(answers, DEFAULT_THRESHOLDS), false);
  assert.equal(qualifies(answers, { ...DEFAULT_THRESHOLDS, viral: 0, hook: 0 }), true);
  // Historical answers must not retain a removed approval gate.
  assert.equal(qualifies({ ...answers, safety: { type: 'noul', noul: .01, confidence: .99 } }, { ...DEFAULT_THRESHOLDS, viral: 0, hook: 0 }), true);
  assert.equal(qualifies({}, { trigger: 0, worthy: 0, arc: 0, viral: 0, hook: 0 }), false);
  const bounds = trimBounds({ ...answers, peak_position: { type: 'choice', choice: 'p95', confidence: 1, probabilities: { p95: 1 } }, best_clip_duration: { type: 'choice', choice: 's60', confidence: 1, probabilities: { s60: 1 } } }, 8);
  assert.deepEqual(bounds, { start: 0, end: 8 });
});
test('upstream errors expose no credentials and are not retried', async () => {
  let calls = 0;
  await assert.rejects(createDecisionJudge(async () => { calls++; throw new Error('secret key'); })(request, media, 60, 0), error => { assert.doesNotMatch((error as Error).message, /secret key/); return true; });
  assert.equal(calls, 1);
});
test('clip routes validate input, block cross-origin requests, and cap concurrent expensive work', async t => {
  const app = express(); let calls = 0; const resolvers: (() => void)[] = [];
  app.use('/api/clips', createClipRouter(async r => { calls++; await new Promise<void>(resolve => resolvers.push(resolve)); return { answers: {}, durationSec: 60, sourceOffsetSec: 0, trim: { start: 0, end: 60 }, inspection: { request: r.stage, response: {}, elapsedMs: 1 } }; }, async () => ({ media, durationSec: 60, sourceOffsetSec: 0 })));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/clips/analyze`;
  const post = (body: unknown, origin?: string) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  assert.equal((await post({})).status, 400); assert.equal(calls, 0);
  assert.equal((await post(request, 'https://different.example')).status, 403);
  const first = post(request); const second = post(request);
  while (calls < 2) await new Promise(r => setTimeout(r, 5));
  assert.equal((await post(request)).status, 429);
  resolvers.forEach(r => r());
  for (const result of await Promise.all([first, second])) { assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store'); }
});
