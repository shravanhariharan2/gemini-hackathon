import { createSoundboard } from '../src/services/soundboard';
import { createStageCapture } from '../src/services/stageCapture';

document.querySelector<HTMLButtonElement>('#run')!.onclick = async () => {
  const result = document.querySelector('#result')!;
  result.textContent = 'Recording the MLG airhorn through the stage mixer…';
  const audio = new AudioContext();
  await audio.resume();
  const silentInput = audio.createMediaStreamDestination();
  const silence = audio.createConstantSource(); silence.offset.value = 0; silence.connect(silentInput); silence.start();
  const mic = silentInput.stream.getAudioTracks()[0]; mic.enabled = false;
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
  const context = canvas.getContext('2d')!;
  const timer = setInterval(() => { context.fillStyle = '#111827'; context.fillRect(0, 0, 320, 180); context.fillStyle = '#fb7185'; context.fillRect(Date.now() / 10 % 280, 60, 40, 40); }, 50);
  const input = new MediaStream([...canvas.captureStream(20).getVideoTracks(), mic]);
  const board = createSoundboard(input);
  const stage = createStageCapture();
  let recorder: MediaRecorder | undefined;
  try {
    stage.update([{ id: 'self', stream: board.stream, name: 'Soundboard recording test' }]);
    recorder = new MediaRecorder(stage.stream, { mimeType: 'video/webm;codecs=vp8,opus' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.start(100);
    const completed = await board.play('air-horn', .4);
    await new Promise<void>(resolve => { recorder!.onstop = () => resolve(); recorder!.stop(); });
    const decoded = await audio.decodeAudioData(await new Blob(chunks).arrayBuffer());
    const pcm = decoded.getChannelData(0);
    const rms = Math.sqrt(pcm.reduce((sum, sample) => sum + sample * sample, 0) / pcm.length);
    if (!completed || rms < .01 || mic.enabled || !board.stream.getAudioTracks()[0].enabled) throw new Error(`Recorded audio routing failed: RMS ${rms}`);
    const interrupted = board.play('air-horn', .4);
    board.stop();
    if (await interrupted) throw new Error('Stopped playback must not trigger detection.');
    board.dispose();
    if (mic.readyState !== 'ended' || board.stream.getAudioTracks()[0].readyState !== 'ended') throw new Error('Mixer tracks were not released.');
    result.textContent = `PASS: Soundboard audio reached recorded WebM (RMS ${rms.toFixed(4)}).\nPASS: Microphone stayed muted; outgoing sound stayed audible.\nPASS: Stop cancels pending playback.\nPASS: Disposal releases input and output audio tracks.`;
  } catch (error) {
    result.textContent = `FAIL: ${error instanceof Error ? error.message : error}`;
  } finally {
    if (recorder?.state === 'recording') recorder.stop();
    stage.stop(); board.dispose(); clearInterval(timer); silence.stop(); input.getTracks().forEach(t => t.stop()); await audio.close();
  }
};
