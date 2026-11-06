// Super Admin Property Setup — Room Types (/super-admin/property-setup/room-types) for a chosen business and location.
import { Suspense } from 'react';
import { PropertySetupPlaceholder, PropertySetupView } from '@/features/super-admin/property-setup-view';

// Renders the page body inside Suspense, because it reads the selected business and location from the URL.
export default function PropertyRoomTypesPage() {
  return (
    <Suspense fallback={<PropertySetupPlaceholder />}>
      <PropertySetupView section="room-types" />
    </Suspense>
  );
}