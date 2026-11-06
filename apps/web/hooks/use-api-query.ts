// React hook that loads data from the API and exposes loading, error, and reload state to a component.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, type QueryParams } from '@/lib/api-client';

// What the hook returns: the latest data (kept while reloading), the last error, and a reload function.
export interface ApiQueryState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

// Fetches `path` (with optional query) whenever the path, query, or reload counter changes; cancels outdated requests.
export function useApiQuery<T>(path: string | null, query?: QueryParams): ApiQueryState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(path !== null);
  const [version, setVersion] = useState(0);
  const queryKey = JSON.stringify(query ?? {});

  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- marks the start of a new request for this effect run
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
  }, [path, queryKey, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { data, error, loading, reload };
}
