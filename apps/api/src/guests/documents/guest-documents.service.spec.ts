// Unit test for upload consistency: when the database write fails after the file was stored, the stored file is removed
// again, so no file is left without a database record.
import { GuestDocumentsService } from './guest-documents.service.js';

describe('GuestDocumentsService upload consistency', () => {
  // Proves a failed transaction removes the file that was just stored and passes the error on.
  it('removes the stored file when the database write fails', async () => {
    const stored = new Map<string, Buffer>();
    const storage = {
      put: vi.fn(async (key: string, content: Buffer) => void stored.set(key, content)),
      read: vi.fn(async (key: string) => stored.get(key) ?? null),
      delete: vi.fn(async (key: string) => void stored.delete(key)),
    };
    const prisma = {
      guest: { findFirst: vi.fn(async () => ({ id: 'guest-1' })) },
      guestDocument: { count: vi.fn(async () => 0) },
      $transaction: vi.fn(async () => {
        throw new Error('database unavailable');
      }),
    };
    const service = new GuestDocumentsService(prisma as never, { record: vi.fn() } as never, storage);
    const file = { originalname: 'id.pdf', mimetype: 'application/pdf', size: 9, buffer: Buffer.from('%PDF-1.7\n') };

    await expect(
      service.upload({ businessId: 'b1', locationId: 'l1' }, 'guest-1', 'PASSPORT', file, { actorType: 'BUSINESS_USER', businessUserId: 'u1' }),
    ).rejects.toThrow('database unavailable');
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith(storage.put.mock.calls[0]![0]);
    expect(stored.size).toBe(0);
  });
});
