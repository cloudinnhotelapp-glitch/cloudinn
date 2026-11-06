// Playwright global setup: creates the browser-test accounts in the test database and tells the tests where to find them.
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Runs the API's guarded fixture script and stores the path of its output file for the tests.
export default function globalSetup(): void {
  const directory = mkdtempSync(path.join(tmpdir(), 'hms-ui-'));
  const file = path.join(directory, 'fixture.json');
  execFileSync('pnpm', ['exec', 'tsx', 'test/support/ui-fixture.ts', file], {
    cwd: path.resolve(import.meta.dirname, '../../api'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  process.env.HMS_UI_FIXTURE = file;
}
