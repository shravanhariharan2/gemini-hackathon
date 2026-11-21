import * as THREE from "three";

const FOV = 42;
const TANGENT = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const FOCUS = 3.4;
const OVERSCAN = 1.12;
const clamp = (n, limit = 1) => Math.max(-limit, Math.min(limit, n));

export function dragView(start, dx, dy, width, height) {
  return {
    x: clamp(start.x - (2 * dx) / Math.max(1, width)),
    y: clamp(start.y + (2 * dy) / Math.max(1, height)),
  };
}

export function tiltView(beta, gamma, origin, screenAngle = 0) {
  if (![beta, gamma, origin?.beta, origin?.gamma].every(Number.isFinite))
    return { x: 0, y: 0 };
  const angle = THREE.MathUtils.degToRad(screenAngle);
  const x = gamma - origin.gamma;
  const y = beta - origin.beta;
  return {
    x: clamp((x * Math.cos(angle) + y * Math.sin(angle)) / 22),
    y: clamp((y * Math.cos(angle) - x * Math.sin(angle)) / 22),
  };
}

// Same ray reconstruction as the vertex shader. Relative depth, not metres.
export function surfacePoint(u, v, near, aspect, strength = 0.75) {
  const z = THREE.MathUtils.lerp(FOCUS, 4.4 - 2 * near, strength);
  return new THREE.Vector3(
    (u - 0.5) * 2 * z * TANGENT * aspect * OVERSCAN,
    (v - 0.5) * 2 * z * TANGENT * OVERSCAN,
    -z,
  );
}

export function createDepthSurface(video) {
  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.repeat.set(0.5, 1);
  const uniforms = {
    packedFrame: { value: texture },
    frameAspect: { value: video.videoWidth / 2 / video.videoHeight || 16 / 9 },
    depthStrength: { value: 0.75 },
  };
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `uniform sampler2D packedFrame;
      uniform float frameAspect;
      uniform float depthStrength;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `// The right half is grayscale depth: white is near. The left is RGB.
      float nearValue = texture2D(packedFrame, vec2(0.5 + uv.x * 0.5, uv.y)).r;
      float rayDepth = mix(${FOCUS.toFixed(1)}, 4.4 - 2.0 * nearValue, depthStrength);
      vec3 transformed = vec3((uv - 0.5) * 2.0 * rayDepth * ${TANGENT.toFixed(9)} * ${OVERSCAN.toFixed(2)}, -rayDepth);
      transformed.x *= frameAspect;`,
    );
  };
  const geometry = new THREE.PlaneGeometry(1, 1, 192, 108);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; // Displacement happens on the GPU, not in the bounds.
  return {
    mesh,
    uniforms,
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

export class LookAroundPlayer {
  constructor(video, canvas, stage, onInteraction, onError) {
    this.video = video;
    this.canvas = canvas;
    this.stage = stage;
    this.onInteraction = onInteraction;
    this.onError = onError;
    this.active = false;
    this.ready = false;
    this.auto = false;
    this.target = { x: 0, y: 0 };
    this.view = { x: 0, y: 0 };
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x101820);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 20);
    this.surface = createDepthSurface(video);
    this.scene.add(this.surface.mesh);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(stage);
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.active = false;
      this.onError();
    });
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      canvas.setPointerCapture(event.pointerId);
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, view: { ...this.view } };
      this.auto = false;
      this.target = { ...this.view };
      this.onInteraction();
    });
    canvas.addEventListener("pointermove", (event) => {
      if (this.drag?.id !== event.pointerId) return;
      this.target = dragView(this.drag.view, event.clientX - this.drag.x, event.clientY - this.drag.y, canvas.clientWidth, canvas.clientHeight);
    });
    const release = () => { this.drag = null; };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("keydown", (event) => {
      const moves = { ArrowLeft: [-0.2, 0], ArrowRight: [0.2, 0], ArrowUp: [0, 0.2], ArrowDown: [0, -0.2] };
      if (!moves[event.key]) return;
      event.preventDefault();
      this.auto = false;
      this.target = { x: clamp(this.target.x + moves[event.key][0]), y: clamp(this.target.y + moves[event.key][1]) };
      this.onInteraction();
    });
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  resize() {
    if (!this.active) return;
    const aspect = this.video.videoWidth / 2 / this.video.videoHeight || 16 / 9;
    const width = Math.min(this.stage.clientWidth, this.stage.clientHeight * aspect);
    const height = width / aspect;
    this.renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.surface.uniforms.frameAspect.value = aspect;
  }

  setActive(active) {
    this.active = active;
    this.resize();
  }

  reset() {
    this.target = { x: 0, y: 0 };
    this.view = { x: 0, y: 0 };
    this.auto = false;
  }

  clear() {
    this.ready = false;
    this.reset();
    this.renderer.clear();
  }

  frame(time) {
    if (!this.active || !this.ready || document.hidden || this.video.readyState < 2 || this.video.seeking) return;
    if (this.auto) this.target = { x: Math.sin(time / 1900) * 0.85, y: Math.cos(time / 2700) * 0.22 };
    this.view.x += (this.target.x - this.view.x) * 0.1;
    this.view.y += (this.target.y - this.view.y) * 0.1;
    this.camera.position.set(this.view.x * 0.55, this.view.y * 0.35, 0);
    this.camera.lookAt(0, 0, -FOCUS);
    try {
      this.renderer.render(this.scene, this.camera);
    } catch {
      this.active = false;
      this.onError();
    }
  }
}
