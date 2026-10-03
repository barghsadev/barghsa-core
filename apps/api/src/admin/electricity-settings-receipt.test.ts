import { expect, it, vi } from 'vitest';
import { AdminService } from './admin.service.js';
import { getDbPool } from '@barghsa/db';

vi.mock('../session/session-step-up.js', () => ({ requireSessionStepUp: vi.fn() }));
vi.mock('./staff-mutation-permission.js', () => ({ requireStaffMutationPermission: vi.fn() }));
vi.mock('@barghsa/db', () => ({ getDbPool: vi.fn() }));

it('returns the captured template selection when another writer changes it immediately after commit', async () => {
  const selected = '11111111-1111-4111-8111-111111111111';
  let stored: string | null = null;
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('INSERT INTO app_config')) {
      stored = JSON.parse(values[0] as string) as string;
      return { rows: [{ version: 1 }] };
    }
    if (sql === 'COMMIT') stored = null; // A competing writer wins after our transaction.
    if (sql.includes('SELECT value FROM app_config')) return { rows: [{ value: stored }] };
    if (sql.includes('SELECT v.placeholders')) return { rows: [{ placeholders: ['date'] }] };
    if (sql.includes('SELECT v.id,t.name'))
      return {
        rows: [
          {
            id: selected,
            name: 'Supply agreement',
            version_number: 1,
            status: 'active',
            placeholders: ['date'],
          },
        ],
      };
    return { rows: [] };
  });
  const client = { query, release: vi.fn() };
  const pool = {
    connect: async () => client,
    query: vi.fn(async () => ({ rows: [{ value: null }] })),
  };
  vi.mocked(getDbPool).mockReturnValue(pool as never);
  const receipt = await new AdminService().setElectricityContractTemplate(
    selected,
    {
      userId: 'operator',
      sessionId: 'current',
      csrfToken: 'csrf',
    },
    '127.0.0.1'
  );
  expect(receipt).toMatchObject({
    selectedVersionId: selected,
    options: [{ id: selected, active: true, supported: true }],
  });
  expect(stored).toBeNull();
  expect(pool.query).not.toHaveBeenCalled();
  expect(client.release).toHaveBeenCalledOnce();
});
