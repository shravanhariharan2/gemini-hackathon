import test from 'node:test';
import assert from 'node:assert/strict';
import { selectStageSources } from './stageCapture';

const local = { id: 'local' } as unknown as MediaStream;
const guest = { id: 'guest' } as unknown as MediaStream;
const participants = [
  { id: 'me', name: 'shrav', role: 'host' },
  { id: 'larry', name: 'larry', role: 'cohost' },
  { id: 'maya', name: 'maya', role: 'cohost' },
  { id: 'viewer', name: 'viewer', role: 'viewer' },
];

test('stage sources include guests that only arrive through the WebSocket frame relay', () => {
  const sources = selectStageSources({ localStream: local, selfName: 'shrav', remoteStreams: { maya: guest }, relayFrames: { larry: 'data:image/webp;base64,AA' }, participants });
  assert.deepEqual(sources.map(s => [s.id, s.name, s.stream?.id]), [['self', 'shrav', 'local'], ['larry', 'larry', undefined], ['maya', 'maya', 'guest']]);
});

test('relay frames from viewers or departed peers never add stage tiles', () => {
  const sources = selectStageSources({ localStream: local, selfName: '', remoteStreams: {}, relayFrames: { viewer: 'data:image/webp;base64,AA', gone: 'data:image/webp;base64,AA' }, participants });
  assert.deepEqual(sources.map(s => s.name), ['You']);
});

test('a guest with both a WebRTC stream and a relay frame gets one tile', () => {
  const sources = selectStageSources({ localStream: local, selfName: 'shrav', remoteStreams: { larry: guest }, relayFrames: { larry: 'data:image/webp;base64,AA' }, participants });
  assert.deepEqual(sources.map(s => s.id), ['self', 'larry']);
});
