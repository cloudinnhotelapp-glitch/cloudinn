// End-to-end tests proving the API boots with its global setup, uses the test database, and answers over real HTTP.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './support/test-app.js';

// Tests for routing, versioning, error format, security headers, and CORS.
describe('API bootstrap (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Boots the full application once against the test database.
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  // Shuts the application down after the tests.
  afterAll(async () => {
    await app.close();
  });

  // Proves the app is connected to the dedicated test database, never the development one.
  it('is connected to the hotel_management_test database', async () => {
    const [{ current_database: name }] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
    expect(name).toBe('hotel_management_test');
  });

  // Proves the health route is served under /api/v1 and reports the database as reachable.
  it('GET /api/v1/health returns ok with the database up', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(response.body).toMatchObject({ status: 'ok', service: 'hotel-management-api', database: 'up' });
  });

  // Proves routes are not reachable without the version prefix.
  it('GET /health without the /api/v1 prefix returns 404', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });

  // Proves unknown routes use the consistent error format.
  it('unknown routes return the standard JSON error body', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    expect(response.body).toMatchObject({ statusCode: 404, error: 'NOT_FOUND', path: '/api/v1/does-not-exist' });
    expect(typeof response.body.timestamp).toBe('string');
  });

  // Proves helmet security headers are applied to responses.
  it('responses include security headers', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  // Proves CORS only allows the configured frontend origin.
  it('CORS allows the configured frontend origin and no other', async () => {
    const allowed = await request(app.getHttpServer()).get('/api/v1/health').set('Origin', 'http://localhost:3000');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const blocked = await request(app.getHttpServer()).get('/api/v1/health').set('Origin', 'http://evil.example.com');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });

  // Proves state-changing requests from another website are rejected before reaching any route.
  it('blocks POST requests from a foreign Origin', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://evil.example.com')
      .send({ role: 'ADMIN', email: 'nobody@hotel.test', password: 'irrelevant-value' })
      .expect(403);
    expect(response.body.message).toBe('Cross-origin request blocked.');
  });
});
