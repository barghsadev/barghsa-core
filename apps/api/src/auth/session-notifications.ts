import { v7 as uuidv7 } from 'uuid';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import type { PoolClient } from 'pg';
import { securitySettingsText } from '@barghsa/i18n/security-settings-forms';
import { NotificationsService } from '../notifications/notifications.service.js';

/** Only the committed revocation audit is carried to delivery. */
export async function notifySessionsRevoked(
  client: PoolClient,
  userId: string,
  auditId: string,
  notifications: Pick<
    NotificationsService,
    'createAccountBusinessEvent'
  > = new NotificationsService()
): Promise<void> {
  const localizedContent = Object.fromEntries(
    (['fa', 'en'] as const).map((locale) => [
      locale,
      {
        title: securitySettingsText('sessionRevokedTitle', locale),
        body: securitySettingsText('sessionRevokedBody', locale),
      },
    ])
  ) as Record<'fa' | 'en', { title: string; body: string }>;
  await notifications.createAccountBusinessEvent(
    {
      userId,
      operatingContext: 'account',
      type: 'general',
      ...localizedContent.fa,
      localizedContent,
      link: '/settings/security',
      eventKey: 'auth.session_revoked',
      occurrenceKey: `auth.session_revoked:${auditId}:${userId}`,
      payload: { auditId },
    },
    client
  );
}

/** Record only actual session transitions; credentials and session/family IDs never leave storage. */
export async function notifySessionLifecycleRevocation(
  client: PoolClient,
  userId: string,
  changedSessionCount: number,
  reason: 'logout' | 'session_cap' | 'family'
): Promise<void> {
  if (!Number.isInteger(changedSessionCount) || changedSessionCount <= 0)
    throw new Error('Session lifecycle delivery requires an actual revocation');
  const auditId = uuidv7();
  const audit = await client.query(
    `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at)
     VALUES($1,$2,'session_lifecycle_revoked',$3,$4,clock_timestamp()) RETURNING id`,
    [
      auditId,
      userId,
      JSON.stringify({ reason, changedSessionCount }),
      correlationIdStorage.getStore() ?? uuidv7(),
    ]
  );
  if (audit.rows.length !== 1 || audit.rows[0].id !== auditId)
    throw new Error('Session lifecycle audit was not stored');
  await notifySessionsRevoked(client, userId, auditId);
}
