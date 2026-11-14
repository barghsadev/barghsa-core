import { createHash, randomUUID } from 'node:crypto';
import { createDirectDbPool } from '@barghsa/db';
import type * as Db from '@barghsa/db';
import type { PoolClient } from 'pg';
import type { StorageProvider } from '@barghsa/shared/storage';
import { expect, it, vi } from 'vitest';
import { writeProvisionalStorageCopy } from '../storage/reserve-storage-copy.js';
import { reserveUpload } from '../upload/upload-reservations.js';
import { SolarContractSourceService } from './solar-contract-source.service.js';
import type { SolarContractReviewInput } from './solar-contract.validation.js';

vi.mock('../storage/reserve-storage-copy.js', () => ({ writeProvisionalStorageCopy: vi.fn() }));
vi.mock('../upload/upload-reservations.js', () => ({ reserveUpload: vi.fn() }));
vi.mock('@barghsa/db', async (original) => ({
  ...(await original<typeof Db>()),
  createDirectDbPool: vi.fn(),
}));

const profileId = randomUUID();
const requestId = randomUUID();
const templateVersionId = randomUUID();
const documentId = randomUUID();
const templateInput: SolarContractReviewInput = {
  profileId,
  requestId,
  idempotencyKey: randomUUID(),
  title: 'Installation agreement',
  text: 'The signed delivery period is three weeks.',
  changeDescription: 'Initial solar contract',
  commercialValue: { kind: 'fixed', amountIrr: '900000' },
  source: { kind: 'template', templateVersionId },
  invoiceLines: [
    { description: 'Deposit', quantity: 1, unitPrice: '900000', vatRate: 0, isTaxable: false },
  ],
};
const documentInput: SolarContractReviewInput = {
  ...templateInput,
  source: { kind: 'document', documentId },
};

function fixture(content: Buffer, overrides: Record<string, unknown> = {}) {
  const record = {
    label: 'Installation terms',
    version_number: 2,
    storage_key: 'verified-source',
    file_name: 'terms.txt',
    file_size: content.length,
    content_type: 'text/plain',
    checksum: createHash('sha256').update(content).digest('hex'),
    ...overrides,
  };
  const query = vi.fn().mockResolvedValueOnce({ rows: [record] });
  const getObject = vi.fn().mockImplementation(async () => ({
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(content);
        controller.close();
      },
    }),
  }));
  const putObject = vi.fn().mockResolvedValue(undefined);
  const client = { query } as unknown as PoolClient;
  const service = new SolarContractSourceService({
    getObject,
    putObject,
  } as unknown as StorageProvider);
  return { record, query, getObject, putObject, client, service };
}

it('uses current template metadata and substitutes the exact accepted price and customer', async () => {
  const content = Buffer.from('Supply for {{customerName}}, deposit {{amount}} IRR.');
  const { service, client, record, query, getObject } = fixture(content);
  query.mockResolvedValueOnce({ rows: [{ customer_name: 'Solar Customer' }] });
  const source = await service.inspect(client, templateInput);
  expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining("s.status='immutable'"), [
    templateVersionId,
  ]);
  expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('LEFT JOIN legal_profiles'), [
    profileId,
  ]);
  const packet = await service.fetch(source);
  expect(getObject).toHaveBeenCalledExactlyOnceWith(record.storage_key);
  expect(service.describe(templateInput, source, packet, 900000n)).toMatchObject({
    bytes: content,
    rendered: {
      name: record.label,
      text: `Supply for Solar Customer, deposit 900000 IRR.\n\n${templateInput.text}`,
    },
    snapshot: {
      ...templateInput.source,
      versionNumber: 2,
      checksum: record.checksum,
      sizeBytes: content.length,
    },
  });
});

it.each([0, -1, 1.5, 50 * 1024 * 1024 + 1])(
  'rejects invalid source metadata size %s before reading storage',
  async (size) => {
    const { service, client, getObject } = fixture(Buffer.from('source'), { file_size: size });
    await expect(service.inspect(client, documentInput)).rejects.toThrow(
      'Contract source size is invalid'
    );
    expect(getObject).not.toHaveBeenCalled();
  }
);

it('requires a sealed document associated with the exact construction request and profile', async () => {
  const { service, client, query, getObject } = fixture(Buffer.from('source'));
  query.mockReset().mockResolvedValueOnce({ rows: [] });
  await expect(service.inspect(client, documentInput)).rejects.toThrow(
    'Select an available contract source'
  );
  expect(query).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining("d.scan_state='Available'"),
    [documentId, profileId, requestId]
  );
  expect(getObject).not.toHaveBeenCalled();
});

it('rejects mismatched bytes and checksums before a private source can be described', async () => {
  const changed = fixture(Buffer.from('changed'), { checksum: '0'.repeat(64) });
  const changedSource = await changed.service.inspect(changed.client, documentInput);
  await expect(changed.service.fetch(changedSource)).rejects.toMatchObject({
    status: 409,
    message: 'Contract source checksum changed',
  });
  const truncated = fixture(Buffer.from('short'), { file_size: 10 });
  const truncatedSource = await truncated.service.inspect(truncated.client, documentInput);
  await expect(truncated.service.fetch(truncatedSource)).rejects.toMatchObject({
    status: 503,
    message: 'Contract source could not be read',
  });
});

it('requires an existing customer before reading the template', async () => {
  const { service, client, query, getObject } = fixture(Buffer.from('terms'));
  query.mockResolvedValueOnce({ rows: [] });
  await expect(service.inspect(client, templateInput)).rejects.toThrow(
    'Contract customer is unavailable'
  );
  expect(getObject).not.toHaveBeenCalled();
});

it.each([
  [Buffer.from([0xff]), 'Contract template must contain UTF-8 text'],
  [Buffer.from('{{unknown}}'), 'Unsupported contract template placeholder'],
  [Buffer.from('   '), 'Contract template is empty'],
])('fails closed when a template cannot be rendered', async (content, error) => {
  const { service, client, query } = fixture(content);
  query.mockResolvedValueOnce({ rows: [{ customer_name: 'Solar Customer' }] });
  const source = await service.inspect(client, templateInput);
  await expect(
    service.fetch(source).then((packet) => service.describe(templateInput, source, packet, 900000n))
  ).rejects.toThrow(error);
});

it.each(['lock', 'upload', 'copy'] as const)(
  'stops a contract attachment when the %s reservation is lost',
  async (failure) => {
    vi.mocked(reserveUpload).mockReset().mockResolvedValue(undefined);
    vi.mocked(writeProvisionalStorageCopy).mockReset().mockResolvedValue(false);
    const content = Buffer.from('sealed original document');
    const { service, client, putObject, record } = fixture(content);
    const selected = await service.inspect(client, documentInput);
    const packet = await service.fetch(selected);
    const source = service.describe(documentInput, selected, packet, 900000n);
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ contractNumber: '101' }] })
      .mockResolvedValueOnce({ rows: [{ acquired: failure !== 'lock' }] })
      .mockResolvedValueOnce({ rowCount: failure === 'upload' ? 0 : 1 })
      .mockResolvedValueOnce({ rows: [{ released: true }] });
    const direct = { query, release: vi.fn() } as unknown as PoolClient;
    if (failure === 'lock') {
      vi.mocked(createDirectDbPool).mockReturnValue({
        query,
        connect: vi.fn().mockResolvedValue(direct),
      } as unknown as ReturnType<typeof createDirectDbPool>);
    }
    await expect(
      service.prepareAttachment(
        source,
        profileId,
        'solar-staff',
        failure === 'lock' ? undefined : direct
      )
    ).rejects.toThrow(
      failure === 'copy'
        ? 'Contract copy reservation expired'
        : 'Contract upload reservation expired'
    );
    expect(reserveUpload).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        userId: 'solar-staff',
        fileSize: content.length,
        category: 'contract',
        independent: true,
        context: expect.objectContaining({ profileId }),
      })
    );
    if (failure === 'copy') {
      expect(putObject).toHaveBeenCalledExactlyOnceWith(
        expect.stringMatching(/^uploads\/contract\//),
        content,
        'text/plain'
      );
      expect(writeProvisionalStorageCopy).toHaveBeenCalledExactlyOnceWith(
        expect.stringMatching(/^business-documents\//),
        expect.objectContaining({ selectedSourceKey: record.storage_key, sha256: record.checksum }),
        expect.any(Function),
        direct
      );
    } else {
      expect(putObject).not.toHaveBeenCalled();
      expect(writeProvisionalStorageCopy).not.toHaveBeenCalled();
    }
    if (failure === 'lock') expect(createDirectDbPool).toHaveBeenCalledTimes(2);
    else expect(query).toHaveBeenCalledTimes(4);
  }
);
