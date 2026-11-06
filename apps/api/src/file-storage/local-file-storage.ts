// Local-disk storage adapter for development (STORAGE_DRIVER=local). Files live under STORAGE_LOCAL_PATH, a folder the
// web app never serves (it is outside the Next.js public folder and git-ignored); they are read only through authorized
// API endpoints. Every key is checked against the allowed shape and the resolved path must stay inside the root folder,
// so path traversal is impossible. Files are written to a temporary name first and then renamed (atomic), with
// owner-only permissions where the operating system supports them.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertValidKey, InvalidStorageKeyError, type FileStorage } from './file-storage.js';

// Stores files on the local disk below one root folder.
export class LocalFileStorage implements FileStorage {
  private readonly root: string;

  // Resolves the root folder once (relative paths are relative to the API's working directory).
  constructor(rootPath: string) {
    this.root = path.resolve(rootPath);
  }

  // Writes the bytes to a temporary file next to the target, then renames it into place.
  async put(key: string, content: Buffer): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.tmp-${randomBytes(6).toString('hex')}`;
    try {
      await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  // Reads the stored bytes, or returns null when the file does not exist.
  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  // Removes the file (a missing file is ignored).
  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  // Maps a key to a path inside the root, refusing anything that would leave it.
  private pathFor(key: string): string {
    assertValidKey(key);
    const resolved = path.resolve(this.root, ...key.split('/'));
    if (!resolved.startsWith(this.root + path.sep)) throw new InvalidStorageKeyError();
    return resolved;
  }
}
