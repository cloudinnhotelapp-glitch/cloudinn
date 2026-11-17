// Sending an advertisement on WhatsApp from the Ads page (owner decision 2026-11-11): Admins, Managers, and Receptionists
// send it to every guest who agreed to receive offers. The server sends one message at a time in the background; this
// shows the progress of the latest send of each advertisement and refreshes while it is still sending.
'use client';

import { useEffect, useRef, useState } from 'react';
import { explainWhatsAppError, type AdWhatsAppSendSummary, type AdWhatsAppStatus, type AdvertisementSummary } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useNotify } from '@/components/ui/notifications';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';

// "1 guest" / "3 guests".
const guests = (n: number) => `${n} guest${n === 1 ? '' : 's'}`;

// Note shown above the advertisements when sending is not possible yet.
export function WhatsAppSetupNote({ status }: { status: AdWhatsAppStatus | undefined }) {
  if (!status || status.configured) return null;
  return (
    <p role="note" className="m-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
      WhatsApp is not set up for your business yet, so advertisements cannot be sent to guests. Ask your platform administrator to set it up.
    </p>
  );
}

// The "Send on WhatsApp" button of one advertisement, with its confirmation and the latest send's progress.
export function SendOnWhatsApp({ ad, status, onChanged }: { ad: AdvertisementSummary; status: AdWhatsAppStatus | undefined; onChanged: () => void }) {
  const notify = useNotify();
  const [confirming, setConfirming] = useState(false);
  const sends = useApiQuery<AdWhatsAppSendSummary[]>(`/ads/${ad.id}/whatsapp`);
  const latest = sends.data?.[0];
  const sending = latest?.status === 'SENDING';
  const previous = useRef(latest?.status);

  // Refreshes every 2 seconds while sending, and tells the page when a send has finished.
  useEffect(() => {
    if (previous.current === 'SENDING' && latest && latest.status !== 'SENDING') onChanged();
    previous.current = latest?.status;
    if (!sending) return;
    const timer = setInterval(sends.reload, 2000);
    return () => clearInterval(timer);
  }, [sending, latest, sends.reload, onChanged]);

  const blocked = !status?.configured || status.sendingNow || status.recipients === 0;
  const reason = !status ? '' : !status.configured ? '' : status.sendingNow && !sending ? 'Another advertisement is being sent; try again when it has finished.' : status.recipients === 0 ? 'No guests have agreed to receive offers on WhatsApp yet.' : '';

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div>
        <Button variant="secondary" size="sm" aria-label={`Send ${ad.title} on WhatsApp`} disabled={blocked} onClick={() => setConfirming(true)}>
          Send on WhatsApp
        </Button>
      </div>
      {reason && <p className="m-0 text-xs text-slate-500">{reason}</p>}
      {latest && (
        <p role="status" data-testid={`whatsapp-status-${ad.id}`} className="m-0 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {latest.status === 'SENDING' && `Sending on WhatsApp… ${latest.sent + latest.failed} of ${latest.total} done (${latest.sent} sent, ${latest.failed} failed).`}
          {latest.status === 'COMPLETED' && `Sent on WhatsApp ${formatDateTime(latest.completedAt)} by ${latest.sentBy.name}: ${latest.sent} sent, ${latest.failed} failed.`}
          {latest.status === 'FAILED' && `Sending on WhatsApp failed: ${latest.error ?? 'unknown reason'}`}
          {latest.skipped > 0 && ` ${guests(latest.skipped)} left out (phone number without a country code).`}
        </p>
      )}
      {latest && latest.status !== 'SENDING' && (latest.failureReason ?? latest.error) && (
        <div role="note" data-testid={`whatsapp-reason-${ad.id}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {explainWhatsAppError(latest.failureReason ?? latest.error) && <p className="m-0 font-semibold">{explainWhatsAppError(latest.failureReason ?? latest.error)}</p>}
          {latest.failureReason && <p className="m-0 mt-1 break-words">WhatsApp said: {latest.failureReason}</p>}
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title="Send on WhatsApp"
        description={
          status
            ? `Send “${ad.title}” with its picture to ${guests(status.recipients)} who agreed to receive offers on WhatsApp?${status.skipped > 0 ? ` ${guests(status.skipped)} who agreed will be left out because their phone number has no country code.` : ''}`
            : ''
        }
        confirmLabel="Send"
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          await apiRequest('POST', `/ads/${ad.id}/whatsapp`);
          notify('Sending on WhatsApp has started.');
          sends.reload();
          onChanged();
        }}
      />
    </div>
  );
}
