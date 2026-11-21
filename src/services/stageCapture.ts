export interface StageSource { id: string; name: string; stream?: MediaStream }

/** Every on-stage camera: the local stream, WebRTC guests, and guests only reachable through the WebSocket frame relay. */
export function selectStageSources(options: { localStream: MediaStream; selfName: string; remoteStreams: Record<string, MediaStream>; relayFrames: Record<string, string>; participants: { id: string; name: string; role: string }[] }): StageSource[] {
  const { participants, remoteStreams, relayFrames } = options;
  const name = (id: string) => participants.find(p => p.id === id)?.name || 'Guest';
  const ids = [...Object.keys(remoteStreams), ...Object.keys(relayFrames).filter(id => !(id in remoteStreams) && participants.some(p => p.id === id && p.role !== 'viewer'))];
  const order = (id: string) => { const index = participants.findIndex(p => p.id === id); return index < 0 ? participants.length : index; };
  ids.sort((a, b) => order(a) - order(b));
  return [{ id: 'self', name: options.selfName || 'You', stream: options.localStream }, ...ids.map(id => ({ id, name: name(id), stream: remoteStreams[id] }))];
}

/** A stable canvas + audio destination records the local stage, WebRTC guests and relayed guests. */
export function createStageCapture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  const context = canvas.getContext('2d')!;
  const audio = new AudioContext();
  const destination = audio.createMediaStreamDestination();
  // Keep the audio clock running even for video-only guests or muted microphones.
  // A destination with no input can otherwise stall MediaRecorder's multiplexing.
  const silence = audio.createConstantSource();
  silence.offset.value = 0;
  silence.connect(destination);
  silence.start();
  let sources: { id: string; video: HTMLVideoElement; name: string; stream?: MediaStream; node?: MediaStreamAudioSourceNode; gain?: GainNode }[] = [];
  const relayImages = new Map<string, { src: string; image: HTMLImageElement; ready?: HTMLImageElement }>();
  const output = canvas.captureStream(20);
  destination.stream.getAudioTracks().forEach(track => output.addTrack(track));
  const draw = () => {
    context.fillStyle = '#0f172a'; context.fillRect(0, 0, 1280, 720);
    const cols = sources.length > 1 ? 2 : 1;
    const rows = Math.max(1, Math.ceil(sources.length / cols));
    sources.forEach(({ id, video, name }, index) => {
      const w = 1280 / cols; const h = 720 / rows; const x = index % cols * w; const y = Math.floor(index / cols) * h;
      // Relay frames exist only while the peer's WebRTC link is unhealthy, mirroring the stage tiles.
      const relay = relayImages.get(id)?.ready;
      const frame = relay ? { image: relay, width: relay.naturalWidth, height: relay.naturalHeight }
        : video.readyState >= 2 && video.videoWidth > 0 ? { image: video, width: video.videoWidth, height: video.videoHeight } : null;
      if (frame && frame.width > 0) {
        const ratio = Math.min(w / frame.width, h / frame.height);
        const dw = frame.width * ratio; const dh = frame.height * ratio;
        context.drawImage(frame.image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      }
      context.fillStyle = '#0f172acc'; context.fillRect(x + 12, y + h - 45, Math.min(w - 24, name.length * 11 + 24), 32);
      context.fillStyle = '#ffffff'; context.font = '18px sans-serif'; context.fillText(name, x + 24, y + h - 23, w - 48);
    });
  };
  const timer = setInterval(draw, 50);
  const release = (s: (typeof sources)[number]) => { s.node?.disconnect(); s.gain?.disconnect(); s.video.pause(); s.video.srcObject = null; };
  const clear = () => { sources.forEach(release); sources = []; };
  return {
    stream: output,
    update(streams: StageSource[]) {
      clear();
      const selected = streams.slice(0, 6);
      sources = selected.map(({ id, stream, name }) => {
        const video = document.createElement('video'); video.muted = true; video.playsInline = true;
        if (stream) { video.srcObject = stream; void video.play().catch(() => {}); }
        let node: MediaStreamAudioSourceNode | undefined; let gain: GainNode | undefined;
        if (stream?.getAudioTracks().length) {
          node = audio.createMediaStreamSource(stream); gain = audio.createGain(); gain.gain.value = .8 / Math.sqrt(selected.length); node.connect(gain); gain.connect(destination);
        }
        return { id, video, name, stream, node, gain };
      });
      void audio.resume().catch(() => {});
      draw();
    },
    setRelayFrames(frames: Record<string, string>) {
      for (const id of relayImages.keys()) if (!(id in frames)) relayImages.delete(id);
      for (const [id, src] of Object.entries(frames)) {
        const entry = relayImages.get(id);
        if (entry?.src === src) continue;
        const image = new Image();
        const next = { src, image, ready: entry?.ready };
        image.onload = () => { if (relayImages.get(id) === next) next.ready = image; };
        image.src = src;
        relayImages.set(id, next);
      }
    },
    stop() { clearInterval(timer); silence.stop(); silence.disconnect(); clear(); relayImages.clear(); output.getTracks().forEach(t => t.stop()); void audio.close(); },
  };
}
