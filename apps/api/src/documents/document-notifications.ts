import type { Document } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { resolveStaffPermissions } from '../session/staff-permissions.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { staffDocumentPermission } from './document-access.js';
import type { BusinessType } from './document-validation.js';

const messages = {
  submit: { fa: 'مدرک برای بررسی آماده است.', en: 'A document is ready for review.' },
  approve: { fa: 'مدرک شما تأیید شد.', en: 'Your document was approved.' },
  reject: {
    fa: 'مدرک شما رد شد. می‌توانید مدرک جایگزین بارگذاری کنید.',
    en: 'Your document was rejected. You can upload a replacement.',
  },
  'request-changes': {
    fa: 'مدرک برای اصلاح بازگردانده شد.',
    en: 'Your document was returned for changes.',
  },
  quarantine: {
    fa: 'این فایل پذیرفته نشد و قابل دریافت نیست.',
    en: 'This file was not accepted and cannot be downloaded.',
  },
};
export async function notifyDocumentReview(
  client: PoolClient,
  document: Document,
  event: keyof typeof messages,
  reason?: string
) {
  if (event !== 'submit' && document.businessRecordType === 'contract') {
    const published = await client.query(
      `SELECT 1 FROM contract_documents cd JOIN contract_publications p
      ON p.contract_id=cd.contract_id AND p.version_id=cd.contract_version_id WHERE cd.document_id=$1`,
      [document.id]
    );
    if (!published.rows.length) return;
  }
  const owner = (
    await client.query<{ user_id: string }>('SELECT user_id FROM profiles WHERE id=$1', [
      document.profileId,
    ])
  ).rows[0]!.user_id;
  const recipients = new Set<string>();
  if (event === 'submit') {
    const staff = await client.query<{ user_id: string; is_admin: boolean; permissions: unknown }>(
      `SELECT u.user_id,u.is_admin,array_agg(r.permissions) FILTER (WHERE r.role_id IS NOT NULL) AS permissions
       FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.user_id LEFT JOIN staff_roles r ON r.role_id=ur.role_id
       WHERE (u.is_staff OR u.is_admin) AND u.disabled_at IS NULL AND u.activation_token IS NULL GROUP BY u.user_id,u.is_admin`
    );
    const permission = staffDocumentPermission(document.businessRecordType as BusinessType, true);
    for (const user of staff.rows) {
      const grants = resolveStaffPermissions(user.permissions);
      if (user.is_admin || grants.includes('*') || grants.includes(permission))
        recipients.add(user.user_id);
    }
  } else recipients.add(owner);
  const message = messages[event];
  for (const userId of recipients)
    await new NotificationsService().create(
      {
        userId,
        ...(event !== 'submit' && userId === owner ? { profileId: document.profileId } : {}),
        type: 'general',
        title: message.en,
        localizedContent: {
          fa: {
            title: 'مدارک',
            body:
              message.fa +
              ' شناسه مدرک: ' +
              document.id +
              (reason && event !== 'quarantine' ? ' ' + reason : ''),
          },
          en: {
            title: 'Documents',
            body:
              message.en +
              ' Document reference: ' +
              document.id +
              (reason && event !== 'quarantine' ? ' ' + reason : ''),
          },
        },
      },
      client
    );
}
