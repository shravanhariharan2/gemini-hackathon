import { useCallback, useEffect, useRef, useState } from 'react';
import { registerClipSink } from '../services/clipSink';
import { RollingRecorder, type BufferedMedia } from '../services/rollingRecorder';
import { createStageCapture } from '../services/stageCapture';
import { DEFAULT_RULES, DEFAULT_THRESHOLDS, probability, type ClipResult, type ClipRules, type ClipThresholds, type ClipStage, type SavedClip } from '../shared/clipping';
import type { ChatMessage, RoomParticipant } from '../utils/types';

export interface ImportableClip { id: string; runId: string; clipId: number; title: string; start: number; end: number }
interface Options { active: boolean; roomId: string; localStream: MediaStream | null; remoteStreams: Record<string, MediaStream>; participants: RoomParticipant[]; selfName: string; messages: ChatMessage[] }
export async function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('Could not read recording.')); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(blob); });
}
export function useAutoClipper(options: Options) {
  const [autoProbe, setAutoProbe] = useState(true);
  const [includeChat, setIncludeChat] = useState(false);
  const [deepJudge, setDeepJudge] = useState(true);
  const [intervalSec, setIntervalSec] = useState(15);
  const [resolution, setResolution] = useState<'medium' | 'high'>('medium');
  const [rules, setRules] = useState<ClipRules>(DEFAULT_RULES);
  const [thresholds, setThresholds] = useState<ClipThresholds>(DEFAULT_THRESHOLDS);
  const [queue, setQueue] = useState<SavedClip[]>([]);
  const [history, setHistory] = useState<{ id: string; stage: ClipStage; result: ClipResult }[]>([]);
  const [latest, setLatest] = useState<ClipResult | null>(null);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState('Offline');
  const [bufferedSeconds, setBufferedSeconds] = useState(0);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ configured: boolean; mediaReady: boolean } | null>(null);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [imports, setImports] = useState<ImportableClip[]>([]);
  const ready = libraryLoaded && !!status?.configured && !!status?.mediaReady;
  const recorder = useRef<RollingRecorder | null>(null);
  const capture = useRef<ReturnType<typeof createStageCapture> | null>(null);
  const latestConfig = useRef({ options, includeChat, deepJudge, resolution, rules, thresholds });
  latestConfig.current = { options, includeChat, deepJudge, resolution, rules, thresholds };
  const generation = useRef(0);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef<{ deadline: number; source: string } | null>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTrigger = useRef(0);
  const refreshLibrary = useCallback(async () => {
    try {
      const response = await fetch('/api/clips/library');
      if (!response.ok) throw new Error('Could not load My Clips.');
      const data = await response.json(); setQueue(data.clips); setLibraryLoaded(true);
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => {
    void fetch('/api/clips/status').then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(setStatus).catch(() => setError('Could not check the clipping server.'));
    void refreshLibrary();
    void fetch('/api/clips/imports').then(r => r.ok ? r.json() : { runs: [] }).then(data => setImports(data.runs)).catch(() => {});
    const refresh = () => { if (document.visibilityState === 'visible') void refreshLibrary(); };
    const timer = setInterval(refresh, 15_000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [refreshLibrary]);

  const cancelSession = useCallback(() => {
    generation.current++; lastTrigger.current = 0; controller.current?.abort(); controller.current = null;
    pending.current = null; if (pendingTimer.current) clearTimeout(pendingTimer.current);
    inFlight.current = false; setBusy(false);
  }, []);
  useEffect(() => {
    cancelSession(); setError('');
    if (!options.active || !options.localStream) { setPhase('Offline'); setBufferedSeconds(0); setRecording(false); return; }
    try {
      const stage = createStageCapture(); capture.current = stage;
      const buffer = new RollingRecorder(stage.stream, message => { setError(message); setRecording(false); }); recorder.current = buffer;
      setRecording(true); setPhase('Buffering');
      const tick = setInterval(() => { setBufferedSeconds(Math.floor(buffer.bufferedSeconds)); if (pending.current) setPhase(pending.current.deadline > Date.now() ? `Post-roll · ${Math.ceil((pending.current.deadline - Date.now()) / 1000)}s` : 'Waiting for current analysis'); }, 500);
      return () => { clearInterval(tick); buffer.stop(); stage.stop(); recorder.current = null; capture.current = null; cancelSession(); setRecording(false); setBufferedSeconds(0); };
    } catch (e) { capture.current?.stop(); capture.current = null; setError((e as Error).message); setRecording(false); }
  }, [options.active, options.roomId, !!options.localStream, cancelSession]);

  useEffect(() => {
    if (!capture.current || !options.localStream) return;
    capture.current.update([{ stream: options.localStream, name: options.selfName || 'You' }, ...Object.entries(options.remoteStreams).map(([id, stream]) => ({ stream, name: options.participants.find(p => p.id === id)?.name || 'Guest' }))]);
  }, [options.localStream, options.remoteStreams, options.participants, options.selfName, options.active, options.roomId]);

  const analyze = useCallback(async (media: BufferedMedia, stage: ClipStage, source: string, token: number) => {
    if (token !== generation.current) return null;
    const c = latestConfig.current;
    const chat = c.includeChat ? c.options.messages.filter(m => m.timestamp >= media.startedAt && m.timestamp <= media.endedAt).slice(-100).map(m => ({ name: m.senderName.slice(0, 80), text: m.text.slice(0, 1000), offsetSec: (m.timestamp - media.startedAt) / 1000 })) : [];
    const abort = new AbortController(); controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 240_000);
    try {
      const response = await fetch('/api/clips/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal, body: JSON.stringify({ stage, resolution: stage === 'judge' ? c.resolution : 'low', media: await toBase64(media.blob), durationSec: media.durationSec, targetSeconds: stage === 'judge' ? 60 : 15, chat, rules: c.rules, capture: { id: crypto.randomUUID(), roomId: c.options.roomId, source, startedAt: media.startedAt, thresholds: c.thresholds } }) });
      const result = await response.json() as ClipResult & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Clip analysis failed.');
      if (token !== generation.current) return null;
      const { media: video, ...metadata } = result;
      setLatest(metadata);
      setHistory(old => [{ id: crypto.randomUUID(), stage, result: metadata }, ...old].slice(0, 20));
      if (result.savedClip) setQueue(old => [result.savedClip!, ...old.filter(clip => clip.id !== result.savedClip!.id)]);
      return result;
    } finally { clearTimeout(timeout); }
  }, []);

  const run = useCallback(async (stage: ClipStage, source: string) => {
    if (!ready || !recorder.current || recorder.current.bufferedSeconds < 1 || inFlight.current) return null;
    const token = generation.current; inFlight.current = true; setBusy(true); setError(''); setPhase(stage === 'probe' ? 'Probing' : 'Judging');
    try {
      const media = await recorder.current.snapshot(stage === 'judge' ? 60 : 15);
      const result = await analyze(media, stage, source, token);
      return result ? { result, endedAt: media.endedAt } : null;
    }
    catch (e) { if (token === generation.current) { setError((e as Error).name === 'AbortError' ? 'Analysis timed out. Retry manually.' : (e as Error).message); setAutoProbe(false); } return null; }
    finally { if (token === generation.current) { inFlight.current = false; setBusy(!!pending.current); setPhase(pending.current ? 'Post-roll' : 'Buffering'); } }
  }, [analyze, ready]);

  const flush = useCallback((source = 'manual', triggeredAt = Date.now()) => {
    if (!ready || !recorder.current || recorder.current.bufferedSeconds < 1 || pending.current) return;
    const token = generation.current;
    // API latency already contributed post-roll after the probed window ended.
    const delay = latestConfig.current.deepJudge ? Math.max(0, triggeredAt + 10_000 - Date.now()) : 0;
    pending.current = { deadline: Date.now() + delay, source }; setBusy(true); setPhase(delay ? `Post-roll · ${Math.ceil(delay / 1000)}s` : 'Waiting for current analysis');
    const captureWhenReady = () => {
      if (token !== generation.current || !pending.current) return;
      if (inFlight.current) { pendingTimer.current = setTimeout(captureWhenReady, 250); return; }
      const job = pending.current; pending.current = null;
      void run('judge', job.source);
    };
    pendingTimer.current = setTimeout(captureWhenReady, delay);
  }, [run, ready]);
  const probe = useCallback(async () => {
    if (pending.current || inFlight.current || !recorder.current) return;
    const stage = latestConfig.current.deepJudge ? 'probe' : 'instant';
    const token = generation.current;
    const outcome = await run(stage, 'auto-probe');
    if (token !== generation.current || !outcome || stage !== 'probe') return;
    if ((probability(outcome.result.answers, 'trigger_detected') ?? 0) >= latestConfig.current.thresholds.trigger && outcome.endedAt - lastTrigger.current >= 30_000) {
      lastTrigger.current = outcome.endedAt; flush('auto-trigger', outcome.endedAt);
    }
  }, [run, flush]);
  useEffect(() => { if (!autoProbe || !recording || !ready) return; const timer = setInterval(() => void probe(), intervalSec * 1000); return () => clearInterval(timer); }, [autoProbe, recording, ready, intervalSec, probe]);
  useEffect(() => {
    registerClipSink({ name: 'gemini-decisions', onClipMarked: ({ marker }) => { if (marker.roomId === latestConfig.current.options.roomId && latestConfig.current.options.active) flush(marker.source); } });
    return () => registerClipSink(null);
  }, [flush]);
  const remove = async (id: string) => {
    try {
      const response = await fetch(`/api/clips/library/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not delete clip.');
      setQueue(old => old.filter(c => c.id !== id));
    } catch (e) { setError((e as Error).message); }
  };
  const importClip = async (entry: ImportableClip) => {
    try {
      const response = await fetch('/api/clips/library/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: entry.runId, clipId: entry.clipId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not import clip.');
      setQueue(old => [data.clip, ...old.filter(c => c.id !== data.clip.id)]);
      setImports(old => old.filter(c => c.runId !== entry.runId || c.clipId !== entry.clipId));
    } catch (e) { setError((e as Error).message); }
  };
  return { autoProbe, setAutoProbe, includeChat, setIncludeChat, deepJudge, setDeepJudge, intervalSec, setIntervalSec, resolution, setResolution, setRules, rules, thresholds, setThresholds, queue, history, latest, error, setError, phase, bufferedSeconds, recording, busy, status, ready, probe, flush, remove, imports: imports.filter(entry => !queue.some(clip => clip.id === entry.id)), importClip, libraryLoaded };
}
