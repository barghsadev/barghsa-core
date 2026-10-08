import { beforeEach, expect, it, vi } from 'vitest';
import { JobService } from './jobs.service.js';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@barghsa/db', () => ({ getDbPool: () => ({ query }) }));

beforeEach(() => query.mockReset().mockResolvedValue({ rows: [] }));

it('immediately enqueues a UUIDv7 job with its captured owner, context and bounded payload', async () => {
  const id = await new JobService().submit('test-export', { profileId: 'owned' }, 'owner', 'staff');
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(query).toHaveBeenCalledOnce();
  expect(query.mock.calls[0]![1]).toEqual([
    id,
    'test-export',
    '{"profileId":"owned"}',
    'owner',
    'staff',
  ]);
});

it.each([
  ['Untrusted-Type', {}],
  ['test-export', undefined],
  ['test-export', 'x'.repeat(64 * 1024)],
] as const)('rejects invalid type or payload before enqueueing: %s', async (type, payload) => {
  await expect(new JobService().submit(type, payload, 'owner')).rejects.toThrow();
  expect(query).not.toHaveBeenCalled();
});
