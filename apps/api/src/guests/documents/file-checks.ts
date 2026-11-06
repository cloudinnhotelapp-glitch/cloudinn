// Server-side checks for uploaded ID files. Nothing the browser says is trusted on its own: the file's extension, the
// type the browser reported, and the type found in the file's actual first bytes ("magic numbers") must all agree, and
// only JPG/JPEG, PNG, and PDF are accepted. The original file name is cleaned up for display only.
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { GUEST_DOCUMENT_MAX_BYTES, type GuestDocumentContentType } from '@hms/shared';

// File extensions accepted for each content type.
const EXTENSIONS: Record<GuestDocumentContentType, readonly string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'application/pdf': ['.pdf'],
};

// Browser-reported types accepted for each content type ("image/jpg" and "image/pjpeg" are older names some systems send).
const BROWSER_TYPES: Record<GuestDocumentContentType, readonly string[]> = {
  'image/jpeg': ['image/jpeg', 'image/jpg', 'image/pjpeg'],
  'image/png': ['image/png', 'image/x-png'],
  'application/pdf': ['application/pdf', 'application/x-pdf'],
};

// Message for any file that is not a JPG, PNG, or PDF.
export const UNSUPPORTED_FILE = 'Only JPG, PNG, and PDF files can be uploaded.';

// The minimal shape of an uploaded file (as delivered by the multipart parser, kept in memory).
export interface UploadedFileInput {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

// Finds the real type from the file's first bytes, or null when it is none of the accepted kinds.
export function detectContentType(content: Buffer): GuestDocumentContentType | null {
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return 'image/jpeg';
  if (content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (content.length >= 5 && content.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

// Cleans an original file name for display: drops any folder part, control and markup characters, and trims the length.
export function displayFileName(original: string): string {
  const base = original.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex -- control characters are removed on purpose
    .replace(/[\u0000-\u001f\u007f<>"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const name = cleaned.length > 0 ? cleaned : 'document';
  if (name.length <= 120) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : '';
  return `${name.slice(0, 120 - extension.length)}${extension}`;
}

// Checks one uploaded file and returns its verified content type (throws a readable 400/413 error otherwise).
export function verifyUploadedFile(file: UploadedFileInput | undefined): GuestDocumentContentType {
  if (!file || !Buffer.isBuffer(file.buffer)) throw new BadRequestException(['Choose a file to upload.']);
  if (file.buffer.length === 0) throw new BadRequestException(['The file is empty.']);
  if (file.buffer.length > GUEST_DOCUMENT_MAX_BYTES) throw new PayloadTooLargeException('The file is larger than 5 MB.');

  const detected = detectContentType(file.buffer);
  if (!detected) throw new BadRequestException([UNSUPPORTED_FILE]);
  const name = file.originalname.toLowerCase();
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  if (!Object.values(EXTENSIONS).some((list) => list.includes(extension))) throw new BadRequestException([UNSUPPORTED_FILE]);
  if (!EXTENSIONS[detected].includes(extension) || !BROWSER_TYPES[detected].includes(file.mimetype.toLowerCase())) {
    throw new BadRequestException(['The file’s content does not match its name or type. Upload the original JPG, PNG, or PDF file.']);
  }
  return detected;
}
