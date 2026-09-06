import { HttpException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import { resolveStaffPermissions } from '../session/staff-permissions.js';
import type { WalletQueryClient } from '../wallet/wallet.service.js';

export async function requireCurrentFinancePermission(
  client: WalletQueryClient,
  userId: string
): Promise<void> {
  const row = (
    await client.query(
      `SELECT u.is_admin, ARRAY(SELECT r.permissions FROM user_roles ur
    JOIN staff_roles r ON r.role_id=ur.role_id WHERE ur.user_id=u.user_id) AS role_permissions
    FROM users u WHERE u.user_id=$1 AND u.disabled_at IS NULL AND u.activation_token IS NULL`,
      [userId]
    )
  ).rows[0] as { is_admin: boolean; role_permissions: unknown } | undefined;
  const permissions = resolveStaffPermissions(row?.role_permissions);
  if (
    !row ||
    (!row.is_admin && !permissions.includes('*') && !permissions.includes('admin:financial:edit'))
  )
    throw new HttpException(
      {
        statusCode: 403,
        error: ErrorCodes.AUTHZ_FORBIDDEN.code,
        message: 'Current finance permission is required for both approvers',
      },
      403
    );
}
