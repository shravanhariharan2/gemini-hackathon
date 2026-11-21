'use strict';
const $ = id => document.getElementById(id);
const clip = $('clip'), original = $('original'), swapped = $('swapped');
let clipData = null, photo = null, busy = false, uploading = false, picking = 0;
let cameraStream = null, photoURL = null, selected = null, playing = false, pickSerial = 0;
const stamp = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
function error(message = '') { $('error').textContent = message; $('error').hidden = !message; }
function controls() {
  $('swap').disabled = busy || uploading || !clipData || !photo || !$('target').value.trim() || !!picking;
  $('sample').disabled = busy || uploading;
  $('clip-file').disabled = busy || uploading;
  $('photo-file').disabled = busy;
  $('camera-open').disabled = busy;
  $('target').disabled = busy;
}
async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.detail === 'string' ? data.detail : `Request failed (${response.status})`);
  }
  return response.json();
}
function stopResults() {
  playing = false; original.pause(); swapped.pause();
  $('result-play').textContent = $('solo').checked ? 'Play swapped' : 'Play both';
}
async function sourceDuration(file) {
  const video = document.createElement('video'), url = URL.createObjectURL(file);
  try {
    return await new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), 3000);
      video.onloadedmetadata = () => { clearTimeout(timer); resolve(video.duration); };
      video.onerror = () => { clearTimeout(timer); resolve(null); };
      video.src = url;
    });
  } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}
async function loadClip(file, sample = false) {
  if (busy || uploading) return;
  error(); uploading = true; clipData = null; picking = 0; pickSerial++; selected = null;
  clip.pause(); stopResults(); $('results').hidden = true; $('marker').hidden = true;
  $('target').value = ''; $('describe-status').textContent = 'Preparing your clip…';
  $('clip-info').textContent = 'Uploading and preparing…'; controls();
  try {
    if (file.size > 200 * 1024 * 1024) throw new Error('Video must be 200 MB or smaller.');
    const duration = await sourceDuration(file);
    const form = new FormData(); form.append('video', file);
    clipData = await request('/api/clips', {method: 'POST', body: form});
    clip.src = clipData.url; clip.load(); $('empty').hidden = true;
    $('clip-info').textContent = `${clipData.duration.toFixed(1)} s · ${clipData.aspect_ratio}${duration > 15 ? ' · Trimmed to the first 15 seconds' : ''}`;
    $('credit').hidden = !sample;
    $('describe-status').textContent = 'Click the person you want to replace.';
    $('clip-play').disabled = false; $('clip-seek').disabled = false;
  } catch (e) { error(e.message); $('clip-info').textContent = 'Could not prepare clip. Please try again.'; }
  finally { uploading = false; controls(); }
}
$('clip-file').onchange = e => { if (e.target.files[0]) loadClip(e.target.files[0]); };
$('sample').onclick = async () => {
  try {
    $('sample').disabled = true;
    const response = await fetch('/demo/dancers.mp4');
    if (!response.ok) throw new Error('Could not load sample clip.');
    await loadClip(new File([await response.blob()], 'dancers.mp4', {type: 'video/mp4'}), true);
  } catch (e) { error(e.message); } finally { controls(); }
};
$('clip-play').onclick = () => clip.paused ? clip.play().catch(e => error(e.message)) : clip.pause();
clip.onplay = () => { $('clip-play').textContent = 'Pause clip'; $('marker').hidden = true; };
clip.onpause = () => { $('clip-play').textContent = 'Play clip'; };
clip.ontimeupdate = () => { $('clip-time').textContent = stamp(clip.currentTime); $('clip-seek').value = clip.currentTime / (clip.duration || 1); };
$('clip-seek').oninput = e => { clip.currentTime = Number(e.target.value) * clip.duration; $('marker').hidden = true; };
function positionMarker() {
  if (!selected) return;
  const rect = clip.getBoundingClientRect();
  const scale = Math.min(rect.width / clip.videoWidth, rect.height / clip.videoHeight);
  const width = clip.videoWidth * scale, height = clip.videoHeight * scale;
  $('marker').style.left = `${(rect.width - width) / 2 + selected.x * width}px`;
  $('marker').style.top = `${(rect.height - height) / 2 + selected.y * height}px`;
}
window.addEventListener('resize', positionMarker);
clip.onclick = async event => {
  if (!clipData || busy || uploading || !clip.videoWidth || clip.readyState < 2) return;
  const rect = clip.getBoundingClientRect();
  const scale = Math.min(rect.width / clip.videoWidth, rect.height / clip.videoHeight);
  const width = clip.videoWidth * scale, height = clip.videoHeight * scale;
  const x = (event.clientX - rect.left - (rect.width - width) / 2) / width;
  const y = (event.clientY - rect.top - (rect.height - height) / 2) / height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  clip.pause(); selected = {x, y}; positionMarker(); $('marker').hidden = false;
  const token = ++pickSerial, id = clipData.clip_id; picking = token;
  $('target').value = ''; $('describe-status').textContent = 'Identifying your person…'; controls(); error();
  try {
    const canvas = document.createElement('canvas'); canvas.width = clip.videoWidth; canvas.height = clip.videoHeight;
    canvas.getContext('2d').drawImage(clip, 0, 0);
    const frame = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .9));
    if (!frame) throw new Error('Could not capture frame. Try again.');
    const form = new FormData(); form.append('frame', frame, 'frame.jpg'); form.append('x', x); form.append('y', y);
    const data = await request(`/api/clips/${id}/describe`, {method: 'POST', body: form});
    if (token !== picking || clipData?.clip_id !== id) return;
    $('target').value = data.description;
    $('describe-status').textContent = 'Person selected. You can refine the description.';
  } catch (e) { if (token === picking) { error(e.message); $('describe-status').textContent = 'Click again or type a description.'; } }
  finally { if (token === picking) picking = 0; controls(); }
};
$('target').oninput = controls;
async function selectPhoto(file) {
  try {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP photo.');
    if (file.size > 15 * 1024 * 1024) throw new Error('Photo must be 15 MB or smaller.');
    const bitmap = await createImageBitmap(file);
    const pixels = bitmap.width * bitmap.height; bitmap.close();
    if (pixels > 30000000) throw new Error('Photo must be 30 megapixels or smaller.');
    photo = file; if (photoURL) URL.revokeObjectURL(photoURL);
    photoURL = URL.createObjectURL(file); $('photo-preview').src = photoURL; $('photo-preview').hidden = false;
    $('photo-info').textContent = file.name; error();
  } catch (e) { error(e.message); } finally { controls(); }
}
$('photo-file').onchange = e => { if (e.target.files[0]) selectPhoto(e.target.files[0]); };
function closeCamera() { cameraStream?.getTracks().forEach(track => track.stop()); cameraStream = null; $('camera').srcObject = null; $('camera-panel').hidden = true; }
$('camera-open').onclick = async () => {
  try {
    closeCamera();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera needs localhost or HTTPS and browser permission. Please upload a photo instead.');
    cameraStream = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'user'}, audio: false});
    $('camera').srcObject = cameraStream; $('camera-panel').hidden = false;
  } catch (e) { error(`Camera unavailable: ${e.message}`); }
};
$('camera-close').onclick = closeCamera;
$('capture').onclick = async () => {
  const video = $('camera'); if (!video.videoWidth) return;
  const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .9));
  if (blob) { await selectPhoto(new File([blob], 'selfie.jpg', {type: 'image/jpeg'})); closeCamera(); }
};
window.addEventListener('pagehide', closeCamera);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function loaded(video) {
  return new Promise((resolve, reject) => {
    video.onloadeddata = resolve; video.onerror = () => reject(new Error('Could not load result video. Use Download to save it.'));
    video.load();
  });
}
$('swap').onclick = async () => {
  if ($('swap').disabled) return;
  busy = true; controls(); error(); closeCamera(); clip.pause(); stopResults(); $('results').hidden = true;
  const start = performance.now();
  const elapsed = setInterval(() => { $('job-status').textContent = `Creating your swap · ${Math.floor((performance.now() - start) / 1000)} s elapsed · usually about a minute`; }, 1000);
  $('job-status').textContent = 'Uploading reference…'; $('swap').textContent = 'Swapping…';
  try {
    const form = new FormData(); form.append('photo', photo); form.append('clip_id', clipData.clip_id); form.append('target', $('target').value.trim());
    const {job_id} = await request('/api/swaps', {method: 'POST', body: form});
    let job;
    do {
      await delay(2000); job = await request(`/api/swaps/${job_id}`);
      if (job.status === 'error') throw new Error(job.error || 'Swap failed. Please retry.');
    } while (job.status !== 'done');
    clearInterval(elapsed);
    $('job-status').textContent = `Done · ${job.seconds.toFixed(1)} s generation time`;
    original.src = clipData.url; swapped.src = job.video_url; $('download').href = job.video_url;
    $('results').hidden = false; $('result-play').disabled = true;
    await Promise.all([loaded(original), loaded(swapped)]);
    $('result-play').disabled = false; $('results').scrollIntoView({behavior: 'smooth', block: 'start'});
  } catch (e) { error(e.message); $('job-status').textContent = 'Could not finish. You can retry with the same inputs.'; }
  finally { clearInterval(elapsed); busy = false; $('swap').textContent = 'Swap character ↗'; controls(); }
};
async function startResults() {
  if (swapped.ended || swapped.currentTime >= Math.min(original.duration, swapped.duration) - .1) swapped.currentTime = 0;
  original.currentTime = swapped.currentTime; playing = true;
  try { await Promise.all([original.play(), swapped.play()]); $('result-play').textContent = 'Pause'; }
  catch (e) { stopResults(); error(e.message); }
}
$('result-play').onclick = () => playing ? stopResults() : startResults();
$('solo').onchange = () => {
  $('original-figure').hidden = $('solo').checked;
  $('comparison').classList.toggle('solo', $('solo').checked);
  if (!playing) $('result-play').textContent = $('solo').checked ? 'Play swapped' : 'Play both';
};
swapped.onended = stopResults; original.onended = stopResults;
function sync() {
  if (playing) {
    if (Math.abs(original.currentTime - swapped.currentTime) > .08) original.currentTime = swapped.currentTime;
    $('result-time').textContent = `${stamp(swapped.currentTime)} / ${stamp(swapped.duration || 0)}`;
  }
  requestAnimationFrame(sync);
}
sync(); controls();
