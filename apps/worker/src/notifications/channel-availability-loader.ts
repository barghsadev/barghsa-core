/** Resolve the queued recipient's verified contacts and profile marketing preferences.
 * An explicit outbox user wins over the current profile owner. Disabled users
 * and pending staff activations have no external destination. Complaint and
 * bounce suppression applies independently of marketing consent.
 */
import type { NotificationChannel } from '@barghsa/shared/notifications';
import {
  resolveChannelAvailability,
  type ChannelAvailabilityContext,
} from './channel-availability.js';

/** Minimal pool surface used by the loader (matches the worker's test pools). */
export interface AvailabilityPool {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** A fully-opted-out, zero-verified-destination default context. */
export const EMPTY_AVAILABILITY_CONTEXT: ChannelAvailabilityContext = {
  enabledChannels: {},
  verifiedEmail: false,
  verifiedPhone: false,
  marketingOptedIn: {},
};

/** The external channels that marketing consent applies to. */
export const MARKETING_CHANNELS: ReadonlyArray<'email' | 'sms'> = ['email', 'sms'];

/**
 * Resolve a profile's verified destinations and marketing opt-ins for the
 * outbox worker. Returns `EMPTY_AVAILABILITY_CONTEXT` when the recipient
 * cannot be found so external legs are conservatively skipped.
 */
export async function loadChannelAvailabilityContext(
  pool: AvailabilityPool,
  outboxId: string
): Promise<ChannelAvailabilityContext> {
  const row = await loadNotificationRecipient(pool, outboxId);
  if (!row) return EMPTY_AVAILABILITY_CONTEXT;
  return loadRecipientAvailability(pool, row);
}

async function loadRecipientAvailability(
  pool: AvailabilityPool,
  row: NotificationRecipient
): Promise<ChannelAvailabilityContext> {
  const verifiedEmail = Boolean(row.email);
  const verifiedPhone = Boolean(row.mobile);

  // Marketing consent per external channel (T-05.05.01). A profile that has
  // NEVER created a preference row defaults to `marketing_opted_in = false`,
  // so absent rows below resolve to no-consent for the gate.
  const consents: Partial<Record<'email' | 'sms', boolean>> = {};
  const pref = await pool.query(
    `SELECT channel, marketing_opted_in
       FROM user_notification_preferences
      WHERE profile_id = $1`,
    [row.profileId]
  );
  for (const p of pref.rows) {
    const ch = p.channel;
    if (ch !== 'email' && ch !== 'sms') continue;
    consents[ch] = p.marketing_opted_in === true;
  }

  return {
    enabledChannels: row.enabledChannels,
    verifiedEmail,
    verifiedPhone,
    emailSuppressed: row.emailSuppressed,
    marketingOptedIn: consents,
  };
}

export type { NotificationChannel };
export interface NotificationRecipient {
  enabledChannels: ChannelAvailabilityContext['enabledChannels'];
  userId: string;
  profileId: string | null;
  email: string | null;
  mobile: string | null;
  locale: 'fa' | 'en';
  emailSuppressed: boolean;
}

/** Explicit recipients remain stable. Canonical private business notices require current ownership. */
export async function loadNotificationRecipient(
  pool: AvailabilityPool,
  outboxId: string
): Promise<NotificationRecipient | null> {
  const result = await pool.query(
    `SELECT o.profile_id,u.user_id,u.locale,u.notification_preferences,contacts.email,contacts.mobile,
      EXISTS (SELECT 1 FROM email_suppressions s WHERE lower(s.address)=lower(contacts.email)) AS email_suppressed
    FROM notification_outbox o LEFT JOIN profiles p ON p.id=o.profile_id
    JOIN users u ON u.user_id=COALESCE(o.user_id,p.user_id)
    CROSS JOIN LATERAL (
      SELECT
        CASE WHEN EXISTS (SELECT 1 FROM account_login_identifiers i WHERE i.user_id=u.user_id
          AND i.kind='email' AND i.destination=lower(u.email) AND i.verified_at IS NOT NULL)
          THEN u.email
          WHEN u.username LIKE '%@%' AND EXISTS (SELECT 1 FROM account_login_identifiers i
            WHERE i.user_id=u.user_id AND i.kind='primary' AND i.destination=lower(u.username))
          THEN u.username END AS email,
        CASE WHEN EXISTS (SELECT 1 FROM account_login_identifiers i WHERE i.user_id=u.user_id
          AND i.kind='mobile' AND i.destination=u.mobile AND i.verified_at IS NOT NULL)
          THEN u.mobile
          WHEN u.username LIKE '+%' AND EXISTS (SELECT 1 FROM account_login_identifiers i
            WHERE i.user_id=u.user_id AND i.kind='primary' AND i.destination=u.username)
          THEN u.username END AS mobile
    ) contacts
    WHERE o.id=$1 AND u.disabled_at IS NULL AND u.activation_token IS NULL
      AND (o.event_key NOT IN (
        'contract.created','contract.awaiting_acceptance','contract.accepted',
        'contract.signed','contract.active','contract.cancelled','contract.changes_requested',
        'order.submitted','order.status_changed','order.cancellation_requested',
        'document.review_completed','profile.verification_status'
      ) OR (p.user_id=u.user_id AND NOT p.archived) OR EXISTS (
        SELECT 1 FROM in_app_notifications n
        WHERE n.delivery_key='outbox:'||o.id::text AND n.profile_id=o.profile_id
          AND n.recipient_user_id=u.user_id AND n.operating_context='staff'
          AND n.type=o.event_key
      ))
      AND (o.event_key NOT IN ('ticket.new_reply','ticket.assigned') OR EXISTS (
        SELECT 1 FROM tickets t JOIN in_app_notifications n ON n.delivery_key='outbox:'||o.id::text
        WHERE t.id::text=o.payload->>'ticketNumber' AND n.profile_id IS NULL AND o.profile_id IS NULL
          AND n.recipient_user_id=u.user_id AND n.type=o.event_key
          AND ((n.operating_context='customer' AND t.user_id=u.user_id AND o.event_key='ticket.new_reply')
            OR (n.operating_context='staff' AND (u.is_admin OR EXISTS (
              SELECT 1 FROM user_roles ur JOIN staff_roles r ON r.role_id=ur.role_id WHERE ur.user_id=u.user_id
                AND ((CASE WHEN r.permissions IS JSON ARRAY THEN r.permissions::jsonb ELSE '[]'::jsonb END)
                  ?| ARRAY['*','tickets:*','tickets:read'] OR
                  (t.assigned_to=u.user_id AND (CASE WHEN r.permissions IS JSON ARRAY
                    THEN r.permissions::jsonb ELSE '[]'::jsonb END) ? 'tickets:assigned'))
            ))))
      ))
      AND (o.event_key<>'profile.invitation_received' OR (o.profile_id IS NULL AND EXISTS (
        SELECT 1 FROM profile_invitations i JOIN profiles entity ON entity.id=i.profile_id
        JOIN account_login_identifiers a ON a.destination=i.username
        JOIN in_app_notifications n ON n.delivery_key='outbox:'||o.id::text
        WHERE i.id::text=o.payload->>'invitationId' AND a.user_id=u.user_id
          AND i.status='Pending' AND (i.expires_at IS NULL OR i.expires_at>clock_timestamp())
          AND NOT entity.archived AND entity.profile_type='LEGAL' AND i.role IN ('Manager','Finance','Legal')
          AND n.profile_id IS NULL AND n.recipient_user_id=u.user_id
          AND n.operating_context='customer' AND n.type=o.event_key
      )))
      AND (o.event_key<>'profile.agent_role_changed' OR (o.profile_id IS NULL AND EXISTS (
        SELECT 1 FROM audit_log a JOIN profiles entity ON entity.id::text=a.metadata::jsonb->>'profileId'
        JOIN in_app_notifications n ON n.delivery_key='outbox:'||o.id::text
        WHERE a.id::text=o.payload->>'auditId' AND a.event IN ('agent_roles_changed','agent_removed')
          AND a.metadata::jsonb->>'targetUserId'=u.user_id AND NOT entity.archived AND entity.profile_type='LEGAL'
          AND n.profile_id IS NULL AND n.recipient_user_id=u.user_id
          AND n.operating_context='customer' AND n.type=o.event_key
      )))
      AND (o.event_key<>'auth.password_changed' OR (o.profile_id IS NULL AND EXISTS (
        SELECT 1 FROM audit_log a JOIN in_app_notifications n ON n.delivery_key='outbox:'||o.id::text
        WHERE a.id::text=o.payload->>'auditId' AND a.user_id=u.user_id AND a.event IN ('password_changed','password_reset')
          AND n.profile_id IS NULL AND n.recipient_user_id=u.user_id AND n.operating_context='account' AND n.type=o.event_key
      )))
      AND (o.event_key<>'auth.refresh_token_reused' OR (o.profile_id IS NULL AND EXISTS (
        SELECT 1 FROM in_app_notifications n WHERE n.id::text=o.payload->>'inboxId'
          AND n.profile_id IS NULL AND n.recipient_user_id=u.user_id
          AND n.operating_context='account' AND n.type=o.event_key
          AND n.link_route='/settings/security' AND n.delivery_key LIKE 'session-reuse:%'
          AND EXISTS(SELECT 1 FROM notification_job j WHERE j.outbox_id=o.id AND j.channel='in_app'
            AND j.status='done' AND j.provider_ref=n.id::text)
          AND EXISTS(SELECT 1 FROM notification_delivery_log h WHERE h.notification_id=o.id
            AND h.channel='in_app' AND h.status='delivered' AND h.attempt_number=1 AND h.provider_ref=n.id::text)
      )))
      AND (o.event_key<>'auth.session_revoked' OR (o.profile_id IS NULL AND EXISTS (
        SELECT 1 FROM audit_log a JOIN in_app_notifications n ON n.delivery_key='outbox:'||o.id::text
        WHERE a.id::text=o.payload->>'auditId' AND (
          (a.event IN ('sessions_revoked','session_lifecycle_revoked') AND a.user_id=u.user_id AND (a.metadata::jsonb->>'changedSessionCount')::integer>0)
          OR (a.event IN ('expire_sessions','force_password_change') AND a.metadata::jsonb->>'targetUserId'=u.user_id)
          OR (a.event='invitation_accepted' AND a.user_id=u.user_id)
          OR (a.event='profile_closure_executed' AND a.metadata::jsonb->>'ownerUserId'=u.user_id)
        ) AND n.profile_id IS NULL AND n.recipient_user_id=u.user_id AND n.operating_context='account' AND n.type=o.event_key
      )))`,
    [outboxId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const preferences =
    typeof row.notification_preferences === 'string' ? row.notification_preferences.split(',') : [];
  return {
    enabledChannels: { email: preferences.includes('EMAIL'), sms: preferences.includes('SMS') },
    userId: row.user_id as string,
    profileId: (row.profile_id as string | null) ?? null,
    email: typeof row.email === 'string' && row.email.trim() ? row.email.trim() : null,
    mobile: typeof row.mobile === 'string' && row.mobile.trim() ? row.mobile.trim() : null,
    locale: row.locale === 'en' ? 'en' : 'fa',
    emailSuppressed: row.email_suppressed === true,
  };
}

/** Recheck after rendering/snapshot work, before handing an external message to its sender. */
export async function assertNotificationRecipientAvailable(
  pool: AvailabilityPool,
  outboxId: string,
  eventKey: string,
  channel: 'email' | 'sms',
  expected: NotificationRecipient
): Promise<void> {
  const current = await loadNotificationRecipient(pool, outboxId);
  const destination = channel === 'email' ? 'email' : 'mobile';
  if (
    !current ||
    current.userId !== expected.userId ||
    current.profileId !== expected.profileId ||
    current[destination] !== expected[destination]
  ) {
    throw new Error('Notification recipient changed; delivery requires reconciliation');
  }
  const decision = resolveChannelAvailability(
    eventKey,
    [channel],
    await loadRecipientAvailability(pool, current)
  );
  if (decision.skipped.length) throw new Error(decision.skipped[0]!.reason);
}
