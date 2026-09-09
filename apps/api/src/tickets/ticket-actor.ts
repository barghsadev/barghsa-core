import { HttpException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { PoolClient } from 'pg';
import type { ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { resolveStaffPermissions } from '../session/staff-permissions.js';

export type TicketActor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;

/** Hold current authority until the caller's ticket transaction commits. */
export async function authorizeTicketMutation(
  client: PoolClient,
  actor: TicketActor,
  expectedUserId: string,
  staff: boolean,
  targetUserId?: string
): Promise<string | undefined> {
  if (actor.userId !== expectedUserId)
    throw new HttpException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code }, 401);
  const accounts = await client.query(
    `SELECT user_id,is_admin,disabled_at,activation_token IS NOT NULL AS activation_pending
     FROM users WHERE user_id=ANY($1::text[]) ORDER BY user_id FOR NO KEY UPDATE`,
    [[...new Set([actor.userId, ...(targetUserId ? [targetUserId] : [])])]]
  );
  const account = accounts.rows.find((row) => row.user_id === actor.userId);
  if (!account || account.disabled_at || account.activation_pending)
    throw new HttpException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code }, 401);
  if (!staff || account.is_admin) {
    await requireCurrentSession(client, actor);
    return;
  }
  const roles = await client.query(
    `SELECT r.permissions FROM user_roles ur JOIN staff_roles r ON r.role_id=ur.role_id
     WHERE ur.user_id=$1 ORDER BY r.role_id FOR SHARE OF ur,r`,
    [actor.userId]
  );
  const grants = resolveStaffPermissions(roles.rows.map((row) => row.permissions));
  const fullAccess = grants.some((permission) =>
    ['*', 'tickets:*', 'tickets:write'].includes(permission)
  );
  if (!fullAccess && !grants.includes('tickets:assigned'))
    throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
  await requireCurrentSession(client, actor);
  return fullAccess ? undefined : actor.userId;
}
