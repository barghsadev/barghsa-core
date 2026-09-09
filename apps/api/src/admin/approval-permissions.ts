import { HttpException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import { resolveStaffPermissions } from '../session/staff-permissions.js';
import type { WalletQueryClient } from '../wallet/wallet.service.js';

export async function requireCurrentFinancePermission(
  client: WalletQueryClient,
  userId: string
): Promise<void> {
  try {
    // The caller already owns its actor lock. Do not wait on the other approver:
    // simultaneous decisions by opposite actors could otherwise deadlock.
    const row = (
      await client.query(
        `SELECT u.is_admin FROM users u
         WHERE u.user_id=$1 AND u.disabled_at IS NULL AND u.activation_token IS NULL
         FOR SHARE OF u NOWAIT`,
        [userId]
      )
    ).rows[0] as { is_admin: boolean } | undefined;
    if (row?.is_admin) return;
    if (row) {
      const roles = await client.query(
        `SELECT r.permissions FROM user_roles ur
         JOIN staff_roles r ON r.role_id=ur.role_id WHERE ur.user_id=$1
         ORDER BY r.role_id FOR SHARE OF ur,r NOWAIT`,
        [userId]
      );
      const permissions = resolveStaffPermissions(
        (roles.rows as { permissions: unknown }[]).map((role) => role.permissions)
      );
      if (permissions.includes('*') || permissions.includes('admin:financial:edit')) return;
    }
  } catch (error) {
    if ((error as { code?: string }).code === '55P03') {
      throw new HttpException(
        {
          statusCode: 409,
          error: ErrorCodes.CONFLICT_STATE.code,
          message: 'Another action is changing an approver. Retry the receipt decision.',
        },
        409
      );
    }
    throw error;
  }
  throw new HttpException(
    {
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
      message: 'Current finance permission is required for both approvers',
    },
    403
  );
}
