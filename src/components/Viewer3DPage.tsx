import viewerScript from '../viewer3d/main.js?worker&url';
import template from '../viewer3d/template.html?raw';
import styles from '../viewer3d/style.css?raw';
import { AppHeader } from './AppHeader';

export function Viewer3DPage() {
  const html = template
    .replace('<head>', `<head><base href="${window.location.origin}/3d">`)
    .replace('<link rel="icon" type="image/svg+xml" href="/icon.svg" />', '')
    .replace('<script type="module" src="/src/main.js"></script>', `<style>${styles}\n.topbar{display:none}main{padding-top:24px}button,input,select{font-family:inherit} :root{--accent:#0f172a;--radius:12px;--font:Inter,system-ui,sans-serif}</style><script type="module" src="${viewerScript}"></script>`);
  return <div className="h-dvh flex flex-col bg-slate-50">
    <AppHeader current="/3d" />
    <iframe title="3D clip viewer" srcDoc={html} allow="xr-spatial-tracking; fullscreen; accelerometer; gyroscope" allowFullScreen className="min-h-0 w-full flex-1 border-0" />
  </div>;
}
