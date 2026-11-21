import test from 'node:test';
import assert from 'node:assert/strict';
import { StereoPreview } from '../preview.js';

test('ordinary saved clips draw the full frame while stereo clips draw one eye', () => {
  for (const [layout, width] of [['mono', 361], ['sbs', 180.5]]) {
    const calls = [];
    const preview = Object.assign(Object.create(StereoPreview.prototype), {
      layout, mode: 'left', video: { videoWidth: 361, videoHeight: 640, currentTime: 0, currentSrc: 'saved' },
      canvas: {}, scratch: {}, context: { drawImage: (...args) => calls.push(args) },
    });
    preview.draw(0);
    assert.equal(calls[0][3], width);
    assert.equal(preview.canvas.width, width);
    assert.equal(preview.canvas.height, 640);
    preview.draw(1);
    assert.equal(calls.length, 1);
  }
});
