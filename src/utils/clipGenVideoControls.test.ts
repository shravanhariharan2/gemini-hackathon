import test from 'node:test';
import assert from 'node:assert/strict';
import { isPlaybackAbort, videoTime } from '../components/ClipGenVideoControls';

test('video control clock formats elapsed time and handles unavailable metadata', () => {
  assert.equal(videoTime(0), '0:00');
  assert.equal(videoTime(8.9), '0:08');
  assert.equal(videoTime(125), '2:05');
  for (const value of [-1, NaN, Infinity]) assert.equal(videoTime(value), '0:00');
});

test('interrupted playback is silent but other playback errors remain reportable', () => {
  assert.equal(isPlaybackAbort(new DOMException('play interrupted by pause', 'AbortError')), true);
  assert.equal(isPlaybackAbort({ name: 'AbortError' }), true);
  for (const error of [new DOMException('not allowed', 'NotAllowedError'), new Error('decode failed'), null, undefined, 'AbortError']) {
    assert.equal(isPlaybackAbort(error), false);
  }
});
