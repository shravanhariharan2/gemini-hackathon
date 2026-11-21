import { useEffect, useState, type RefObject } from 'react';
import { Play, Pause } from 'lucide-react';

export function videoTime(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export function isPlaybackAbort(error: unknown) {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

export function ClipGenVideoControls({ primary, secondary, source, label, onError }: {
  primary: RefObject<HTMLVideoElement | null>;
  secondary?: RefObject<HTMLVideoElement | null>;
  source: string;
  label: string;
  onError: (error: unknown) => void;
}) {
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0), [duration, setDuration] = useState(0);
  useEffect(() => {
    const main = primary.current, other = secondary?.current;
    if (!main) return;
    const videos = other ? [main, other] : [main];
    const update = () => {
      setPlaying(!main.paused && !main.ended);
      setTime(main.currentTime);
      setDuration(videos.every(v => Number.isFinite(v.duration) && v.duration > 0) ? Math.min(...videos.map(v => v.duration)) : 0);
      if (other && Math.abs(other.currentTime - main.currentTime) > .08) other.currentTime = main.currentTime;
    };
    const stop = () => { videos.forEach(v => v.pause()); update(); };
    const events = ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'seeked'];
    videos.forEach(v => {
      events.forEach(event => v.addEventListener(event, update));
      v.addEventListener('ended', stop);
    });
    main.addEventListener('pause', stop);
    update();
    return () => {
      videos.forEach(v => {
        events.forEach(event => v.removeEventListener(event, update));
        v.removeEventListener('ended', stop);
        v.pause();
      });
      main.removeEventListener('pause', stop);
    };
  }, [primary, secondary, source]);
  const videos = () => [primary.current, secondary?.current].filter((v): v is HTMLVideoElement => !!v);
  async function toggle() {
    const main = primary.current;
    if (!main) return;
    const group = videos();
    if (!main.paused) { group.forEach(v => v.pause()); return; }
    if (main.ended || main.currentTime >= duration) group.forEach(v => { v.currentTime = 0; });
    else group.forEach(v => { v.currentTime = main.currentTime; });
    try { await Promise.all(group.map(v => v.play())); }
    catch (error) {
      group.forEach(v => v.pause()); setPlaying(false);
      if (!isPlaybackAbort(error)) onError(error);
    }
  }
  return <div role="group" aria-label={`${label} playback`} className="flex items-center gap-3">
    <button type="button" aria-label={`${playing ? 'Pause' : 'Play'} ${label}`} disabled={!duration} onClick={() => void toggle()} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">
      {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
    </button>
    <input aria-label={`${label} position`} type="range" min="0" max={duration} step="0.01" value={Math.min(time, duration)} disabled={!duration} className="min-w-0 flex-1 accent-slate-900" onChange={event => {
      const next = Math.max(0, Math.min(duration, Number(event.target.value)));
      videos().forEach(v => { v.currentTime = next; }); setTime(next);
    }} />
    <span className="shrink-0 text-xs tabular-nums text-slate-500">{videoTime(time)} / {videoTime(duration)}</span>
  </div>;
}
