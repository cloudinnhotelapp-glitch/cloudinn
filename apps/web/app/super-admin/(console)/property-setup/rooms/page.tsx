// Super Admin Property Setup — Rooms (/super-admin/property-setup/rooms) for a chosen business and location.
import { Suspense } from 'react';
import { PropertySetupPlaceholder, PropertySetupView } from '@/features/super-admin/property-setup-view';

// Renders the page body inside Suspense, because it reads the selected business and location from the URL.
export default function PropertyRoomsPage() {
  return (
    <Suspense fallback={<PropertySetupPlaceholder />}>
      <PropertySetupView section="rooms" />
    </Suspense>
  );
}