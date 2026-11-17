// WhatsApp helpers shared by the API and the web app. Guest feedback (Room Dashboard) only prepares a "click to chat"
// link (https://wa.me/<number>?text=<message>) that staff open themselves. Advertisements (owner decision 2026-11-11)
// are sent by the server through the business's own WhatsApp Business Platform account, only to guests who agreed.

// Result of reading a phone number for WhatsApp.
export type WhatsAppPhone = { ok: true; digits: string } | { ok: false; reason: string };

// Reads a stored phone number as an international WhatsApp number: it must start with "+" (or "00") and the country
// code, and have 8–15 digits; spaces, dashes, dots, and brackets are ignored. A number without a country code is
// refused rather than guessed.
export function normalizeWhatsAppPhone(raw: string | null | undefined): WhatsAppPhone {
  const value = (raw ?? '').trim();
  if (!value) return { ok: false, reason: 'The guest has no phone number on record.' };
  if (!/^[+\d][\d\s().-]*$/.test(value)) return { ok: false, reason: 'The guest’s phone number contains characters that are not allowed.' };
  const international = value.startsWith('+') || value.startsWith('00');
  const digits = value.replace(/\D/g, '').replace(/^00/, '');
  if (!international) return { ok: false, reason: 'Add the country code to the guest’s phone number (for example +91 98765 43210).' };
  if (digits.length < 8 || digits.length > 15) return { ok: false, reason: 'The guest’s phone number is not a valid international number.' };
  return { ok: true, digits };
}

// The feedback message (the link is added only when the property has one configured).
export function buildFeedbackMessage(guestName: string, propertyName: string, feedbackUrl: string): string {
  return `Hello ${guestName}, thank you for staying with ${propertyName}. We would appreciate your feedback about your stay: ${feedbackUrl}`;
}

// The WhatsApp "click to chat" link with the message safely encoded.
export function whatsAppLink(digits: string, message: string): string {
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

// The one fixed Meta template that carries every advertisement (owner decision 2026-11-11: no template in the WhatsApp
// settings; the guest receives the ad uploaded on the Ads page). Its image header is the ad's own picture and its body
// holds the guest's name, the ad title, and the description and link. Meta only delivers marketing messages to guests who
// have not written in the last 24 hours through an approved template, and accepts a plain message without reporting
// that it was not delivered, so CloudInn always uses this template. Each business creates it once in WhatsApp Manager:
// Marketing, name "cloudinn_ad", English (en), an Image header, and the body "Hello {{1}}, {{2}}: {{3}}".
export const WHATSAPP_AD_TEMPLATE = { name: 'cloudinn_ad', language: 'en', body: 'Hello {{1}}, {{2}}: {{3}}' } as const;

// A plain explanation of a WhatsApp Business Platform error (by Meta's error code in the message, "(#132001) ..."), so
// the hotel knows what to fix; null when the error is not one of the common ones.
export function explainWhatsAppError(message: string | null | undefined): string | null {
  const code = /\(#(\d+)\)/.exec(message ?? '')?.[1] ?? /\b(1\d{5}|190)\b/.exec(message ?? '')?.[1];
  switch (code) {
    case '132001':
      return 'WhatsApp needs the approved template "cloudinn_ad" (English, en) for guests who have not written to the hotel in the last 24 hours. Create it once in Meta’s WhatsApp Manager (Marketing; Image header; body: Hello {{1}}, {{2}}: {{3}}) and wait until it is approved.';
    case '131047':
      return 'WhatsApp only allows a free picture message to guests who wrote to the hotel in the last 24 hours.';
    case '132000':
    case '132012':
      return 'The template’s variables do not match. It needs an image header and exactly three body variables: {{1}} guest name, {{2}} title, {{3}} details.';
    case '132015':
    case '132016':
      return 'The template is paused or disabled in Meta’s WhatsApp Manager.';
    case '131030':
      return 'This number is not on the allowed list of a Meta test number. Add it in Meta, or use the business’s live WhatsApp number.';
    case '190':
      return 'The WhatsApp access token has expired or is not valid. Ask your platform administrator to save a new one.';
    case '131026':
      return 'The message could not be delivered, for example because the number is not on WhatsApp.';
    case '131049':
      return 'WhatsApp held this marketing message back to protect the guest’s experience; it may go through later.';
    default:
      return null;
  }
}

// What the API returns for a WhatsApp feedback request (opened by staff; never sent automatically).
export interface WhatsAppFeedback {
  /** The international number used (digits only), shown so staff can check it. */
  phone: string;
  message: string;
  url: string;
}
