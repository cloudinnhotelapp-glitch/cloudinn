// Encrypts and decrypts a business's WhatsApp access token for storage (AES-256-GCM). The key is derived from
// SESSION_SECRET with HKDF, so no extra secret is needed; changing SESSION_SECRET means the tokens must be entered again
// (decryption then fails and sending reports that the settings must be saved again).
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

// Fixed label that separates this key from any other use of SESSION_SECRET.
const KEY_INFO = 'cloudinn:whatsapp-access-token:v1';

// The 32-byte encryption key for a secret.
function keyFor(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), KEY_INFO, 32));
}

// Encrypts a token: base64 of a 12-byte IV, the 16-byte authentication tag, and the ciphertext.
export function encryptToken(secret: string, token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

// Decrypts a stored token, or returns null when it cannot be read (wrong key or altered data).
export function decryptToken(secret: string, stored: string): string | null {
  try {
    const raw = Buffer.from(stored, 'base64');
    if (raw.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', keyFor(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
