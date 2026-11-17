// Keeps a page's form controls disabled until React has taken over the server-rendered HTML (SSR audit 2026-11-16).
// Signed-in pages now arrive with their forms already drawn; without this, text typed or a button pressed in the short
// moment before the page's JavaScript is ready would be lost. A native <fieldset disabled> disables every input, select,
// textarea, and button inside it (links keep working), and it is lifted as soon as the page is interactive.
'use client';

import { useSyncExternalStore, type ReactNode } from 'react';

// Nothing to subscribe to: the value only changes from the server render to the first browser render.
const subscribe = () => () => {};

// Renders the children inside a fieldset that is disabled on the server and enabled in the browser.
export function InteractiveAfterHydration({ children }: { children: ReactNode }) {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return (
    <fieldset disabled={!hydrated} data-hydrated={hydrated ? 'true' : 'false'} className="m-0 min-w-0 border-0 p-0">
      {children}
    </fieldset>
  );
}
