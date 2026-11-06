// React hook that reports whether a CSS media query (such as the desktop breakpoint) currently matches.
'use client';

import { useSyncExternalStore } from 'react';

// Subscribes to changes of the media query and returns whether it matches (false on the server).
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
