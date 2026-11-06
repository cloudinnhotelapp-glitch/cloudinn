// Integration tests for guest management (Phase 6.1) against the test database: list, search, filters, pagination,
// create, view, edit, validation, duplicate prevention, restricted notes, role permissions, business isolation, and audit
// entries that never contain personal values.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SESSION_COOKIES, type BusinessRole } from '@hms/shared';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTenant, uniqueSuffix, type TestTenant } from './support/fixtures.js';
import { captureSession, sessionHeaders, type SessionCookies } from './support/http.js';
import { createTestApp } from './support/test-app.js';

describe('Guests (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TestTenant;
  let other: TestTenant;
  const sessions = {} as Record<BusinessRole, SessionCookies>;
  let otherAdmin: SessionCookies;

  // Logs one business user in and keeps the session cookies.
  async function login(t: TestTenant, role: BusinessRole): Promise<SessionCookies> {
    const user = t.users[role];
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ role, email: user.email, password: user.password }).expect(200);
    return captureSession(response, SESSION_COOKIES.businessUser);
  }

  // Sends a JSON request as a role (with the CSRF header for writes).
  function as(role: BusinessRole | SessionCookies) {
    const session = typeof role === 'string' ? sessions[role] : role;
    const server = request(app.getHttpServer());
    return {
      get: (url: string) => server.get(`/api/v1${url}`).set(sessionHeaders(session)),
      post: (url: string, body: object) => server.post(`/api/v1${url}`).set(sessionHeaders(session, true)).send(body),
      patch: (url: string, body: object) => server.patch(`/api/v1${url}`).set(sessionHeaders(session, true)).send(body),
    };
  }

  // Creates two businesses and logs in every role of the first one and the Admin of the second.
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    tenant = await createTenant(prisma);
    other = await createTenant(prisma);
    for (const role of ['ADMIN', 'MANAGER', 'RECEPTIONIST'] as const) sessions[role] = await login(tenant, role);
    otherAdmin = await login(other, 'ADMIN');
  });

  // Shuts the application down.
  afterAll(async () => {
    await app.close();
  });

  // Proves a guest can be created with every field, cleaned up, and read back; the ID number is masked in the list.
  it('creates a guest with all fields, normalizes them, and masks the ID number in the list', async () => {
    const suffix = uniqueSuffix();
    const created = await as('MANAGER')
      .post('/guests', {
        fullName: `  Asha   Menon ${suffix} `,
        email: `Asha.${suffix}@Example.COM`,
        phone: '+91 98765 43210',
        addressLine: '12 Beach Road',
        city: 'Kochi',
        state: 'Kerala',
        country: 'India',
        postalCode: '682001',
        nationality: 'Indian',
        dateOfBirth: '1990-04-21',
        idDocumentType: 'PASSPORT',
        idDocumentNumber: `p${suffix}`,
        notes: 'Prefers a sea-view room.',
      })
      .expect(201);
    expect(created.body).toMatchObject({
      fullName: `Asha Menon ${suffix}`,
      email: `asha.${suffix}@example.com`,
      dateOfBirth: '1990-04-21',
      idDocumentType: 'PASSPORT',
      idDocumentNumber: `P${suffix}`.toUpperCase(),
      notesVisible: true,
      notes: 'Prefers a sea-view room.',
      reservationCount: 0,
      documentCount: 0,
    });

    const list = await as('RECEPTIONIST').get(`/guests?search=${suffix}`).expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].idDocumentNumberMasked).toBe(`•••• ${`P${suffix}`.toUpperCase().slice(-4)}`);
    expect(list.body.items[0]).not.toHaveProperty('idDocumentNumber');
    expect(list.body.items[0]).not.toHaveProperty('notes');
  });

  // Proves search matches name, email, phone, and ID number, and the ID-type filter and pagination work.
  it('searches, filters by ID type, sorts, and paginates', async () => {
    const tag = uniqueSuffix();
    const names = ['Charlie', 'Alpha', 'Bravo'].map((n) => `${n} ${tag}`);
    await as('ADMIN').post('/guests', { fullName: names[0], phone: `+44 7700 ${tag.replace(/\D/g, '').padEnd(6, '1').slice(0, 6)}` }).expect(201);
    await as('ADMIN').post('/guests', { fullName: names[1], idDocumentType: 'NATIONAL_ID', idDocumentNumber: `ID${tag}` }).expect(201);
    await as('ADMIN').post('/guests', { fullName: names[2], email: `bravo.${tag}@mail.test` }).expect(201);

    const byName = await as('ADMIN').get(`/guests?search=${tag}&sort=name`).expect(200);
    expect(byName.body.items.map((g: { fullName: string }) => g.fullName)).toEqual([names[1], names[2], names[0]]);

    const byEmail = await as('ADMIN').get(`/guests?search=bravo.${tag}`).expect(200);
    expect(byEmail.body.items.map((g: { fullName: string }) => g.fullName)).toEqual([names[2]]);

    const byId = await as('ADMIN').get(`/guests?search=id${tag}`).expect(200);
    expect(byId.body.items.map((g: { fullName: string }) => g.fullName)).toEqual([names[1]]);

    const filtered = await as('ADMIN').get(`/guests?search=${tag}&idDocumentType=NATIONAL_ID`).expect(200);
    expect(filtered.body.total).toBe(1);

    const page2 = await as('ADMIN').get(`/guests?search=${tag}&sort=name&page=2&pageSize=2`).expect(200);
    expect(page2.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(page2.body.items.map((g: { fullName: string }) => g.fullName)).toEqual([names[0]]);
  });

  // Proves invalid input is refused with 400 and nothing is saved.
  it('refuses invalid guest details', async () => {
    const cases: object[] = [
      { fullName: 'A' },
      { fullName: 'Valid Name', email: 'not-an-email' },
      { fullName: 'Valid Name', phone: 'call me' },
      { fullName: 'Valid Name', dateOfBirth: '2999-01-01' },
      { fullName: 'Valid Name', dateOfBirth: '1990-02-30' },
      { fullName: 'Valid Name', idDocumentType: 'PASSPORT' },
      { fullName: 'Valid Name', idDocumentNumber: 'X1234567' },
      { fullName: 'Valid Name', idDocumentType: 'LIBRARY_CARD', idDocumentNumber: 'X1234567' },
      { fullName: 'Valid Name', businessId: other.businessId },
    ];
    for (const body of cases) await as('ADMIN').post('/guests', body).expect(400);
  });

  // Proves the email address and the ID document are unique within a business but may repeat across businesses.
  it('prevents duplicate email addresses and ID documents within a business', async () => {
    const tag = uniqueSuffix();
    await as('ADMIN').post('/guests', { fullName: `Original ${tag}`, email: `dup.${tag}@mail.test`, idDocumentType: 'PASSPORT', idDocumentNumber: `DUP${tag}` }).expect(201);

    const sameEmail = await as('RECEPTIONIST').post('/guests', { fullName: `Copy ${tag}`, email: `DUP.${tag}@MAIL.TEST` }).expect(409);
    expect(sameEmail.body.message).toContain(`Original ${tag}`);
    await as('RECEPTIONIST').post('/guests', { fullName: `Copy ${tag}`, idDocumentType: 'PASSPORT', idDocumentNumber: `dup${tag}` }).expect(409);
    // The same number under a different document type is a different document.
    await as('RECEPTIONIST').post('/guests', { fullName: `Visa ${tag}`, idDocumentType: 'VISA', idDocumentNumber: `DUP${tag}` }).expect(201);
    // Another business may hold the same guest.
    await as(otherAdmin).post('/guests', { fullName: `Original ${tag}`, email: `dup.${tag}@mail.test`, idDocumentType: 'PASSPORT', idDocumentNumber: `DUP${tag}` }).expect(201);
  });

  // Proves editing changes only the fields sent, clears optional fields with null, and still checks duplicates.
  it('edits a guest, clears optional fields, and checks duplicates on edit', async () => {
    const tag = uniqueSuffix();
    const first = await as('ADMIN').post('/guests', { fullName: `First ${tag}`, email: `first.${tag}@mail.test`, city: 'Pune' }).expect(201);
    const second = await as('ADMIN').post('/guests', { fullName: `Second ${tag}`, email: `second.${tag}@mail.test` }).expect(201);

    const edited = await as('RECEPTIONIST').patch(`/guests/${first.body.id}`, { phone: '+1 415 555 0100', city: null }).expect(200);
    expect(edited.body).toMatchObject({ fullName: `First ${tag}`, phone: '+1 415 555 0100', city: null, email: `first.${tag}@mail.test` });

    await as('RECEPTIONIST').patch(`/guests/${second.body.id}`, { email: `FIRST.${tag}@mail.test` }).expect(409);
    await as('RECEPTIONIST').patch(`/guests/${second.body.id}`, { fullName: null }).expect(400);
    await as('RECEPTIONIST').patch(`/guests/${second.body.id}`, { idDocumentNumber: 'ABC12345' }).expect(400);
    // Saving its own unchanged email again is not a duplicate.
    await as('RECEPTIONIST').patch(`/guests/${second.body.id}`, { email: `second.${tag}@mail.test` }).expect(200);
  });

  // Proves restricted notes are visible and editable for Admin and Manager only.
  it('restricts guest notes to Admin and Manager', async () => {
    const tag = uniqueSuffix();
    const guest = await as('ADMIN').post('/guests', { fullName: `Notes ${tag}`, notes: 'VIP. Late checkout approved.' }).expect(201);

    const forReceptionist = await as('RECEPTIONIST').get(`/guests/${guest.body.id}`).expect(200);
    expect(forReceptionist.body).toMatchObject({ notesVisible: false, notes: null });
    const forManager = await as('MANAGER').get(`/guests/${guest.body.id}`).expect(200);
    expect(forManager.body).toMatchObject({ notesVisible: true, notes: 'VIP. Late checkout approved.' });

    await as('RECEPTIONIST').post('/guests', { fullName: `Sneaky ${tag}`, notes: 'x' }).expect(403);
    await as('RECEPTIONIST').patch(`/guests/${guest.body.id}`, { notes: 'changed' }).expect(403);
    // A receptionist editing other fields keeps the notes intact.
    await as('RECEPTIONIST').patch(`/guests/${guest.body.id}`, { city: 'Goa' }).expect(200);
    const after = await as('MANAGER').get(`/guests/${guest.body.id}`).expect(200);
    expect(after.body.notes).toBe('VIP. Late checkout approved.');
  });

  // Proves guests of another business can never be listed, read, or edited, whatever the client sends.
  it('keeps guests inside their own business', async () => {
    const tag = uniqueSuffix();
    const foreign = await as(otherAdmin).post('/guests', { fullName: `Foreign ${tag}` }).expect(201);

    await as('ADMIN').get(`/guests/${foreign.body.id}`).expect(404);
    await as('ADMIN').patch(`/guests/${foreign.body.id}`, { fullName: 'Hijacked' }).expect(404);
    const list = await as('ADMIN').get(`/guests?search=Foreign ${tag}`).set({ 'x-business-id': other.businessId }).expect(200);
    expect(list.body.total).toBe(0);
    const stored = await prisma.guest.findUniqueOrThrow({ where: { id: foreign.body.id } });
    expect(stored.fullName).toBe(`Foreign ${tag}`);
  });

  // Proves the API needs a session, the CSRF header for writes, and a valid guest ID.
  it('requires a session, CSRF protection, and a valid ID', async () => {
    await request(app.getHttpServer()).get('/api/v1/guests').expect(401);
    await request(app.getHttpServer()).post('/api/v1/guests').set(sessionHeaders(sessions.ADMIN)).send({ fullName: 'No Csrf' }).expect(403);
    await as('ADMIN').get('/guests/not-a-uuid').expect(400);
    await as('ADMIN').get('/guests/00000000-0000-7000-8000-000000000000').expect(404);
  });

  // Proves creates and edits are audited with field names only (no names, emails, ID numbers, or notes in the details).
  it('audits guest changes without personal values', async () => {
    const tag = uniqueSuffix();
    const guest = await as('MANAGER')
      .post('/guests', { fullName: `Audit ${tag}`, email: `audit.${tag}@mail.test`, idDocumentType: 'PASSPORT', idDocumentNumber: `AUD${tag}`, notes: 'secret note' })
      .expect(201);
    await as('MANAGER').patch(`/guests/${guest.body.id}`, { phone: '+91 90000 00000', notes: 'another secret' }).expect(200);

    const entries = await prisma.auditLog.findMany({ where: { entityId: guest.body.id }, orderBy: { createdAt: 'asc' } });
    expect(entries.map((e) => e.action)).toEqual(['guest.created', 'guest.updated']);
    expect(entries[0]).toMatchObject({ businessId: tenant.businessId, locationId: tenant.locations[0]!.id, businessUserId: tenant.users.MANAGER.id, actorType: 'BUSINESS_USER' });
    expect(entries[1]!.metadata).toEqual({ changedFields: ['phone', 'notes'] });
    const text = JSON.stringify(entries.map((e) => e.metadata));
    for (const secret of [`Audit ${tag}`, `audit.${tag}`, `AUD${tag}`.toUpperCase(), 'secret note', 'another secret', '90000']) expect(text).not.toContain(secret);
  });
});
