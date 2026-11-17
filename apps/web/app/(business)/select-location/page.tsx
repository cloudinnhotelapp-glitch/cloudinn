// Location selection page (/select-location), shown when a user has several assigned locations.
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { SelectLocationView } from '@/features/business/select-location-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Renders the page body inside Suspense, because it reads URL data that is only known at request time.
export default function SelectLocationPage() {
  return <Suspense fallback={<LoadingState />}><InteractiveAfterHydration><SelectLocationView /></InteractiveAfterHydration></Suspense>;
}