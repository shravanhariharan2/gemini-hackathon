export interface BufferedMedia { blob: Blob; startedAt: number; endedAt: number; durationSec: number }
interface Recording { recorder: MediaRecorder; chunks: Blob[]; startedAt: number; bytes: number }
/** Staggered recordings retain their own initialization header. Never evict a header chunk. */
export class RollingRecorder {
  private recordings: Recording[] = [];
  private timer: ReturnType<typeof setInterval>;
  private pending = new Set<() => void>();
  private stopped = false;
  private mimeType: string;
  constructor(private stream: MediaStream, private onError: (message: string) => void = () => {}) {
    this.mimeType = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)) || '';
    if (!this.mimeType) throw new Error('This browser cannot record WebM. Use a Chromium browser.');
    this.startRecording();
    this.timer = setInterval(() => {
      try {
        this.prune();
        this.startRecording();
      } catch { this.onError('Recording stopped. Restart the live stream.'); this.stop(); }
    }, 15_000);
  }
  private startRecording() {
    if (this.stopped) return;
    const recorder = new MediaRecorder(this.stream, { mimeType: this.mimeType, videoBitsPerSecond: 1_200_000, audioBitsPerSecond: 64_000 });
    const entry: Recording = { recorder, chunks: [], startedAt: Date.now(), bytes: 0 };
    recorder.addEventListener('dataavailable', event => {
      if (event.data.size && !this.stopped) {
        entry.chunks.push(event.data); entry.bytes += event.data.size;
        if (entry.bytes > 16 * 1024 * 1024) { this.onError('Recording exceeded the memory limit. Restart the live stream.'); this.stop(); }
      }
    });
    recorder.addEventListener('error', () => { this.onError('The browser could not record the stage. Restart the live stream.'); this.stop(); });
    recorder.start(1000);
    this.recordings.push(entry);
  }
  private prune() {
    const cutoff = Date.now() - 60_000;
    this.recordings = this.recordings.filter(entry => {
      if (entry.startedAt >= cutoff) return true;
      if (entry.recorder.state !== 'inactive') entry.recorder.stop();
      entry.chunks = [];
      return false;
    });
  }
  get bufferedSeconds() { return this.recordings.length ? Math.min(60, (Date.now() - this.recordings[0].startedAt) / 1000) : 0; }
  async snapshot(seconds: number): Promise<BufferedMedia> {
    if (this.stopped) throw new Error('The live buffer is stopped.');
    const now = Date.now();
    const eligible = this.recordings.filter(r => r.recorder.state === 'recording' && now - r.startedAt <= 60_100);
    // Probe uses the shortest header-bearing recording covering 15s. Judge takes
    // the oldest current recording (45–60s once warm). FFmpeg trims the probe tail.
    const entry = seconds < 60 ? [...eligible].reverse().find(r => now - r.startedAt >= seconds * 1000) || eligible[0] : eligible[0];
    if (!entry || now - entry.startedAt < 1000) throw new Error('Buffer warming up. Wait at least one second.');
    return new Promise((resolve, reject) => {
      const done = () => {
        cleanup();
        const endedAt = Date.now();
        if (!entry.bytes) { reject(new Error('The stage produced no recorded media. Check audio playback permissions and restart the stream.')); return; }
        resolve({ blob: new Blob(entry.chunks, { type: 'video/webm' }), startedAt: entry.startedAt, endedAt, durationSec: Math.min(60, (endedAt - entry.startedAt) / 1000) });
      };
      const cancel = () => { cleanup(); reject(new Error('Recording was interrupted.')); };
      const timeout = setTimeout(cancel, 5000);
      const cleanup = () => { clearTimeout(timeout); this.pending.delete(cancel); entry.recorder.removeEventListener('dataavailable', done); };
      this.pending.add(cancel);
      entry.recorder.addEventListener('dataavailable', done, { once: true });
      try { entry.recorder.requestData(); } catch { cancel(); }
    });
  }
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    for (const cancel of this.pending) cancel();
    for (const entry of this.recordings) { if (entry.recorder.state !== 'inactive') entry.recorder.stop(); entry.chunks = []; }
    this.recordings = [];
  }
}
