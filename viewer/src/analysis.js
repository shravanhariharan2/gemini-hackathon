// A signal check, not a depth/comfort certificate. Constant translations and
// unrelated images must not be reported as verified depth.
export function analyzeStereo(left, right, width, height) {
  if (left.length !== right.length || left.length !== width * height * 4) {
    throw new Error('Stereo frame dimensions do not match.');
  }
  const gray = (data) => Float32Array.from({ length: width * height }, (_, i) =>
    (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114));
  const a = gray(left), b = gray(right);
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  const difference = total / a.length;
  if (difference < 0.65) return { kind: 'identical', difference, message: 'The eyes are nearly identical in this frame. No stereo signal detected; try another moment.' };
  const matches = [];
  const score = (x, y, dx, dy) => {
    let sum = 0;
    for (let yy = -2; yy <= 2; yy++) for (let xx = -2; xx <= 2; xx++) {
      sum += Math.abs(a[(y + yy) * width + x + xx] - b[(y + yy + dy) * width + x + xx + dx]);
    }
    return sum / 25;
  };
  let textured = 0;
  for (let y = 6; y < height - 6; y += 6) for (let x = 12; x < width - 12; x += 6) {
    let min = 255, max = 0;
    for (let yy = -2; yy <= 2; yy++) for (let xx = -2; xx <= 2; xx++) {
      const value = a[(y + yy) * width + x + xx];
      min = Math.min(min, value); max = Math.max(max, value);
    }
    if (max - min < 25) continue;
    textured++;
    const zero = score(x, y, 0, 0);
    let best = { score: zero, dx: 0, dy: 0 };
    for (let dy = -2; dy <= 2; dy++) for (let dx = -8; dx <= 8; dx++) {
      const value = score(x, y, dx, dy);
      if (value < best.score) best = { score: value, dx, dy };
    }
    if (best.score < 18 && zero - best.score > 4 && best.dx !== 0 && best.dy === 0) matches.push(best.dx);
  }
  const sorted = [...matches].sort((x, y) => x - y);
  const spread = sorted.length ? sorted[Math.floor(sorted.length * 0.8)] - sorted[Math.floor(sorted.length * 0.2)] : 0;
  if (matches.length >= 5 && matches.length >= textured * 0.15 && spread >= 2) {
    return { kind: 'disparity', difference, matches: matches.length, message: 'Varying horizontal disparity detected: this frame has a stereo signal. This does not verify depth accuracy, eye order, or viewing comfort.' };
  }
  return { kind: 'inconclusive', difference, matches: matches.length, message: 'The eyes differ, but varying depth is unconfirmed. A flat shift, low texture, motion, or artifacts can cause this; inspect wiggle mode or check another frame.' };
}

export function combineAnaglyph(left, right, output) {
  for (let i = 0; i < output.length; i += 4) {
    // Left eye through red; right eye through cyan. A grayscale mix limits
    // disappearing saturated objects in this inspection (not mastering) mode.
    output[i] = left[i] * 0.299 + left[i + 1] * 0.587 + left[i + 2] * 0.114;
    const cyan = right[i] * 0.299 + right[i + 1] * 0.587 + right[i + 2] * 0.114;
    output[i + 1] = cyan; output[i + 2] = cyan; output[i + 3] = 255;
  }
}
