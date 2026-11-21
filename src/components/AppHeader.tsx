import type { ReactNode } from 'react';

export function AppHeader({ current, children }: { current: '/' | '/clip-gen' | '/3d'; children?: ReactNode }) {
  return <>
    <header className="h-14 md:h-16 shrink-0 bg-white border-b border-slate-200/80 px-3.5 md:px-6 flex items-center justify-between gap-3 md:gap-8">
      <a href="/" className="font-display text-base md:text-lg font-bold tracking-tight text-slate-950 whitespace-nowrap shrink-0">ClipThat</a>
      <nav aria-label="Main navigation" className="flex items-center gap-3.5 sm:gap-6 md:gap-7">
        {([['/', 'Studio'], ['/clip-gen', 'Clip Gen'], ['/3d', '3D View']] as const).map(([href, label]) => <a key={href} href={href} aria-current={current === href ? 'page' : undefined} className={`text-xs sm:text-sm font-medium whitespace-nowrap rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 ${current === href ? 'text-slate-950 underline underline-offset-4' : 'text-slate-600 hover:text-slate-950'}`}>{label}</a>)}
      </nav>
    </header>
    {children && <div className="shrink-0 flex flex-wrap items-center justify-end gap-3 border-b border-slate-200/80 bg-white px-3.5 py-2 md:px-6">{children}</div>}
  </>;
}
