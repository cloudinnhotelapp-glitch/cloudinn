// Panel that calls GET /api/v1/health and shows whether the API and database are reachable.
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { HealthResponse } from '@hms/shared';
import { apiGet, errorMessages } from '@/lib/api-client';

// The three possible states of the health request.
type StatusState =
  | { kind: 'loading' }
  | { kind: 'ready'; health: HealthResponse }
  | { kind: 'error'; message: string };

// Human-readable text for each database state.
const DATABASE_LABELS: Record<HealthResponse['database'], string> = {
  up: 'Connected',
  down: 'Unreachable',
};

// Shows loading, error, and success states for the live API health check, with a retry button.
export function SystemStatus() {
  const [state, setState] = useState<StatusState>({ kind: 'loading' });

  // Fetches the health endpoint and stores the result or a readable error.
  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ready', health: await apiGet<HealthResponse>('/health') });
    } catch (error) {
      setState({ kind: 'error', message: errorMessages(error).join(' ') });
    }
  }, []);

  // Runs the first check when the panel appears.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    void load();
  }, [load]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <h2 className="text-base font-medium">System status</h2>

      {state.kind === 'loading' && <p className="mt-3 text-sm text-slate-500">Checking the API…</p>}

      {state.kind === 'error' && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          API unreachable: {state.message}. Is the API running on port 4000?
        </p>
      )}

      {state.kind === 'ready' && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-500">API</dt>
          <dd className="text-green-700 dark:text-green-400">Running</dd>
          <dt className="text-slate-500">Database</dt>
          <dd>{DATABASE_LABELS[state.health.database]}</dd>
          <dt className="text-slate-500">Checked at</dt>
          <dd>{new Date(state.health.timestamp).toLocaleString()}</dd>
        </dl>
      )}

      <button
        type="button"
        onClick={() => void load()}
        disabled={state.kind === 'loading'}
        className="mt-4 rounded-xl bg-brand-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-900 disabled:opacity-50"
      >
        Check again
      </button>
    </section>
  );
}
