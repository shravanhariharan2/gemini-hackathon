import test from 'node:test';
import assert from 'node:assert/strict';
import { RollingRecorder } from './rollingRecorder';
class FakeRecorder extends EventTarget {
  static instances: FakeRecorder[] = [];
  static isTypeSupported() { return true; }
  state = 'inactive'; first = true; emit = true;
  constructor(_stream: unknown, _options: unknown) { super(); FakeRecorder.instances.push(this); }
  start() { this.state = 'recording'; }
  requestData() {
    if (!this.emit) return;
    const event = new Event('dataavailable') as Event & { data: Blob };
    event.data = new Blob([this.first ? new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]) : new Uint8Array([1])]);
    this.first = false; this.dispatchEvent(event);
  }
  stop() { this.state = 'inactive'; }
}
test('staggered snapshots retain their initialization header after multiple ring rollovers', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: 100_000 });
  const original = globalThis.MediaRecorder; (globalThis as any).MediaRecorder = FakeRecorder;
  t.after(() => { (globalThis as any).MediaRecorder = original; });
  const buffer = new RollingRecorder({} as MediaStream); t.after(() => buffer.stop());
  for (let i = 0; i < 12; i++) {
    t.mock.timers.tick(15_000);
    const probe = await buffer.snapshot(15); const full = await buffer.snapshot(60);
    for (const snapshot of [probe, full]) {
      assert.deepEqual(Array.from(new Uint8Array(await snapshot.blob.arrayBuffer()).slice(0, 4)), [0x1a, 0x45, 0xdf, 0xa3]);
      assert.ok(snapshot.durationSec <= 60); assert.ok(snapshot.durationSec >= 15);
    }
    if (i > 4) assert.ok(full.durationSec >= 45);
    assert.ok(FakeRecorder.instances.filter(r => r.state === 'recording').length <= 5);
  }
  buffer.stop(); assert.equal(buffer.bufferedSeconds, 0); await assert.rejects(buffer.snapshot(15), /stopped/);
});
test('stopping a buffer rejects an in-flight flush and releases recorders', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: 100_000 });
  const original = globalThis.MediaRecorder; (globalThis as any).MediaRecorder = FakeRecorder;
  t.after(() => { (globalThis as any).MediaRecorder = original; });
  const buffer = new RollingRecorder({} as MediaStream);
  t.mock.timers.tick(2000); FakeRecorder.instances.at(-1)!.emit = false;
  const result = buffer.snapshot(60); buffer.stop(); await assert.rejects(result, /interrupted/);
  assert.equal(FakeRecorder.instances.filter(r => r.state === 'recording').length, 0);
});
