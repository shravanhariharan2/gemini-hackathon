import test from 'node:test';
import assert from 'node:assert/strict';
import { FinishReason, FunctionCallingConfigMode } from '@google/genai';
import { createClipAnalyzer, createClipEditor, validateEdit } from './clipEditor';
import { DEFAULT_RULES, DEFAULT_THRESHOLDS, type ClipRequest, type ClipResult } from '../shared/clipping';

const media = Buffer.from('test video bytes');
const request: ClipRequest = { stage: 'judge', resolution: 'medium', durationSec: 60, targetSeconds: 60, media: '', rules: DEFAULT_RULES, chat: [
  { name: 'A', text: 'outside', offsetSec: 2 }, { name: 'B', text: 'reaction', offsetSec: 20 },
] };
const result: ClipResult = { answers: {}, durationSec: 45, sourceOffsetSec: 15, trim: { start: 10, end: 30 }, inspection: { request: {}, response: {}, elapsedMs: 1 } };
const response = () => ({ candidates: [{ finishReason: FinishReason.STOP }], functionCalls: [{ name: 'trim_clip', args: { start: 4.25, end: 31.75, reason: 'Keep the setup through the reaction.' } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } });

test('editor sends normalized video and aligned chat, requests one tool, and redacts inspector media', async () => {
  const edited = await createClipEditor({ generate: async payload => {
    assert.equal(payload.config?.toolConfig?.functionCallingConfig?.mode, FunctionCallingConfigMode.ANY);
    assert.deepEqual(payload.config?.toolConfig?.functionCallingConfig?.allowedFunctionNames, ['trim_clip']);
    const parts = (payload.contents as any)[0].parts;
    assert.equal(parts[0].inlineData.data, media.toString('base64'));
    const context = JSON.parse(parts[1].text);
    assert.equal(context.durationSec, 45);
    assert.deepEqual(context.chat, [{ name: 'B', text: 'reaction', offsetSec: 5 }]);
    return response();
  } })(request, media, result);
  assert.equal(edited.edit.start, 4.25);
  assert.equal(edited.edit.usage?.candidatesTokenCount, 20);
  assert.equal(JSON.stringify(edited.inspection).includes(media.toString('base64')), false);
});

test('invalid bounds and extra tool arguments are rejected rather than clamped', () => {
  const good = { start: 0, end: 4, reason: 'Complete action.' };
  for (const change of [{ start: -1 }, { end: 46 }, { end: 0 }, { end: .01 }, { start: '0' }, { end: NaN }, { reason: '' }, { reason: 'x'.repeat(1001) }, { command: 'anything' }]) {
    assert.throws(() => validateEdit({ ...good, ...change }, 45));
  }
  assert.deepEqual(validateEdit({ ...good, end: .5 }, .5), { ...good, end: .5 });
});

test('blocked, incomplete, multiple or unknown tool calls cannot become edits', async () => {
  for (const change of [
    { candidates: [] }, { candidates: [{ finishReason: FinishReason.MAX_TOKENS }] },
    { promptFeedback: { blockReason: 'SAFETY' } }, { functionCalls: [] },
    { functionCalls: [...response().functionCalls, ...response().functionCalls] },
    { functionCalls: [{ name: 'run_command', args: {} }] },
  ]) {
    await assert.rejects(createClipEditor({ generate: async () => ({ ...response(), ...change } as any) })(request, media, result));
  }
});

test('missing key, upstream errors and rate limits fail without retries or credential disclosure', async () => {
  await assert.rejects(createClipEditor({ apiKey: '' })(request, media, result), { status: 503 });
  let calls = 0;
  await assert.rejects(createClipEditor({ generate: async () => { calls++; throw new Error('secret-key'); } })(request, media, result), e => {
    assert.doesNotMatch((e as Error).message, /secret-key/); return true;
  });
  assert.equal(calls, 1);
  await assert.rejects(createClipEditor({ generate: async () => { throw { status: 429 }; } })(request, media, result), { status: 429 });
});

test('pipeline edits manual and qualifying captures, skips probes and rejects, and fails closed', async () => {
  let calls = 0;
  let positive = false;
  const judge = async (): Promise<ClipResult> => ({ ...result, answers: Object.fromEntries(['worthy', 'arc', 'viral', 'hook'].map(k => [k, { type: 'noul', noul: positive ? 1 : 0, confidence: 1 }])) });
  const editor = createClipEditor({ generate: async () => { calls++; return response(); } });
  const analyze = createClipAnalyzer(judge, editor);
  const capture = { id: 'id', source: 'auto-trigger' as const, startedAt: 0, roomId: 'room', thresholds: DEFAULT_THRESHOLDS };
  const run = (r: ClipRequest) => analyze(r, media, 45, 15);
  await run({ ...request, stage: 'probe' });
  await run({ ...request, capture });
  assert.equal(calls, 0);
  for (const source of ['manual', 'voice', 'manual-flush'] as const) {
    const edited = await run({ ...request, capture: { ...capture, source } });
    assert.deepEqual(edited.trim, { start: 4.25, end: 31.75 });
    assert.ok(edited.inspection.editor);
  }
  positive = true;
  await run({ ...request, capture });
  await run({ ...request, stage: 'instant', capture });
  await run(request); // Analysis-only and offline clients also receive edited boundaries.
  assert.equal(calls, 6);
  await assert.rejects(createClipAnalyzer(judge, createClipEditor({ generate: async () => ({ ...response(), functionCalls: [] }) }))(request, media, 45, 15));
});
