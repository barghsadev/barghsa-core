import type { PoolClient } from 'pg';

export type ElectricityDraftMode = 'simple' | 'advanced';

export async function readElectricityDraftRevision(
  client: PoolClient,
  userId: string,
  profileId: string,
  mode: ElectricityDraftMode
): Promise<string | null> {
  const result = await client.query<{ revision: string }>(
    'SELECT revision FROM electricity_customer_draft_revisions WHERE user_id=$1 AND profile_id=$2 AND mode=$3',
    [userId, profileId, mode]
  );
  return result.rows[0]?.revision ?? null;
}

export async function clearElectricityDraft(
  client: PoolClient,
  userId: string,
  profileId: string,
  mode: ElectricityDraftMode
): Promise<void> {
  const removed = await client.query(
    'DELETE FROM electricity_customer_drafts WHERE user_id=$1 AND profile_id=$2 AND mode=$3',
    [userId, profileId, mode]
  );
  // The row trigger covers an existing draft. Invalidate an already-empty slot too.
  if (removed.rowCount === 0) {
    await client.query('SELECT bump_electricity_draft_revision($1,$2,$3)', [
      userId,
      profileId,
      mode,
    ]);
  }
}
