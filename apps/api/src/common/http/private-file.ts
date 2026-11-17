// Helpers for private uploaded files: one-file multipart parsing with a readable size error, and sending stored files with headers that stop caching and content sniffing.
import { CallHandler, ExecutionContext, Injectable, mixin, type NestInterceptor, PayloadTooLargeException, StreamableFile, type Type } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { Observable } from 'rxjs';

// A stored file ready to send to the browser.
export interface PrivateFile {
  fileName: string;
  contentType: string;
  content: Buffer;
}

// Builds a Content-Disposition header with a safe ASCII name and the full UTF-8 name.
function contentDisposition(kind: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

// Sends a stored file with private, no-sniff headers.
export function sendPrivateFile(res: Response, file: PrivateFile, kind: 'inline' | 'attachment'): StreamableFile {
  res.set({
    'Content-Type': file.contentType,
    'Content-Length': String(file.content.length),
    'Content-Disposition': contentDisposition(kind, file.fileName),
    'Cache-Control': 'private, no-store, max-age=0',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  return new StreamableFile(file.content);
}

// Builds an interceptor that parses one file kept in memory, at most the given size, with a few small text fields.
export function singleFileUpload(field: string, maxBytes: number): Type<NestInterceptor> {
  const Base = FileInterceptor(field, { limits: { fileSize: maxBytes, files: 1, fields: 8, fieldSize: 2048, parts: 10 } });

  // Same as the multipart interceptor, with a readable message for files over the size limit.
  @Injectable()
  class LimitedUpload extends Base {
    // Runs the parser and replaces its generic "File too large" message.
    override async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
      try {
        return await super.intercept(context, next);
      } catch (error) {
        if (error instanceof PayloadTooLargeException) throw new PayloadTooLargeException(`The file is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`);
        throw error;
      }
    }
  }
  return mixin(LimitedUpload);
}
