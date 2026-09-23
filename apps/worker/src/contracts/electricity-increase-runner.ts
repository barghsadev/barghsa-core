import { getDbPool } from '@barghsa/db';
import {
  activateDueElectricityIncreases,
  expireDueElectricityIncreases,
} from '@barghsa/db/electricity-increase-activation';
import { recordJobFailure, recordJobSuccess } from '../jobs/job-recorder.js';
import type { Pool } from 'pg';

export const ELECTRICITY_INCREASE_INTERVAL_MS = 30_000;

export async function runElectricityIncreaseActivation(pool: Pool = getDbPool()) {
  try {
    const activated = await activateDueElectricityIncreases(pool);
    const expired = await expireDueElectricityIncreases(pool);
    await recordJobSuccess('electricity_increase_activation', pool);
    return { activated: activated.activated, activationSkipped: activated.skipped, ...expired };
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
