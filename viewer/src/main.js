import './style.css';
import { resolveMediaUrl, eyeAspect, formatTime, mediaErrorMessage } from './media.js';
import { StereoPreview } from './preview.js';
import { ImmersivePlayer } from './xr.js';
import { analyzeStereo } from './analysis.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const demoUrl = new URL(`${import.meta.env.BASE_URL}demo/flower-sbs.mp4`, location.href).href;
const calibrationUrl = new URL(`${import.meta.env.BASE_URL}demo/stereo-check.mp4`, location.href).href;
let currentUrl = '', localUrl = '', title = '', ready = false;
const support = { 'immersive-vr': false, 'immersive-ar': false };

function status(message = '', error = false) {
  $('media-status').textContent = message;
  $('media-status').classList.toggle('error', error);
}

const preview = new StereoPreview(video, $('preview'), () => {
  status('This server blocks video pixel access. Enable CORS (Access-Control-Allow-Origin) or open a local file.', true);
});
const immersive = new ImmersivePlayer(video, $('xr-overlay'), () => {
  updateButtons();
  $('enter-vr').textContent = 'Enter VR';
  $('enter-ar').textContent = 'Open in AR';
});

function updateButtons() {
  $('play').disabled = !ready;
  $('seek').disabled = !ready;
  $('check-stereo').disabled = !ready;
  $('enter-vr').disabled = !ready || !support['immersive-vr'] || !!immersive.session || immersive.entering;
  $('enter-ar').disabled = !ready || !support['immersive-ar'] || !!immersive.session || immersive.entering;
  $('share').disabled = !!localUrl || !ready;
}

function loadClip(url, clipTitle, isLocal = false) {
  video.pause();
  ready = false;
  preview.failed = false;
  preview.reset();
  currentUrl = url;
  title = clipTitle || 'Your stereo clip';
  $('clip-title').textContent = title;
  $('stage-message').textContent = 'Loading clip…';
  $('stage-message').hidden = false;
  $('media-info').textContent = 'Full-width side-by-side video';
  $('check-result').textContent = 'Check the current frame for eye differences and horizontal disparity.';
  $('duration').textContent = '0:00';
  $('current-time').textContent = '0:00';
  $('seek').value = 0;
  status();
  video.src = url;
  video.load();
  if (localUrl && localUrl !== url) URL.revokeObjectURL(localUrl);
  localUrl = isLocal ? url : '';
  $('source-url').value = isLocal || url === demoUrl ? '' : url;
  updateButtons();
}

video.addEventListener('loadedmetadata', () => {
  const aspect = eyeAspect(video.videoWidth, video.videoHeight);
  if (video.videoWidth % 2 !== 0 || !Number.isFinite(video.duration)) {
    status('Expected a finite side-by-side clip with an even video width.', true);
    return;
  }
  $('stage').style.aspectRatio = Math.min(2.4, Math.max(0.8, aspect));
  $('duration').textContent = formatTime(video.duration);
  $('seek').max = video.duration;
  $('media-info').textContent = `${video.videoWidth} × ${video.videoHeight} · side-by-side · left eye first`;
  immersive.resizeScreen();
});

video.addEventListener('loadeddata', () => {
  ready = video.videoWidth > 0 && video.videoWidth % 2 === 0 && Number.isFinite(video.duration);
  $('stage-message').hidden = ready;
  updateButtons();
});

video.addEventListener('error', () => {
  ready = false;
  preview.failed = true;
  preview.reset();
  $('stage-message').textContent = 'Couldn’t open this clip';
  $('stage-message').hidden = false;
  status(mediaErrorMessage(video.error), true);
  updateButtons();
});

async function togglePlayback() {
  if (!ready) return;
  if (!video.paused) video.pause();
  else {
    if (video.ended) video.currentTime = 0;
    try { await video.play(); } catch { status('Playback was blocked. Press play again or try another browser.', true); }
  }
}

function syncPlayback() {
  $('play').innerHTML = `<span aria-hidden="true">${video.paused ? '▶' : 'Ⅱ'}</span>`;
  $('play').setAttribute('aria-label', video.paused ? 'Play' : 'Pause');
  $('current-time').textContent = formatTime(video.currentTime);
  $('seek').value = video.currentTime;
}
['play', 'pause', 'ended', 'timeupdate', 'seeked'].forEach((event) => video.addEventListener(event, syncPlayback));
$('play').addEventListener('click', togglePlayback);
$('xr-play').addEventListener('click', togglePlayback);
$('seek').addEventListener('input', () => { video.currentTime = Number($('seek').value); });
$('mute').addEventListener('click', () => {
  video.muted = !video.muted;
  $('mute').textContent = video.muted ? 'Muted' : 'Sound on';
  $('mute').setAttribute('aria-label', video.muted ? 'Unmute audio' : 'Mute audio');
});
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if ($('stage').requestFullscreen) await $('stage').requestFullscreen();
    else status('Fullscreen is unavailable in this browser. Rotate your phone for a larger preview.');
  } catch { status('Fullscreen is unavailable in this browser.'); }
});

const modeHelp = { left: 'One eye, natural proportions.', wiggle: 'Alternates eyes ~3 times/sec. Look for depth, not scene jumps.', anaglyph: 'Red lens: left eye. Cyan lens: right eye.' };
function selectMode(mode) {
  preview.setMode(mode);
  document.querySelectorAll('[data-mode]').forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.mode === mode)));
  $('mode-help').textContent = modeHelp[mode];
  document.querySelector('.mode-label').textContent = mode === 'wiggle' ? 'Depth preview · wiggle' : mode === 'anaglyph' ? '3D glasses · red / cyan' : '2D preview · left eye';
}
document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => selectMode(button.dataset.mode)));
selectMode(matchMedia('(prefers-reduced-motion: reduce)').matches ? 'left' : 'wiggle');

$('check-stereo').addEventListener('click', () => {
  try {
    const { left, right, width, height } = preview.sampleEyes();
    const result = analyzeStereo(left, right, width, height);
    $('check-result').textContent = result.message;
    $('check-result').dataset.result = result.kind;
  } catch {
    $('check-result').textContent = 'Pixel access was blocked. Enable CORS on the video server or use a local file.';
  }
});

$('source-form').addEventListener('submit', (event) => {
  event.preventDefault();
  try { loadClip(resolveMediaUrl($('source-url').value, location.href), 'Your stereo clip'); }
  catch (error) { status(error.message, true); }
});
$('file').addEventListener('change', () => {
  const file = $('file').files[0];
  if (file) loadClip(URL.createObjectURL(file), file.name, true);
  $('file').value = '';
});
$('sample').addEventListener('click', () => loadClip(demoUrl, 'Generated flower clip · AI depth conversion'));
$('calibration').addEventListener('click', () => loadClip(calibrationUrl, 'Calibration cube · synthetic stereo'));
$('share').addEventListener('click', async () => {
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('src', currentUrl);
  url.searchParams.set('title', title);
  try { await navigator.clipboard.writeText(url.href); status('Viewer link copied. Anyone opening it needs access to the video URL.'); }
  catch { status('Copying is unavailable here. The share link is selected in the Video URL field.'); $('source-url').value = url.href; $('source-url').select(); }
});

for (const [buttonId, mode] of [['enter-vr', 'immersive-vr'], ['enter-ar', 'immersive-ar']]) {
  $(buttonId).addEventListener('click', async () => {
    const request = immersive.enter(mode);
    updateButtons();
    try { await request; }
    catch (error) { status(error.name === 'NotAllowedError' ? 'Headset permission was declined. You can still use the preview modes.' : 'Couldn’t start immersive playback. Check headset access, HTTPS, and WebXR browser support.', true); }
    finally { updateButtons(); }
  });
}
$('xr-exit').addEventListener('click', () => immersive.exit().catch(() => status('Use the headset’s system menu to exit.')));
$('xr-recenter').addEventListener('click', () => immersive.recenter());

async function detectXR() {
  if (!window.isSecureContext || !navigator.xr) {
    $('xr-status').textContent = !window.isSecureContext ? 'Headset mode needs HTTPS (or localhost). Preview modes work here.' : 'No WebXR headset detected here. Try wiggle or red/cyan mode, or open this page in a headset browser.';
    return;
  }
  await Promise.all(Object.keys(support).map(async (mode) => {
    try { support[mode] = await navigator.xr.isSessionSupported(mode); } catch { support[mode] = false; }
  }));
  $('xr-status').textContent = Object.values(support).some(Boolean) ? 'Headset ready. Press a button above to grant access. Use a controller trigger to pause or play.' : 'No compatible headset session available. Preview modes still work.';
  updateButtons();
}
detectXR();
const params = new URLSearchParams(location.search);
try {
  loadClip(params.has('src') ? resolveMediaUrl(params.get('src'), location.href) : demoUrl, params.get('title') || (params.has('src') ? 'Your stereo clip' : 'Generated flower clip · AI depth conversion'));
} catch (error) { status(error.message, true); $('stage-message').textContent = 'Open a stereo clip to start'; }
