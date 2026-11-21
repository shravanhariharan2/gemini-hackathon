import * as THREE from "three";
import { eyeAspect } from "./media.js";

// Both textures use ONE video element: frames, seeking and sound stay in sync.
export function createStereoScreen(video) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const group = new THREE.Group();
  const textures = [0, 0.5].map((offset) => {
    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.repeat.set(0.5, 1);
    texture.offset.set(offset, 0);
    return texture;
  });
  textures.forEach((map, index) => {
    const material = new THREE.MeshBasicMaterial({
      map,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    // Three's WebXRManager enables layer 1 for left and 2 for right.
    mesh.layers.set(index + 1);
    group.add(mesh);
  });
  group.position.z = -3.2;
  const resize = () => {
    const aspect = eyeAspect(video.videoWidth, video.videoHeight);
    const width = Math.min(3.6, 2.4 * aspect);
    group.scale.set(width, width / aspect, 1);
  };
  resize();
  return {
    group,
    resize,
    dispose() {
      for (const mesh of group.children) mesh.material.dispose();
      for (const texture of textures) texture.dispose();
      geometry.dispose();
    },
  };
}

export function placeScreenInFront(screen, camera) {
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  camera.getWorldPosition(position);
  camera.getWorldQuaternion(rotation);
  screen.position.copy(
    new THREE.Vector3(0, 0, -3.2).applyQuaternion(rotation).add(position),
  );
  screen.quaternion.copy(rotation);
}
