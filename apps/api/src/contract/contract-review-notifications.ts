import type { PoolClient } from 'pg';
import { resolveStaffPermissions } from '../session/staff-permissions.js';
import { NotificationsService } from '../notifications/notifications.service.js';
const messages = {
  electricity_increase_requested: {
    fa: 'درخواست افزایش مقدار برق برای بررسی کارکنان ثبت شد.',
    en: 'An electricity quantity increase request is awaiting staff review.',
  },
  electricity_increase_rejected: {
    fa: 'درخواست افزایش مقدار برق رد شد. دلیل را در جزئیات سفارش بررسی کنید.',
    en: 'Your electricity quantity increase request was declined. See the order for the reason.',
  },
  electricity_increase_approved: {
    fa: 'درخواست افزایش مقدار برق تأیید شد. الحاقیه را در جزئیات سفارش بررسی کنید.',
    en: 'Your electricity quantity increase was approved. Review the amendment in your order details.',
  },
  electricity_increase_signed: {
    fa: 'الحاقیه افزایش برق امضا شد. فاکتور تعدیل را برای اعمال افزایش پرداخت کنید.',
    en: 'Your electricity increase amendment was signed. Pay the adjustment invoice to activate it.',
  },
  cancellation_requested: {
    fa: 'درخواست لغو قرارداد برای بررسی کارکنان ثبت شد.',
    en: 'A contract cancellation request is awaiting staff review.',
  },
  cancellation_request_rejected: {
    fa: 'درخواست لغو قرارداد رد شد. برای پیگیری با پشتیبانی تماس بگیرید.',
    en: 'Your cancellation request was declined. Contact support for help.',
  },
  cancellation_request_fulfilled: {
    fa: 'درخواست لغو پذیرفته و قرارداد لغو شد. وضعیت بازپرداخت را در قرارداد بررسی کنید.',
    en: 'Your request was accepted and the contract was cancelled. Check the contract for refund progress.',
  },
  signature_requested: {
    fa: 'نسخه پذیرفته‌شده قرارداد برای ثبت نسخه امضاشده آماده است.',
    en: 'The accepted contract version is ready for its signed copy.',
  },
  signed_copy_recorded: {
    fa: 'نسخه امضاشده تأییدشده برای قرارداد ثبت شد.',
    en: 'An approved signed copy has been recorded for the contract.',
  },
  submitted: { fa: 'قرارداد برای بررسی آماده است.', en: 'A contract is ready for staff review.' },
  resubmitted: {
    fa: 'نسخه جدید قرارداد برای بررسی ارسال شد.',
    en: 'A revised contract has been submitted for review.',
  },
  changes_requested: {
    fa: 'برای قرارداد درخواست اصلاح ثبت شد.',
    en: 'Changes have been requested for the contract.',
  },
  published: {
    fa: 'قرارداد برای بررسی و پذیرش شما آماده است.',
    en: 'Your contract is ready for review and acceptance.',
  },
  accepted: {
    fa: 'نسخه منتشرشده قرارداد توسط مشتری پذیرفته شد.',
    en: 'The customer accepted the published contract version.',
  },
};
export async function notifyContractReview(
  client: PoolClient,
  id: string,
  event: keyof typeof messages,
  reason?: string
) {
  const profile = (
    await client.query<{ profile_id: string; user_id: string }>(
      'SELECT c.profile_id,p.user_id FROM contracts c JOIN profiles p ON p.id=c.profile_id WHERE c.id=$1',
      [id]
    )
  ).rows[0]!;
  const recipients = new Set<string>();
  if (event !== 'submitted') recipients.add(profile.user_id);
  if (
    [
      'submitted',
      'resubmitted',
      'accepted',
      'signature_requested',
      'signed_copy_recorded',
      'cancellation_requested',
      'electricity_increase_requested',
    ].includes(event)
  ) {
    const staff = await client.query<{ user_id: string; is_admin: boolean; permissions: unknown }>(
      'SELECT u.user_id,u.is_admin,array_agg(r.permissions) FILTER (WHERE r.role_id IS NOT NULL) AS permissions FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.user_id LEFT JOIN staff_roles r ON r.role_id=ur.role_id WHERE (u.is_staff OR u.is_admin) AND u.disabled_at IS NULL AND u.activation_token IS NULL GROUP BY u.user_id,u.is_admin'
    );
    for (const row of staff.rows) {
      const grants = resolveStaffPermissions(row.permissions);
      if (row.is_admin || grants.includes('*') || grants.includes('contracts:write'))
        recipients.add(row.user_id);
    }
  }
  const message = messages[event];
  for (const userId of recipients)
    await new NotificationsService().create(
      {
        userId,
        ...(userId === profile.user_id ? { profileId: profile.profile_id } : {}),
        type: 'general',
        title: message.en,
        localizedContent: {
          fa: {
            title: 'قرارداد',
            body: message.fa + ' شناسه قرارداد: ' + id + (reason ? ' ' + reason : ''),
          },
          en: {
            title: 'Contract',
            body: message.en + ' Contract reference: ' + id + (reason ? ' ' + reason : ''),
          },
        },
      },
      client
    );
}
