import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createDepthSurface, dragView, tiltView, surfacePoint } from "../src/lookaround.js";

test("depth reconstruction preserves front-view alignment but gives near/far surfaces different camera parallax", () => {
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 20);
  camera.updateMatrixWorld();
  const near = surfacePoint(0.65, 0.4, 1, 16 / 9);
  const far = surfacePoint(0.65, 0.4, 0, 16 / 9);
  assert.ok(near.z > far.z, "white must be closer than black");
  assert.ok(Math.abs(near.clone().project(camera).x - far.clone().project(camera).x) < 1e-10);
  assert.ok(Math.abs(near.clone().project(camera).y - far.clone().project(camera).y) < 1e-10);
  camera.position.x = 0.5;
  camera.updateMatrixWorld();
  const nearShift = near.clone().project(camera).x;
  const farShift = far.clone().project(camera).x;
  assert.ok(Math.abs(nearShift - farShift) > 0.05, "viewpoint shift must cause depth-dependent, not uniform, movement");
  assert.equal(surfacePoint(0.65, 0.4, 1, 16 / 9, 0).z, surfacePoint(0.65, 0.4, 0, 16 / 9, 0).z);
});

test("RGB and depth sample opposite halves of one video without a second playback clock", () => {
  const video = { videoWidth: 1920, videoHeight: 540 };
  const surface = createDepthSurface(video);
  const map = surface.mesh.material.map;
  assert.equal(map.image, video);
  assert.equal(surface.uniforms.packedFrame.value, map);
  assert.equal(map.repeat.x, 0.5);
  assert.equal(map.offset.x, 0);
  const shader = { uniforms: {}, vertexShader: "#include <begin_vertex>" };
  surface.mesh.material.onBeforeCompile(shader);
  assert.match(shader.vertexShader, /texture2D\(packedFrame, vec2\(0.5 \+ uv.x \* 0.5, uv.y\)\)/);
  assert.equal(surface.uniforms.frameAspect.value, 16 / 9);
  assert.ok(surface.mesh.geometry.attributes.position.count > 20000);
  surface.dispose();
});

test("drag remains relative to its start and clamps extreme movements", () => {
  assert.deepEqual(dragView({ x: 0.2, y: -0.1 }, 100, 50, 1000, 500), { x: 0, y: 0.1 });
  assert.deepEqual(dragView({ x: 0, y: 0 }, -2000, -2000, 1000, 500), { x: 1, y: -1 });
  assert.deepEqual(dragView({ x: 0, y: 0 }, 0, 0, 0, 0), { x: 0, y: 0 });
});

test("phone tilt uses a neutral baseline, handles landscape and ignores absent sensor values", () => {
  assert.deepEqual(tiltView(60, 10, { beta: 60, gamma: 10 }), { x: 0, y: 0 });
  assert.deepEqual(tiltView(71, 21, { beta: 60, gamma: 10 }), { x: 0.5, y: 0.5 });
  const landscape = tiltView(82, 10, { beta: 60, gamma: 10 }, 90);
  assert.ok(Math.abs(landscape.x - 1) < 1e-10);
  assert.ok(Math.abs(landscape.y) < 1e-10);
  assert.deepEqual(tiltView(200, -90, { beta: 60, gamma: 10 }), { x: -1, y: 1 });
  assert.deepEqual(tiltView(null, null, { beta: 60, gamma: 10 }), { x: 0, y: 0 });
});
