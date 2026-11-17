'use client';
// Puts the saved-theme script into the server-rendered page only. When a layout is opened by a client-side navigation
// (for example right after signing in), React would create the script but never run it, and warns about it; the session
// provider applies the theme in that case instead.
import { useSyncExternalStore } from 'react';
import { THEME_BOOTSTRAP } from './theme';

// Nothing changes after the first render, so there is nothing to subscribe to.
const subscribe = () => () => {};

// Renders the script while the server HTML is hydrated, and nothing on a client-side mount. "script" defaults to the business app's.
export function ThemeBootstrap({ script = THEME_BOOTSTRAP }: { script?: string }) {
  const fromServer = useSyncExternalStore(subscribe, () => false, () => true);
  return fromServer ? <script dangerouslySetInnerHTML={{ __html: script }} /> : null;
}
