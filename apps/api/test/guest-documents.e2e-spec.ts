// Integration tests for private guest ID documents (Phase 6.2) against the test database and a temporary storage folder:
// upload (JPG, PNG, PDF), list, preview, download, delete, file checks (extension, browser type, real content, size,
// empty, missing), the per-guest limit, role permissions, business isolation, files kept outside any public folder,
// database/file consistency, and audit entries without file names or contents.
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { GUEST_DOCUMENT_MAX_BYTES, GUEST_DOCUMENT_MAX_PER_GUEST, SESSION_COOKIES, type BusinessRole } from '@hms/shared';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTenant, uniqueSuffix, type TestTenant } from './support/fixtures.js';
import { captureSession, sessionHeaders, type SessionCookies } from './support/http.js';
import { createTestApp } from './support/test-app.js';

// Small but valid file starts for each accepted type, plus a Windows program header for a disguised file.
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fake-jpeg-body')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-png-body')]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');
const EXE = Buffer.from('MZ\x90\x00this program cannot be run');

// Where the API stores files during tests (set in test/setup/test-env.ts).
const storageRoot = () => path.resolve(process.env.STORAGE_LOCAL_PATH!);

describe('Guest documents (e2e)', () => {
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

  // Uploads a file as a role (multipart, with the CSRF header).
  function upload(session: SessionCookies, guestId: string, content: Buffer, fileName: string, contentType: string, documentType = 'PASSPORT') {
    return request(app.getHttpServer())
      .post(`/api/v1/guests/${guestId}/documents`)
      .set(sessionHeaders(session, true))
      .field('documentType', documentType)
      .attach('file', content, { filename: fileName, contentType });
  }

  // GET as a role.
  const get = (session: SessionCookies, url: string) => request(app.getHttpServer()).get(`/api/v1${url}`).set(sessionHeaders(session));
  // DELETE as a role.
  const del = (session: SessionCookies, url: string) => request(app.getHttpServer()).delete(`/api/v1${url}`).set(sessionHeaders(session, true));

  // Creates a fresh guest in a business.
  async function newGuest(t: TestTenant): Promise<string> {
    const guest = await prisma.guest.create({ data: { businessId: t.businessId, fullName: `Doc Guest ${uniqueSuffix()}` } });
    return guest.id;
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

  // Proves every role uploads JPG, PNG, and PDF files, sees them listed, and can preview and download the exact bytes.
  it('uploads, lists, previews, and downloads JPG, PNG, and PDF files', async () => {
    const guestId = await newGuest(tenant);
    const jpg = await upload(sessions.RECEPTIONIST, guestId, JPG, 'C:\\Users\\me\\Passport scan.JPEG', 'image/jpeg').expect(201);
    expect(jpg.body).toMatchObject({ documentType: 'PASSPORT', fileName: 'Passport scan.JPEG', contentType: 'image/jpeg', sizeBytes: JPG.length });
    expect(jpg.body.uploadedBy.id).toBe(tenant.users.RECEPTIONIST.id);
    expect(jpg.body).not.toHaveProperty('storageKey');
    await upload(sessions.MANAGER, guestId, PNG, 'visa.png', 'image/png', 'VISA').expect(201);
    const pdf = await upload(sessions.ADMIN, guestId, PDF, 'licence.pdf', 'application/pdf', 'DRIVING_LICENSE').expect(201);

    const list = await get(sessions.RECEPTIONIST, `/guests/${guestId}/documents`).expect(200);
    expect(list.body.map((d: { documentType: string }) => d.documentType)).toEqual(['DRIVING_LICENSE', 'VISA', 'PASSPORT']);
    expect(JSON.stringify(list.body)).not.toMatch(/storageKey|sha256|guest-documents\//);

    const preview = await get(sessions.RECEPTIONIST, `/guests/${guestId}/documents/${jpg.body.id}/content`).buffer(true).expect(200);
    expect(Buffer.compare(preview.body as Buffer, JPG)).toBe(0);
    expect(preview.headers['content-type']).toBe('image/jpeg');
    expect(preview.headers['content-disposition']).toMatch(/^inline;/);
    expect(preview.headers['cache-control']).toContain('no-store');
    expect(preview.headers['x-content-type-options']).toBe('nosniff');

    const download = await get(sessions.MANAGER, `/guests/${guestId}/documents/${pdf.body.id}/download`).buffer(true).expect(200);
    expect(Buffer.compare(download.body as Buffer, PDF)).toBe(0);
    expect(download.headers['content-disposition']).toBe(`attachment; filename="licence.pdf"; filename*=UTF-8''licence.pdf`);

    const detail = await get(sessions.ADMIN, `/guests/${guestId}`).expect(200);
    expect(detail.body.documentCount).toBe(3);
  });

  // Proves files are stored under a random key inside the private storage folder, never under the original name.
  it('stores files privately under random keys', async () => {
    const guestId = await newGuest(tenant);
    const created = await upload(sessions.ADMIN, guestId, PNG, '../../etc/passwd.png', 'image/png').expect(201);
    expect(created.body.fileName).toBe('passwd.png');
    const row = await prisma.guestDocument.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.storageKey).toMatch(new RegExp(`^guest-documents/${tenant.businessId}/[0-9a-f-]{36}$`));
    expect(row.storageKey).not.toContain('passwd');
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    const file = path.join(storageRoot(), ...row.storageKey.split('/'));
    expect(file.startsWith(storageRoot() + path.sep)).toBe(true);
    expect(existsSync(file)).toBe(true);
    expect(file).not.toMatch(/[\\/]public[\\/]/);
  });

  // Proves the server checks the extension, the browser-reported type, the real content, the size, and missing files.
  it('refuses files that are not genuine JPG, PNG, or PDF files', async () => {
    const guestId = await newGuest(tenant);
    const refused: [Buffer, string, string, number][] = [
      [Buffer.from('GIF89a......'), 'photo.gif', 'image/gif', 400],
      [EXE, 'passport.jpg', 'image/jpeg', 400],
      [PNG, 'passport.pdf', 'application/pdf', 400],
      [PNG, 'passport.png', 'application/pdf', 400],
      [PDF, 'passport', 'application/pdf', 400],
      [Buffer.from(''), 'empty.pdf', 'application/pdf', 400],
      [Buffer.concat([PDF, Buffer.alloc(GUEST_DOCUMENT_MAX_BYTES)]), 'huge.pdf', 'application/pdf', 413],
    ];
    for (const [content, name, type, status] of refused) {
      const response = await upload(sessions.ADMIN, guestId, content, name, type);
      expect({ name, status: response.status }).toEqual({ name, status });
    }
    const tooBig = await upload(sessions.ADMIN, guestId, Buffer.concat([PDF, Buffer.alloc(GUEST_DOCUMENT_MAX_BYTES)]), 'huge.pdf', 'application/pdf');
    expect(tooBig.body.message).toBe('The file is larger than 5 MB.');
    await request(app.getHttpServer()).post(`/api/v1/guests/${guestId}/documents`).set(sessionHeaders(sessions.ADMIN, true)).field('documentType', 'PASSPORT').expect(400);
    await upload(sessions.ADMIN, guestId, PDF, 'ok.pdf', 'application/pdf', 'LIBRARY_CARD').expect(400);
    expect(await prisma.guestDocument.count({ where: { guestId } })).toBe(0);
  });

  // Proves one guest can hold at most the configured number of files.
  it('limits the number of files per guest', async () => {
    const guestId = await newGuest(tenant);
    for (let i = 0; i < GUEST_DOCUMENT_MAX_PER_GUEST; i++) await upload(sessions.ADMIN, guestId, PNG, `page-${i}.png`, 'image/png').expect(201);
    const response = await upload(sessions.ADMIN, guestId, PNG, 'one-more.png', 'image/png').expect(409);
    expect(response.body.message).toContain(`${GUEST_DOCUMENT_MAX_PER_GUEST} ID files`);
  });

  // Proves only Admin and Manager delete; deletion keeps the record for the audit trail, removes the file, and hides it.
  it('deletes documents (Admin and Manager only), removing the file and keeping the record', async () => {
    const guestId = await newGuest(tenant);
    const doc = await upload(sessions.RECEPTIONIST, guestId, JPG, 'id.jpg', 'image/jpeg').expect(201);
    const row = await prisma.guestDocument.findUniqueOrThrow({ where: { id: doc.body.id } });
    const file = path.join(storageRoot(), ...row.storageKey.split('/'));

    await del(sessions.RECEPTIONIST, `/guests/${guestId}/documents/${doc.body.id}`).expect(403);
    expect(existsSync(file)).toBe(true);
    await del(sessions.MANAGER, `/guests/${guestId}/documents/${doc.body.id}`).expect(204);

    expect(existsSync(file)).toBe(false);
    const stored = await prisma.guestDocument.findUniqueOrThrow({ where: { id: doc.body.id } });
    expect(stored.deletedAt).not.toBeNull();
    expect((await get(sessions.ADMIN, `/guests/${guestId}/documents`).expect(200)).body).toEqual([]);
    await get(sessions.ADMIN, `/guests/${guestId}/documents/${doc.body.id}/content`).expect(404);
    await del(sessions.ADMIN, `/guests/${guestId}/documents/${doc.body.id}`).expect(404);
  });

  // Proves another business can never list, view, download, upload to, or delete these documents, even with real IDs.
  it('keeps documents inside their own business', async () => {
    const guestId = await newGuest(tenant);
    const doc = await upload(sessions.ADMIN, guestId, PDF, 'secret.pdf', 'application/pdf').expect(201);
    const base = `/guests/${guestId}/documents`;

    await get(otherAdmin, base).expect(404);
    await get(otherAdmin, `${base}/${doc.body.id}/content`).expect(404);
    await get(otherAdmin, `${base}/${doc.body.id}/download`).expect(404);
    await del(otherAdmin, `${base}/${doc.body.id}`).expect(404);
    await upload(otherAdmin, guestId, PDF, 'planted.pdf', 'application/pdf').expect(404);

    // The document cannot be reached through a different guest of the same business either.
    const otherGuest = await newGuest(tenant);
    await get(sessions.ADMIN, `/guests/${otherGuest}/documents/${doc.body.id}/content`).expect(404);
    expect(await prisma.guestDocument.count({ where: { guestId, deletedAt: null } })).toBe(1);
  });

  // Proves the endpoints need a session, the CSRF header for writes, and valid IDs.
  it('requires a session, CSRF protection, and valid IDs', async () => {
    const guestId = await newGuest(tenant);
    await request(app.getHttpServer()).get(`/api/v1/guests/${guestId}/documents`).expect(401);
    await request(app.getHttpServer())
      .post(`/api/v1/guests/${guestId}/documents`)
      .set(sessionHeaders(sessions.ADMIN))
      .field('documentType', 'PASSPORT')
      .attach('file', PDF, { filename: 'a.pdf', contentType: 'application/pdf' })
      .expect(403);
    await get(sessions.ADMIN, `/guests/${guestId}/documents/not-a-uuid/content`).expect(400);
  });

  // Proves uploads, views, downloads, and deletions are audited without file names or contents.
  it('audits document activity without file names or contents', async () => {
    const guestId = await newGuest(tenant);
    const doc = await upload(sessions.MANAGER, guestId, PDF, 'Aadhaar 1234 5678.pdf', 'application/pdf', 'NATIONAL_ID').expect(201);
    await get(sessions.MANAGER, `/guests/${guestId}/documents/${doc.body.id}/content`).expect(200);
    await get(sessions.MANAGER, `/guests/${guestId}/documents/${doc.body.id}/download`).expect(200);
    await del(sessions.MANAGER, `/guests/${guestId}/documents/${doc.body.id}`).expect(204);

    const entries = await prisma.auditLog.findMany({ where: { entityId: doc.body.id }, orderBy: { createdAt: 'asc' } });
    expect(entries.map((e) => e.action)).toEqual(['guest_document.uploaded', 'guest_document.viewed', 'guest_document.downloaded', 'guest_document.deleted']);
    expect(entries[0]).toMatchObject({ businessId: tenant.businessId, businessUserId: tenant.users.MANAGER.id, entityType: 'GuestDocument' });
    expect(entries[0]!.metadata).toEqual({ guestId, documentType: 'NATIONAL_ID', contentType: 'application/pdf', sizeBytes: PDF.length });
    const text = JSON.stringify(entries.map((e) => e.metadata));
    expect(text).not.toMatch(/Aadhaar|1234|%PDF|guest-documents\//);
  });
});
