// Integration tests against the test database for sending advertisements on WhatsApp (owner decision 2026-11-11): guest
// consent, the Super Admin's WhatsApp settings (token encrypted, never returned), and sending through a local stand-in
// for Meta's API (no real message is sent): only consenting guests with an international number, one message per number,
// failures recorded, upload failures, one send at a time, permissions, and business isolation.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SESSION_COOKIES, type AdWhatsAppSendSummary, type AdWhatsAppStatus, type GuestDetail, type WhatsAppSettingsView } from '@hms/shared';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { startFakeWhatsApp, type FakeWhatsApp } from './support/fake-whatsapp.js';
import { createSuperAdmin, createTenant, type TestTenant, type TestUser } from './support/fixtures.js';
import { captureSession, sessionHeaders, type SessionCookies } from './support/http.js';
import { createTestApp } from './support/test-app.js';

// A small PNG for advertisements.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

// A token as Meta issues them (long and opaque); never real.
const TOKEN = `EAAtest${'x'.repeat(60)}`;

describe('Advertisements on WhatsApp (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fake: FakeWhatsApp;
  let superAdmin: SessionCookies;
  const tenants: TestTenant[] = [];

  // Starts the stand-in, points the API at it, boots the app, and signs a Super Admin in.
  beforeAll(async () => {
    fake = await startFakeWhatsApp();
    process.env.WHATSAPP_GRAPH_BASE_URL = fake.url;
    ({ app, prisma } = await createTestApp());
    const admin = await createSuperAdmin(prisma, false);
    const response = await request(app.getHttpServer()).post('/api/v1/super-admin/auth/login').send({ email: admin.email, password: admin.password }).expect(200);
    superAdmin = captureSession(response, SESSION_COOKIES.superAdmin);
  });

  // Leaves no send of these tests "in progress" (so no later app resumes it), then shuts everything down.
  afterAll(async () => {
    await prisma.adWhatsAppSend.updateMany({ where: { businessId: { in: tenants.map((t) => t.businessId) }, status: 'SENDING' }, data: { status: 'FAILED', error: 'Test ended.', completedAt: new Date() } });
    await app.close();
    await fake.close();
    delete process.env.WHATSAPP_GRAPH_BASE_URL;
  });

  // A new tenant, remembered for clean-up.
  async function tenant(): Promise<TestTenant> {
    const created = await createTenant(prisma);
    tenants.push(created);
    return created;
  }

  // Logs a business user in.
  async function login(user: TestUser): Promise<SessionCookies> {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ role: user.role, email: user.email, password: user.password }).expect(200);
    return captureSession(response, SESSION_COOKIES.businessUser);
  }

  // Requests as one session.
  function as(session: SessionCookies) {
    const server = request(app.getHttpServer());
    return {
      get: (url: string) => server.get(`/api/v1${url}`).set(sessionHeaders(session)),
      post: (url: string, body: object = {}) => server.post(`/api/v1${url}`).set(sessionHeaders(session, true)).send(body),
      patch: (url: string, body: object) => server.patch(`/api/v1${url}`).set(sessionHeaders(session, true)).send(body),
      put: (url: string, body: object) => server.put(`/api/v1${url}`).set(sessionHeaders(session, true)).send(body),
    };
  }

  // Saves WhatsApp settings for a business as the Super Admin.
  function saveSettings(businessId: string, body: Partial<{ phoneNumberId: string; templateName: string; accessToken: string | null; enabled: boolean }> = {}) {
    return as(superAdmin).put(`/super-admin/businesses/${businessId}/whatsapp`, { phoneNumberId: '1065403522', accessToken: TOKEN, enabled: true, ...body });
  }

  // Uploads an advertisement as the tenant's Admin.
  async function upload(t: TestTenant, title = 'Monsoon offer', description = '20% off weekend stays'): Promise<string> {
    const admin = await login(t.users.ADMIN);
    const response = await request(app.getHttpServer())
      .post('/api/v1/ads')
      .set(sessionHeaders(admin, true))
      .field('title', title)
      .field('description', description)
      .field('linkUrl', 'https://hotel.test/offer')
      .attach('image', PNG, { filename: 'offer.png', contentType: 'image/png' })
      .expect(201);
    return response.body.id as string;
  }

  // Waits until a send has finished and returns it.
  async function finished(session: SessionCookies, adId: string): Promise<AdWhatsAppSendSummary> {
    for (let i = 0; i < 100; i++) {
      const [latest] = (await as(session).get(`/ads/${adId}/whatsapp`).expect(200)).body as AdWhatsAppSendSummary[];
      if (latest && latest.status !== 'SENDING') return latest;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('The send did not finish in time.');
  }

  // Proves consent is off by default, recorded with its time when given, cleared when withdrawn, and audited by name only.
  it('records guest consent to WhatsApp offers', async () => {
    const t = await tenant();
    const reception = await login(t.users.RECEPTIONIST);
    const plain = (await as(reception).post('/guests', { fullName: 'Anil Kumar', phone: '+91 98765 43210' }).expect(201)).body as GuestDetail;
    expect(plain.whatsappOffersConsent).toBe(false);
    expect(plain.whatsappOffersConsentAt).toBeNull();

    const agreed = (await as(reception).post('/guests', { fullName: 'Bina Thomas', phone: '+91 98765 43211', whatsappOffersConsent: true }).expect(201)).body as GuestDetail;
    expect(agreed.whatsappOffersConsent).toBe(true);
    expect(Date.parse(agreed.whatsappOffersConsentAt!)).toBeGreaterThan(Date.now() - 60_000);

    const withdrawn = (await as(reception).patch(`/guests/${agreed.id}`, { whatsappOffersConsent: false }).expect(200)).body as GuestDetail;
    expect(withdrawn.whatsappOffersConsent).toBe(false);
    expect(withdrawn.whatsappOffersConsentAt).toBeNull();
    const given = (await as(reception).patch(`/guests/${plain.id}`, { whatsappOffersConsent: true }).expect(200)).body as GuestDetail;
    expect(given.whatsappOffersConsentAt).not.toBeNull();
    await as(reception).patch(`/guests/${plain.id}`, { whatsappOffersConsent: 'yes' }).expect(400);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: agreed.id, action: 'guest.updated' } });
    expect(audit.metadata).toEqual({ changedFields: ['whatsappOffersConsent'] });
    // The database refuses a consent time without consent.
    await expect(prisma.guest.update({ where: { id: plain.id }, data: { whatsappOffersConsent: false } })).rejects.toThrow();
  });

  // Proves the Super Admin saves the settings, the token is encrypted and never returned, and business users cannot reach them.
  it('keeps the WhatsApp settings with the Super Admin and the token secret', async () => {
    const t = await tenant();
    const path = `/super-admin/businesses/${t.businessId}/whatsapp`;
    expect((await as(superAdmin).get(path).expect(200)).body).toMatchObject({ configured: false, tokenSet: false });
    await saveSettings(t.businessId, { accessToken: null }).expect(400);
    await saveSettings(t.businessId, { phoneNumberId: '12ab' }).expect(400);
    // There is no template to choose (owner decision 2026-11-11): a template name is refused as an unknown field.
    await saveSettings(t.businessId, { templateName: 'hotel_offer' }).expect(400);

    const saved = (await saveSettings(t.businessId).expect(200)).body as WhatsAppSettingsView;
    expect(saved).toEqual({ configured: true, enabled: true, phoneNumberId: '1065403522', tokenSet: true, updatedAt: expect.any(String) });
    expect(JSON.stringify(saved)).not.toContain(TOKEN);
    const row = await prisma.businessWhatsAppSettings.findUniqueOrThrow({ where: { businessId: t.businessId } });
    expect(row.accessTokenEncrypted).not.toContain(TOKEN);
    expect(row.accessTokenEncrypted).not.toContain('EAAtest');

    // Saving again without a token keeps the stored one.
    await saveSettings(t.businessId, { accessToken: null, phoneNumberId: '1065403599' }).expect(200);
    const kept = await prisma.businessWhatsAppSettings.findUniqueOrThrow({ where: { businessId: t.businessId } });
    expect(kept.accessTokenEncrypted).toBe(row.accessTokenEncrypted);
    expect(kept.phoneNumberId).toBe('1065403599');

    const audits = await prisma.auditLog.findMany({ where: { businessId: t.businessId, action: 'business.whatsapp_settings_saved' } });
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain(TOKEN);

    const admin = await login(t.users.ADMIN);
    await as(admin).get(path).expect(401);
    await as(admin).put(path, { phoneNumberId: '1', enabled: true }).expect(401);
    await as(superAdmin).get('/super-admin/businesses/00000000-0000-7000-8000-000000000000/whatsapp').expect(404);
  });

  // Proves an ad goes only to consenting guests with an international number, once per number, with failures recorded.
  it('sends an advertisement to the guests who agreed', async () => {
    const t = await tenant();
    const reception = await login(t.users.RECEPTIONIST);
    const adId = await upload(t);

    // Not set up yet: nothing can be sent.
    expect((await as(reception).get('/ads/whatsapp').expect(200)).body).toMatchObject({ configured: false });
    expect((await as(reception).post(`/ads/${adId}/whatsapp`).expect(409)).body.message).toMatch(/not set up/);
    await saveSettings(t.businessId).expect(200);

    // No guest has agreed yet.
    expect((await as(reception).post(`/ads/${adId}/whatsapp`).expect(400)).body.message[0]).toMatch(/No guests have agreed/);

    const guest = (body: object) => as(reception).post('/guests', body).expect(201);
    await guest({ fullName: 'Asha Menon', phone: '+91 98470 11111', whatsappOffersConsent: true });
    const failing = (await guest({ fullName: 'Ravi Nair', phone: '+91 98470 00000', whatsappOffersConsent: true })).body as GuestDetail;
    await guest({ fullName: 'No Country Code', phone: '98470 22222', whatsappOffersConsent: true });
    await guest({ fullName: 'Did Not Agree', phone: '+91 98470 33333' });
    await guest({ fullName: 'Asha Duplicate Number', phone: '+91-98470-11111', whatsappOffersConsent: true });

    const status = (await as(reception).get('/ads/whatsapp').expect(200)).body as AdWhatsAppStatus;
    expect(status).toEqual({ configured: true, recipients: 2, skipped: 1, sendingNow: false });

    const before = fake.requests.length;
    const started = (await as(reception).post(`/ads/${adId}/whatsapp`).expect(202)).body as AdWhatsAppSendSummary;
    expect(started).toMatchObject({ advertisementId: adId, total: 2, skipped: 1, sentBy: { id: t.users.RECEPTIONIST.id } });
    const done = await finished(reception, adId);
    expect(done).toMatchObject({ status: 'COMPLETED', total: 2, sent: 1, failed: 1, skipped: 1, error: null, failureReason: expect.stringMatching(/not in allowed list/) });

    // What reached the stand-in: one image upload, then one template message per number, with the stored token.
    const calls = fake.requests.slice(before);
    expect(calls.map((c) => c.path)).toEqual(['/1065403522/media', '/1065403522/messages', '/1065403522/messages']);
    expect(calls.every((c) => c.token === TOKEN)).toBe(true);
    const messages = calls.filter((c) => c.path.endsWith('/messages')).map((c) => c.body!);
    expect(messages.map((m) => m.to).sort()).toEqual(['919847000000', '919847011111']);
    const toAsha = messages.find((m) => m.to === '919847011111')!;
    // Always CloudInn's fixed template, carrying the ad's own picture (uploaded as the header image) and its text.
    expect(toAsha.template).toEqual({
      name: 'cloudinn_ad',
      language: { code: 'en' },
      components: [
        { type: 'header', parameters: [{ type: 'image', image: { id: expect.stringMatching(/^media-/) } }] },
        { type: 'body', parameters: [{ type: 'text', text: expect.stringMatching(/^Asha /) }, { type: 'text', text: 'Monsoon offer' }, { type: 'text', text: '20% off weekend stays https://hotel.test/offer' }] },
      ],
    });

    const recipients = await prisma.adWhatsAppRecipient.findMany({ where: { sendId: done.id } });
    expect(recipients.find((r) => r.guestId === failing.id)).toMatchObject({ status: 'FAILED', error: expect.stringMatching(/not in allowed list/) });
    expect(recipients.find((r) => r.phone === '919847011111')).toMatchObject({ status: 'SENT', providerMessageId: expect.stringMatching(/^wamid\./) });
    // One message per number: Asha and the guest sharing her number get one message between them.
    expect(recipients).toHaveLength(2);
    expect(recipients.filter((r) => r.phone === '919847011111')).toHaveLength(1);

    const actions = (await prisma.auditLog.findMany({ where: { businessId: t.businessId, entityId: adId } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['advertisement.whatsapp_send_started', 'advertisement.whatsapp_send_finished']));
    expect(JSON.stringify(await prisma.auditLog.findMany({ where: { businessId: t.businessId } }))).not.toContain(TOKEN);
  });

  // Proves a failed image upload fails the whole send, and a token that can no longer be decrypted blocks sending.
  it('reports a failed upload and unreadable settings', async () => {
    const t = await tenant();
    const manager = await login(t.users.MANAGER);
    const adId = await upload(t);
    await as(manager).post('/guests', { fullName: 'Leela Das', phone: '+44 7700 900123', whatsappOffersConsent: true }).expect(201);
    await saveSettings(t.businessId, { accessToken: `token-that-fails-uploads-${'y'.repeat(20)}` }).expect(200);
    await as(manager).post(`/ads/${adId}/whatsapp`).expect(202);
    const done = await finished(manager, adId);
    expect(done).toMatchObject({ status: 'FAILED', total: 1, sent: 0, failed: 1, error: expect.stringMatching(/image could not be uploaded/) });

    await prisma.businessWhatsAppSettings.update({ where: { businessId: t.businessId }, data: { accessTokenEncrypted: Buffer.from('not a real encrypted token at all').toString('base64') } });
    expect((await as(manager).get('/ads/whatsapp').expect(200)).body).toMatchObject({ configured: false });
    expect((await as(manager).post(`/ads/${adId}/whatsapp`).expect(409)).body.message).toMatch(/saved again/);
  });

  // Proves only one send runs at a time, every business role may send, and another business reaches nothing.
  it('allows one send at a time and isolates businesses', async () => {
    const t = await tenant();
    const other = await tenant();
    const adId = await upload(t);
    await saveSettings(t.businessId).expect(200);
    const admin = await login(t.users.ADMIN);
    await as(admin).post('/guests', { fullName: 'Mini Joseph', phone: '+91 98470 44444', whatsappOffersConsent: true }).expect(201);

    // A send still in progress blocks a second one.
    const running = await prisma.adWhatsAppSend.create({ data: { businessId: t.businessId, advertisementId: adId, sentByUserId: t.users.ADMIN.id, totalCount: 0 } });
    expect((await as(admin).get('/ads/whatsapp').expect(200)).body).toMatchObject({ sendingNow: true });
    expect((await as(admin).post(`/ads/${adId}/whatsapp`).expect(409)).body.message).toMatch(/Another advertisement is being sent/);
    await prisma.adWhatsAppSend.update({ where: { id: running.id }, data: { status: 'COMPLETED', completedAt: new Date() } });

    for (const role of ['ADMIN', 'MANAGER', 'RECEPTIONIST'] as const) {
      const session = await login(t.users[role]);
      await as(session).post(`/ads/${adId}/whatsapp`).expect(202);
      expect((await finished(session, adId)).status).toBe('COMPLETED');
    }

    const foreign = await login(other.users.ADMIN);
    await as(foreign).post(`/ads/${adId}/whatsapp`).expect(404);
    await as(foreign).get(`/ads/${adId}/whatsapp`).expect(404);
    expect((await as(foreign).get('/ads/whatsapp').expect(200)).body).toMatchObject({ configured: false, recipients: 0 });
    await request(app.getHttpServer()).post(`/api/v1/ads/${adId}/whatsapp`).expect(401);
  });
});
