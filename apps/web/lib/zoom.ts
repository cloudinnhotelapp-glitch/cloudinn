// Page zoom of the app (owner request 2026-11-16: zoom in and zoom out in the header for the Super Admin and every user).
// The level is a per-device convenience kept in this browser's storage; it is applied with CSS "zoom" on the <html>
// element and mirrored in the --app-zoom variable, which the few full-height layouts use to stay one screen tall.

// The available levels, in percent.
export const ZOOM_LEVELS = [80, 90, 100, 110, 125, 150] as const;

// The normal level.
export const DEFAULT_ZOOM = 100;

// Browser storage key of the chosen level.
export const ZOOM_STORAGE_KEY = 'cloudinn-zoom';

// Event fired on window whenever the level changes, so every zoom control shows the same value.
export const ZOOM_EVENT = 'cloudinn-zoom-change';

// Inline script for the root layout: applies the stored level before the first paint, so pages do not jump.
export const ZOOM_BOOT_SCRIPT = `(function(){try{var z=Number(localStorage.getItem('${ZOOM_STORAGE_KEY}'));if([${ZOOM_LEVELS.join(',')}].indexOf(z)>=0&&z!==${DEFAULT_ZOOM}){var r=document.documentElement;r.style.zoom=String(z/100);r.style.setProperty('--app-zoom',String(z/100));}}catch(e){}})();`;

// The current level in percent (100 on the server or when nothing is applied).
export function currentZoom(): number {
  if (typeof document === 'undefined') return DEFAULT_ZOOM;
  const value = Number.parseFloat(document.documentElement.style.zoom);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : DEFAULT_ZOOM;
}

// The current zoom as a factor (1 = normal). Code that places fixed elements from getBoundingClientRect divides by it,
// because CSS lengths are multiplied by the zoom while screen coordinates are not.
export function zoomFactor(): number {
  return currentZoom() / 100;
}

// Applies and remembers a level, then tells every zoom control.
export function setZoom(level: number): void {
  const root = document.documentElement;
  if (level === DEFAULT_ZOOM) {
    root.style.removeProperty('zoom');
    root.style.removeProperty('--app-zoom');
  } else {
    root.style.zoom = String(level / 100);
    root.style.setProperty('--app-zoom', String(level / 100));
  }
  try {
    if (level === DEFAULT_ZOOM) localStorage.removeItem(ZOOM_STORAGE_KEY);
    else localStorage.setItem(ZOOM_STORAGE_KEY, String(level));
  } catch {
    // Storage can be blocked (private windows); the level then lasts only for this page.
  }
  window.dispatchEvent(new Event(ZOOM_EVENT));
}
