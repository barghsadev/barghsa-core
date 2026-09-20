import { HttpException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { PoolClient } from 'pg';
import type { ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { resolveStaffPermissions } from '../session/staff-permissions.js';

export type TicketActor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
export type TicketAccess = {
  scope?: string | undefined;
  canWrite: boolean;
  canAssignOthers: boolean;
};

/** Hold current authority until the caller's ticket transaction commits. */
export async function authorizeTicketMutation(
  client: PoolClient,
  actor: TicketActor,
  expectedUserId: string,
  staff: boolean,
  targetUserId?: string
): Promise<string | undefined> {
  return (
    await authorizeTicketAccess(
      client,
      actor,
      expectedUserId,
      staff ? 'write' : false,
      targetUserId
    )
  ).scope;
}

export async function authorizeTicketAccess(
  client: PoolClient,
  actor: TicketActor,
  expectedUserId: string,
  staff: false | 'read' | 'write',
  targetUserId?: string
): Promise<TicketAccess> {
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
    return { canWrite: true, canAssignOthers: !!staff };
  }
  const roles = await client.query(
    `SELECT r.permissions FROM user_roles ur JOIN staff_roles r ON r.role_id=ur.role_id
     WHERE ur.user_id=$1 ORDER BY r.role_id FOR SHARE OF ur,r`,
    [actor.userId]
  );
  const grants = resolveStaffPermissions(roles.rows.map((row) => row.permissions));
  const canAssignOthers = grants.some((permission) =>
    ['*', 'tickets:*', 'tickets:write'].includes(permission)
  );
  const fullAccess =
    staff === 'write'
      ? canAssignOthers
      : grants.some((permission) => ['*', 'tickets:*', 'tickets:read'].includes(permission));
  const assigned = grants.includes('tickets:assigned');
  if (!fullAccess && !assigned)
    throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
  await requireCurrentSession(client, actor);
  return {
    scope: fullAccess ? undefined : actor.userId,
    canWrite: canAssignOthers || assigned,
    canAssignOthers,
  };
}
