import { HttpException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';

// Preserve the existing setting, version history and audit chain.
export const WIZARD_DRAFT_TTL_KEY = 'electricity.order_draft_ttl_days';

export async function readWizardDraftTtl(db: Pool | PoolClient): Promise<number> {
  const row = (
    await db.query<{ value: unknown }>('SELECT value FROM app_config WHERE key=$1', [
      WIZARD_DRAFT_TTL_KEY,
    ])
  ).rows[0];
  if (!row) return 7;
  const days = row.value;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 365)
    throw new HttpException({ error: 'CONFIG:STORED_VALUE_INVALID' }, 503);
  return days;
}
