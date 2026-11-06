// The Super Admin's Delete action, shared by every management table: a trash-icon button and a confirmation dialog that
// first asks the server what Delete would do (delete, archive, or blocked and why), then performs it. The server makes
// the decision and enforces it again on DELETE; the dialog only explains it.
'use client';

import type { DeletionCheck, DeletionResult } from '@hms/shared';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest, errorMessages } from '@/lib/api-client';
import { Button } from './button';
import { ConfirmDialog } from './confirm-dialog';
import { Icon } from './icons';
import { useNotify } from './notifications';
import { ErrorState, LoadingState } from './states';

// The record the dialog is about.
export interface DeleteTarget {
  /** Lower-case record type, such as "room" or "business user". */
  kind: string;
  /** Name shown to the user, such as "Room 101". */
  name: string;
  /** Short facts that help identify the record (code, email, status...). */
  details?: string[];
  /** API path answering GET with a DeletionCheck. */
  checkPath: string;
  /** API path that DELETE removes or archives. */
  deletePath: string;
}

// Table action button with the shared trash icon; its accessible name names the record ("Delete room 101").
// "small" matches tables whose other actions are compact text buttons.
export function DeleteButton({ kind, name, onClick, small = false }: { kind: string; name: string; onClick: () => void; small?: boolean }) {
  if (small) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`Delete ${kind} ${name}`}
        className="ui-chip-button border-red-200 bg-red-50 text-red-600 hover:border-red-300 hover:bg-red-100 hover:text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
      >
        <Icon name="trash" className="h-3.5 w-3.5" />
        Delete
      </button>
    );
  }
  return (
    <Button variant="softDanger" size="sm" onClick={onClick} aria-label={`Delete ${kind} ${name}`}>
      <Icon name="trash" className="h-[15px] w-[15px]" />
      Delete
    </Button>
  );
}

// Confirmation dialog for one target; shows the server's check and refreshes the caller's list after success.
export function DeleteRecordDialog({ target, onClose, onDeleted }: { target: DeleteTarget | null; onClose: () => void; onDeleted: (result: DeletionResult) => void }) {
  const notify = useNotify();
  const check = useApiQuery<DeletionCheck>(target ? target.checkPath : null);
  const action = check.data?.action;
  const kind = target?.kind ?? 'record';

  // Sends DELETE; the dialog stays open with the error (and an error notification) if the server refuses.
  async function confirm() {
    if (!target) return;
    try {
      const result = await apiRequest<DeletionResult>('DELETE', target.deletePath);
      notify(result.message);
      onDeleted(result);
    } catch (error) {
      notify(errorMessages(error).join(' '), 'error');
      check.reload();
      throw error;
    }
  }

  return (
    <ConfirmDialog
      open={target !== null}
      title={`Delete ${kind}?`}
      tone="danger"
      icon="trash"
      confirmLabel={action === 'ARCHIVE' ? `Archive ${kind}` : `Delete ${kind}`}
      confirmDisabled={!check.data || action === 'BLOCKED'}
      onConfirm={confirm}
      onClose={onClose}
      description={<p>Are you sure you want to delete this {kind}?</p>}
    >
      {target && (
        <div className="flex flex-col gap-3 text-sm">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800" data-testid="delete-target">
            <p className="font-semibold text-slate-900 dark:text-white">{target.name}</p>
            {target.details?.filter(Boolean).map((detail) => (
              <p key={detail} className="text-xs text-slate-500">
                {detail}
              </p>
            ))}
          </div>
          {check.loading && !check.data ? <LoadingState label="Checking linked records…" /> : null}
          {check.error ? <ErrorState error={check.error} onRetry={check.reload} /> : null}
          {check.data && (
            <div
              data-testid="delete-check"
              className={`rounded-xl px-3.5 py-3 ring-1 ${
                action === 'BLOCKED'
                  ? 'bg-red-50 text-red-800 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-900'
                  : action === 'ARCHIVE'
                    ? 'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-900'
                    : 'bg-brand-50 text-brand-900 ring-brand-100 dark:bg-brand-950 dark:text-brand-100 dark:ring-brand-900'
              }`}
            >
              <p className="flex items-start gap-2 font-medium">
                <Icon name={action === 'BLOCKED' ? 'alertTriangle' : 'shield'} className="mt-0.5 h-4 w-4 shrink-0" />
                {check.data.summary}
              </p>
              {check.data.blockers.length > 0 && (
                <ul className="mt-2 list-disc pl-6">
                  {check.data.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              )}
              {check.data.linked.length > 0 && (
                <p className="mt-2 text-xs opacity-80">Linked records kept: {check.data.linked.map((item) => `${item.label}: ${item.count}`).join(' · ')}</p>
              )}
            </div>
          )}
        </div>
      )}
    </ConfirmDialog>
  );
}
