import { beforeEach, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { runRefundRetries } from './retry-runner.js';
const mocks = vi.hoisted(() => ({ due: vi.fn(), success: vi.fn(), failure: vi.fn(), pool: {} }));
vi.mock('@barghsa/db', () => ({ getDbPool: () => mocks.pool }));
vi.mock('@barghsa/db/refund-processing', () => ({ retryDueWalletRefunds: mocks.due }));
vi.mock('../jobs/job-recorder.js', () => ({
  recordJobSuccess: mocks.success,
  recordJobFailure: mocks.failure,
}));
beforeEach(() => {
  vi.clearAllMocks();
});
it('uses the worker pool and clears only infrastructure failure after a healthy poll', async () => {
  mocks.due.mockResolvedValue(['failed', 'exhausted', 'completed']);
  expect(await runRefundRetries()).toEqual(['failed', 'exhausted', 'completed']);
  expect(mocks.due).toHaveBeenCalledWith(mocks.pool);
  expect(mocks.success).toHaveBeenCalledWith('refund_retry', mocks.pool);
  expect(mocks.failure).not.toHaveBeenCalled();
});
it('records a sanitized infrastructure failure without exposing the underlying error', async () => {
  const pool = {} as Pool;
  mocks.due.mockRejectedValue(new Error('postgres://private:secret@host'));
  expect(await runRefundRetries(pool)).toEqual(['unavailable']);
  expect(mocks.failure).toHaveBeenCalledWith(
    { jobType: 'refund_retry', error: 'refund_retry_unavailable', errorCategory: 'transient' },
    pool
  );
  expect(mocks.success).not.toHaveBeenCalled();
});
