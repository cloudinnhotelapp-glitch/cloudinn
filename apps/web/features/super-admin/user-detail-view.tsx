// Business-user page for the Super Admin: edit name/email, assign locations, activate/deactivate, and reset the password.
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { BusinessUserDetail, TemporaryPasswordResult } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, FormErrors, inputClass } from '@/components/ui/fields';
import { useNotify } from '@/components/ui/notifications';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest, errorMessages } from '@/lib/api-client';
import { formatDateTime, titleCase } from '@/lib/format';
import { LocationChecklist } from './location-checklist';
import { TemporaryPasswordPanel } from './temporary-password-panel';

// Loads the user from the URL and renders all sections.
export function UserDetailView() {
  const { userId } = useParams<{ userId: string }>();
  const notify = useNotify();
  const { data: user, error, loading, reload } = useApiQuery<BusinessUserDetail>(`/super-admin/users/${userId}`);
  const [dialog, setDialog] = useState<'status' | 'reset' | null>(null);
  const [temporary, setTemporary] = useState<TemporaryPasswordResult | null>(null);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !user) return <LoadingState />;
  if (!user) return null;
  const deactivating = user.status === 'ACTIVE';

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-4 text-sm text-slate-500">
        <Link href="/super-admin/business-users" className="hover:underline">
          ← All business users
        </Link>
        <Link href={`/super-admin/businesses/${user.businessId}`} className="hover:underline">
          ← Back to business
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="ui-page-title">{user.name}</h1>
        <span className="text-sm text-slate-500">{titleCase(user.role)}</span>
        <StatusBadge status={user.status} />
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => setDialog('reset')}>
            Reset password
          </Button>
          <Button variant={deactivating ? 'danger' : 'primary'} onClick={() => setDialog('status')}>
            {deactivating ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      </div>

      {temporary && (
        <TemporaryPasswordPanel email={temporary.user.email} password={temporary.temporaryPassword} onDone={() => setTemporary(null)} />
      )}

      <dl className="ui-card grid grid-cols-1 gap-4 p-5 text-sm sm:grid-cols-3">
        <div>
          <dt className="ui-detail-label">Business</dt>
          <dd className="ui-detail-value">
            <Link href={`/super-admin/businesses/${user.business.id}`} className="underline-offset-2 hover:underline">
              {user.business.name}
            </Link>
          </dd>
        </div>
        <div>
          <dt className="ui-detail-label">Email</dt>
          <dd className="ui-detail-value">{user.email}</dd>
        </div>
        <div>
          <dt className="ui-detail-label">Created</dt>
          <dd className="ui-detail-value">{formatDateTime(user.createdAt)}</dd>
        </div>
        <div>
          <dt className="ui-detail-label">Assigned locations</dt>
          <dd className="ui-detail-value">{user.locations.map((l) => l.name).join(', ') || '—'}</dd>
        </div>
        <div>
          <dt className="ui-detail-label">Last login</dt>
          <dd className="ui-detail-value">{formatDateTime(user.lastLoginAt)}</dd>
        </div>
        <div>
          <dt className="ui-detail-label">Password</dt>
          <dd className="ui-detail-value">Set by the Super Admin or the user; the user may change it at any time</dd>
        </div>
        <div>
          <dt className="ui-detail-label">Login lock</dt>
          <dd className="ui-detail-value">{user.lockedUntil ? `Locked until ${formatDateTime(user.lockedUntil)}` : 'Not locked'}</dd>
        </div>
      </dl>

      <ProfileForm key={`${user.id}-${user.name}-${user.email}`} user={user} onSaved={reload} />
      <LocationAssignment key={user.locations.map((l) => l.id).join(',')} user={user} onSaved={reload} />

      <ConfirmDialog
        open={dialog === 'status'}
        title={deactivating ? `Deactivate ${user.name}?` : `Activate ${user.name}?`}
        description={
          deactivating
            ? 'The user is signed out everywhere and cannot log in until activated again. Their records are kept.'
            : 'The user will be able to log in again.'
        }
        confirmLabel={deactivating ? 'Deactivate user' : 'Activate user'}
        tone={deactivating ? 'danger' : 'primary'}
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          await apiRequest('POST', `/super-admin/users/${user.id}/${deactivating ? 'deactivate' : 'activate'}`);
          notify(deactivating ? 'User deactivated.' : 'User activated.');
          reload();
        }}
      />
      <ConfirmDialog
        open={dialog === 'reset'}
        title={`Reset the password of ${user.name}?`}
        description="A new temporary password is created and shown once. The old password stops working, the user is signed out everywhere, any login lock is cleared, and the user must choose a new password at the next login."
        confirmLabel="Reset password"
        tone="danger"
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          setTemporary(await apiRequest<TemporaryPasswordResult>('POST', `/super-admin/users/${user.id}/reset-password`));
          reload();
        }}
      />
    </section>
  );
}

// Edits the user's name and email (the role and business can never change).
function ProfileForm({ user, onSaved }: { user: BusinessUserDetail; onSaved: () => void }) {
  const notify = useNotify();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Validates and saves the changes.
  async function submit(event: FormEvent) {
    event.preventDefault();
    const problems: string[] = [];
    if (name.trim().length < 2) problems.push('Enter a name of at least 2 characters.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) problems.push('Enter a valid email address.');
    setErrors(problems);
    if (problems.length > 0) return;
    setBusy(true);
    try {
      await apiRequest('PATCH', `/super-admin/users/${user.id}`, { body: { name: name.trim(), email: email.trim() } });
      notify('User details saved.');
      onSaved();
    } catch (error) {
      setErrors(errorMessages(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} aria-labelledby="profile-heading" className="flex max-w-xl flex-col gap-4" noValidate>
      <h2 id="profile-heading" className="ui-section-title">
        Details
      </h2>
      <Field id="edit-user-name" label="Full name" required>
        <input id="edit-user-name" className={inputClass} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id="edit-user-email" label="Email" required>
        <input id="edit-user-email" type="email" className={inputClass} maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <FormErrors messages={errors} />
      <div>
        <Button type="submit" busy={busy}>
          Save details
        </Button>
      </div>
    </form>
  );
}

// Chooses the locations the user may work in and saves the full list.
function LocationAssignment({ user, onSaved }: { user: BusinessUserDetail; onSaved: () => void }) {
  const notify = useNotify();
  const [selected, setSelected] = useState(user.locations.map((l) => l.id));
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Saves the selected locations.
  async function save() {
    setBusy(true);
    setErrors([]);
    try {
      await apiRequest('PUT', `/super-admin/users/${user.id}/locations`, { body: { locationIds: selected } });
      notify('Location assignments saved.');
      onSaved();
    } catch (error) {
      setErrors(errorMessages(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="assignment-heading" className="flex max-w-xl flex-col gap-3">
      <h2 id="assignment-heading" className="ui-section-title">
        Locations
      </h2>
      <LocationChecklist businessId={user.businessId} selected={selected} onChange={setSelected} />
      <FormErrors messages={errors} />
      <div>
        <Button onClick={() => void save()} busy={busy}>
          Save locations
        </Button>
      </div>
    </section>
  );
}
