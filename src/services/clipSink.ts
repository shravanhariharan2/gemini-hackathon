import type { ClipSinkAdapter, DownstreamClipPayload } from '../shared/protocol';

/**
 * Fixed-capacity ring buffer for rolling live media chunks (e.g., last 60s of 1s chunks).
 * Keeps memory strictly bounded during long streams while keeping the latest window ready
 * for a downstream clipping pipeline.
 */
export class ClipRingBuffer<T = Blob> {
  private readonly maxItems: number;
  private items: T[] = [];

  constructor(maxSeconds = 60) {
    this.maxItems = Math.max(1, Math.floor(maxSeconds));
  }

  push(chunk: T): void {
    this.items.push(chunk);
    if (this.items.length > this.maxItems) {
      this.items.shift();
    }
  }

  snapshot(): T[] {
    return [...this.items];
  }

  get length(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }
}

/**
 * Default no-op sink: does not upload or persist media anywhere.
 * A downstream clipping integration can plug in via registerClipSink(adapter).
 */
const noopClipSink: ClipSinkAdapter = {
  name: 'noop-local-buffer',
  onClipMarked: () => {
    // Intentionally empty: downstream clipping system consumes this hook.
  },
};

let activeSink: ClipSinkAdapter = noopClipSink;

export function registerClipSink(adapter: ClipSinkAdapter | null): void {
  activeSink = adapter ?? noopClipSink;
}

export function getActiveClipSink(): ClipSinkAdapter {
  return activeSink;
}

export function dispatchClipToSink(payload: DownstreamClipPayload): void {
  try {
    void Promise.resolve(activeSink.onClipMarked(payload)).catch(() => {
      // Async sink failures must not interrupt the broadcast.
    });
  } catch {
    // Isolate downstream sink errors from the live broadcast session
  }
}
