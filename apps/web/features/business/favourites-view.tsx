// Favourites page of the business app (/favourites), the "Favourites" menu item under Dashboard (owner decision
// 2026-11-11) for Admins, Managers, and Receptionists: the user's own pinned pages, with Manage to add, remove, and
// reorder them. This is the only place favourites are shown (owner decision 2026-11-11: not on the dashboard).
'use client';

import { EmptyState, LoadingState } from '@/components/ui/states';
import { useBusinessSession } from './business-session';
import { FavouritesPanel } from './dashboard/favourites-panel';

// Page heading, then the favourites panel.
export function FavouritesView() {
  const { info, can } = useBusinessSession();
  if (!info) return <LoadingState />;
  if (!can('dashboard.view')) return <EmptyState message="You do not have access to favourites." />;
  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="ui-page-title">Favourites</h1>
        <p className="text-sm text-slate-500">Your shortcuts to the pages you use most. Choose Manage to change them.</p>
      </div>
      <FavouritesPanel />
    </section>
  );
}
