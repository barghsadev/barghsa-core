import { HttpException, Logger } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import { SessionService, type ValidatedSession } from './session.service.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';

const logger = new Logger('SessionStepUp');

/**
 * Call after locking the actor account, and again after writes before commit.
 * An expected revocation time is allowed only on the final check of a mutation
 * that intentionally revoked its own already-authorized, locked session.
 */
export async function requireSessionStepUp(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> },
  actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>,
  expectedRevokedAt?: Date
): Promise<Date> {
  await client.query(
    'SELECT session_id FROM sessions WHERE session_id=$1 AND user_id=$2 FOR UPDATE',
    [actor.sessionId, actor.userId]
  );
  // Read the database clock after any lock wait, including on the final check.
  const result = await client.query(
    `SELECT csrf_token, step_up_verified_at,
       (CASE WHEN $4::timestamptz IS NULL THEN revoked_at IS NULL
             ELSE revoked_at=$4::timestamptz END)
       AND expires_at>clock_timestamp() AND idle_deadline>clock_timestamp() AS active,
       step_up_verified_at<=clock_timestamp() AND
       step_up_verified_at>clock_timestamp()-($3::double precision*INTERVAL '1 millisecond') AS fresh
     FROM sessions WHERE session_id=$1 AND user_id=$2`,
    [actor.sessionId, actor.userId, SessionService.STEP_UP_WINDOW_MS, expectedRevokedAt ?? null]
  );
  const session = result.rows[0];
  if (!session?.active)
    throw new HttpException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code }, 401);
  if (session.csrf_token !== actor.csrfToken) {
    logger.warn(
      `CSRF check failed: session token changed | correlationId=${correlationIdStorage.getStore() ?? 'none'}`
    );
    throw new HttpException({ error: ErrorCodes.AUTHZ_CSRF_INVALID.code }, 403);
  }
  if (!session.fresh)
    throw new HttpException({ error: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code }, 403);
  return session.step_up_verified_at as Date;
}
