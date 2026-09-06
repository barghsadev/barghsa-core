import { NotificationsService } from '../notifications/notifications.service.js'
import { resolveStaffPermissions } from '../session/staff-permissions.js'
import type { DualApprovalQueryClient } from './dual-approval-resolution.js'

/** Caller owns the request transaction. A failed notice must fail that transaction. */
export async function notifyApprovalRequested(
  client: DualApprovalQueryClient,
  input: { requestId: string; amountIrR: string; initiatorUserId: string },
  notifications: Pick<NotificationsService, 'create'> = new NotificationsService(),
): Promise<void> {
  const result = await client.query(
    `SELECT u.user_id, u.is_admin,
            ARRAY(SELECT r.permissions FROM user_roles ur
                  JOIN staff_roles r ON r.role_id=ur.role_id
                  WHERE ur.user_id=u.user_id) AS role_permissions
     FROM users u WHERE u.disabled_at IS NULL AND u.activation_token IS NULL AND u.user_id <> $1
       AND (u.is_admin=TRUE OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id=u.user_id))`,
    [input.initiatorUserId],
  )
  const amount=BigInt(input.amountIrR)
  const localizedContent = {
    fa: { title: 'درخواست تأیید دومرحله‌ای جدید', body: `درخواست ${input.requestId} به مبلغ ${new Intl.NumberFormat('fa').format(amount)} ریال برای بررسی در صف تأییدهای مالی قرار گرفت.` },
    en: { title: 'Financial approval requested', body: `Request ${input.requestId} for ${new Intl.NumberFormat('en').format(amount)} IRR requires a second financial reviewer.` },
  }
  for (const row of result.rows as { user_id: string; is_admin: boolean; role_permissions: unknown }[]) {
    const permissions = resolveStaffPermissions(row.role_permissions)
    if (!row.is_admin && !permissions.includes('*') && !permissions.includes('admin:financial:edit')) continue
    await notifications.create({ userId: row.user_id, type: 'general',
      ...localizedContent.fa, localizedContent, link: '/admin/approval-requests' }, client)
  }
}

/** Both queue decisions and direct receipt decisions notify inside their transaction. */
export async function notifyApprovalResolved(
  client: DualApprovalQueryClient,
  input: { requestId: string; initiatorId: string; decision: 'approve'|'reject'; reviewReason: string|null },
  notifications: Pick<NotificationsService, 'create'> = new NotificationsService(),
): Promise<void> {
  const approved=input.decision==='approve'
  const localizedContent = {
    fa: { title: approved ? 'درخواست تأیید شد' : 'درخواست تأیید رد شد',
      body: approved ? `درخواست ${input.requestId} تأیید شد. وضعیت پرداخت را در رسید یا عملیات مربوط بررسی کنید.` : `درخواست ${input.requestId} رد شد. دلیل: ${input.reviewReason ?? ''}` },
    en: { title: approved ? 'Request approved' : 'Request rejected',
      body: approved ? `Request ${input.requestId} was approved. Check the related receipt or action for payment status.` : `Request ${input.requestId} was rejected. Reason: ${input.reviewReason ?? ''}` },
  }
  await notifications.create({ userId: input.initiatorId, type: 'general',
    ...localizedContent.fa, localizedContent, link: '/admin/approval-requests' }, client)
}
