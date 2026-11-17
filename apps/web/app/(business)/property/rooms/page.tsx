// Property Setup, Rooms tab (/property/rooms), for Admins, Managers, and Receptionists (read-only).
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { PropertyPage } from '@/features/business/property-page';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Renders the page body inside Suspense, because it reads URL data that is only known at request time.
export default function RoomsPage() {
  return <Suspense fallback={<LoadingState />}><InteractiveAfterHydration><PropertyPage section="rooms" /></InteractiveAfterHydration></Suspense>;
}
