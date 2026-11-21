import { combineAnaglyph } from './analysis.js';
import { eyeAspect } from './media.js';

export class StereoPreview {
  constructor(video, canvas, onError) {
    this.video = video;
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.scratch = document.createElement('canvas');
    this.scratchContext = this.scratch.getContext('2d', { willReadFrequently: true });
    this.mode = 'left';
    this.onError = onError;
    this.failed = false;
    this.frame = (time) => {
      if (this.video.readyState >= 2 && !this.failed && !document.hidden) {
        try { this.draw(time); } catch (error) { this.failed = true; this.onError(error); }
      }
      this.animation = requestAnimationFrame(this.frame);
    };
    this.animation = requestAnimationFrame(this.frame);
  }

  setMode(mode) { this.mode = mode; this.failed = false; }

  reset() {
    this.lastKey = null;
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(time) {
    const { video, canvas, context } = this;
    const eye = this.mode === 'wiggle' ? Math.floor(time / 170) % 2 : 0;
    const key = `${video.currentSrc}:${video.currentTime}:${this.mode}:${eye}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const width = Math.min(this.mode === 'anaglyph' ? 640 : 960, video.videoWidth / 2);
    const height = Math.round(width / eyeAspect(video.videoWidth, video.videoHeight));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width; canvas.height = height;
      this.scratch.width = width; this.scratch.height = height;
    }
    context.drawImage(video, eye * video.videoWidth / 2, 0, video.videoWidth / 2, video.videoHeight, 0, 0, width, height);
    if (this.mode === 'anaglyph') {
      const left = context.getImageData(0, 0, width, height);
      this.scratchContext.drawImage(video, video.videoWidth / 2, 0, video.videoWidth / 2, video.videoHeight, 0, 0, width, height);
      const right = this.scratchContext.getImageData(0, 0, width, height);
      combineAnaglyph(left.data, right.data, left.data);
      context.putImageData(left, 0, 0);
    }
  }

  sampleEyes() {
    const width = 160, height = 90;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const eyes = [0, 1].map((eye) => {
      context.drawImage(this.video, eye * this.video.videoWidth / 2, 0, this.video.videoWidth / 2, this.video.videoHeight, 0, 0, width, height);
      return context.getImageData(0, 0, width, height).data;
    });
    return { left: eyes[0], right: eyes[1], width, height };
  }
}
