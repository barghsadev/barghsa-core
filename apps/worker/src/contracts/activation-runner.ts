import { getDbPool } from '@barghsa/db';
import { activateReadyContracts } from '@barghsa/db/contract-activation';
import { recordJobFailure, recordJobSuccess } from '../jobs/job-recorder.js';
import type { Pool } from 'pg';
export const CONTRACT_ACTIVATION_INTERVAL_MS = 30_000;
export async function runContractActivation(pool: Pool = getDbPool()) {
  try {
    const result = await activateReadyContracts(pool);
    await recordJobSuccess('contract_activation', pool);
    return result;
  } catch {
    await recordJobFailure(
      {
        jobType: 'contract_activation',
        error: 'contract_activation_unavailable',
        errorCategory: 'transient',
      },
      pool
    );
    return null;
  }
}
