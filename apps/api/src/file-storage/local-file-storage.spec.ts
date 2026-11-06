// Unit tests for the local private storage adapter: store/read/delete, atomic writes, and refusal of unsafe keys.
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InvalidStorageKeyError } from './file-storage.js';
import { LocalFileStorage } from './local-file-storage.js';

describe('LocalFileStorage', () => {
  let root: string;
  let storage: LocalFileStorage;

  // Uses a fresh temporary folder for every test.
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'cloudinn-storage-unit-'));
    storage = new LocalFileStorage(root);
  });

  // Removes the temporary folder.
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // Proves bytes round-trip, no temporary file is left behind, and deleting is idempotent.
  it('stores, reads, and deletes files', async () => {
    const key = 'guest-documents/business-1/0b1e7c9a-0000-4000-8000-000000000001';
    await storage.put(key, Buffer.from('hello'));
    expect((await storage.read(key))!.toString()).toBe('hello');
    expect(readdirSync(path.join(root, 'guest-documents', 'business-1'))).toEqual(['0b1e7c9a-0000-4000-8000-000000000001']);
    await storage.delete(key);
    expect(await storage.read(key)).toBeNull();
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });

  // Proves keys that could escape the root folder or carry file names are refused before touching the disk.
  it('refuses unsafe keys', async () => {
    for (const key of ['../outside', 'a/../../outside', '/etc/passwd', 'C:\\Windows\\x', 'a//b', 'name.pdf', 'UPPER', '', 'a/b/c/d/e/f/g']) {
      await expect(storage.put(key, Buffer.from('x'))).rejects.toBeInstanceOf(InvalidStorageKeyError);
      await expect(storage.read(key)).rejects.toBeInstanceOf(InvalidStorageKeyError);
    }
    expect(existsSync(path.join(root, '..', 'outside'))).toBe(false);
  });
});
