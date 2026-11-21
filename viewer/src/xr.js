import * as THREE from "three";
import { createStereoScreen, placeScreenInFront } from "./stereo.js";

export class ImmersivePlayer {
  constructor(video, overlay, onEnd) {
    this.video = video;
    this.overlay = overlay;
    this.onEnd = onEnd;
    this.session = null;
  }

  async enter(mode) {
    if (this.session || this.entering) return;
    this.entering = true;
    // Make the permission request inside the click activation, before awaiting.
    let session;
    try {
      const request = navigator.xr.requestSession(mode, {
        optionalFeatures: ["dom-overlay"],
        domOverlay: { root: this.overlay },
      });
      // Start the same video from the user gesture, including its audio.
      this.video.play().catch(() => {});
      session = await request;
      this.session = session;
      session.addEventListener("end", () => this.cleanup(), { once: true });
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.xr.enabled = true;
      // A local reference works for both seated VR and handheld AR.
      this.renderer.xr.setReferenceSpaceType("local");
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setClearColor(0x000000, mode === "immersive-ar" ? 0 : 1);
      this.renderer.domElement.className = "xr-canvas";
      document.body.append(this.renderer.domElement);
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.01,
        100,
      );
      this.camera.layers.enable(1);
      this.screen = createStereoScreen(this.video);
      this.scene.add(this.screen.group);
      for (let index = 0; index < 2; index++) {
        this.renderer.xr.getController(index).addEventListener("select", () => {
          if (this.video.paused) this.video.play().catch(() => {});
          else this.video.pause();
        });
      }
      this.overlay.hidden = false;
      await this.renderer.xr.setSession(session);
      let initialPosition = true;
      this.renderer.setAnimationLoop(() => {
        if (initialPosition) {
          this.recenter();
          initialPosition = false;
        }
        this.renderer.render(this.scene, this.camera);
      });
    } catch (error) {
      if (session) await session.end().catch(() => {});
      this.cleanup();
      throw error;
    } finally {
      this.entering = false;
    }
  }

  recenter() {
    if (this.screen && this.renderer) {
      placeScreenInFront(this.screen.group, this.renderer.xr.getCamera());
    }
  }

  resizeScreen() {
    this.screen?.resize();
  }

  async exit() {
    await this.session?.end();
  }

  cleanup() {
    this.renderer?.setAnimationLoop(null);
    this.screen?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.renderer = null;
    this.screen = null;
    this.scene = null;
    this.camera = null;
    this.session = null;
    this.overlay.hidden = true;
    this.onEnd();
  }
}
