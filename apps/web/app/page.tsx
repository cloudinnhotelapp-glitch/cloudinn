// Root URL (/): the proxy already sends visitors to /login or /dashboard; this redirect is the fallback.
import { redirect } from 'next/navigation';

// Sends the visitor to the dashboard (which requires a business-user session).
export default function HomePage() {
  redirect('/dashboard');
}
