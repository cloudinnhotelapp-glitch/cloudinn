// Unit tests for the shared WhatsApp feedback helpers (Room Dashboard): international phone numbers only (never guessed),
// the message text, and a safely encoded "click to chat" link.
import { buildFeedbackMessage, normalizeWhatsAppPhone, whatsAppLink } from '@hms/shared';

// Tests for the WhatsApp helpers.
describe('WhatsApp feedback helpers', () => {
  // Proves international numbers are read with spaces and signs removed, and anything else is refused with a reason.
  it('reads only international phone numbers', () => {
    expect(normalizeWhatsAppPhone('+91 98450 12345')).toEqual({ ok: true, digits: '919845012345' });
    expect(normalizeWhatsAppPhone('0044 (20) 7946-0958')).toEqual({ ok: true, digits: '442079460958' });
    expect(normalizeWhatsAppPhone('+1.415.555.0100')).toEqual({ ok: true, digits: '14155550100' });
    expect(normalizeWhatsAppPhone(null)).toMatchObject({ ok: false, reason: expect.stringContaining('no phone number') });
    expect(normalizeWhatsAppPhone('  ')).toMatchObject({ ok: false });
    expect(normalizeWhatsAppPhone('98450 12345')).toMatchObject({ ok: false, reason: expect.stringContaining('country code') });
    expect(normalizeWhatsAppPhone('+91 98450 abc')).toMatchObject({ ok: false, reason: expect.stringContaining('not allowed') });
    expect(normalizeWhatsAppPhone('+123')).toMatchObject({ ok: false, reason: expect.stringContaining('not a valid') });
    expect(normalizeWhatsAppPhone('+1234567890123456')).toMatchObject({ ok: false });
  });

  // Proves the message names the guest, the hotel, and the link, and the link encodes it (spaces, &, ?, #, accents).
  it('builds an encoded click-to-chat link', () => {
    const message = buildFeedbackMessage('Anna & José', 'Sea View Hotel', 'https://example.com/f?h=1#x');
    expect(message).toBe('Hello Anna & José, thank you for staying with Sea View Hotel. We would appreciate your feedback about your stay: https://example.com/f?h=1#x');
    const link = whatsAppLink('919845012345', message);
    expect(link.startsWith('https://wa.me/919845012345?text=')).toBe(true);
    // The encoded text has no raw space, "#", "&", or "?" that could cut the link short or start a new parameter.
    expect(link.split('?text=')[1]).not.toMatch(/[ #&?]/);
    expect(decodeURIComponent(link.split('?text=')[1]!)).toBe(message);
  });
});
