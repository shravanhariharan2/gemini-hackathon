import viewerScript from '../viewer3d/main.js?worker&url';
import template from '../viewer3d/template.html?raw';
import styles from '../viewer3d/style.css?raw';
import { AppHeader } from './AppHeader';
import { useEffect, useRef, useState } from 'react';
import { ClipGenMyClips, clipPickerText } from './ClipGenMyClips';

export function Viewer3DPage() {
  const viewer = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.source === viewer.current?.contentWindow && event.data?.type === 'viewer3d-ready') setReady(true);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  const html = template
    .replace('<head>', `<head><base href="${window.location.origin}/3d">`)
    .replace('<link rel="icon" type="image/svg+xml" href="/icon.svg" />', '')
    .replace('<script type="module" src="/src/main.js"></script>', `<style>${styles}\n.topbar{display:none}main{padding-top:24px}button,input,select{font-family:inherit} :root{--accent:#0f172a;--radius:12px;--font:Inter,system-ui,sans-serif}</style><script type="module" src="${viewerScript}"></script>`);
  return <div className="h-dvh flex flex-col bg-slate-50">
    <AppHeader current="/3d" />
    <div className="min-h-0 flex-1 overflow-y-auto lg:flex lg:overflow-hidden">
      <aside className="shrink-0 p-4 lg:w-80 lg:overflow-y-auto">
        <ClipGenMyClips disabled={!ready} onSelect={clip => viewer.current?.contentWindow?.postMessage({ type: 'viewer3d-clip', url: clip.url, title: clipPickerText(clip).title }, window.location.origin)} />
        <p className="mt-3 text-xs text-slate-500">Saved clips play in 2D. Look-around needs depth video; wiggle, red/cyan and headset modes need stereo video. Try the demos for those modes.</p>
      </aside>
      <iframe ref={viewer} title="3D clip viewer" srcDoc={html} allow="xr-spatial-tracking; fullscreen; accelerometer; gyroscope" allowFullScreen className="h-dvh min-h-0 w-full flex-1 border-0 lg:h-full lg:min-w-0" />
    </div>
  </div>;
}
