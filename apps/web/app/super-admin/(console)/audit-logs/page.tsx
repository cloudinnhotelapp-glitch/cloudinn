// Platform audit log page (/super-admin/audit-logs).
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { AuditLogView } from '@/features/super-admin/audit-log-view';

// Renders the page body inside Suspense, because it reads URL data that is only known at request time.
export default function AuditLogsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <AuditLogView />
    </Suspense>
  );
}