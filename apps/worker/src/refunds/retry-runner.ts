import { getDbPool } from '@barghsa/db';
import { retryDueWalletRefunds } from '@barghsa/db/refund-processing';
import { recordJobFailure, recordJobSuccess } from '../jobs/job-recorder.js';
import type { Pool } from 'pg';

export const REFUND_RETRY_INTERVAL_MS = 15_000;
export async function runRefundRetries(pool: Pool = getDbPool()) {
  try {
    const results = await retryDueWalletRefunds(pool);
    await recordJobSuccess('refund_retry', pool);
    return results;
  } catch {
    await recordJobFailure(
      { jobType: 'refund_retry', error: 'refund_retry_unavailable', errorCategory: 'transient' },
      pool
    );
    return ['unavailable'] as const;
  }
}
