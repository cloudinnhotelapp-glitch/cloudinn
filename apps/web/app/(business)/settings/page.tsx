// Business Settings page (/settings): Property Setup and Change Password (owner decision 2026-11-16).
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { SettingsView } from '@/features/business/settings-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Renders the page body inside Suspense, because it reads session data that is only known at request time.
export default function SettingsPage() {
  return <Suspense fallback={<LoadingState />}><InteractiveAfterHydration><SettingsView /></InteractiveAfterHydration></Suspense>;
}
