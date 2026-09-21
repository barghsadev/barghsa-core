import { beforeEach, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { runContractCompletion } from './completion-runner.js';
const mocks = vi.hoisted(() => ({
  activate: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
  pool: {},
}));
vi.mock('@barghsa/db', () => ({ getDbPool: () => mocks.pool }));
vi.mock('@barghsa/db/contract-completion', () => ({ completeDueContracts: mocks.activate }));
vi.mock('../jobs/job-recorder.js', () => ({
  recordJobSuccess: mocks.success,
  recordJobFailure: mocks.failure,
}));
beforeEach(() => vi.clearAllMocks());
it('tracks healthy polls including contention without claiming skipped contracts completed', async () => {
  mocks.activate.mockResolvedValue({ completed: 2, skipped: 1 });
  expect(await runContractCompletion()).toEqual({ completed: 2, skipped: 1 });
  expect(mocks.activate).toHaveBeenCalledWith(mocks.pool);
  expect(mocks.success).toHaveBeenCalledWith('contract_completion', mocks.pool);
  expect(mocks.failure).not.toHaveBeenCalled();
});
it('records sanitized infrastructure failures for retry', async () => {
  const pool = {} as Pool;
  mocks.activate.mockRejectedValue(new Error('postgres://secret'));
  expect(await runContractCompletion(pool)).toBeNull();
  expect(mocks.failure).toHaveBeenCalledWith(
    {
      jobType: 'contract_completion',
      error: 'contract_completion_unavailable',
      errorCategory: 'transient',
    },
    pool
  );
  expect(mocks.success).not.toHaveBeenCalled();
});
