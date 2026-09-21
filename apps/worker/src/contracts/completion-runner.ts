import { getDbPool } from '@barghsa/db';
import { completeDueContracts } from '@barghsa/db/contract-completion';
import { recordJobFailure, recordJobSuccess } from '../jobs/job-recorder.js';
import type { Pool } from 'pg';
export const CONTRACT_COMPLETION_INTERVAL_MS = 30_000;
export async function runContractCompletion(pool: Pool = getDbPool()) {
  try {
    const result = await completeDueContracts(pool);
    await recordJobSuccess('contract_completion', pool);
    return result;
  } catch {
    await recordJobFailure(
      {
        jobType: 'contract_completion',
        error: 'contract_completion_unavailable',
        errorCategory: 'transient',
      },
      pool
    );
    return null;
  }
}
