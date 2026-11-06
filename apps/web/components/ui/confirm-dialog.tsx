// Modal dialog for forms and important actions, built on the native <dialog> element and styled after the reference app:
// - Form/primary dialogs: white 16px-radius card with a large shadow over a 60% slate backdrop with blur; header (p-6,
//   bottom border) with a 20px bold title, a short description, and a close button; body (p-6); footer (border-top) with
//   right-aligned Cancel (white, bordered) and the main action. The card itself never scrolls (so its rounded corners stay
//   intact on all four sides); when the content is taller than the window only the body scrolls, with the slim
//   "ui-scroll" scrollbar, while the header and the buttons stay in place.
// - Danger dialogs (delete, deactivate, suspend): the reference's centred confirmation, with a red icon circle, a bold
//   title, the description, and two full-width buttons (Cancel, then the red action).
'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { errorMessages } from '@/lib/api-client';
import { Button } from './button';
import { FormErrors } from './fields';
import { Icon, type IconName } from './icons';

// Dialog widths (reference: max-w-md for confirmations, wider for forms).
const SIZES = { md: 'max-w-md', lg: 'max-w-xl', xl: 'max-w-3xl' } as const;

// Props: visibility, texts, optional extra content (such as a reason field), and the confirm/cancel callbacks.
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  /** Icon in the red circle of a danger dialog (default: warning). */
  icon?: IconName;
  size?: keyof typeof SIZES;
  children?: ReactNode;
  confirmDisabled?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

// Shows the dialog, runs onConfirm when confirmed, and keeps the dialog open with the error if the action fails.
export function ConfirmDialog({ open, title, description, confirmLabel, tone = 'primary', icon = 'alertTriangle', size, children, confirmDisabled, onConfirm, onClose }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  // Unique per dialog, so pages with several dialogs never share an element id.
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const danger = tone === 'danger';

  // Opens or closes the native dialog when the "open" prop changes.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Start focus on the dialog itself rather than its close button (no focus ring on open); Tab reaches every control.
      dialog.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Runs the confirmed action and closes on success.
  async function confirm() {
    setBusy(true);
    setErrors([]);
    try {
      await onConfirm();
      onClose();
    } catch (error) {
      setErrors(errorMessages(error));
    } finally {
      setBusy(false);
    }
  }

  // Clears old errors and tells the parent the dialog closed (also used for the Escape key).
  function close() {
    if (busy) return;
    setErrors([]);
    onClose();
  }

  const width = SIZES[size ?? (danger ? 'md' : 'lg')];
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className={`m-auto max-h-[90vh] w-[calc(100%-2rem)] overflow-hidden rounded-2xl border-0 bg-white p-0 outline-none text-slate-900 shadow-2xl backdrop:bg-slate-900/60 backdrop:backdrop-blur-sm dark:bg-slate-900 dark:text-slate-100 ${width}`}
    >
      {danger ? (
        <div className="ui-scroll max-h-[90vh] overflow-y-auto p-6">
          <div className="text-center">
            <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-red-500 dark:bg-red-950">
              <Icon name={icon} className="h-[30px] w-[30px]" />
            </span>
            <h2 id={titleId} className="m-0 mb-2 text-xl font-bold text-slate-900 dark:text-white">
              {title}
            </h2>
            <div className="mb-6 text-slate-500 dark:text-slate-300">{description}</div>
          </div>
          {(children || errors.length > 0) && (
            <div className="mb-6 flex flex-col gap-4 text-left">
              {children}
              <FormErrors messages={errors} />
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button variant="secondary" className="flex-1 font-medium!" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" className="flex-1" onClick={() => void confirm()} busy={busy} disabled={confirmDisabled}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex max-h-[90vh] flex-col">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 p-6 dark:border-slate-800">
            <div className="min-w-0">
              <h2 id={titleId} className="m-0 text-xl font-bold text-slate-900 dark:text-white">
                {title}
              </h2>
              <div className="mt-1 text-sm text-slate-500 dark:text-slate-300">{description}</div>
            </div>
            <button
              type="button"
              onClick={close}
              disabled={busy}
              aria-label="Close dialog"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-50"
            >
              <Icon name="close" className="h-5 w-5" />
            </button>
          </div>
          {(children || errors.length > 0) && (
            <div className="ui-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
              {children}
              <FormErrors messages={errors} />
            </div>
          )}
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-slate-100 px-6 py-4 dark:border-slate-800">
            <Button variant="secondary" className="px-5! font-medium!" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" className="px-5!" onClick={() => void confirm()} busy={busy} disabled={confirmDisabled}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
