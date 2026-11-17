// "WhatsApp" section of the Super Admin's business page (owner decision 2026-11-11): the business's own WhatsApp
// Business Platform settings used to send its advertisements to guests who agreed. The access token is write-only: it is
// stored encrypted, never shown again, and kept when the field is left empty.
'use client';

import { useState, type FormEvent } from 'react';
import { WHATSAPP_AD_TEMPLATE, type WhatsAppSettingsView } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { Field, FormErrors, inputClass } from '@/components/ui/fields';
import { useNotify } from '@/components/ui/notifications';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest, errorMessages } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';

// Loads the settings and shows them, or the form to change them.
export function BusinessWhatsAppSection({ businessId }: { businessId: string }) {
  const { data, error, loading, reload } = useApiQuery<WhatsAppSettingsView>(`/super-admin/businesses/${businessId}/whatsapp`);
  const [editing, setEditing] = useState(false);
  return (
    <section aria-labelledby="whatsapp-heading" className="ui-card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="whatsapp-heading" className="ui-section-title m-0">
            WhatsApp
          </h2>
          <p className="m-0 mt-1 text-xs text-slate-500">The business’s WhatsApp Business Platform account (Meta). Guests who agreed receive the advertisement uploaded on the Ads page: its picture, title, description, and link.</p>
        </div>
        {data && !editing && (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {data.configured ? 'Change settings' : 'Set up WhatsApp'}
          </Button>
        )}
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingState /> : null}
      {data && !editing && (
        <dl className="m-0 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="ui-detail-label">Status</dt>
            <dd className="ui-detail-value">{data.configured ? <StatusBadge status={data.enabled ? 'ACTIVE' : 'INACTIVE'} label={data.enabled ? 'Enabled' : 'Turned off'} /> : 'Not set up'}</dd>
          </div>
          <div>
            <dt className="ui-detail-label">Phone number ID</dt>
            <dd className="ui-detail-value">{data.phoneNumberId ?? '—'}</dd>
          </div>
          <div>
            <dt className="ui-detail-label">Access token</dt>
            <dd className="ui-detail-value">{data.tokenSet ? 'Saved (hidden)' : '—'}</dd>
          </div>
          {data.updatedAt && (
            <div>
              <dt className="ui-detail-label">Last saved</dt>
              <dd className="ui-detail-value">{formatDateTime(data.updatedAt)}</dd>
            </div>
          )}
        </dl>
      )}
      {data && (
        <p role="note" className="m-0 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          One-time step in Meta’s WhatsApp Manager: WhatsApp only delivers offers through an approved message. Create one Marketing
          template named <strong>{WHATSAPP_AD_TEMPLATE.name}</strong>, language English (<strong>{WHATSAPP_AD_TEMPLATE.language}</strong>), with an Image header and
          the body <strong>{WHATSAPP_AD_TEMPLATE.body}</strong>. CloudInn fills it with each advertisement’s own picture, the guest’s name, the title,
          and the description and link.
        </p>
      )}
      {data && editing && (
        <WhatsAppForm
          businessId={businessId}
          current={data}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
    </section>
  );
}

// The settings form; the token field is empty and only replaces the stored token when filled in.
function WhatsAppForm({ businessId, current, onCancel, onSaved }: { businessId: string; current: WhatsAppSettingsView; onCancel: () => void; onSaved: () => void }) {
  const notify = useNotify();
  const [phoneNumberId, setPhoneNumberId] = useState(current.phoneNumberId ?? '');
  const [accessToken, setAccessToken] = useState('');
  const [enabled, setEnabled] = useState(current.configured ? current.enabled : true);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Saves the settings; the server checks every field again.
  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErrors([]);
    try {
      await apiRequest('PUT', `/super-admin/businesses/${businessId}/whatsapp`, { body: { phoneNumberId: phoneNumberId.trim(), accessToken: accessToken.trim() || null, enabled } });
      notify('WhatsApp settings saved.');
      onSaved();
    } catch (error) {
      setErrors(errorMessages(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} aria-label="WhatsApp settings" className="flex flex-col gap-4">
      <FormErrors messages={errors} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="whatsapp-phone-number-id" label="Phone number ID" required hint="From Meta: WhatsApp Manager → API setup (digits only).">
          <input id="whatsapp-phone-number-id" inputMode="numeric" className={inputClass} maxLength={30} value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} />
        </Field>
        <Field
          id="whatsapp-access-token"
          label="Access token"
          required={!current.tokenSet}
          hint={current.tokenSet ? 'Leave empty to keep the saved token. It is stored encrypted and never shown again.' : 'A permanent (system user) access token. It is stored encrypted and never shown again.'}
        >
          <input id="whatsapp-access-token" type="password" autoComplete="off" className={inputClass} maxLength={2000} value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
        </Field>
      </div>
      <label htmlFor="whatsapp-enabled" className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input id="whatsapp-enabled" type="checkbox" className="h-4 w-4 accent-emerald-600" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Allow this business to send advertisements on WhatsApp
      </label>
      <div className="flex gap-2">
        <Button type="submit" busy={saving}>
          Save WhatsApp settings
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
