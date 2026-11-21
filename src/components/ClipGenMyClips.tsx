import { useEffect, useState } from 'react';
import type { SavedClip } from '../shared/clipping';

export function clipPickerText(clip: Pick<SavedClip, 'title' | 'description' | 'brief' | 'answers'>) {
  const category = clip.answers.trigger_type || clip.answers.category;
  return {
    title: clip.title?.trim() || clip.brief?.title?.trim() || (category?.type === 'choice' ? category.choice : 'Highlight'),
    description: clip.description?.trim() || clip.brief?.description?.trim() || clip.brief?.summary?.trim() || 'No description is available for this older clip.',
  };
}

export function ClipGenMyClips({ disabled, onSelect }: { disabled: boolean; onSelect: (clip: SavedClip) => void }) {
  const [clips, setClips] = useState<SavedClip[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void (async () => {
      try {
        const response = await fetch('/api/clips/library', { signal: controller.signal });
        if (!response.ok) throw new Error('Could not load your clips.');
        const data = await response.json();
        if (!controller.signal.aborted) setClips(data.clips);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load your clips.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [attempt]);
  return <section aria-label="My clips" className="space-y-3 border-t border-slate-200 pt-4">
    <h3 className="font-display text-lg font-bold">My clips</h3>
    {loading ? <p role="status" className="text-sm text-slate-500">Loading your clips…</p> : error ? <div role="alert" className="text-sm text-rose-700">{error} <button className="underline" onClick={() => setAttempt(n => n + 1)}>Retry</button></div> : !clips.length ? <p className="text-sm text-slate-500">No clips yet</p> : <div className="grid max-h-80 grid-cols-2 gap-3 overflow-y-auto">
      {clips.map(clip => <button key={clip.id} disabled={disabled} onClick={() => onSelect(clip)} className="overflow-hidden rounded-xl border border-slate-200 text-left hover:border-slate-400 disabled:opacity-40">
        <video src={`${clip.url}#t=0.1`} muted playsInline preload="metadata" className="pointer-events-none h-24 w-full bg-slate-950 object-cover" />
        <span className="block truncate px-3 pt-2 text-sm font-semibold" title={clipPickerText(clip).title}>{clipPickerText(clip).title}</span>
        <span className="mx-3 my-1 line-clamp-2 text-xs text-slate-500" title={clipPickerText(clip).description}>{clipPickerText(clip).description}</span>
        <span className="block px-3 pb-2 text-xs text-slate-500">{clip.durationSec.toFixed(1)} s · Use this clip</span>
      </button>)}
    </div>}
  </section>;
}
