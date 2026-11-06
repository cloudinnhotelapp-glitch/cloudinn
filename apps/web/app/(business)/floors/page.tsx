// Floor setup page for business Admins (/floors).
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { PropertyPage } from '@/features/business/property-page';

// Renders the page body inside Suspense, because it reads URL data that is only known at request time.
export default function FloorsPage() {
  return <Suspense fallback={<LoadingState />}><PropertyPage section="floors" /></Suspense>;
}