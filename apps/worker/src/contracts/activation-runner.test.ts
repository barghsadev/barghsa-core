import { beforeEach, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { runContractActivation } from './activation-runner.js';
const mocks = vi.hoisted(() => ({
  activate: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
  pool: {},
}));
vi.mock('@barghsa/db', () => ({ getDbPool: () => mocks.pool }));
vi.mock('@barghsa/db/contract-activation', () => ({ activateReadyContracts: mocks.activate }));
vi.mock('../jobs/job-recorder.js', () => ({
  recordJobSuccess: mocks.success,
  recordJobFailure: mocks.failure,
}));
beforeEach(() => vi.clearAllMocks());
it('tracks healthy polls including contention without claiming skipped contracts activated', async () => {
  mocks.activate.mockResolvedValue({ activated: 2, skipped: 1 });
  expect(await runContractActivation()).toEqual({ activated: 2, skipped: 1 });
  expect(mocks.activate).toHaveBeenCalledWith(mocks.pool);
  expect(mocks.success).toHaveBeenCalledWith('contract_activation', mocks.pool);
  expect(mocks.failure).not.toHaveBeenCalled();
});
it('records sanitized infrastructure failures for retry', async () => {
  const pool = {} as Pool;
  mocks.activate.mockRejectedValue(new Error('postgres://secret'));
  expect(await runContractActivation(pool)).toBeNull();
  expect(mocks.failure).toHaveBeenCalledWith(
    {
      jobType: 'contract_activation',
      error: 'contract_activation_unavailable',
      errorCategory: 'transient',
    },
    pool
  );
  expect(mocks.success).not.toHaveBeenCalled();
});
