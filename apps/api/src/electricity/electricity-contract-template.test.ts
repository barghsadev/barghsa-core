import { expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import type { StorageProvider } from '@barghsa/shared/storage';
import { electricityContractTemplateSnapshot } from './electricity-contract-template.js';

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
  const snapshot = await electricityContractTemplateSnapshot(
    client,
    storage,
    'profile-1',
    123456n,
    new Date('2026-09-23T10:30:00Z')
  );
  expect(snapshot).toEqual({
    templateId: 'template-1',
    versionId: 'version-1',
    versionNumber: 2,
    name: 'Supply agreement',
    text: 'Dear Customer Company, 123456 IRR on 2026-09-23.',
  });
});

it('rejects an unsupported placeholder instead of saving an incomplete contract', async () => {
  const { client, storage } = fixture('version-1', 'Dear {{unknown}}', []);
  await expect(
    electricityContractTemplateSnapshot(client, storage, 'profile-1', 1n, new Date())
  ).rejects.toThrow('Unsupported contract template placeholder');
});

it('keeps existing order submission available while no template is selected', async () => {
  const { client } = fixture(null, '', []);
  await expect(
    electricityContractTemplateSnapshot(client, null, 'profile-1', 1n, new Date())
  ).resolves.toBeNull();
});
