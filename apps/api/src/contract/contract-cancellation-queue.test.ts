import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { ContractCancellationRequestService } from './contract-cancellation-request.service.js';

const pool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@barghsa/db', async (load) => ({
  ...(await load<typeof import('@barghsa/db')>()),
  getDbPool: () => pool,
}));

it('returns a cursor for the last visible request and forwards the savings scope on the next page', async () => {
  const rows = Array.from({ length: 51 }, () => ({ id: randomUUID(), status: 'Pending' }));
  pool.query
    .mockReset()
    .mockResolvedValueOnce({ rows })
    .mockResolvedValueOnce({ rows: rows.slice(50) });
  const service = new ContractCancellationRequestService();
  const page = await service.queue(undefined, 'savings');
  expect(page).toEqual({ requests: rows.slice(0, 50), nextBefore: rows[49]!.id });
  const last = await service.queue(page.nextBefore!, 'savings');
  expect(last).toEqual({ requests: [rows[50]], nextBefore: null });
  expect(pool.query.mock.calls.map(([, binds]) => binds)).toEqual([
    [null, 'savings'],
    [rows[49]!.id, 'savings'],
  ]);
});

it('does not disclose a request for an unknown contract or rejection reference', async () => {
  pool.query.mockReset().mockResolvedValue({ rowCount: 0, rows: [] });
  const service = new ContractCancellationRequestService();
  const missing = randomUUID();
  await expect(service.staff(missing)).rejects.toMatchObject({ status: 404 });
  await expect(
    service.reject(
      missing,
      { reason: 'Reviewed fixture', idempotencyKey: randomUUID() },
      {
        userId: 'fixture-staff',
        sessionId: randomUUID(),
        csrfToken: randomUUID(),
      },
      '192.0.2.14'
    )
  ).rejects.toMatchObject({ status: 404 });
  expect(pool.query.mock.calls.map(([, binds]) => binds)).toEqual([[missing], [missing]]);
});
