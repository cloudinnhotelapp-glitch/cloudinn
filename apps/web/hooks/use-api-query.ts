// React hook that loads data from the API and exposes loading, error, and reload state to a component. When the page was
// rendered on the server with this request's data (components/data/prefetch.tsx), the first render uses it straight away
// and the browser does not ask again unless that data is more than a few seconds old (for example a page kept in the
// router cache); later changes of path or query, and reload(), always ask the API.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { markInitialDataUsed, useInitialData } from '@/components/data/initial-data';
import { apiGet, type QueryParams } from '@/lib/api-client';
import { apiCacheKey } from '@/lib/api-key';

// Server data younger than this is used without asking the API again.
const SERVER_DATA_FRESH_MS = 15_000;

// What the hook returns: the latest data (kept while reloading), the last error, and a reload function.
export interface ApiQueryState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

// Fetches `path` (with optional query) whenever the path, query, or reload counter changes; cancels outdated requests.
export function useApiQuery<T>(path: string | null, query?: QueryParams): ApiQueryState<T> {
  const key = path === null ? null : apiCacheKey(path, query);
  const seed = useInitialData(key);
  const [data, setData] = useState<T | undefined>(() => seed?.data as T | undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(path !== null && seed === undefined);
  const [version, setVersion] = useState(0);
  // The server data of the first render, used once to skip the first request.
  const firstSeed = useRef(seed && key !== null ? { key, at: seed.at, set: seed.set } : null);
  const queryKey = JSON.stringify(query ?? {});

  useEffect(() => {
    if (path === null) return;
    const used = firstSeed.current;
    firstSeed.current = null;
    if (used) markInitialDataUsed(used.set, used.key);
    if (used && used.key === key && version === 0 && Date.now() - used.at < SERVER_DATA_FRESH_MS) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiGet<T>(path, JSON.parse(queryKey) as QueryParams, controller.signal)
      .then((result) => {
        setData(result);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(caught);
        setLoading(false);
      });
    return () => controller.abort();
  }, [path, queryKey, version, key]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { data, error, loading, reload };
}
