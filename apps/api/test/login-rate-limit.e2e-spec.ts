// Integration test proving login endpoints are rate-limited per IP address.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support/test-app.js';

// Tests for the per-IP login limit (set very low for this file only, before the app is created).
describe('Login rate limiting (e2e)', () => {
  let app: INestApplication;

  // Lowers the limit to 3 per minute, then boots a fresh app that reads it.
  beforeAll(async () => {
    process.env.LOGIN_RATE_LIMIT_PER_MINUTE = '3';
    ({ app } = await createTestApp());
  });

  // Shuts the application down after the test.
  afterAll(async () => {
    await app.close();
  });

  // Proves the 4th attempt within a minute from the same IP is refused with 429, on both login endpoints.
  it('returns 429 after too many login attempts from one IP', async () => {
    for (const path of ['/api/v1/auth/login', '/api/v1/super-admin/auth/login']) {
      const body = path.includes('super-admin')
        ? { email: 'nobody@platform.test', password: 'wrong-password-value' }
        : { role: 'ADMIN', email: 'nobody@hotel.test', password: 'wrong-password-value' };
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer()).post(path).send(body).expect(401);
      }
      await request(app.getHttpServer()).post(path).send(body).expect(429);
    }
  });
});
