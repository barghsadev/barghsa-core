import { HttpException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import { resolveStaffPermissions } from '../session/staff-permissions.js';

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
