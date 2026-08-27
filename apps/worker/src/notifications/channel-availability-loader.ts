/**
 * Channel availability context loader (E-05, T-05.05.02).
 *
 * Resolves, for one outbox row, the {@link ChannelAvailabilityContext} the
 * pure availability rule needs: whether the recipient profile owns verified
 * email and phone destinations, and whether the user has opted in to marketing
 * on each external channel (T-05.05.01 `user_notification_preferences`).
 *
 * Verified destinations: Barghsa verifies a user's contact at registration —
 * the username is a normalized, OTP-verified email or E.164 phone (T-01), so a
 * non-null `users.email` is a verified email destination and a non-null
 * `users.mobile` is a verified SMS destination. The loader reads the user's
 * verified contact fields (routed through the row's profile → user link) and
 * the marketing opt-in rows so the runner can gate external dispatch.
 *
 * The loader returns a default context (`no verified destination, no consent`)
 * when the profile/user cannot be found, which the availability rule interprets
 * as "skip all external legs" — safe: a notification is never shipped to an
 * unverified or un-consented external channel. It never throws on a missing
 * recipient so one bad row cannot poison a whole poll.
 *
 * @module notifications
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
  // Resolve the recipient's verified contact fields through the row's
  // profile→user link (covers rows where a user_id is present too, since the
  // outbox always carries a profile_id). Verified email/phone map to the
  // registration-verified `users.mobile` / `users.email` columns.
  const contact = await pool.query(
    `SELECT u.email, u.mobile
       FROM notification_outbox o
       JOIN profiles p ON p.id = o.profile_id
       JOIN users u ON u.user_id = p.user_id
      WHERE o.id = $1`,
    [outboxId],
  )

  const row = contact.rows[0]
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

  return { verifiedEmail, verifiedPhone, marketingOptedIn: consents }
}

export type { NotificationChannel }