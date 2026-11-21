import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { analyzeStereo, combineAnaglyph } from '../src/analysis.js';
import { eyeAspect, formatTime, mediaErrorMessage, resolveMediaUrl } from '../src/media.js';
import { createStereoScreen, placeScreenInFront } from '../src/stereo.js';

test('URLs support platform-relative media and reject executable URLs, credentials and mixed content', () => {
  assert.equal(resolveMediaUrl('/clips/a.mp4', 'https://example.com/viewer/'), 'https://example.com/clips/a.mp4');
  assert.equal(resolveMediaUrl('https://cdn.example/a.mp4?token=123&x=2', 'https://example.com'), 'https://cdn.example/a.mp4?token=123&x=2');
  for (const url of ['javascript:alert(1)', 'data:video/mp4;base64,AA', 'file:///tmp/video.mp4', 'blob:https://example.com/1', 'https://user:password@example.com/a.mp4', 'http://cdn.example/a.mp4', '']) {
    assert.throws(() => resolveMediaUrl(url, 'https://example.com'));
  }
  assert.equal(resolveMediaUrl('http://localhost:8000/clip.mp4', 'http://localhost:4173'), 'http://localhost:8000/clip.mp4');
});

test('full-width SBS renders at single-eye aspect, not double-wide', () => {
  assert.equal(eyeAspect(3840, 1080), 16 / 9);
  assert.equal(eyeAspect(2160, 1920), 9 / 16);
  assert.equal(eyeAspect(0, 0), 16 / 9);
  assert.equal(formatTime(125.9), '2:05');
  assert.equal(formatTime(Infinity), '0:00');
  assert.match(mediaErrorMessage({ code: 4 }), /CORS/);
});

test('VR textures select correct source halves with exclusive left/right camera layers', () => {
  const video = { videoWidth: 3840, videoHeight: 1080 };
  const screen = createStereoScreen(video);
  const [left, right] = screen.group.children;
  assert.equal(left.material.map.image, video);
  assert.equal(right.material.map.image, video);
  assert.equal(left.layers.mask, 1 << 1);
  assert.equal(right.layers.mask, 1 << 2);
  assert.equal(left.material.map.repeat.x, 0.5);
  assert.equal(right.material.map.repeat.x, 0.5);
  assert.equal(left.material.map.offset.x, 0);
  assert.equal(right.material.map.offset.x, 0.5);
  assert.ok(Math.abs(screen.group.scale.x / screen.group.scale.y - 16 / 9) < 1e-12);
  // A transformed UV at the middle of each plane must hit its own source eye.
  left.material.map.updateMatrix();
  right.material.map.updateMatrix();
  const uvLeft = left.material.map.transformUv(new THREE.Vector2(0.5, 0.5));
  const uvRight = right.material.map.transformUv(new THREE.Vector2(0.5, 0.5));
  assert.equal(uvLeft.x, 0.25);
  assert.equal(uvRight.x, 0.75);
  screen.dispose();
});

test('recenter places the screen in front of a turned and translated headset', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(2, 1, 5);
  camera.rotation.y = Math.PI / 2;
  camera.updateMatrixWorld();
  const screen = new THREE.Group();
  placeScreenInFront(screen, camera);
  assert.ok(Math.abs(screen.position.x - -1.2) < 1e-8);
  assert.ok(Math.abs(screen.position.y - 1) < 1e-8);
  assert.ok(Math.abs(screen.position.z - 5) < 1e-8);
});

function makeFrame(width, height, seed = 1) {
  let state = seed;
  return Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => {
    if (i % 4 === 3) return 255;
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    return (state >>> 16) & 255;
  });
}

function shiftedFrame(left, width, height, offset) {
  const right = new Uint8ClampedArray(left.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const xx = x + offset(y);
    if (xx >= 0 && xx < width) right.set(left.subarray((y * width + x) * 4, (y * width + x + 1) * 4), (y * width + xx) * 4);
  }
  return right;
}

test('stereo check rejects duplicate eyes and does not certify a uniform image translation', () => {
  const width = 160, height = 90;
  const left = makeFrame(width, height);
  assert.equal(analyzeStereo(left, left, width, height).kind, 'identical');
  const uniform = shiftedFrame(left, width, height, () => 4);
  assert.equal(analyzeStereo(left, uniform, width, height).kind, 'inconclusive');
});

test('stereo check detects varying horizontal disparity, without declaring accurate depth', () => {
  const width = 160, height = 90;
  const left = makeFrame(width, height);
  const right = shiftedFrame(left, width, height, (y) => y < height / 2 ? 2 : 6);
  const result = analyzeStereo(left, right, width, height);
  assert.equal(result.kind, 'disparity');
  assert.match(result.message, /does not verify depth accuracy/);
});

test('stereo check does not mistake unrelated noisy eyes for depth', () => {
  assert.equal(analyzeStereo(makeFrame(160, 90, 5), makeFrame(160, 90, 9), 160, 90).kind, 'inconclusive');
  assert.throws(() => analyzeStereo(new Uint8Array(4), new Uint8Array(8), 1, 1));
});

test('anaglyph routes left luminance to red and right luminance to cyan, with opaque output', () => {
  const left = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
  const right = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
  const output = new Uint8ClampedArray(8);
  combineAnaglyph(left, right, output);
  assert.deepEqual([...output], [255, 0, 0, 255, 0, 255, 255, 255]);
  combineAnaglyph(left, right, left);
  assert.deepEqual(left, output);
});
