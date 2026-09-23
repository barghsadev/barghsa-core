import { beforeEach, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { runElectricityIncreaseActivation } from './electricity-increase-runner.js';

const mocks = vi.hoisted(() => ({
  activate: vi.fn(),
  expire: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
  pool: {},
}));
vi.mock('@barghsa/db', () => ({ getDbPool: () => mocks.pool }));
vi.mock('@barghsa/db/electricity-increase-activation', () => ({
  activateDueElectricityIncreases: mocks.activate,
  expireDueElectricityIncreases: mocks.expire,
}));
vi.mock('../jobs/job-recorder.js', () => ({
  recordJobSuccess: mocks.success,
  recordJobFailure: mocks.failure,
}));
beforeEach(() => vi.clearAllMocks());

it('records successful activation polls', async () => {
  mocks.activate.mockResolvedValue({ activated: 2, skipped: 1 });
  mocks.expire.mockResolvedValue({ expired: 3, cancelled: 2, financeReview: 1, skipped: 0 });
  expect(await runElectricityIncreaseActivation()).toEqual({
    activated: 2,
    activationSkipped: 1,
    expired: 3,
    cancelled: 2,
    financeReview: 1,
    skipped: 0,
  });
  expect(mocks.success).toHaveBeenCalledWith('electricity_increase_activation', mocks.pool);
});

it('records a retryable failure without exposing the database error', async () => {
  const pool = {} as Pool;
  mocks.activate.mockRejectedValue(new Error('postgres://secret'));
  expect(await runElectricityIncreaseActivation(pool)).toBeNull();
  expect(mocks.failure).toHaveBeenCalledWith(
    {
      jobType: 'electricity_increase_activation',
      error: 'electricity_increase_activation_unavailable',
      errorCategory: 'transient',
    },
    pool
  );
});
