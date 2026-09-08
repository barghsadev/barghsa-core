import { randomUUID } from 'node:crypto';
import { getDbPool } from '@barghsa/db';
import type { Pool } from 'pg';

export const INVITATION_EXPIRY_JOB_TYPE = 'invitation_expiry_scan' as const;
export const INVITATION_EXPIRY_INTERVAL_MS = 60_000;

/** Expire a bounded batch and its audit records in the same transaction. */
export async function expireInvitations(
  pool: Pool = getDbPool(),
  actorId = process.env['WORKER_SYSTEM_ACTOR_USER_ID'],
  limit = 200
): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw new Error('Invitation expiry batch size must be between 1 and 200');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const due = await client.query(
      "SELECT id FROM profile_invitations WHERE status='Pending' AND expires_at<=clock_timestamp() LIMIT 1"
    );
    if (!due.rows.length) {
      await client.query('COMMIT');
      return 0;
    }
    // Account before invitation, matching decision writers and the audit FK.
    // A missing configured actor is an error, never attributed to another user.
    const actor = await client.query<{ user_id: string }>(
      actorId?.trim()
        ? 'SELECT user_id FROM users WHERE user_id=$1 AND disabled_at IS NULL FOR KEY SHARE'
        : 'SELECT user_id FROM users WHERE is_admin AND disabled_at IS NULL ORDER BY created_at,user_id LIMIT 1 FOR KEY SHARE',
      actorId?.trim() ? [actorId.trim()] : []
    );
    if (!actor.rows[0]) throw new Error('Invitation expiry requires an active worker audit actor');
    const result = await client.query(
      `WITH candidates AS (
        SELECT id FROM profile_invitations
        WHERE status='Pending' AND expires_at<=clock_timestamp()
        ORDER BY expires_at,id LIMIT $1 FOR UPDATE SKIP LOCKED
      ), expired AS (
        UPDATE profile_invitations pi SET status='Expired',updated_at=clock_timestamp()
        FROM candidates c WHERE pi.id=c.id AND pi.status='Pending'
        RETURNING pi.id,pi.profile_id,pi.expires_at
      )
      INSERT INTO audit_log(id,user_id,event,metadata,correlation_id)
      SELECT uuid_generate_v7()::text,$2,'invitation_expired',
        jsonb_build_object('invitationId',id,'profileId',profile_id,'expiresAt',expires_at,
          'source','worker','reason','seven_day_expiry')::text,$3
      FROM expired RETURNING id`,
      [limit, actor.rows[0].user_id, randomUUID()]
    );
    await client.query('COMMIT');
    return result.rowCount ?? 0;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
