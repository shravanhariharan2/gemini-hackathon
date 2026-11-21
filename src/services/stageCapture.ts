/** A stable canvas + audio destination records the local stage and WebRTC guests. */
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
  let sources: { video: HTMLVideoElement; name: string; node?: MediaStreamAudioSourceNode; gain?: GainNode }[] = [];
  const output = canvas.captureStream(20);
  destination.stream.getAudioTracks().forEach(track => output.addTrack(track));
  const draw = () => {
    context.fillStyle = '#0f172a'; context.fillRect(0, 0, 1280, 720);
    const cols = sources.length > 1 ? 2 : 1;
    const rows = Math.max(1, Math.ceil(sources.length / cols));
    sources.forEach(({ video, name }, index) => {
      const w = 1280 / cols; const h = 720 / rows; const x = index % cols * w; const y = Math.floor(index / cols) * h;
      if (video.readyState >= 2 && video.videoWidth > 0) {
        const ratio = Math.min(w / video.videoWidth, h / video.videoHeight);
        const dw = video.videoWidth * ratio; const dh = video.videoHeight * ratio;
        context.drawImage(video, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      }
      context.fillStyle = '#0f172acc'; context.fillRect(x + 12, y + h - 45, Math.min(w - 24, name.length * 11 + 24), 32);
      context.fillStyle = '#ffffff'; context.font = '18px sans-serif'; context.fillText(name, x + 24, y + h - 23, w - 48);
    });
  };
  const timer = setInterval(draw, 50);
  const clear = () => { sources.forEach(s => { s.node?.disconnect(); s.gain?.disconnect(); s.video.pause(); s.video.srcObject = null; }); sources = []; };
  return {
    stream: output,
    update(streams: { stream: MediaStream; name: string }[]) {
      clear();
      const selected = streams.slice(0, 6);
      sources = selected.map(({ stream, name }) => {
        const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.srcObject = stream; void video.play().catch(() => {});
        let node: MediaStreamAudioSourceNode | undefined; let gain: GainNode | undefined;
        if (stream.getAudioTracks().length) {
          node = audio.createMediaStreamSource(stream); gain = audio.createGain(); gain.gain.value = .8 / Math.sqrt(selected.length); node.connect(gain); gain.connect(destination);
        }
        return { video, name, node, gain };
      });
      void audio.resume().catch(() => {});
      draw();
    },
    stop() { clearInterval(timer); silence.stop(); silence.disconnect(); clear(); output.getTracks().forEach(t => t.stop()); void audio.close(); },
  };
}
