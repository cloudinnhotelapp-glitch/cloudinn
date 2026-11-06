// Room list with filters, pagination, and add/edit dialogs (including operational status); shared by business Admins and the Super Admin.
'use client';

import { useState } from 'react';
import type { FloorDetail, Paginated, RoomDetail, RoomTypeDetail } from '@hms/shared';
import { Icon } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DeleteRecordDialog, type DeleteTarget } from '@/components/ui/delete-record';
import { RowActions } from '@/components/ui/row-actions';
import { compactInputClass, Field, inputClass, searchInputClass } from '@/components/ui/fields';
import { useNotify } from '@/components/ui/notifications';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest, FormValidationError } from '@/lib/api-client';
import { titleCase } from '@/lib/format';
import { OPERATIONAL_LABELS } from '@/lib/room-status';
import type { PropertyManagerProps } from './floors-manager';

// Same rules as the server.
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const ROOM_NUMBER = /^[A-Z0-9][A-Z0-9 ./-]{0,19}$/;

// Form values for one room (empty rate/capacity fields mean "use the room type's default" when adding).
interface RoomForm {
  roomNumber: string;
  floorId: string;
  roomTypeId: string;
  capacity: string;
  maxExtraBeds: string;
  standardRate: string;
  extraBedRate: string;
  operationalStatus: string;
  notes: string;
}

// Converts a room (or nothing) into form values.
function toForm(room: RoomDetail | null): RoomForm {
  return {
    roomNumber: room?.roomNumber ?? '',
    floorId: room?.floor.id ?? '',
    roomTypeId: room?.roomType.id ?? '',
    capacity: room ? String(room.capacity) : '',
    maxExtraBeds: String(room?.maxExtraBeds ?? 0),
    standardRate: room?.standardRate ?? '',
    extraBedRate: room?.extraBedRate ?? '',
    operationalStatus: room?.operationalStatus ?? 'ACTIVE',
    notes: room?.notes ?? '',
  };
}

// Loads rooms, floors, and room types, and renders the filters, table, and add/edit dialog.
export function RoomsManager({ apiBase, canManage }: PropertyManagerProps) {
  const notify = useNotify();
  const [floorFilter, setFloorFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // Original page size of this list (users can change it with "Rows per page").
  const [pageSize, setPageSize] = useState<number>(25);
  const rooms = useApiQuery<Paginated<RoomDetail>>(`${apiBase}/rooms`, {
    search: search.trim().toUpperCase(),
    floorId: floorFilter,
    roomTypeId: typeFilter,
    operationalStatus: statusFilter,
    page,
    pageSize,
  });
  const floors = useApiQuery<FloorDetail[]>(`${apiBase}/floors`);
  const types = useApiQuery<RoomTypeDetail[]>(`${apiBase}/room-types`);
  const [editing, setEditing] = useState<{ room: RoomDetail | null } | null>(null);
  const [form, setForm] = useState<RoomForm>(toForm(null));
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);

  // Updates one form field.
  const set = (key: keyof RoomForm) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  // Validates and saves the room; empty optional fields are left out so the server applies the room type's defaults.
  async function save() {
    const roomNumber = form.roomNumber.trim().toUpperCase();
    const problems: string[] = [];
    if (!ROOM_NUMBER.test(roomNumber)) problems.push('Room number: 1-20 letters, digits, spaces, dashes, dots, or slashes.');
    if (!form.floorId) problems.push('Choose a floor.');
    if (!form.roomTypeId) problems.push('Choose a room type.');
    if (form.capacity && !(Number.isInteger(Number(form.capacity)) && Number(form.capacity) >= 1 && Number(form.capacity) <= 20)) problems.push('Capacity must be 1-20.');
    if (!(Number.isInteger(Number(form.maxExtraBeds)) && Number(form.maxExtraBeds) >= 0 && Number(form.maxExtraBeds) <= 10)) problems.push('Extra beds must be 0-10.');
    if (form.standardRate && !MONEY.test(form.standardRate.trim())) problems.push('Enter the nightly rate, for example 3500.00.');
    if (form.extraBedRate && !MONEY.test(form.extraBedRate.trim())) problems.push('Enter the extra-bed rate, for example 800.');
    if (problems.length > 0) throw new FormValidationError(problems);

    const body: Record<string, unknown> = {
      roomNumber,
      floorId: form.floorId,
      roomTypeId: form.roomTypeId,
      maxExtraBeds: Number(form.maxExtraBeds),
      notes: form.notes.trim(),
    };
    if (form.capacity) body.capacity = Number(form.capacity);
    if (form.standardRate) body.standardRate = form.standardRate.trim();
    if (form.extraBedRate) body.extraBedRate = form.extraBedRate.trim();
    if (editing?.room) {
      body.operationalStatus = form.operationalStatus;
      await apiRequest('PATCH', `${apiBase}/rooms/${editing.room.id}`, { body });
    } else {
      await apiRequest('POST', `${apiBase}/rooms`, { body });
    }
    notify(editing?.room ? `Room ${roomNumber} saved.` : `Room ${roomNumber} added.`);
    rooms.reload();
  }

  // Resets to page 1 whenever a filter changes.
  const filter = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };

  const activeFloors = floors.data?.filter((floor) => floor.isActive || floor.id === form.floorId) ?? [];
  const activeTypes = types.data?.filter((type) => type.isActive || type.id === form.roomTypeId) ?? [];

  return (
    <section aria-labelledby="rooms-heading" className="ui-list-panel">
      <div className="ui-list-header flex flex-wrap items-center gap-2">
        <h2 id="rooms-heading" className="ui-section-title mr-auto">
          Rooms
        </h2>
        <label htmlFor="rooms-search" className="sr-only">
          Search room number
        </label>
        <div className="relative flex w-full min-w-[160px] flex-1 items-center sm:w-[280px] sm:flex-none">
          <Icon name="search" className="pointer-events-none absolute left-3 h-[18px] w-[18px] text-slate-400" />
        <input
            id="rooms-search"
            type="search"
            className={searchInputClass}
            placeholder="Room number…"
            value={search}
            onChange={(e) => filter(setSearch)(e.target.value)}
          />
        </div>
        <label htmlFor="rooms-floor-filter" className="sr-only">
          Floor
        </label>
        <select id="rooms-floor-filter" className={`${compactInputClass}`} value={floorFilter} onChange={(e) => filter(setFloorFilter)(e.target.value)}>
          <option value="">All floors</option>
          {floors.data?.map((floor) => (
            <option key={floor.id} value={floor.id}>
              {floor.name}
            </option>
          ))}
        </select>
        <label htmlFor="rooms-type-filter" className="sr-only">
          Room type
        </label>
        <select id="rooms-type-filter" className={`${compactInputClass}`} value={typeFilter} onChange={(e) => filter(setTypeFilter)(e.target.value)}>
          <option value="">All room types</option>
          {types.data?.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
        <label htmlFor="rooms-status-filter" className="sr-only">
          Operational status
        </label>
        <select id="rooms-status-filter" className={`${compactInputClass}`} value={statusFilter} onChange={(e) => filter(setStatusFilter)(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(OPERATIONAL_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {canManage && (
          <Button
            onClick={() => {
              setForm(toForm(null));
              setEditing({ room: null });
            }}
          >
            <Icon name="plus" className="h-5 w-5" />
            Add room
          </Button>
        )}
      </div>

      {rooms.error ? <ErrorState error={rooms.error} onRetry={rooms.reload} /> : null}
      {rooms.loading && !rooms.data ? <LoadingState /> : null}
      {rooms.data && rooms.data.items.length === 0 && <EmptyState message="No rooms match these filters." />}
      {rooms.data && rooms.data.items.length > 0 && (
        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead>
              <tr>
                <th>Room</th>
                <th>Floor</th>
                <th>Type</th>
                <th>Capacity</th>
                <th>Rate</th>
                <th>Extra bed</th>
                <th>Operational</th>
                <th>Occupancy</th>
                <th>Housekeeping</th>
                {canManage && <th className="text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rooms.data.items.map((room) => (
                <tr key={room.id}>
                  <td className="font-medium">{room.roomNumber}</td>
                  <td>{room.floor.name}</td>
                  <td>{room.roomType.name}</td>
                  <td className="tabular-nums">
                    {room.capacity}
                    {room.maxExtraBeds > 0 && ` +${room.maxExtraBeds}`}
                  </td>
                  <td className="tabular-nums">{room.standardRate}</td>
                  <td className="tabular-nums">{room.extraBedRate}</td>
                  <td>{OPERATIONAL_LABELS[room.operationalStatus]}</td>
                  <td>{titleCase(room.occupancyStatus)}</td>
                  <td>{titleCase(room.housekeepingStatus)}</td>
                  {canManage && (
                    <td className="text-right">
                      <RowActions
                        label={`Actions for room ${room.roomNumber}`}
                        actions={[
                          {
                            label: 'Edit room',
                            icon: 'edit',
                            tone: 'emerald',
                            onSelect: () => {
                              setForm(toForm(room));
                              setEditing({ room });
                            },
                          },
                          {
                            label: 'Delete room',
                            icon: 'trash',
                            tone: 'red',
                            onSelect: () =>
                              setDeleting({
                                kind: 'room',
                                name: `Room ${room.roomNumber}`,
                                details: [`${room.floor.name} · ${room.roomType.name}`, `${OPERATIONAL_LABELS[room.operationalStatus]} · ${titleCase(room.occupancyStatus)}`],
                                checkPath: `${apiBase}/rooms/${room.id}/deletion-check`,
                                deletePath: `${apiBase}/rooms/${room.id}`,
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
      {rooms.data && <Pagination page={rooms.data.page} pageSize={rooms.data.pageSize} total={rooms.data.total} onPageChange={setPage} onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }} />}

      <ConfirmDialog
        open={editing !== null}
        title={editing?.room ? `Edit room ${editing.room.roomNumber}` : 'Add room'}
        description={editing?.room ? 'Rate changes are recorded in the audit log.' : 'Leave capacity and rates empty to use the room type’s defaults.'}
        confirmLabel={editing?.room ? 'Save room' : 'Add room'}
        onClose={() => setEditing(null)}
        onConfirm={save}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field id="room-number" label="Room number" required>
            <input id="room-number" className={`${inputClass} uppercase`} maxLength={20} value={form.roomNumber} onChange={(e) => set('roomNumber')(e.target.value)} />
          </Field>
          <Field id="room-floor" label="Floor" required>
            <select id="room-floor" className={inputClass} value={form.floorId} onChange={(e) => set('floorId')(e.target.value)}>
              <option value="">Choose…</option>
              {activeFloors.map((floor) => (
                <option key={floor.id} value={floor.id}>
                  {floor.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="room-type" label="Room type" required>
            <select id="room-type" className={inputClass} value={form.roomTypeId} onChange={(e) => set('roomTypeId')(e.target.value)}>
              <option value="">Choose…</option>
              {activeTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="room-capacity" label="Capacity">
            <input id="room-capacity" inputMode="numeric" className={inputClass} value={form.capacity} onChange={(e) => set('capacity')(e.target.value)} />
          </Field>
          <Field id="room-extra-beds" label="Max extra beds">
            <input id="room-extra-beds" inputMode="numeric" className={inputClass} value={form.maxExtraBeds} onChange={(e) => set('maxExtraBeds')(e.target.value)} />
          </Field>
          <Field id="room-rate" label="Nightly rate">
            <input id="room-rate" inputMode="decimal" className={inputClass} value={form.standardRate} onChange={(e) => set('standardRate')(e.target.value)} />
          </Field>
          <Field id="room-extra-rate" label="Extra-bed rate">
            <input id="room-extra-rate" inputMode="decimal" className={inputClass} value={form.extraBedRate} onChange={(e) => set('extraBedRate')(e.target.value)} />
          </Field>
          {editing?.room && (
            <Field id="room-status" label="Operational status">
              <select id="room-status" className={inputClass} value={form.operationalStatus} onChange={(e) => set('operationalStatus')(e.target.value)}>
                {Object.entries(OPERATIONAL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <Field id="room-notes" label="Notes">
          <input id="room-notes" className={inputClass} maxLength={500} value={form.notes} onChange={(e) => set('notes')(e.target.value)} />
        </Field>
      </ConfirmDialog>
      {canManage && <DeleteRecordDialog target={deleting} onClose={() => setDeleting(null)} onDeleted={rooms.reload} />}
    </section>
  );
}
