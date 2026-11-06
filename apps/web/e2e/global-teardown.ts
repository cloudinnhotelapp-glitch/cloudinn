// Playwright global teardown: deletes the temporary file holding the browser-test account passwords.
import { rmSync } from 'node:fs';
import path from 'node:path';

// Removes the fixture file and its temporary folder (outside the repository).
export default function globalTeardown(): void {
  const file = process.env.HMS_UI_FIXTURE;
  if (file) rmSync(path.dirname(file), { recursive: true, force: true });
}
