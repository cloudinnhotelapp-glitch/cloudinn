// Floor list with add, edit, activate, deactivate, and delete actions (Super Admin), or read-only for business users.
// Users without the manage permission see a read-only list (the API refuses their changes anyway).
'use client';

import { useState } from 'react';
import type { FloorDetail } from '@hms/shared';
import { Pagination } from '@/components/ui/pagination';
import { Icon } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DeleteRecordDialog, type DeleteTarget } from '@/components/ui/delete-record';
import { RowActions } from '@/components/ui/row-actions';
import { Field, inputClass } from '@/components/ui/fields';
import { useNotify } from '@/components/ui/notifications';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { ListFilters, useListFilter } from '@/components/ui/list-filters';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest, FormValidationError } from '@/lib/api-client';

// Props: the API base path ("" for the active location, or "/super-admin/locations/:id") and whether changes are allowed.
export interface PropertyManagerProps {
  apiBase: string;
  canManage: boolean;
}

// Text a floor is searched by.
const floorText = (floor: FloorDetail) => floor.name;

// The floor being edited (null when adding a new one).
type Editing = { floor: FloorDetail | null } | null;

// Loads the floors and renders the table plus the add/edit and status dialogs.
export function FloorsManager({ apiBase, canManage }: PropertyManagerProps) {
  const notify = useNotify();
  const { data, error, loading, reload } = useApiQuery<FloorDetail[]>(`${apiBase}/floors`);
  const filters = useListFilter(data, floorText);
  const [editing, setEditing] = useState<Editing>(null);
  const [name, setName] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [toggling, setToggling] = useState<FloorDetail | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);

  // Opens the add/edit dialog with the floor's current values.
  function openEditor(floor: FloorDetail | null) {
    setName(floor?.name ?? '');
    setSortOrder(String(floor?.sortOrder ?? 0));
    setEditing({ floor });
  }

  // Validates and saves the floor.
  async function save() {
    const problems: string[] = [];
    if (!name.trim() || name.trim().length > 60) problems.push('Enter a floor name of 1-60 characters.');
    if (!/^-?\d{1,3}$/.test(sortOrder.trim())) problems.push('Display order must be a whole number.');
    if (problems.length > 0) throw new FormValidationError(problems);
    const body = { name: name.trim(), sortOrder: Number(sortOrder) };
    if (editing?.floor) await apiRequest('PATCH', `${apiBase}/floors/${editing.floor.id}`, { body });
    else await apiRequest('POST', `${apiBase}/floors`, { body });
    notify(editing?.floor ? 'Floor saved.' : 'Floor added.');
    reload();
  }

  return (
    <section aria-labelledby="floors-heading" className="ui-list-panel">
      <div className="ui-list-header flex items-center justify-between gap-3">
        <h2 id="floors-heading" className="ui-section-title">
          Floors
        </h2>
        {canManage && (
          <Button onClick={() => openEditor(null)}>
            <Icon name="plus" className="h-5 w-5" />
            Add floor
          </Button>
        )}
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingState /> : null}
      {data && data.length > 0 && (
        <ListFilters
          idPrefix="floors"
          searchLabel="Search floors"
          search={filters.search}
          onSearch={filters.setSearch}
          status={filters.status}
          onStatus={filters.setStatus}
        />
      )}
      {data && data.length === 0 && <EmptyState message="No floors yet." />}
      {data && data.length > 0 && filters.visible.length === 0 && <EmptyState message="No floors match these filters." />}
      {filters.visible.length > 0 && (
        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead>
              <tr>
                <th>Floor</th>
                <th>Order</th>
                <th>Rooms</th>
                <th>Status</th>
                {canManage && <th className="text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filters.paged.map((floor) => (
                <tr key={floor.id}>
                  <td className="font-medium">{floor.name}</td>
                  <td className="tabular-nums">{floor.sortOrder}</td>
                  <td className="tabular-nums">{floor.roomCount}</td>
                  <td>
                    <StatusBadge status={floor.isActive ? 'ACTIVE' : 'INACTIVE'} />
                  </td>
                  {canManage && (
                    <td className="text-right">
                      <RowActions
                        label={`Actions for floor ${floor.name}`}
                        actions={[
                          { label: 'Edit floor', icon: 'edit', tone: 'emerald', onSelect: () => openEditor(floor) },
                          floor.isActive
                            ? { label: 'Deactivate floor', icon: 'toggleOff', tone: 'amber', onSelect: () => setToggling(floor) }
                            : { label: 'Activate floor', icon: 'toggleOn', tone: 'emerald', onSelect: () => setToggling(floor) },
                          {
                            label: 'Delete floor',
                            icon: 'trash',
                            tone: 'red',
                            onSelect: () =>
                              setDeleting({
                                kind: 'floor',
                                name: floor.name,
                                details: [`Display order ${floor.sortOrder}`, `${floor.roomCount} room${floor.roomCount === 1 ? '' : 's'}`, floor.isActive ? 'Active' : 'Inactive'],
                                checkPath: `${apiBase}/floors/${floor.id}/deletion-check`,
                                deletePath: `${apiBase}/floors/${floor.id}`,
                              }),
                          },
                        ]}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={filters.page} pageSize={filters.pageSize} total={filters.visible.length} onPageChange={filters.setPage} onPageSizeChange={filters.setPageSize} />

      <ConfirmDialog
        open={editing !== null}
        title={editing?.floor ? `Edit ${editing.floor.name}` : 'Add floor'}
        description="Floor names must be unique within this location."
        confirmLabel={editing?.floor ? 'Save floor' : 'Add floor'}
        onClose={() => setEditing(null)}
        onConfirm={save}
      >
        <Field id="floor-name" label="Floor name" required>
          <input id="floor-name" className={inputClass} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="floor-order" label="Display order" hint="Lower numbers are listed first (for example 0 for ground floor).">
          <input id="floor-order" inputMode="numeric" className={inputClass} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={toggling !== null}
        title={toggling?.isActive ? `Deactivate ${toggling?.name}?` : `Activate ${toggling?.name}?`}
        description={toggling?.isActive ? 'An inactive floor cannot receive new rooms. Floors that still have rooms in use cannot be deactivated.' : 'The floor can receive rooms again.'}
        confirmLabel={toggling?.isActive ? 'Deactivate floor' : 'Activate floor'}
        tone={toggling?.isActive ? 'danger' : 'primary'}
        onClose={() => setToggling(null)}
        onConfirm={async () => {
          await apiRequest('POST', `${apiBase}/floors/${toggling!.id}/${toggling!.isActive ? 'deactivate' : 'activate'}`);
          notify(toggling!.isActive ? 'Floor deactivated.' : 'Floor activated.');
          reload();
        }}
      />
      {canManage && <DeleteRecordDialog target={deleting} onClose={() => setDeleting(null)} onDeleted={reload} />}
    </section>
  );
}
