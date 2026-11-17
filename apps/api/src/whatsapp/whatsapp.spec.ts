// Unit tests for WhatsApp advertisement sending helpers: the access-token encryption, the template values, and the plain
// explanations of Meta's errors.
import { explainWhatsAppError } from '@hms/shared';
import { adTemplateParameters, templateText } from './whatsapp-cloud.client.js';
import { decryptToken, encryptToken } from './whatsapp-token-crypto.js';

const SECRET = 'unit-test-session-secret-'.repeat(4);
const TOKEN = `EAAunit${'z'.repeat(80)}`;

describe('WhatsApp access token encryption', () => {
  // Proves a token comes back unchanged, and the stored form never contains it.
  it('encrypts and decrypts', () => {
    const stored = encryptToken(SECRET, TOKEN);
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain('EAAunit');
    expect(decryptToken(SECRET, stored)).toBe(TOKEN);
  });

  // Proves the same token is stored differently each time (a fresh IV).
  it('uses a fresh IV each time', () => {
    expect(encryptToken(SECRET, TOKEN)).not.toBe(encryptToken(SECRET, TOKEN));
  });

  // Proves another secret, altered data, and junk are refused instead of returning garbage.
  it('refuses the wrong key and altered data', () => {
    const stored = encryptToken(SECRET, TOKEN);
    expect(decryptToken(`${SECRET}x`, stored)).toBeNull();
    const raw = Buffer.from(stored, 'base64');
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 1;
    expect(decryptToken(SECRET, raw.toString('base64'))).toBeNull();
    expect(decryptToken(SECRET, 'short')).toBeNull();
    expect(decryptToken(SECRET, '')).toBeNull();
  });
});

describe('advertisement template values', () => {
  // Proves the three body values: the guest's name, the title, and the description with the link.
  it('builds the name, title, and details', () => {
    expect(adTemplateParameters('Asha Menon', { title: 'Monsoon offer', description: '20% off', linkUrl: 'https://hotel.test/o' })).toEqual(['Asha Menon', 'Monsoon offer', '20% off https://hotel.test/o']);
  });

  // Proves Meta's rules are kept: no empty value, no line breaks or tabs, at most three spaces in a row, limited length.
  it('never sends an empty or malformed value', () => {
    expect(adTemplateParameters('  ', { title: 'Offer', description: null, linkUrl: null })).toEqual(['Guest', 'Offer', 'Ask us for details.']);
    expect(templateText('Line one\nline two\t\tend')).toBe('Line one line two end');
    expect(templateText('a      b')).toBe('a   b');
    const long = templateText('x'.repeat(2000));
    expect(long).toHaveLength(1000);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('WhatsApp error explanations', () => {
  // Proves the common Meta errors get a plain hint (by the "(#code)" in Meta's message), and unknown ones none.
  it('explains the common errors', () => {
    expect(explainWhatsAppError('(#132001) Template name does not exist in the translation')).toMatch(/approved template "cloudinn_ad" \(English, en\)/);
    expect(explainWhatsAppError('(#131030) Recipient phone number not in allowed list')).toMatch(/allowed list/);
    expect(explainWhatsAppError('(#190) Error validating access token')).toMatch(/access token has expired/);
    expect(explainWhatsAppError('Something else went wrong')).toBeNull();
    expect(explainWhatsAppError(null)).toBeNull();
  });
});
