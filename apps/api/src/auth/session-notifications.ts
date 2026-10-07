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

/** Attach durable delivery to the new native warning without replacing its inbox identity. */
export async function queueRefreshReuseWarning(
  client: PoolClient,
  userId: string,
  inboxId: string
): Promise<void> {
  const outboxId = uuidv7();
  const payload = { inboxId, link_route: '/settings/security' };
  const inserted = await client.query(
    `INSERT INTO notification_outbox(id,user_id,event_key,payload,channels,status,idempotency_key,max_attempts,correlation_id)
     SELECT $1,$2,'auth.refresh_token_reused',$3,ARRAY['in_app','email'],'queued',$4,5,$5
     FROM in_app_notifications n WHERE n.id=$6 AND n.recipient_user_id=$2
       AND n.profile_id IS NULL AND n.operating_context='account' AND n.type='auth.refresh_token_reused'
       AND n.link_route='/settings/security' AND n.delivery_key LIKE 'session-reuse:%'
     RETURNING id`,
    [
      outboxId,
      userId,
      payload,
      `auth.refresh_token_reused:${inboxId}:${userId}`,
      correlationIdStorage.getStore() ?? null,
      inboxId,
    ]
  );
  if (inserted.rows.length !== 1 || inserted.rows[0].id !== outboxId)
    throw new Error('Refresh reuse warning outbox was not stored');
  const inboxJob = await client.query(
    `INSERT INTO notification_job(outbox_id,channel,status,priority,max_attempts,attempts,provider_ref,delivery_payload)
     VALUES($1,'in_app','done','urgent',5,1,$2,$3)`,
    [outboxId, inboxId, payload]
  );
  if (inboxJob.rowCount !== 1) throw new Error('Refresh reuse inbox job was not stored');
  const emailJob = await client.query(
    `INSERT INTO notification_job(outbox_id,channel,status,priority,max_attempts,attempts)
     VALUES($1,'email','queued','urgent',5,0)`,
    [outboxId]
  );
  if (emailJob.rowCount !== 1) throw new Error('Refresh reuse email job was not stored');
  const history = await client.query(
    `INSERT INTO notification_delivery_log(notification_id,channel,status,attempt_number,provider_ref)
     VALUES($1,'in_app','delivered',1,$2)`,
    [outboxId, inboxId]
  );
  if (history.rowCount !== 1) throw new Error('Refresh reuse inbox history was not stored');
}

/** An authenticated login from a device absent from this account's session history. */
export async function notifyNewDeviceLogin(client: PoolClient, userId: string): Promise<void> {
  const auditId = uuidv7();
  const audit = await client.query(
    `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at)
     VALUES($1,$2,'new_device_login',$3,$4,clock_timestamp()) RETURNING id,created_at`,
    [
      auditId,
      userId,
      JSON.stringify({ unrecognizedDevice: true }),
      correlationIdStorage.getStore() ?? uuidv7(),
    ]
  );
  if (audit.rows.length !== 1 || audit.rows[0].id !== auditId)
    throw new Error('New device login audit was not stored');
  const localizedContent = Object.fromEntries(
    (['fa', 'en'] as const).map((locale) => [
      locale,
      {
        title: securitySettingsText('newDeviceTitle', locale),
        body: securitySettingsText('newDeviceBody', locale),
      },
    ])
  ) as Record<'fa' | 'en', { title: string; body: string }>;
  await new NotificationsService().createAccountBusinessEvent(
    {
      userId,
      operatingContext: 'account',
      type: 'general',
      ...localizedContent.fa,
      localizedContent,
      link: '/settings/security',
      eventKey: 'auth.new_device_login',
      occurrenceKey: `auth.new_device_login:${auditId}:${userId}`,
      payload: {
        auditId,
        device: `${securitySettingsText('unrecognizedDevice', 'fa')} / ${securitySettingsText('unrecognizedDevice', 'en')}`,
        loginTime: (audit.rows[0].created_at as Date).toISOString(),
      },
    },
    client
  );
}
