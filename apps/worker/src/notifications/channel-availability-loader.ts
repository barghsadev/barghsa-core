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

/** The queue's explicit recipient wins; absent recipients use the current owner. */
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
    WHERE o.id=$1 AND u.disabled_at IS NULL AND u.activation_token IS NULL`,
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
