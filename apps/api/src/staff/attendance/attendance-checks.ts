// Pure checks behind attendance: the distance from the attendance area, the short-lived capture token, and the rules a selfie file must meet.
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { ATTENDANCE_SELFIE_MAX_BYTES } from '@hms/shared';
import { safeEqual } from '../../auth/session/session-tokens.js';
import type { UploadedFileInput } from '../../guests/documents/file-checks.js';

// How long a capture token stays valid after the location check (5 minutes).
export const CAPTURE_TOKEN_MS = 5 * 60_000;

// Message for any photo that did not come from the page's camera step.
export const CAMERA_ONLY_MESSAGE = 'Use the camera on this page to take your photo. Existing photos cannot be used.';

// Great-circle distance in whole metres between two points, by the haversine formula.
export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeChange = radians(b.latitude - a.latitude);
  const longitudeChange = radians(b.longitude - a.longitude);
  const h = Math.sin(latitudeChange / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(longitudeChange / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h))));
}

// The worst device accuracy accepted for an area: a reading vaguer than this cannot show the device is inside it.
export function maxAccuracyMeters(radiusMeters: number): number {
  return Math.max(radiusMeters, 100);
}

// Signature tying a capture token to one session, one location, and an expiry time.
function signature(secret: string, sessionId: string, locationId: string, expires: number): string {
  return createHmac('sha256', secret).update(`attendance:${sessionId}:${locationId}:${expires}`, 'utf8').digest('base64url');
}

// Issues the token that proves this session passed the location check moments ago.
export function createCaptureToken(secret: string, sessionId: string, locationId: string, now: number): string {
  const expires = now + CAPTURE_TOKEN_MS;
  return `${expires}.${signature(secret, sessionId, locationId, expires)}`;
}

// True when the token was issued to this session and location and has not expired.
export function isValidCaptureToken(secret: string, token: string, sessionId: string, locationId: string, now: number): boolean {
  const [expiresText, given, extra] = token.split('.');
  if (!expiresText || !given || extra !== undefined || !/^\d{1,16}$/.test(expiresText)) return false;
  const expires = Number(expiresText);
  return expires >= now && safeEqual(signature(secret, sessionId, locationId, expires), given);
}

// True when a JPEG carries an APP1 segment (EXIF or XMP), which camera-app files have and the page's canvas capture never does.
export function hasFileMetadata(jpeg: Buffer): boolean {
  let offset = 2;
  while (offset + 4 <= jpeg.length && jpeg[offset] === 0xff) {
    const marker = jpeg[offset + 1];
    if (marker === 0xda || marker === 0xd9) return false;
    if (marker === 0xe1) return true;
    offset += 2 + jpeg.readUInt16BE(offset + 2);
  }
  return false;
}

// Checks a selfie is a real JPEG, within the size limit, and shaped like the page's camera capture (throws a readable error otherwise).
export function verifySelfie(file: UploadedFileInput | undefined): void {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) throw new BadRequestException(['Take your photo before confirming.']);
  if (file.buffer.length > ATTENDANCE_SELFIE_MAX_BYTES) throw new PayloadTooLargeException('The file is larger than 5 MB.');
  const isJpeg = file.buffer.length > 3 && file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff;
  if (!isJpeg || file.mimetype.toLowerCase() !== 'image/jpeg' || hasFileMetadata(file.buffer)) throw new BadRequestException([CAMERA_ONLY_MESSAGE]);
}
