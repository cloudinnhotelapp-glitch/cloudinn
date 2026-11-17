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

// A business kept for one spec, with its rooms and a guest.
export interface FixtureTenant {
  businessId: string;
  guestId: string;
  users: Record<'ADMIN' | 'MANAGER' | 'RECEPTIONIST', FixtureUser>;
  locations: (FixtureLocation & { roomIds: string[] })[];
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
  branches: FixtureTenant;
  closing: FixtureTenant;
  solo: FixtureTenant;
  calendar: FixtureTenant;
  attendance: FixtureTenant;
  attendanceErrors: FixtureTenant;
  office: FixtureTenant;
  favourites: FixtureTenant;
  sweep: FixtureTenant;
  staffPortal: FixtureTenant;
  whatsapp: FixtureTenant;
  availability: FixtureTenant;
  propertyEdit: FixtureTenant;
  roomShift: FixtureTenant;
  /** A guest due to check out today and one overdue, both in house at the first location. */
  departures: FixtureTenant & { guests: Record<'dueToday' | 'overdue', { roomNumber: string; guestName: string }> };
  /** Room 101 needs cleaning after a checkout; a Staff member with a Staff app login works at the first location. */
  housekeeping: FixtureTenant & { staff: { name: string; username: string; password: string } };
}

// Loads the fixture file named by HMS_UI_FIXTURE.
export function fixture(): UiFixture {
  const file = process.env.HMS_UI_FIXTURE;
  if (!file) throw new Error('HMS_UI_FIXTURE is not set; run through the Playwright config.');
  return JSON.parse(readFileSync(file, 'utf8')) as UiFixture;
}
