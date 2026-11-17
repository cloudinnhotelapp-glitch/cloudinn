// Hands data fetched on the server (components/data/prefetch.tsx) to the browser's useApiQuery, keyed by request
// (lib/api-key.ts). The first render then shows the real content straight from the server's HTML, with no loading
// spinner and no extra round trip. Nested providers add to their parent's data. The data belongs to the signed-in user
// only: it travels in that user's own page response, which is never cached.
'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

// The data one server render fetched, and when.
export interface InitialDataSet {
  at: number;
  entries: Record<string, unknown>;
}

const InitialDataContext = createContext<InitialDataSet[]>([]);

// Adds one server render's data for the components below.
export function InitialData({ at, entries, children }: InitialDataSet & { children: ReactNode }) {
  const parent = useContext(InitialDataContext);
  const value = useMemo(() => [...parent, { at, entries }], [parent, at, entries]);
  return <InitialDataContext.Provider value={value}>{children}</InitialDataContext.Provider>;
}

// Server data already used by a component. Each server render's data serves only the first component that asks for it:
// a component mounted later (after a location switch re-mounts the page, for example) asks the API, so it can never show
// data from before the switch. Keyed by the server's entries object, which keeps its identity when the provider itself is
// mounted again.
const used = new WeakMap<object, Set<string>>();

// One server result: the data, when it was fetched, and the set it came from.
export interface InitialDataEntry {
  data: unknown;
  at: number;
  set: InitialDataSet;
}

// The server's data for a request key, unless it was used already; undefined when the server did not fetch it.
export function useInitialData(key: string | null): InitialDataEntry | undefined {
  const sets = useContext(InitialDataContext);
  if (key === null) return undefined;
  for (let i = sets.length - 1; i >= 0; i--) {
    const set = sets[i]!;
    if (Object.prototype.hasOwnProperty.call(set.entries, key)) return used.get(set.entries)?.has(key) ? undefined : { data: set.entries[key], at: set.at, set };
  }
  return undefined;
}

// Marks a server result as used (called after the component's first render, never during rendering).
export function markInitialDataUsed(set: InitialDataSet, key: string): void {
  const keys = used.get(set.entries) ?? new Set<string>();
  keys.add(key);
  used.set(set.entries, keys);
}
