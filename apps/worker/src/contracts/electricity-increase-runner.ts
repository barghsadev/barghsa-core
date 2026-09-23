import { getDbPool } from '@barghsa/db';
import { activateDueElectricityIncreases } from '@barghsa/db/electricity-increase-activation';
import { recordJobFailure, recordJobSuccess } from '../jobs/job-recorder.js';
import type { Pool } from 'pg';

export const ELECTRICITY_INCREASE_INTERVAL_MS = 30_000;

export async function runElectricityIncreaseActivation(pool: Pool = getDbPool()) {
  try {
    const result = await activateDueElectricityIncreases(pool);
    await recordJobSuccess('electricity_increase_activation', pool);
    return result;
  } catch {
    await recordJobFailure(
      {
        jobType: 'electricity_increase_activation',
        error: 'electricity_increase_activation_unavailable',
        errorCategory: 'transient',
      },
      pool
    );
    return null;
  }
}
