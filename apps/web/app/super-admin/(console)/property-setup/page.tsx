// /super-admin/property-setup opens the Floors section (the last chosen business and location are restored there).
import { redirect } from 'next/navigation';

// Sends the visitor to the first Property Setup section.
export default function PropertySetupIndexPage() {
  redirect('/super-admin/property-setup/floors');
}