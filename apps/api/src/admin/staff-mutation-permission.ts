import { HttpException, Logger } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import { resolveStaffPermissions } from '../session/staff-permissions.js';
import { SessionService, type ValidatedSession } from '../session/session.service.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';

const logger = new Logger('StaffMutationPermission');

/** Call after locking the actor account, and again after writes before commit. */
export async function requireStaffStepUp(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> },
  actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>
): Promise<Date> {
  await client.query(
    'SELECT session_id FROM sessions WHERE session_id=$1 AND user_id=$2 FOR UPDATE',
    [actor.sessionId, actor.userId]
  );
  // Read the database clock after any lock wait, including on the final check.
  const result = await client.query(
    `SELECT csrf_token, step_up_verified_at,
       revoked_at IS NULL AND expires_at>clock_timestamp() AND idle_deadline>clock_timestamp() AS active,
       step_up_verified_at<=clock_timestamp() AND
       step_up_verified_at>clock_timestamp()-($3::double precision*INTERVAL '1 millisecond') AS fresh
     FROM sessions WHERE session_id=$1 AND user_id=$2`,
    [actor.sessionId, actor.userId, SessionService.STEP_UP_WINDOW_MS]
  );
  const session = result.rows[0];
  if (!session?.active)
    throw new HttpException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code }, 401);
  if (session.csrf_token !== actor.csrfToken) {
    logger.warn(
      `CSRF check failed: staff session token changed | correlationId=${correlationIdStorage.getStore() ?? 'none'}`
    );
    throw new HttpException({ error: ErrorCodes.AUTHZ_CSRF_INVALID.code }, 403);
  }
  if (!session.fresh)
    throw new HttpException({ error: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code }, 403);
  return session.step_up_verified_at as Date;
}

/** Hold actor/target accounts in one order, then recheck the actor's current grants. */
export async function requireStaffMutationPermission(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> },
  actorUserId: string,
  permission: string,
  targetUserId?: string | readonly string[]
): Promise<void> {
  const users = await client.query(
    `SELECT user_id,is_admin,disabled_at,activation_token IS NOT NULL AS activation_pending
      FROM users WHERE user_id=ANY($1::text[]) ORDER BY user_id FOR UPDATE`,
    [
      [
        ...new Set([
          actorUserId,
          ...(typeof targetUserId === 'string' ? [targetUserId] : (targetUserId ?? [])),
        ]),
      ],
    ]
  );
  const actor = users.rows.find((row) => row.user_id === actorUserId);
  if (actor && !actor.disabled_at && !actor.activation_pending) {
    if (actor.is_admin) return;
    const roles = await client.query(
      `SELECT r.permissions FROM user_roles ur JOIN staff_roles r ON r.role_id=ur.role_id
       WHERE ur.user_id=$1 ORDER BY r.role_id FOR SHARE OF ur,r`,
      [actorUserId]
    );
    const grants = resolveStaffPermissions(roles.rows.map((row) => row.permissions));
    if (grants.includes('*') || grants.includes(permission)) return;
  }
  throw new HttpException({ statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
}
