import { afterEach, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { StorageObjectNotFound, type StorageProvider } from '@barghsa/shared/storage';
import {
  sealBankReceiptAttachment,
  persistSealedBankReceipt,
  type StorageLockRow,
} from './seal-bank-receipt-attachment.js';
import { reserveStorageCopy } from '../storage/reserve-storage-copy.js';
vi.mock('../storage/reserve-storage-copy.js', () => ({
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
function fixture() {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [{ storage_key: 'reserved' }], rowCount: 1 }),
  };
  const putObject = vi.fn().mockResolvedValue(undefined);
  const getObject = vi.fn().mockImplementation(async () => ({ body: Readable.from([bytes]) }));
  return {
    client,
    putObject,
    getObject,
    storage: { putObject, getObject } as unknown as StorageProvider,
  };
}
it('rejects an invalid receipt key before accessing storage', async () => {
  const { client, storage, getObject, putObject } = fixture();
  await expect(
    sealBankReceiptAttachment(client, storage, 'actor', '../receipt.pdf', row)
  ).rejects.toMatchObject({ status: 400 });
  expect(getObject).not.toHaveBeenCalled();
  expect(putObject).not.toHaveBeenCalled();
});
it('rejects an empty stored receipt before reserving or writing a copy', async () => {
  const { client, storage, getObject, putObject } = fixture();
  getObject.mockResolvedValueOnce({ body: Readable.from([]) });
  await expect(sealBankReceiptAttachment(client, storage, 'actor', key, row)).rejects.toMatchObject(
    { status: 400 }
  );
  expect(reserveStorageCopy).not.toHaveBeenCalled();
  expect(putObject).not.toHaveBeenCalled();
});
it('rejects a stored receipt whose category disagrees with its key', async () => {
  const { client, storage, putObject } = fixture();
  await expect(
    sealBankReceiptAttachment(client, storage, 'actor', key, { ...row, category: 'image' })
  ).rejects.toMatchObject({ status: 400 });
  expect(reserveStorageCopy).not.toHaveBeenCalled();
  expect(putObject).not.toHaveBeenCalled();
});
it('uses measured storage bytes when the legacy recorded size is absent', async () => {
  const { client, storage, putObject } = fixture();
  await expect(
    sealBankReceiptAttachment(client, storage, 'actor', key, { ...row, file_size: null })
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
    await persistSealedBankReceipt(client, 'actor', key, { ...row, metadata }, sealed);
    const saved = JSON.parse(client.query.mock.calls[0]![1][4]);
    expect(saved).toEqual({ ...(expected as object), sealedAttachmentKey: 'sealed-copy' });
    expect(client.query).toHaveBeenCalledTimes(2);
  }
);
it.each([0, null])(
  'does not persist a sealed copy after the original lock update was lost (%s)',
  async (rowCount) => {
    const { client } = fixture();
    client.query.mockResolvedValue({ rows: [], rowCount });
    await expect(persistSealedBankReceipt(client, 'actor', key, row, sealed)).rejects.toMatchObject(
      { status: 400 }
    );
    expect(client.query).toHaveBeenCalledTimes(1);
  }
);
it('distinguishes missing storage from storage transport failure without writing a copy', async () => {
  const { client, storage, getObject, putObject } = fixture();
  await expect(sealBankReceiptAttachment(client, null, 'actor', key, row)).rejects.toMatchObject({
    status: 400,
  });
  getObject.mockRejectedValueOnce(new StorageObjectNotFound(key));
  await expect(sealBankReceiptAttachment(client, storage, 'actor', key, row)).rejects.toMatchObject(
    { status: 400 }
  );
  const failure = new Error('transport unavailable');
  getObject.mockRejectedValueOnce(failure);
  await expect(sealBankReceiptAttachment(client, storage, 'actor', key, row)).rejects.toBe(failure);
  expect(putObject).not.toHaveBeenCalled();
  expect(reserveStorageCopy).not.toHaveBeenCalled();
});
it.each(['23505', 'XX001'])(
  'only a duplicate cleanup reservation may proceed, error %s',
  async (code) => {
    const { client, storage, putObject } = fixture();
    const error = Object.assign(new Error('reservation failure'), { code });
    vi.mocked(reserveStorageCopy).mockRejectedValueOnce(error);
    const action = sealBankReceiptAttachment(client, storage, 'actor', key, row);
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
  const { client, storage, putObject } = fixture();
  client.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
  await expect(sealBankReceiptAttachment(client, storage, 'actor', key, row)).rejects.toMatchObject(
    { status: 409 }
  );
  expect(putObject).not.toHaveBeenCalled();
});
