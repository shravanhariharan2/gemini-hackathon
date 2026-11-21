import test from 'node:test';
import assert from 'node:assert/strict';
import { clipPickerText } from '../components/ClipGenMyClips';

const brief = { title: '', description: '', summary: '', intent: '', relevant: true, beats: [], model: 'test' };

test('clip picker prefers trimmed saved titles and descriptions', () => {
  assert.deepEqual(clipPickerText({ title: ' Dance ', description: ' Two dancers. ', answers: {} }), { title: 'Dance', description: 'Two dancers.' });
});

test('clip picker matches older clip fallbacks and preserves long descriptions for accessible full text', () => {
  assert.deepEqual(clipPickerText({ title: ' ', description: '', answers: {} }), { title: 'Highlight', description: 'No description is available for this older clip.' });
  const description = 'A long description. '.repeat(50);
  assert.deepEqual(clipPickerText({ brief: { ...brief, title: 'Brief title', description, summary: 'Summary' }, answers: {} }), { title: 'Brief title', description: description.trim() });
  assert.deepEqual(clipPickerText({ brief: { ...brief, summary: 'Legacy summary' }, answers: { category: { type: 'choice', choice: 'Dance', probabilities: {}, confidence: 1 } } }), { title: 'Dance', description: 'Legacy summary' });
});
