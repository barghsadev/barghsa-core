import type { PoolClient } from 'pg';
import { resolveStaffPermissions } from '../session/staff-permissions.js';
import { NotificationsService } from '../notifications/notifications.service.js';
const messages = {
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
  if (['submitted', 'resubmitted', 'accepted'].includes(event)) {
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
