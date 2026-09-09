import { HttpException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import { NotificationsService } from '../notifications/notifications.service.js';
import { resolveStaffPermissions } from '../session/staff-permissions.js';
import type { DualApprovalQueryClient } from './dual-approval-resolution.js';

/** Caller owns the request transaction. A failed notice must fail that transaction. */
async function notifyFinancialStaff(
  client: DualApprovalQueryClient,
  input: { requestId: string; amountIrR: string; initiatorUserId: string; reason?: string },
  notifications: Pick<NotificationsService, 'create'> = new NotificationsService()
): Promise<void> {
  const result = await client.query(
    `SELECT u.user_id, u.is_admin,
            ARRAY(SELECT r.permissions FROM user_roles ur
                  JOIN staff_roles r ON r.role_id=ur.role_id
                  WHERE ur.user_id=u.user_id) AS role_permissions
     FROM users u WHERE u.disabled_at IS NULL AND u.activation_token IS NULL AND ($2::boolean OR u.user_id <> $1)
       AND (u.is_admin=TRUE OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id=u.user_id))`,
    [input.initiatorUserId, input.reason !== undefined]
  );
  const amount = BigInt(input.amountIrR);
  const localizedContent =
    input.reason !== undefined
      ? {
          fa: {
            title: 'تأیید اضطراری رسید بانکی',
            body: `درخواست ${input.requestId} به مبلغ ${new Intl.NumberFormat('fa').format(amount)} ریال توسط ${input.initiatorUserId} بدون تأیید دوم انجام شد. دلیل: ${input.reason}`,
          },
          en: {
            title: 'Emergency bank receipt confirmation',
            body: `Request ${input.requestId} for ${new Intl.NumberFormat('en').format(amount)} IRR was confirmed by ${input.initiatorUserId} without a second approval. Reason: ${input.reason}`,
          },
        }
      : {
          fa: {
            title: 'درخواست تأیید دومرحله‌ای جدید',
            body: `درخواست ${input.requestId} به مبلغ ${new Intl.NumberFormat('fa').format(amount)} ریال برای بررسی در صف تأییدهای مالی قرار گرفت.`,
          },
          en: {
            title: 'Financial approval requested',
            body: `Request ${input.requestId} for ${new Intl.NumberFormat('en').format(amount)} IRR requires a second financial reviewer.`,
          },
        };
  for (const row of result.rows as {
    user_id: string;
    is_admin: boolean;
    role_permissions: unknown;
  }[]) {
    const permissions = resolveStaffPermissions(row.role_permissions);
    if (
      !row.is_admin &&
      !permissions.includes('*') &&
      !permissions.includes('admin:financial:edit') &&
      !(input.reason !== undefined && row.user_id === input.initiatorUserId)
    )
      continue;
    if (input.reason !== undefined) {
      // Avoid a notification FK deadlock with a reviewer waiting on this receipt.
      try {
        await client.query('SELECT user_id FROM users WHERE user_id=$1 FOR KEY SHARE NOWAIT', [
          row.user_id,
        ]);
      } catch (error) {
        if ((error as { code?: string }).code === '55P03')
          throw new HttpException(
            {
              statusCode: 409,
              error: ErrorCodes.CONFLICT_STATE.code,
              message: 'A finance reviewer is busy. Retry the emergency confirmation.',
            },
            409
          );
        throw error;
      }
    }
    await notifications.create(
      {
        userId: row.user_id,
        type: 'general',
        ...localizedContent.fa,
        localizedContent,
        link: '/admin/approval-requests',
      },
      client
    );
  }
}

export async function notifyApprovalRequested(
  client: DualApprovalQueryClient,
  input: { requestId: string; amountIrR: string; initiatorUserId: string },
  notifications?: Pick<NotificationsService, 'create'>
): Promise<void> {
  await notifyFinancialStaff(client, input, notifications);
}

/** Immediate in-app alert, committed with the receipt and audit; no daytime queue. */
export async function notifyEmergencyReceiptOverride(
  client: DualApprovalQueryClient,
  input: { requestId: string; amountIrR: string; initiatorUserId: string; reason: string }
): Promise<void> {
  await notifyFinancialStaff(client, input);
}

/** Both queue decisions and direct receipt decisions notify inside their transaction. */
export async function notifyApprovalResolved(
  client: DualApprovalQueryClient,
  input: {
    requestId: string;
    initiatorId: string;
    decision: 'approve' | 'reject';
    reviewReason: string | null;
  },
  notifications: Pick<NotificationsService, 'create'> = new NotificationsService()
): Promise<void> {
  const approved = input.decision === 'approve';
  const localizedContent = {
    fa: {
      title: approved ? 'درخواست تأیید شد' : 'درخواست تأیید رد شد',
      body: approved
        ? `درخواست ${input.requestId} تأیید شد. وضعیت پرداخت را در رسید یا عملیات مربوط بررسی کنید.`
        : `درخواست ${input.requestId} رد شد. دلیل: ${input.reviewReason ?? ''}`,
    },
    en: {
      title: approved ? 'Request approved' : 'Request rejected',
      body: approved
        ? `Request ${input.requestId} was approved. Check the related receipt or action for payment status.`
        : `Request ${input.requestId} was rejected. Reason: ${input.reviewReason ?? ''}`,
    },
  };
  await notifications.create(
    {
      userId: input.initiatorId,
      type: 'general',
      ...localizedContent.fa,
      localizedContent,
      link: '/admin/approval-requests',
    },
    client
  );
}
