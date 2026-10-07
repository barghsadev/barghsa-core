import { documentText } from '@barghsa/i18n/documents';
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
function privateDocumentContent(document: Document, event: 'upload' | 'quarantine', reason = '') {
  return Object.fromEntries(
    (['fa', 'en'] as const).map((locale) => [
      locale,
      {
        title: documentText(
          event === 'upload' ? 'uploadNoticeTitle' : 'quarantineStaffNoticeTitle',
          locale
        ),
        body: documentText(
          event === 'upload' ? 'uploadNoticeBody' : 'quarantineStaffNoticeBody',
          locale
        ).replace(
          /\{(name|reference|reason)\}/g,
          (_match, key: string) =>
            (
              ({ name: document.originalName, reference: document.id, reason }) as Record<
                string,
                string
              >
            )[key]!
        ),
      },
    ])
  ) as Record<'fa' | 'en', { title: string; body: string }>;
}
async function documentReviewStaff(client: PoolClient, document: Document) {
  const users = await client.query<{ user_id: string; is_admin: boolean; permissions: unknown }>(
    `SELECT u.user_id,u.is_admin,array_agg(r.permissions) FILTER(WHERE r.role_id IS NOT NULL) AS permissions
     FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.user_id LEFT JOIN staff_roles r ON r.role_id=ur.role_id
     WHERE (u.is_staff OR u.is_admin) AND u.disabled_at IS NULL AND u.activation_token IS NULL GROUP BY u.user_id,u.is_admin`
  );
  const permission = staffDocumentPermission(document.businessRecordType as BusinessType, true);
  return users.rows
    .filter(
      (u) =>
        u.is_admin ||
        resolveStaffPermissions(u.permissions).some((p) => p === '*' || p === permission)
    )
    .map((u) => u.user_id);
}
export async function notifyDocumentUpload(client: PoolClient, document: Document) {
  if (
    !document.storageKey ||
    !document.checksum ||
    !['PendingScan', 'Available'].includes(document.state)
  )
    throw new Error('Document upload notice requires its successful sealed copy');
  const system = document.uploadedByType === 'system';
  const users = system ? await documentReviewStaff(client, document) : [document.uploadedBy];
  for (const userId of users) {
    const staff = system || document.uploadedByType === 'staff';
    const content = privateDocumentContent(document, 'upload');
    await new NotificationsService().createPrivateDocumentEvent(
      {
        userId,
        profileId: document.profileId,
        operatingContext: staff ? 'staff' : 'customer',
        type: 'general',
        title: content.en.title,
        localizedContent: content,
        ...(staff ? { link: '/admin/documents' } : {}),
        eventKey: 'document.uploaded',
        ...(system
          ? {
              requiredStaffPermission: staffDocumentPermission(
                document.businessRecordType as BusinessType,
                true
              ),
            }
          : {}),
        payload: { documentId: document.id, documentName: document.originalName },
        occurrenceKey: `document.uploaded:${document.id}:${userId}`,
      },
      client
    );
  }
}
async function notifyManualQuarantine(client: PoolClient, document: Document, reason: string) {
  const users = await client.query<{ user_id: string }>(
    'SELECT user_id FROM users WHERE is_staff=true AND is_admin=true AND disabled_at IS NULL AND activation_token IS NULL'
  );
  const content = privateDocumentContent(document, 'quarantine', reason);
  for (const user of users.rows)
    await new NotificationsService().createPrivateDocumentEvent(
      {
        userId: user.user_id,
        operatingContext: 'staff',
        type: 'general',
        title: content.en.title,
        localizedContent: content,
        link: '/admin/documents',
        eventKey: 'document.quarantined',
        payload: { documentId: document.id, documentName: document.originalName, reason },
        occurrenceKey: `document.quarantined:${document.id}:manual:${document.revision}:${user.user_id}`,
      },
      client
    );
}

export async function notifyDocumentReview(
  client: PoolClient,
  document: Document,
  event: keyof typeof messages,
  reason?: string
) {
  if (event === 'quarantine') await notifyManualQuarantine(client, document, reason ?? '');
  if (event !== 'submit' && document.businessRecordType === 'contract') {
    const published = await client.query(
      `SELECT 1 FROM contract_documents cd JOIN contract_publications p
      ON p.contract_id=cd.contract_id AND p.version_id=cd.contract_version_id WHERE cd.document_id=$1`,
      [document.id]
    );
    if (!published.rows.length) return;
  }
  const owner = (
    await client.query<{ user_id: string }>('SELECT user_id FROM profiles WHERE id=$1 FOR SHARE', [
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
  for (const userId of recipients) {
    const params = {
      userId,
      ...(event !== 'submit' && userId === owner ? { profileId: document.profileId } : {}),
      operatingContext: event === 'submit' ? 'staff' : 'customer',
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
    } as const;
    if (event === 'approve' || event === 'reject')
      await new NotificationsService().createCustomerBusinessEvent(
        {
          ...params,
          profileId: document.profileId,
          eventKey: 'document.review_completed',
          occurrenceKey: `document.review_completed:${document.id}:${document.revision}:${userId}`,
          payload: {
            documentId: document.id,
            documentName: document.originalName,
            reviewResult: message.fa + ' / ' + message.en + (reason ? ' ' + reason : ''),
          },
        },
        client
      );
    else await new NotificationsService().create(params, client);
  }
}
