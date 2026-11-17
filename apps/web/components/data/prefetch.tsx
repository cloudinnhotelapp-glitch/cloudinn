// Server Component that fetches a page's first API requests on the server, in parallel, while the page is rendered, and
// hands the results to the page's client components (SSR audit 2026-11-16). The requests must be exactly the ones the
// page's components make on their first render, or they are simply not matched and load in the browser as before. A
// request the user may not make (403), an expired session, or an API error just leaves that request out.
import type { ReactNode } from 'react';
import type { QueryParams } from '@/lib/api-client';
import { apiCacheKey } from '@/lib/api-key';
import { serverApiGet, type ServerAccount } from '@/lib/server-api';
import { InitialData } from './initial-data';

// One request: the API path and its query.
export type PrefetchRequest = readonly [path: string, query?: QueryParams];

// Fetches the requests in parallel; returns the successful results by key, and when they were fetched.
async function load(account: ServerAccount, requests: readonly PrefetchRequest[]): Promise<{ at: number; entries: Record<string, unknown> }> {
  const results = await Promise.all(requests.map(([path, query]) => serverApiGet<unknown>(account, path, query)));
  const entries: Record<string, unknown> = {};
  results.forEach((result, index) => {
    const [path, query] = requests[index]!;
    if (result.ok) entries[apiCacheKey(path, query)] = result.data;
  });
  return { at: Date.now(), entries };
}

// Fetches the requests and renders the children with the results.
export async function Prefetch({ account = 'business', requests, children }: { account?: ServerAccount; requests: readonly PrefetchRequest[]; children: ReactNode }) {
  const { at, entries } = await load(account, requests);
  return (
    <InitialData at={at} entries={entries}>
      {children}
    </InitialData>
  );
}
