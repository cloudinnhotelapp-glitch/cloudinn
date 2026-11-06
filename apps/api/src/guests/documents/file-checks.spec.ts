// Unit tests for the server-side ID file checks: real-content detection, extension/type agreement, size, and display names.
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { GUEST_DOCUMENT_MAX_BYTES } from '@hms/shared';
import { detectContentType, displayFileName, verifyUploadedFile } from './file-checks.js';

// File starts for each accepted type.
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const PDF = Buffer.from('%PDF-1.4 body');

// Builds an uploaded-file object.
const file = (buffer: Buffer, originalname: string, mimetype: string) => ({ buffer, originalname, mimetype, size: buffer.length });

describe('detectContentType', () => {
  // Proves the first bytes decide the type.
  it('recognizes JPG, PNG, and PDF by content', () => {
    expect(detectContentType(JPG)).toBe('image/jpeg');
    expect(detectContentType(PNG)).toBe('image/png');
    expect(detectContentType(PDF)).toBe('application/pdf');
    expect(detectContentType(Buffer.from('GIF89a'))).toBeNull();
    expect(detectContentType(Buffer.from('MZ'))).toBeNull();
    expect(detectContentType(Buffer.from('<svg/>'))).toBeNull();
  });
});

describe('verifyUploadedFile', () => {
  // Proves genuine files pass, including older browser type names and upper-case extensions.
  it('accepts genuine files', () => {
    expect(verifyUploadedFile(file(JPG, 'scan.JPEG', 'image/jpeg'))).toBe('image/jpeg');
    expect(verifyUploadedFile(file(JPG, 'scan.jpg', 'image/pjpeg'))).toBe('image/jpeg');
    expect(verifyUploadedFile(file(PNG, 'scan.png', 'image/png'))).toBe('image/png');
    expect(verifyUploadedFile(file(PDF, 'scan.pdf', 'application/pdf'))).toBe('application/pdf');
  });

  // Proves disguised, mismatched, empty, missing, and oversized files are refused.
  it('refuses disguised, mismatched, empty, missing, and oversized files', () => {
    expect(() => verifyUploadedFile(undefined)).toThrow(BadRequestException);
    expect(() => verifyUploadedFile(file(Buffer.alloc(0), 'a.pdf', 'application/pdf'))).toThrow(BadRequestException);
    expect(() => verifyUploadedFile(file(Buffer.from('MZ....'), 'a.pdf', 'application/pdf'))).toThrow(BadRequestException);
    expect(() => verifyUploadedFile(file(PNG, 'a.jpg', 'image/jpeg'))).toThrow(BadRequestException);
    expect(() => verifyUploadedFile(file(PNG, 'a.png', 'image/jpeg'))).toThrow(BadRequestException);
    expect(() => verifyUploadedFile(file(PDF, 'a.pdf.exe', 'application/pdf'))).toThrow(BadRequestException);
    expect(() => verifyUploadedFile(file(Buffer.concat([PDF, Buffer.alloc(GUEST_DOCUMENT_MAX_BYTES)]), 'a.pdf', 'application/pdf'))).toThrow(
      PayloadTooLargeException,
    );
  });
});

describe('displayFileName', () => {
  // Proves folder parts, control and markup characters are removed, and long names are shortened keeping the extension.
  it('cleans file names for display', () => {
    expect(displayFileName('C:\\fakepath\\passport.pdf')).toBe('passport.pdf');
    expect(displayFileName('../../etc/passwd.png')).toBe('passwd.png');
    // The "/" in "</script>" counts as a folder separator, so only the part after it is kept.
    expect(displayFileName('<script>x</script>.pdf')).toBe('script.pdf');
    expect(displayFileName('"><img src=x>.jpg')).toBe('img src=x.jpg');
    expect(displayFileName('a\u0000b\u001fc.pdf')).toBe('abc.pdf');
    expect(displayFileName('   ')).toBe('document');
    const long = displayFileName(`${'x'.repeat(300)}.jpeg`);
    expect(long).toHaveLength(120);
    expect(long.endsWith('.jpeg')).toBe(true);
  });
});
