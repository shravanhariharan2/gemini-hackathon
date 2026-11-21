import viewerScript from '../viewer3d/main.js?worker&url';
import template from '../viewer3d/template.html?raw';
import styles from '../viewer3d/style.css?raw';

export function Viewer3DPage() {
  const html = template
    .replace('<head>', `<head><base href="${window.location.origin}/3d">`)
    .replace('<link rel="icon" type="image/svg+xml" href="/icon.svg" />', '')
    .replace('<script type="module" src="/src/main.js"></script>', `<style>${styles}\n.topbar{display:none}main{padding-top:24px}button,input,select{font-family:inherit} :root{--accent:#0f172a;--radius:12px;--font:Inter,system-ui,sans-serif}</style><script type="module" src="${viewerScript}"></script>`);
  return <div className="h-dvh flex flex-col bg-slate-50">
    <header className="shrink-0 flex justify-between items-center bg-white border-b border-slate-200 px-6 py-4"><a className="font-display text-lg font-bold" href="/">ClipThat</a><nav className="flex gap-5 text-sm font-medium"><a href="/">← Studio</a><a href="/clip-gen">Clip Gen</a><span>3D View</span></nav></header>
    <iframe title="3D clip viewer" srcDoc={html} allow="xr-spatial-tracking; fullscreen; accelerometer; gyroscope" allowFullScreen className="w-full flex-1 border-0" />
  </div>;
}
