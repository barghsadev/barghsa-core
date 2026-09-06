/** Resolve the queued recipient's verified contacts and profile marketing preferences.
 * An explicit outbox user wins over the current profile owner. Disabled users
 * and pending staff activations have no external destination. Complaint and
 * bounce suppression applies independently of marketing consent.
 */
import type { NotificationChannel } from '@barghsa/shared/notifications'
import type { ChannelAvailabilityContext } from './channel-availability.js'

/** Minimal pool surface used by the loader (matches the worker's test pools). */
export interface AvailabilityPool {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
}

/** A fully-opted-out, zero-verified-destination default context. */
export const EMPTY_AVAILABILITY_CONTEXT: ChannelAvailabilityContext = {
  verifiedEmail: false,
  verifiedPhone: false,
  marketingOptedIn: {},
}

/** The external channels that marketing consent applies to. */
export const MARKETING_CHANNELS: ReadonlyArray<'email' | 'sms'> = ['email', 'sms']

/**
 * Resolve a profile's verified destinations and marketing opt-ins for the
 * outbox worker. Returns `EMPTY_AVAILABILITY_CONTEXT` when the recipient
 * cannot be found so external legs are conservatively skipped.
 */
export async function loadChannelAvailabilityContext(
  pool: AvailabilityPool,
  outboxId: string,
): Promise<ChannelAvailabilityContext> {
  const row = await loadNotificationRecipient(pool, outboxId)
  if (!row) return EMPTY_AVAILABILITY_CONTEXT
  const verifiedEmail = Boolean(row.email)
  const verifiedPhone = Boolean(row.mobile)

  // Marketing consent per external channel (T-05.05.01). A profile that has
  // NEVER created a preference row defaults to `marketing_opted_in = false`,
  // so absent rows below resolve to no-consent for the gate.
  const consents: Partial<Record<'email' | 'sms', boolean>> = {}
  const pref = await pool.query(
    `SELECT channel, marketing_opted_in
       FROM user_notification_preferences
      WHERE profile_id = (
        SELECT profile_id FROM notification_outbox WHERE id = $1
      )`,
    [outboxId],
  )
  for (const p of pref.rows) {
    const ch = p.channel
    if (ch !== 'email' && ch !== 'sms') continue
    consents[ch] = Boolean(p.marketing_opted_in)
  }

  return { verifiedEmail, verifiedPhone, emailSuppressed: row.emailSuppressed, marketingOptedIn: consents }
}

export type { NotificationChannel }
export interface NotificationRecipient {
  userId: string
  profileId: string | null
  email: string | null
  mobile: string | null
  locale: 'fa' | 'en'
  emailSuppressed: boolean
}

/** The queue's explicit recipient wins; absent recipients use the current owner. */
export async function loadNotificationRecipient(pool: AvailabilityPool, outboxId: string): Promise<NotificationRecipient | null> {
  const result = await pool.query(`SELECT o.profile_id,u.user_id,u.locale,
      COALESCE(u.email,CASE WHEN u.username LIKE '%@%' THEN u.username END) AS email,
      COALESCE(u.mobile,CASE WHEN u.username LIKE '+%' THEN u.username END) AS mobile,
      EXISTS (SELECT 1 FROM email_suppressions s WHERE lower(s.address)=lower(
        COALESCE(u.email,CASE WHEN u.username LIKE '%@%' THEN u.username END))) AS email_suppressed
    FROM notification_outbox o LEFT JOIN profiles p ON p.id=o.profile_id
    JOIN users u ON u.user_id=COALESCE(o.user_id,p.user_id)
    WHERE o.id=$1 AND u.disabled_at IS NULL AND u.activation_token IS NULL`, [outboxId])
  const row = result.rows[0]
  if (!row) return null
  return { userId: row.user_id as string, profileId: (row.profile_id as string | null) ?? null,
    email: typeof row.email === 'string' && row.email.trim() ? row.email.trim() : null,
    mobile: typeof row.mobile === 'string' && row.mobile.trim() ? row.mobile.trim() : null,
    locale: row.locale === 'en' ? 'en' : 'fa', emailSuppressed: row.email_suppressed === true }
}
