// "Favourite Items" section of the Favourites page (/favourites): each user's own pinned pages, kept on the server and limited by the server to pages their role can open.
'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { FavouriteItem, FavouritesResponse } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Icon, type IconName } from '@/components/ui/icons';
import { useNotify } from '@/components/ui/notifications';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Panel } from '@/components/ui/summary-card';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest } from '@/lib/api-client';

// Loads the user's favourites and shows them as shortcut tiles.
export function FavouritesPanel() {
  const { data, error, loading, reload } = useApiQuery<FavouritesResponse>('/favourites');
  const [managing, setManaging] = useState(false);
  return (
    <Panel
      title="Favourite Items"
      icon="star"
      action={
        <Button variant="secondary" size="sm" onClick={() => setManaging(true)} disabled={!data}>
          Manage
        </Button>
      }
    >
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingState /> : null}
      {data && data.favourites.length === 0 && <p className="m-0 text-sm text-slate-500">Nothing here yet. Choose Manage to add the pages you use most.</p>}
      {data && data.favourites.length > 0 && (
        <ul aria-label="Favourites" className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-5">
          {data.favourites.map((item) => (
            <li key={item.key}>
              <Link href={item.href} className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-center text-sm font-semibold text-slate-700 transition hover:-translate-y-0.5 hover:border-brand-300 hover:bg-brand-50/60 hover:text-brand-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
                <Icon name={item.icon as IconName} className="h-6 w-6 text-brand-700 dark:text-emerald-300" />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data && managing && (
        <ManageDialog
          data={data}
          onClose={() => setManaging(false)}
          onSaved={reload}
        />
      )}
    </Panel>
  );
}

// Popup to add, remove, and reorder favourites; nothing is saved until the user confirms.
function ManageDialog({ data, onClose, onSaved }: { data: FavouritesResponse; onClose: () => void; onSaved: () => void }) {
  const notify = useNotify();
  const [keys, setKeys] = useState(() => data.favourites.map((item) => item.key));
  const find = (key: string) => data.available.find((item) => item.key === key) as FavouriteItem;
  const remaining = data.available.filter((item) => !keys.includes(item.key));

  // Moves one chosen item up or down the list.
  function move(index: number, change: -1 | 1) {
    setKeys((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(index + change, 0, item!);
      return next;
    });
  }

  // Saves the whole ordered list.
  async function save() {
    await apiRequest('PUT', '/favourites', { body: { keys } });
    notify('Favourites saved.');
    onSaved();
  }

  const iconButton = 'flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800';
  return (
    <ConfirmDialog open title="Manage favourites" description="Pin the pages you use most. Only pages your role can open are listed." confirmLabel="Save favourites" size="lg" onConfirm={save} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <section aria-label="Your favourites" className="flex flex-col gap-2">
          <h3 className="ui-section-title m-0">Your favourites</h3>
          {keys.length === 0 && <p className="m-0 text-sm text-slate-500">None chosen yet.</p>}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {keys.map((key, index) => {
              const item = find(key);
              return (
                <li key={key} className="flex items-center gap-2 rounded-xl border border-slate-200 p-2 dark:border-slate-700">
                  <Icon name={item.icon as IconName} className="h-5 w-5 shrink-0 text-brand-700 dark:text-emerald-300" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">{item.label}</span>
                  <button type="button" className={iconButton} aria-label={`Move ${item.label} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                    <Icon name="arrowUp" className="h-[18px] w-[18px]" />
                  </button>
                  <button type="button" className={iconButton} aria-label={`Move ${item.label} down`} disabled={index === keys.length - 1} onClick={() => move(index, 1)}>
                    <Icon name="arrowDown" className="h-[18px] w-[18px]" />
                  </button>
                  <button type="button" className={iconButton} aria-label={`Remove ${item.label}`} onClick={() => setKeys((current) => current.filter((k) => k !== key))}>
                    <Icon name="close" className="h-[18px] w-[18px]" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        <section aria-label="Add a page" className="flex flex-col gap-2">
          <h3 className="ui-section-title m-0">Add a page</h3>
          {remaining.length === 0 && <p className="m-0 text-sm text-slate-500">Every page you can open is already pinned.</p>}
          <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
            {remaining.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  aria-label={`Add ${item.label}`}
                  onClick={() => setKeys((current) => [...current, item.key])}
                  className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Icon name="plus" className="h-[18px] w-[18px] shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </ConfirmDialog>
  );
}
