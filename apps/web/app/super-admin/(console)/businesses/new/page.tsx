// Old New business address (/super-admin/businesses/new). Creating a business now happens in a popup on the Businesses
// page, so this address opens that page with the popup already showing (?add=1); existing links and bookmarks keep working.
import { redirect } from 'next/navigation';

// Sends the visitor to the Businesses page with the New business popup open.
export default function NewBusinessPage() {
  redirect('/super-admin/businesses?add=1');
}
