import { useEffect, useRef, useState } from 'react';

const button = 'inline-flex items-center justify-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed';
const card = 'rounded-2xl border border-slate-200 bg-white p-5 space-y-4';
type Clip = { clip_id: string; url: string; duration: number; aspect_ratio: string };
type Photo = { file: File; url: string };
async function request(path: string, body?: FormData) {
  const response = await fetch(`/api/clip-gen${path}`, body ? { method: 'POST', body } : undefined);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function canvasBlob(canvas: HTMLCanvasElement) { return new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not capture frame')), 'image/jpeg', .9)); }

export function ClipGenPage() {
  const [clip, setClip] = useState<Clip | null>(null), [photos, setPhotos] = useState<Photo[]>([]);
  const [target, setTarget] = useState(''), [error, setError] = useState(''), [status, setStatus] = useState('Usually about a minute (~50 s per 8 s clip).');
  const [busy, setBusy] = useState(false), [picking, setPicking] = useState(false), [sample, setSample] = useState(false);
  const [result, setResult] = useState(''), [solo, setSolo] = useState(false), [playing, setPlaying] = useState(false), [ready, setReady] = useState(0);
  const [camera, setCamera] = useState<MediaStream | null>(null), [marker, setMarker] = useState<{ x: number; y: number } | null>(null);
  const video = useRef<HTMLVideoElement>(null), original = useRef<HTMLVideoElement>(null), swapped = useRef<HTMLVideoElement>(null), selfie = useRef<HTMLVideoElement>(null);
  const serial = useRef(0), alive = useRef(true), photoRef = useRef(photos), cameraRef = useRef(camera);
  photoRef.current = photos; cameraRef.current = camera;
  useEffect(() => { alive.current = true; return () => { alive.current = false; serial.current++; photoRef.current.forEach(p => URL.revokeObjectURL(p.url)); cameraRef.current?.getTracks().forEach(t => t.stop()); }; }, []);
  useEffect(() => { if (selfie.current) selfie.current.srcObject = camera; }, [camera]);
  const closeCamera = () => { cameraRef.current?.getTracks().forEach(t => t.stop()); setCamera(null); };
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  async function load(file: File, isSample = false) {
    setBusy(true); setError(''); setClip(null); setTarget(''); setResult(''); setMarker(null); serial.current++;
    setStatus('Uploading and preparing your clip…');
    try {
      if (file.size > 200 * 1024 * 1024) throw new Error('Video must be 200 MB or smaller.');
      const form = new FormData(); form.append('video', file);
      setClip(await request('/clips', form)); setSample(isSample); setStatus('Click the person you want to replace. Clips are trimmed to the first 10 seconds.');
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function pick(event: React.MouseEvent<HTMLVideoElement>) {
    const v = video.current;
    if (!clip || busy || !v?.videoWidth) return;
    v.pause();
    const rect = v.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
    setMarker({ x, y }); setPicking(true); setError(''); const token = ++serial.current;
    try {
      const canvas = document.createElement('canvas'); canvas.width = v.videoWidth; canvas.height = v.videoHeight;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(v, 0, 0);
      const radius = Math.max(12, Math.floor(Math.min(canvas.width, canvas.height) / 25));
      ctx.beginPath(); ctx.arc(x * (canvas.width - 1), y * (canvas.height - 1), radius, 0, Math.PI * 2); ctx.strokeStyle = 'red'; ctx.lineWidth = Math.max(3, Math.floor(radius / 5)); ctx.stroke();
      const form = new FormData(); form.append('frame', await canvasBlob(canvas), 'frame.jpg'); form.append('x', String(x)); form.append('y', String(y));
      const data = await request(`/clips/${clip.clip_id}/describe`, form);
      if (token === serial.current) setTarget(data.description);
    } catch (e) { if (token === serial.current) fail(e); } finally { if (token === serial.current) setPicking(false); }
  }
  async function addPhotos(files: File[]) {
    try {
      if (photos.length + files.length > 3) throw new Error('Add up to 3 reference photos.');
      for (const file of files) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 15 * 1024 * 1024) throw new Error('Choose JPEG, PNG or WebP photos up to 15 MB each.');
        const bitmap = await createImageBitmap(file); const pixels = bitmap.width * bitmap.height; bitmap.close();
        if (pixels > 30000000) throw new Error('Each photo must be 30 megapixels or smaller.');
      }
      setPhotos(p => [...p, ...files.map(file => ({ file, url: URL.createObjectURL(file) }))]); setError('');
    } catch (e) { fail(e); }
  }
  async function swap() {
    if (!clip) return;
    setBusy(true); setError(''); setResult(''); setReady(0); setPlaying(false); closeCamera(); video.current?.pause();
    const start = Date.now(); const timer = setInterval(() => setStatus(`Creating your swap · ${Math.floor((Date.now() - start) / 1000)} s elapsed · usually about a minute`), 1000);
    try {
      const form = new FormData(); photos.forEach(p => form.append('photo', p.file)); form.append('clip_id', clip.clip_id); form.append('target', target.trim());
      const { job_id } = await request('/swaps', form);
      while (alive.current) {
        const job = await request(`/swaps/${job_id}`);
        if (job.status === 'error') throw new Error(job.error || 'Swap failed');
        if (job.status === 'done') { setResult(job.video_url); setStatus(`Done · ${job.seconds.toFixed(1)} s generation time`); break; }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (e) { fail(e); setStatus('Could not finish. You can retry with the same inputs.'); }
    finally { clearInterval(timer); setBusy(false); }
  }
  function stop() { original.current?.pause(); swapped.current?.pause(); setPlaying(false); }
  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4"><a href="/" className="font-display font-bold text-lg">ClipThat</a><nav className="flex gap-5 text-sm font-medium"><a href="/">← Studio</a><a href="/3d">3D View</a><span>Clip Gen</span></nav></header>
    <main className="mx-auto max-w-6xl px-5 py-10 space-y-6">
      <div><p className="text-xs font-semibold tracking-widest text-slate-500">GEMINI OMNI · EXPERIMENT</p><h1 className="font-display text-4xl font-bold mt-3">Step into the scene.</h1><p className="mt-3 text-slate-500">Pick a person. Add a face. Keep the moment.</p></div>
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700">{error}</p>}
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className={card}><h2 className="font-display text-xl font-bold">01 · Choose your clip</h2><div className="flex flex-wrap gap-2"><label className={button}>Upload video<input hidden disabled={busy} type="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska" onChange={e => { if (e.target.files?.[0]) void load(e.target.files[0]); e.target.value = ''; }} /></label><button className={button} disabled={busy} onClick={async () => { try { const r = await fetch('/dancers.mp4'); if (!r.ok) throw new Error('Could not load sample'); await load(new File([await r.blob()], 'dancers.mp4', { type: 'video/mp4' }), true); } catch (e) { fail(e); } }}>Try sample clip</button></div><p className="text-sm text-slate-500">MP4, MOV, WebM · up to 200 MB · minimum 3 seconds</p>
          <div className="min-h-52 rounded-xl bg-slate-950 flex items-center justify-center overflow-hidden">{clip ? <div className="relative w-full"><video ref={video} src={clip.url} playsInline className="w-full cursor-crosshair" onClick={pick} onPlay={() => setMarker(null)} />{marker && <span className="pointer-events-none absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-red-500" style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }} />}</div> : <span className="text-slate-400">Your scene starts here</span>}</div>
          {clip && <><div className="flex gap-3"><button className={button} onClick={() => { const v = video.current!; if (v.paused) void v.play().catch(fail); else v.pause(); }}>Play / pause</button><input aria-label="Clip position" className="min-w-0 flex-1" type="range" min="0" max={clip.duration} step="0.01" defaultValue="0" onChange={e => { video.current!.currentTime = Number(e.target.value); setMarker(null); }} /></div><p className="text-sm text-slate-500">{clip.duration.toFixed(1)} s · {clip.aspect_ratio} · first 10 seconds retained</p></>}
          {sample && <p className="text-xs text-slate-500">Video by <a className="underline" href="https://www.pexels.com/video/two-women-dancing-and-hugging-4800574/">Anna Shvets, Pexels</a> · <a className="underline" href="https://www.pexels.com/license/">Pexels license</a></p>}
        </section>
        <div className="space-y-5"><section className={card}><h2 className="font-display text-xl font-bold">02 · Pick a person</h2><p className="text-sm text-slate-500">Click a person to pause and select them. Click again to re-pick.</p><label className="block text-sm font-semibold" htmlFor="target">Who to replace</label><textarea id="target" maxLength={1000} rows={3} disabled={busy || picking} value={target} onChange={e => setTarget(e.target.value)} placeholder="Click a person, then refine the description here." className="w-full rounded-lg border border-slate-200 p-3 text-sm" /><p role="status" className="text-sm text-slate-500">{picking ? 'Identifying your person…' : 'The description is editable.'}</p></section>
          <section className={card}><h2 className="font-display text-xl font-bold">03 · Add references</h2><p className="text-sm text-slate-500">1–3 clear, well-lit photos of the same face. JPEG, PNG or WebP · up to 15 MB each.</p><div className="flex gap-2"><label className={button}>Add photos<input hidden type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy || photos.length >= 3} onChange={e => { void addPhotos(Array.from(e.target.files || [])); e.target.value = ''; }} /></label><button className={button} disabled={busy || photos.length >= 3} onClick={async () => { try { closeCamera(); if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera needs localhost or HTTPS. Please upload a photo.'); setCamera(await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })); } catch (e) { fail(e); } }}>Use camera</button></div>
            {camera && <div><video ref={selfie} autoPlay muted playsInline className="w-full rounded-lg" /><button className={button} onClick={async () => { try { const v = selfie.current!; if (!v.videoWidth) return; const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d')!.drawImage(v, 0, 0); await addPhotos([new File([await canvasBlob(c)], 'selfie.jpg', { type: 'image/jpeg' })]); closeCamera(); } catch (e) { fail(e); } }}>Take photo</button><button className={button} onClick={closeCamera}>Cancel</button></div>}
            <div className="flex gap-3">{photos.map((p, i) => <figure key={p.url}><img src={p.url} alt={`Reference photo ${i + 1}`} className="h-20 w-20 rounded-lg object-cover" /><button disabled={busy} className="text-xs underline" aria-label={`Remove reference photo ${i + 1}`} onClick={() => { URL.revokeObjectURL(p.url); setPhotos(photos.filter(q => q !== p)); }}>Remove</button></figure>)}</div><p className="text-xs text-slate-500">{photos.length}/3 selected</p>
          </section><section className={card}><h2 className="font-display text-xl font-bold">04 · Make the swap</h2><p className="text-sm text-slate-500">Original body, clothing and choreography stay. Public figures are blocked by Gemini. Only use photos you have permission to use.</p><button className={`${button} bg-slate-950 text-white hover:bg-slate-800`} disabled={busy || picking || !clip || !photos.length || !target.trim()} onClick={() => void swap()}>{busy ? 'Working…' : 'Swap character ↗'}</button><p role="status" className="text-sm text-slate-500">{status}</p></section></div>
      </div>
      {result && <section className={card}><div className="flex justify-between items-center"><h2 className="font-display text-2xl font-bold">The result</h2><a className={button} href={result} download="character-swap.mp4">Download MP4 ↓</a></div><div className="flex items-center gap-4"><button className={button} disabled={ready < 2} onClick={async () => { if (playing) { stop(); return; } const a = original.current!, b = swapped.current!; if (b.ended) b.currentTime = 0; a.currentTime = b.currentTime; try { await Promise.all([a.play(), b.play()]); setPlaying(true); } catch (e) { stop(); fail(e); } }}>{playing ? 'Pause' : solo ? 'Play swapped' : 'Play both'}</button><label className="text-sm"><input type="checkbox" checked={solo} onChange={e => setSolo(e.target.checked)} /> Swapped only</label></div><div className={`grid gap-4 ${solo ? '' : 'md:grid-cols-2'}`}><figure hidden={solo}><figcaption className="text-xs mb-2 text-slate-500">ORIGINAL</figcaption><video ref={original} src={clip?.url} muted playsInline onLoadedData={() => setReady(n => n + 1)} onEnded={stop} className="w-full rounded-xl" /></figure><figure><figcaption className="text-xs mb-2 text-slate-500">SWAPPED</figcaption><video ref={swapped} src={result} muted playsInline onLoadedData={() => setReady(n => n + 1)} onEnded={stop} onTimeUpdate={() => { if (playing && original.current && swapped.current && Math.abs(original.current.currentTime - swapped.current.currentTime) > .08) original.current.currentTime = swapped.current.currentTime; }} onError={() => setError('Could not load result video. Use Download to save it.')} className="w-full rounded-xl" /></figure></div><p className="text-sm text-slate-500">Synchronized playback · audio muted for comparison</p></section>}
    </main>
  </div>;
}
