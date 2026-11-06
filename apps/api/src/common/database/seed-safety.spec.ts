// Unit tests proving the development seed refuses test, shadow, and production targets.
import { databaseNameFromUrl, seedRefusalReason } from './seed-safety.js';

// Protected names as the real configuration would provide them.
const PROTECTED = ['hotel_management_test', 'hotel_management_shadow'];

// Tests for seedRefusalReason and databaseNameFromUrl.
describe('seed safety', () => {
  // Proves the normal development database is allowed.
  it('allows the development database in development mode', () => {
    expect(seedRefusalReason({ nodeEnv: 'development', databaseName: 'hotel_management_dev', protectedDatabaseNames: PROTECTED })).toBeNull();
  });

  // Proves the seed never runs outside development mode.
  it('refuses when NODE_ENV is production, test, or unset', () => {
    for (const nodeEnv of ['production', 'test', undefined]) {
      expect(seedRefusalReason({ nodeEnv, databaseName: 'hotel_management_dev', protectedDatabaseNames: PROTECTED })).toMatch(/NODE_ENV/);
    }
  });

  // Proves the configured test and shadow databases are refused even if renamed oddly in letter case.
  it('refuses the configured test and shadow databases', () => {
    expect(seedRefusalReason({ nodeEnv: 'development', databaseName: 'HOTEL_MANAGEMENT_TEST', protectedDatabaseNames: PROTECTED })).toMatch(/test or shadow/);
    expect(seedRefusalReason({ nodeEnv: 'development', databaseName: 'hotel_management_shadow', protectedDatabaseNames: PROTECTED })).toMatch(/test or shadow/);
  });

  // Proves names that look like test, shadow, or production databases are refused.
  it('refuses databases whose names look like test, shadow, or production', () => {
    for (const databaseName of ['app_test', 'shadow_db', 'hotel_prod', 'production']) {
      expect(seedRefusalReason({ nodeEnv: 'development', databaseName, protectedDatabaseNames: [] })).toMatch(/looks like/);
    }
  });

  // Proves an unknown database name is refused.
  it('refuses when the database name is unknown', () => {
    expect(seedRefusalReason({ nodeEnv: 'development', databaseName: '', protectedDatabaseNames: [] })).toMatch(/could not be determined/);
  });

  // Proves the database name is read from a URL without needing anything else from it.
  it('extracts the database name from a PostgreSQL URL', () => {
    expect(databaseNameFromUrl('postgresql://u:p@localhost:5432/hotel_management_dev?schema=public')).toBe('hotel_management_dev');
    expect(databaseNameFromUrl('not a url')).toBe('');
    expect(databaseNameFromUrl(undefined)).toBe('');
  });
});
