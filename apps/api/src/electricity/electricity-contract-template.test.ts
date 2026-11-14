import { expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { StorageProvider } from '@barghsa/shared/storage';
import {
  fetchElectricityContractTemplate,
  readElectricityContractTemplate,
  renderElectricityContractTemplate,
} from './electricity-contract-template.js';

async function snapshot(
  client: Pick<PoolClient, 'query'>,
  storage: StorageProvider | null,
  profileId: string,
  amount: bigint,
  now: Date
) {
  const source = await readElectricityContractTemplate(client, profileId);
  if (!source) return null;
  return renderElectricityContractTemplate(
    source,
    await fetchElectricityContractTemplate(storage, source),
    amount,
    now
  );
}

function fixture(value: unknown, source: string, placeholders: string[]) {
  const client = {
    query: async (statement: string) => {
      if (statement.includes('FROM app_config')) return { rows: [{ value }] };
      if (statement.includes('FROM contract_template_versions')) {
        return {
          rows: [
            {
              id: 'version-1',
              template_id: 'template-1',
              version_number: 2,
              name: 'Supply agreement',
              storage_key: 'template-key',
              file_size: source.length,
              placeholders,
            },
          ],
        };
      }
      return { rows: [{ customer_name: 'Customer Company' }] };
    },
  } as unknown as Pick<PoolClient, 'query'>;
  const storage = {
    getObject: async () => ({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(source));
          controller.close();
        },
      }),
    }),
  } as unknown as StorageProvider;
  return { client, storage };
}

it('renders the selected immutable version with the order customer, date and IRR amount', async () => {
  const { client, storage } = fixture(
    'version-1',
    'Dear {{ customerName }}, {{amount}} IRR on {{date}}.',
    ['customerName', 'amount', 'date']
  );
  const result = await snapshot(
    client,
    storage,
    'profile-1',
    123456n,
    new Date('2026-09-23T10:30:00Z')
  );
  expect(result).toEqual({
    templateId: 'template-1',
    versionId: 'version-1',
    versionNumber: 2,
    name: 'Supply agreement',
    text: 'Dear Customer Company, 123456 IRR on 2026-09-23.',
  });
});

it('rejects an unsupported placeholder instead of saving an incomplete contract', async () => {
  const { client, storage } = fixture('version-1', 'Dear {{unknown}}', []);
  await expect(snapshot(client, storage, 'profile-1', 1n, new Date())).rejects.toThrow(
    'Unsupported contract template placeholder'
  );
});

it('keeps existing order submission available while no template is selected', async () => {
  const { client } = fixture(null, '', []);
  await expect(snapshot(client, null, 'profile-1', 1n, new Date())).resolves.toBeNull();
});

it.each([
  [100, undefined, undefined, 'Invalid contract template configuration'],
  ['version-1', null, undefined, 'Selected contract template is unavailable'],
  [
    'version-1',
    { placeholders: ['other'] },
    undefined,
    'Selected contract template is unavailable',
  ],
  [
    'version-1',
    { placeholders: ['amount'], file_size: 10 * 1024 * 1024 + 1 },
    undefined,
    'Selected contract template is too large',
  ],
  [
    'version-1',
    { placeholders: ['amount'], file_size: 12 },
    null,
    'Contract customer is unavailable',
  ],
])(
  'rejects an ineligible template or customer before accessing storage',
  async (value, version, customer, message) => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ value }] })
      .mockResolvedValueOnce({ rows: version ? [version] : [] })
      .mockResolvedValueOnce({ rows: customer ? [customer] : [] });
    await expect(readElectricityContractTemplate({ query }, 'profile-1')).rejects.toMatchObject({
      status: 503,
      message,
    });
    expect(query).toHaveBeenNthCalledWith(1, 'LOCK TABLE app_config IN SHARE MODE');
  }
);

it('fails closed when storage is absent, a file exceeds the cap, or bytes are not valid UTF-8', async () => {
  const { client } = fixture('version-1', '{{amount}}', ['amount']);
  const source = (await readElectricityContractTemplate(client, 'profile-1'))!;
  await expect(fetchElectricityContractTemplate(null, source)).rejects.toMatchObject({
    status: 503,
  });
  for (const bytes of [new Uint8Array(10 * 1024 * 1024 + 1), new Uint8Array([0xff])]) {
    const getObject = vi.fn().mockResolvedValue({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    });
    await expect(
      fetchElectricityContractTemplate({ getObject } as unknown as StorageProvider, source)
    ).rejects.toMatchObject({
      status: 503,
      message: 'Selected contract template could not be read',
    });
    expect(getObject).toHaveBeenCalledExactlyOnceWith('template-key');
  }
});
