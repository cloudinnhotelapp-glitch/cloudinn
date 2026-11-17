// Zoom out, current level (click to reset to 100%), and zoom in, shown in the header of every app (owner request
// 2026-11-16). The level is stored per browser and applies to every page.
'use client';

import { useSyncExternalStore } from 'react';
import { DEFAULT_ZOOM, ZOOM_EVENT, ZOOM_LEVELS, currentZoom, setZoom } from '@/lib/zoom';
import { Icon } from './icons';

// Listens for level changes made by any zoom control.
function subscribe(onChange: () => void): () => void {
  window.addEventListener(ZOOM_EVENT, onChange);
  return () => window.removeEventListener(ZOOM_EVENT, onChange);
}

const BUTTON =
  'grid h-8 w-8 place-items-center rounded-lg border-none bg-transparent text-slate-600 transition-colors hover:bg-emerald-100/60 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800';

// Renders the three buttons.
export function ZoomControl() {
  const level = useSyncExternalStore(subscribe, currentZoom, () => DEFAULT_ZOOM);
  const index = ZOOM_LEVELS.indexOf(level as (typeof ZOOM_LEVELS)[number]);
  const lower = index > 0 ? ZOOM_LEVELS[index - 1] : index < 0 ? DEFAULT_ZOOM : undefined;
  const higher = index >= 0 && index < ZOOM_LEVELS.length - 1 ? ZOOM_LEVELS[index + 1] : index < 0 ? DEFAULT_ZOOM : undefined;
  return (
    <div role="group" aria-label="Zoom" className="flex items-center rounded-xl border border-shell-line bg-white/70 p-0.5 dark:border-slate-800 dark:bg-slate-900/70">
      <button type="button" className={BUTTON} aria-label="Zoom out" title="Zoom out" disabled={lower === undefined} onClick={() => lower !== undefined && setZoom(lower)}>
        <Icon name="minus" className="h-[18px] w-[18px]" />
      </button>
      <button
        type="button"
        aria-label={`Zoom ${level}%, reset to 100%`}
        title="Reset zoom"
        onClick={() => setZoom(DEFAULT_ZOOM)}
        data-testid="zoom-level"
        className="min-w-[3.25rem] rounded-lg border-none bg-transparent px-1 py-1 text-xs font-bold tabular-nums text-slate-700 transition-colors hover:bg-emerald-100/60 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        {level}%
      </button>
      <button type="button" className={BUTTON} aria-label="Zoom in" title="Zoom in" disabled={higher === undefined} onClick={() => higher !== undefined && setZoom(higher)}>
        <Icon name="plus" className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
}
