// Reads the browser-test accounts written by the global setup (random passwords, test database only).
import { readFileSync } from 'node:fs';

// One business user from the fixture.
export interface FixtureUser {
  id: string;
  email: string;
  password: string;
  role: 'ADMIN' | 'MANAGER' | 'RECEPTIONIST';
}

// A location from the fixture.
export interface FixtureLocation {
  id: string;
  name: string;
}

// Everything the global setup created.
export interface UiFixture {
  superAdmin: { email: string; password: string };
  consoleAdmin: { email: string; password: string };
  businessAdmin: FixtureUser;
  hotel: {
    businessId: string;
    businessName: string;
    users: Record<'ADMIN' | 'MANAGER' | 'RECEPTIONIST', FixtureUser>;
    locations: FixtureLocation[];
  };
  pending: { businessId: string; businessName: string; locations: FixtureLocation[] };
  pendingUser: FixtureUser;
}

// Loads the fixture file named by HMS_UI_FIXTURE.
export function fixture(): UiFixture {
  const file = process.env.HMS_UI_FIXTURE;
  if (!file) throw new Error('HMS_UI_FIXTURE is not set; run through the Playwright config.');
  return JSON.parse(readFileSync(file, 'utf8')) as UiFixture;
}
