import type { PoolClient } from 'pg';
import { afterEach, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { StorageObjectNotFound, type StorageProvider } from '@barghsa/shared/storage';
import {
  prepareBankReceiptAttachment,
  persistSealedBankReceipt,
  type StorageLockRow,
} from './seal-bank-receipt-attachment.js';
import { reserveStorageCopy } from '../storage/reserve-storage-copy.js';
vi.mock('../storage/reserve-storage-copy.js', async (original) => ({
  ...(await original<typeof import('../storage/reserve-storage-copy.js')>()),
  reserveStorageCopy: vi.fn().mockResolvedValue(undefined),
}));
afterEach(() => vi.resetAllMocks());
const key = 'uploads/document/11111111-1111-4111-8111-111111111111.pdf';
const bytes = Buffer.from('%PDF-1.7\nReceipt');
const row: StorageLockRow = {
  status: 'active',
  metadata: { uploadedBy: 'actor' },
  file_size: bytes.length,
  content_type: 'application/pdf',
  category: 'document',
  file_name: 'receipt.pdf',
};
const sealed = {
  sealedKey: 'sealed-copy',
  bytes,
  detectedContentType: 'application/pdf',
  category: 'document' as const,
};
const binding = {
  receiptId: '11111111-1111-7111-8111-111111111111',
  profileId: '22222222-2222-7222-8222-222222222222',
  flow: 'invoice',
} as const;
function fixture() {
  const client = {
    query: vi.fn(
      async (
        sql: string,
        _params?: unknown[]
      ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> => {
        if (sql.includes('pg_try_advisory_lock'))
          return { rows: [{ acquired: true }], rowCount: 1 };
        if (sql.includes('pg_advisory_unlock')) return { rows: [{ released: true }], rowCount: 1 };
        return { rows: [{ storage_key: 'reserved' }], rowCount: 1 };
      }
    ),
    release: vi.fn(),
  };
  const putObject = vi.fn().mockResolvedValue(undefined);
  const getObject = vi.fn().mockImplementation(async () => ({ body: Readable.from([bytes]) }));
  return {
    client,
    directClient: client as unknown as PoolClient,
    putObject,
    getObject,
    storage: { putObject, getObject } as unknown as StorageProvider,
  };
}
it('rejects an invalid receipt key before accessing storage', async () => {
  const { directClient, storage, getObject, putObject } = fixture();
  await expect(
    prepareBankReceiptAttachment(directClient, storage, 'actor', '../receipt.pdf', row)
  ).rejects.toMatchObject({ status: 400 });
  expect(getObject).not.toHaveBeenCalled();
  expect(putObject).not.toHaveBeenCalled();
});
it('rejects an empty stored receipt before reserving or writing a copy', async () => {
  const { directClient, storage, getObject, putObject } = fixture();
  getObject.mockResolvedValueOnce({ body: Readable.from([]) });
  await expect(
    prepareBankReceiptAttachment(directClient, storage, 'actor', key, row)
  ).rejects.toMatchObject({ status: 400 });
  expect(reserveStorageCopy).not.toHaveBeenCalled();
  expect(putObject).not.toHaveBeenCalled();
});
it('rejects a stored receipt whose category disagrees with its key', async () => {
  const { directClient, storage, putObject } = fixture();
  await expect(
    prepareBankReceiptAttachment(directClient, storage, 'actor', key, { ...row, category: 'image' })
  ).rejects.toMatchObject({ status: 400 });
  expect(reserveStorageCopy).not.toHaveBeenCalled();
  expect(putObject).not.toHaveBeenCalled();
});
it('uses measured storage bytes when the legacy recorded size is absent', async () => {
  const { directClient, storage, putObject } = fixture();
  await expect(
    prepareBankReceiptAttachment(directClient, storage, 'actor', key, { ...row, file_size: null })
  ).resolves.toMatchObject({
    bytes: new Uint8Array(bytes),
    detectedContentType: 'application/pdf',
  });
  expect(putObject).toHaveBeenCalledWith(
    expect.any(String),
    new Uint8Array(bytes),
    'application/pdf'
  );
});
it.each([
  [null, {}],
  [[], {}],
  [17, {}],
  ['invalid json', {}],
  ['null', {}],
  ['[]', {}],
  ['17', {}],
  [JSON.stringify({ original: 'preserved' }), { original: 'preserved' }],
  [{ original: 'preserved' }, { original: 'preserved' }],
])(
  'sealing preserves valid metadata and discards invalid metadata %j',
  async (metadata, expected) => {
    const { client } = fixture();
    await persistSealedBankReceipt(client, 'actor', key, { ...row, metadata }, sealed, binding);
    const saved = JSON.parse(String(client.query.mock.calls[0]![1]?.[4]));
    expect(saved).toEqual({ ...(expected as object), sealedAttachmentKey: 'sealed-copy' });
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(client.query.mock.calls[1]![1]?.[1]))).toEqual({
      ...(expected as object),
      sealedAttachmentKey: 'sealed-copy',
      sourceAttachmentKey: key,
      receiptBinding: binding,
    });
  }
);
it.each([0, null])(
  'does not persist a sealed copy after the original lock update was lost (%s)',
  async (rowCount) => {
    const { client } = fixture();
    client.query.mockResolvedValue({ rows: [], rowCount });
    await expect(
      persistSealedBankReceipt(client, 'actor', key, row, sealed, binding)
    ).rejects.toMatchObject({ status: 400 });
    expect(client.query).toHaveBeenCalledTimes(1);
  }
);
it('distinguishes missing storage from storage transport failure without writing a copy', async () => {
  const { directClient, storage, getObject, putObject } = fixture();
  await expect(
    prepareBankReceiptAttachment(directClient, null, 'actor', key, row)
  ).rejects.toMatchObject({
    status: 400,
  });
  getObject.mockRejectedValueOnce(new StorageObjectNotFound(key));
  await expect(
    prepareBankReceiptAttachment(directClient, storage, 'actor', key, row)
  ).rejects.toMatchObject({ status: 400 });
  const failure = new Error('transport unavailable');
  getObject.mockRejectedValueOnce(failure);
  await expect(prepareBankReceiptAttachment(directClient, storage, 'actor', key, row)).rejects.toBe(
    failure
  );
  expect(putObject).not.toHaveBeenCalled();
  expect(reserveStorageCopy).not.toHaveBeenCalled();
});
it.each(['23505', 'XX001'])(
  'only a duplicate cleanup reservation may proceed, error %s',
  async (code) => {
    const { directClient, storage, putObject } = fixture();
    const error = Object.assign(new Error('reservation failure'), { code });
    vi.mocked(reserveStorageCopy).mockRejectedValueOnce(error);
    const action = prepareBankReceiptAttachment(directClient, storage, 'actor', key, row);
    if (code === '23505') {
      await expect(action).resolves.toMatchObject({ detectedContentType: 'application/pdf' });
      expect(putObject).toHaveBeenCalledTimes(1);
    } else {
      await expect(action).rejects.toBe(error);
      expect(putObject).not.toHaveBeenCalled();
    }
  }
);
it('does not write storage when its cleanup reservation changed ownership', async () => {
  const { client, directClient, storage, putObject } = fixture();
  client.query
    .mockResolvedValueOnce({ rows: [{ acquired: true }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [], rowCount: 0 });
  await expect(
    prepareBankReceiptAttachment(directClient, storage, 'actor', key, row)
  ).rejects.toMatchObject({ status: 409 });
  expect(putObject).not.toHaveBeenCalled();
});
