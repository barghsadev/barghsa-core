import type { PoolClient } from 'pg';
import { readWizardDraftTtl } from '../common/wizard-draft-retention.js';

// Call only after locking and authorizing the owned DRAFT profile.
export async function readOnboardingDraftState(client: PoolClient, profileId: string) {
  const days = await readWizardDraftTtl(client);
  const row = (
    await client.query<{ version: number; data: Record<string, string>; expired: boolean }>(
      `SELECT version,data,
        (data <> '{}'::jsonb AND updated_at < NOW() - ($2::integer * INTERVAL '1 day')) AS expired
       FROM profile_onboarding_drafts WHERE profile_id=$1`,
      [profileId, days]
    )
  ).rows[0];
  return { version: row?.version ?? 0, data: row?.data ?? {}, expired: row?.expired ?? false };
}
