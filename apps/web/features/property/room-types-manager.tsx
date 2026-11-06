// Room-type list with add, edit, activate, deactivate, and delete actions (Super Admin), or read-only for business users.
'use client';

import { useState } from 'react';
import type { RoomTypeDetail } from '@hms/shared';
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
import type { PropertyManagerProps } from './floors-manager';

// Same money rule as the server: non-negative, up to 2 decimals.
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

// Text a room type is searched by (name and description).
const roomTypeText = (type: RoomTypeDetail) => `${type.name} ${type.description ?? ''}`;

// Form values for one room type.
interface RoomTypeForm {
  name: string;
  description: string;
  defaultCapacity: string;
  defaultStandardRate: string;
  defaultExtraBedRate: string;
}

// Converts a room type (or nothing) into form values.
function toForm(type: RoomTypeDetail | null): RoomTypeForm {
  return {
    name: type?.name ?? '',
    description: type?.description ?? '',
    defaultCapacity: String(type?.defaultCapacity ?? 2),
    defaultStandardRate: type?.defaultStandardRate ?? '',
    defaultExtraBedRate: type?.defaultExtraBedRate ?? '0',
  };
}

// Loads the room types and renders the table plus the add/edit and status dialogs.
export function RoomTypesManager({ apiBase, canManage }: PropertyManagerProps) {
  const notify = useNotify();
  const { data, error, loading, reload } = useApiQuery<RoomTypeDetail[]>(`${apiBase}/room-types`);
  const filters = useListFilter(data, roomTypeText);
  const [editing, setEditing] = useState<{ type: RoomTypeDetail | null } | null>(null);
  const [form, setForm] = useState<RoomTypeForm>(toForm(null));
  const [toggling, setToggling] = useState<RoomTypeDetail | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);

  // Updates one form field.
  const set = (key: keyof RoomTypeForm) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  // Validates and saves the room type.
  async function save() {
    const problems: string[] = [];
    if (form.name.trim().length < 2) problems.push('Enter a name of at least 2 characters.');
    const capacity = Number(form.defaultCapacity);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 20) problems.push('Capacity must be a whole number from 1 to 20.');
    if (!MONEY.test(form.defaultStandardRate.trim())) problems.push('Enter the nightly rate, for example 3500.00.');
    if (!MONEY.test(form.defaultExtraBedRate.trim())) problems.push('Enter the extra-bed rate, for example 800 or 0.');
    if (problems.length > 0) throw new FormValidationError(problems);
    const body = {
      name: form.name.trim(),
      description: form.description.trim(),
      defaultCapacity: capacity,
      defaultStandardRate: form.defaultStandardRate.trim(),
      defaultExtraBedRate: form.defaultExtraBedRate.trim(),
    };
    if (editing?.type) await apiRequest('PATCH', `${apiBase}/room-types/${editing.type.id}`, { body });
    else await apiRequest('POST', `${apiBase}/room-types`, { body });
    notify(editing?.type ? 'Room type saved.' : 'Room type added.');
    reload();
  }

  return (
    <section aria-labelledby="room-types-heading" className="ui-list-panel">
      <div className="ui-list-header flex items-center justify-between gap-3">
        <h2 id="room-types-heading" className="ui-section-title">
          Room types
        </h2>
        {canManage && (
          <Button
            onClick={() => {
              setForm(toForm(null));
              setEditing({ type: null });
            }}
          >
            <Icon name="plus" className="h-5 w-5" />
            Add room type
          </Button>
        )}
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingState /> : null}
      {data && data.length > 0 && (
        <ListFilters
          idPrefix="room-types"
          searchLabel="Search room types"
          search={filters.search}
          onSearch={filters.setSearch}
          status={filters.status}
          onStatus={filters.setStatus}
        />
      )}
      {data && data.length === 0 && <EmptyState message="No room types yet." />}
      {data && data.length > 0 && filters.visible.length === 0 && <EmptyState message="No room types match these filters." />}
      {filters.visible.length > 0 && (
        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead>
              <tr>
                <th>Room type</th>
                <th>Capacity</th>
                <th>Nightly rate</th>
                <th>Extra bed</th>
                <th>Rooms</th>
                <th>Status</th>
                {canManage && <th className="text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filters.paged.map((type) => (
                <tr key={type.id}>
                  <td>
                    <span className="font-medium">{type.name}</span>
                    {type.description && <span className="block text-xs text-slate-500">{type.description}</span>}
                  </td>
                  <td className="tabular-nums">{type.defaultCapacity}</td>
                  <td className="tabular-nums">{type.defaultStandardRate}</td>
                  <td className="tabular-nums">{type.defaultExtraBedRate}</td>
                  <td className="tabular-nums">{type.roomCount}</td>
                  <td>
                    <StatusBadge status={type.isActive ? 'ACTIVE' : 'INACTIVE'} />
                  </td>
                  {canManage && (
                    <td className="text-right">
                      <RowActions
                        label={`Actions for room type ${type.name}`}
                        actions={[
                          {
                            label: 'Edit room type',
                            icon: 'edit',
                            tone: 'emerald',
                            onSelect: () => {
                              setForm(toForm(type));
                              setEditing({ type });
                            },
                          },
                          type.isActive
                            ? { label: 'Deactivate room type', icon: 'toggleOff', tone: 'amber', onSelect: () => setToggling(type) }
                            : { label: 'Activate room type', icon: 'toggleOn', tone: 'emerald', onSelect: () => setToggling(type) },
                          {
                            label: 'Delete room type',
                            icon: 'trash',
                            tone: 'red',
                            onSelect: () =>
                              setDeleting({
                                kind: 'room type',
                                name: type.name,
                                details: [`Capacity ${type.defaultCapacity} · rate ${type.defaultStandardRate}`, `${type.roomCount} room${type.roomCount === 1 ? '' : 's'}`, type.isActive ? 'Active' : 'Inactive'],
                                checkPath: `${apiBase}/room-types/${type.id}/deletion-check`,
                                deletePath: `${apiBase}/room-types/${type.id}`,
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
        title={editing?.type ? `Edit ${editing.type.name}` : 'Add room type'}
        description="These values are copied into new rooms of this type. Existing rooms keep their own rates."
        confirmLabel={editing?.type ? 'Save room type' : 'Add room type'}
        onClose={() => setEditing(null)}
        onConfirm={save}
      >
        <Field id="type-name" label="Name" required>
          <input id="type-name" className={inputClass} maxLength={80} value={form.name} onChange={(e) => set('name')(e.target.value)} />
        </Field>
        <Field id="type-description" label="Description">
          <input id="type-description" className={inputClass} maxLength={500} value={form.description} onChange={(e) => set('description')(e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field id="type-capacity" label="Capacity" required>
            <input id="type-capacity" inputMode="numeric" className={inputClass} value={form.defaultCapacity} onChange={(e) => set('defaultCapacity')(e.target.value)} />
          </Field>
          <Field id="type-rate" label="Nightly rate" required>
            <input id="type-rate" inputMode="decimal" className={inputClass} value={form.defaultStandardRate} onChange={(e) => set('defaultStandardRate')(e.target.value)} />
          </Field>
          <Field id="type-extra" label="Extra-bed rate">
            <input id="type-extra" inputMode="decimal" className={inputClass} value={form.defaultExtraBedRate} onChange={(e) => set('defaultExtraBedRate')(e.target.value)} />
          </Field>
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={toggling !== null}
        title={toggling?.isActive ? `Deactivate ${toggling?.name}?` : `Activate ${toggling?.name}?`}
        description={toggling?.isActive ? 'An inactive room type cannot be used for new rooms. Types still used by rooms in service cannot be deactivated.' : 'The room type can be used again.'}
        confirmLabel={toggling?.isActive ? 'Deactivate room type' : 'Activate room type'}
        tone={toggling?.isActive ? 'danger' : 'primary'}
        onClose={() => setToggling(null)}
        onConfirm={async () => {
          await apiRequest('POST', `${apiBase}/room-types/${toggling!.id}/${toggling!.isActive ? 'deactivate' : 'activate'}`);
          notify(toggling!.isActive ? 'Room type deactivated.' : 'Room type activated.');
          reload();
        }}
      />
      {canManage && <DeleteRecordDialog target={deleting} onClose={() => setDeleting(null)} onDeleted={reload} />}
    </section>
  );
}
