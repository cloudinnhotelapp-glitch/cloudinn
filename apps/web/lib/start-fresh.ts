// Full page load for a change of signed-in person (owner report 2026-11-17). Next.js keeps pages that were visited alive
// in memory with their state (for instant back and forward), and in-app navigation brings them back as they were. After
// logging out and in as someone else, that showed the previous user's header (location switcher, check-out bell) on the
// location chooser, and could show the login form still "Signing in…". Signing in and logging out therefore load the
// next page from the server, which drops everything kept for the previous person.

// Opens the address with a full page load, replacing the current history entry (Back does not return to the form).
export function startFresh(path: string): void {
  window.location.replace(path);
}
