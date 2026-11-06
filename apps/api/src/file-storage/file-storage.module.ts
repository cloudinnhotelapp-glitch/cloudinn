// File storage module: provides the configured private storage adapter under the FILE_STORAGE token.
// Version 1 ships the local development adapter only. STORAGE_DRIVER=s3 is accepted by the configuration (so the setting
// exists for production), but no S3 adapter is implemented yet: the API refuses to start with it, plainly, instead of
// silently storing files somewhere unexpected.
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation.js';
import { FILE_STORAGE, type FileStorage } from './file-storage.js';
import { LocalFileStorage } from './local-file-storage.js';

// Builds the storage adapter from the validated settings.
export function createFileStorage(config: ConfigService<Env, true>): FileStorage {
  const driver = config.get('STORAGE_DRIVER', { infer: true });
  if (driver !== 'local') {
    throw new Error('STORAGE_DRIVER=s3 is not available yet: production S3 storage is not configured in this version. Use STORAGE_DRIVER=local.');
  }
  return new LocalFileStorage(config.get('STORAGE_LOCAL_PATH', { infer: true }));
}

// Registers the storage adapter for the whole application.
@Global()
@Module({
  providers: [{ provide: FILE_STORAGE, inject: [ConfigService], useFactory: createFileStorage }],
  exports: [FILE_STORAGE],
})
export class FileStorageModule {}
