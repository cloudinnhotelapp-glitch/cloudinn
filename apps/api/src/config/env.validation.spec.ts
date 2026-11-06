// Unit tests proving that startup environment validation accepts good settings and rejects bad ones without leaking values.
import { validateEnv } from './env.validation.js';

// Minimal valid settings (fake values that exist only in this test).
const VALID = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/hotel?schema=public',
  SESSION_SECRET: 'x'.repeat(64),
};

// Tests for the validateEnv function.
describe('validateEnv', () => {
  // Proves that safe local defaults are applied when only the required settings are given.
  it('applies local development defaults for optional settings', () => {
    const env = validateEnv(VALID);
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(4000);
    expect(env.FRONTEND_ORIGIN).toBe('http://localhost:3000');
    expect(env.SWAGGER_ENABLED).toBe(true);
    expect(env.SESSION_IDLE_TIMEOUT_MINUTES).toBe(60);
    expect(env.SESSION_ABSOLUTE_TIMEOUT_HOURS).toBe(12);
    expect(env.STORAGE_DRIVER).toBe('local');
  });

  // Proves the database URL is now required.
  it('rejects a missing or blank DATABASE_URL', () => {
    expect(() => validateEnv({ ...VALID, DATABASE_URL: undefined })).toThrow(/DATABASE_URL: is required/);
    expect(() => validateEnv({ ...VALID, DATABASE_URL: '  ' })).toThrow(/DATABASE_URL: is required/);
  });

  // Proves that copying .env.example without editing it is caught at startup.
  it('rejects placeholder database credentials from .env.example', () => {
    expect(() =>
      validateEnv({ ...VALID, DATABASE_URL: 'postgresql://YOUR_DB_USER:YOUR_DB_PASSWORD@localhost:5432/YOUR_DB_NAME' }),
    ).toThrow(/placeholder/);
  });

  // Proves that a non-PostgreSQL URL is rejected.
  it('rejects a non-PostgreSQL database URL', () => {
    expect(() => validateEnv({ ...VALID, DATABASE_URL: 'mysql://localhost/db' })).toThrow(/postgresql/);
  });

  // Proves the session secret must be present, long, and not a placeholder.
  it('rejects a missing, short, or placeholder SESSION_SECRET', () => {
    expect(() => validateEnv({ ...VALID, SESSION_SECRET: undefined })).toThrow(/SESSION_SECRET: is required/);
    expect(() => validateEnv({ ...VALID, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET: must be at least 64/);
    expect(() => validateEnv({ ...VALID, SESSION_SECRET: `REPLACE_WITH_${'a'.repeat(64)}` })).toThrow(/placeholder/);
  });

  // Proves error messages never contain the secret values themselves.
  it('does not include secret values in error messages', () => {
    const secret = 'super-secret-but-too-short';
    try {
      validateEnv({ ...VALID, SESSION_SECRET: secret, DATABASE_URL: 'mysql://hidden-password@host/db' });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(secret);
      expect(message).not.toContain('hidden-password');
    }
  });

  // Proves S3 credentials are optional with local storage but required with the S3 driver.
  it('requires S3 settings only when STORAGE_DRIVER is s3', () => {
    expect(validateEnv({ ...VALID, S3_ACCESS_KEY_ID: 'YOUR_ACCESS_KEY_ID' }).STORAGE_DRIVER).toBe('local');
    expect(() => validateEnv({ ...VALID, STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET: is required when STORAGE_DRIVER=s3/);
  });

  // Proves that an invalid port number stops startup.
  it('rejects an out-of-range API port', () => {
    expect(() => validateEnv({ ...VALID, API_PORT: '70000' })).toThrow(/API_PORT/);
  });

  // Proves that the CORS origin must be a real URL, not a wildcard.
  it('rejects a wildcard frontend origin', () => {
    expect(() => validateEnv({ ...VALID, FRONTEND_ORIGIN: '*' })).toThrow(/FRONTEND_ORIGIN/);
  });
});
