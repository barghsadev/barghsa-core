/**
 * Channel availability rules (E-05, T-05.05.02).
 *
 * Determines, for a given notification event, which requested channels are
 * actually deliverable at dispatch time. This is the consent + destination
 * gate that sits between the outbox worker's lease loop and the transport
 * layer:
 *
 *   - `mandatory` (and `system`) events: the in-app channel is ALWAYS
 *     delivered — transactional/security/payment/contract notifications must
 *     never be silently dropped. An external channel (email/sms) is delivered
 *     ONLY when the profile owns a verified destination for that channel.
 *     Without a verified email, an `email` leg is skipped; without a verified
 *     phone number, an `sms` leg is skipped.
 *   - `marketing` events: the in-app channel is still always delivered (in-app
 *     delivery is never consent-gated). An external channel (email/sms) is
 *     delivered ONLY when the profile HAS opted in to marketing on that
 *     channel AND owns a verified destination. If not opted in, the whole
 *     external surface is skipped—no email/SMS marketing is ever sent without
 *     explicit consent.
 *
 * The decision is a pure function of the event key, the requested channels and
 * a "channel availability context" (verified destinations + marketing
 * opt-ins). It returns the allowed channels plus a machine-readable list of
 * skipped legs and why, so the caller (outbox runner) can (a) only dispatch
 * the allowed legs and (b) record a clear, auditable skip reason on the
 * skipped job.
 *
 * The source of truth for consent category is the code-defined registry in
 * {@link NOTIFICATION_TYPE_REGISTRY}. An unregistered event key is treated as
 * `mandatory` (the safe default — it must never be blocked from in-app by a
 * missing registry entry).
 *
 * @module notifications
 */
import { getNotificationTypeDefinition, type NotificationChannel } from '@barghsa/shared/notifications'

/** Consent category used by the availability gate (registry value, defaulted). */
export type ChannelAvailabilityCategory = 'mandatory' | 'marketing' | 'system'

/**
 * A profile's verified contact destinations and marketing consent, keyed for
 * the lookups performed during availability resolution.
 *
 * `verifiedEmail` / `verifiedPhone` capture whether the profile owns a
 * verified destination for that channel — the outbox worker loader (see
 * `loadChannelAvailabilityContext`) resolves this from verified contact
 * records. `marketingOptedIn` mirrors the consent decision stored per
 * (profile, channel) in `user_notification_preferences` (T-05.05.01).
 */
export interface ChannelAvailabilityContext {
  /** Whether the profile owns a verified email destination. */
  verifiedEmail: boolean
  /** Whether the profile owns a verified phone (SMS) destination. */
  verifiedPhone: boolean
  /** Whether the user has opted in to marketing on each external channel. */
  marketingOptedIn: Partial<Record<'email' | 'sms', boolean>>
}

/** Reason an external channel leg was skipped by the availability gate. */
export type ChannelSkipReason = 'verified_destination_missing' | 'marketing_opt_in_required'

/** One skipped channel leg and why it was dropped. */
export interface SkippedChannel {
  channel: 'email' | 'sms'
  reason: ChannelSkipReason
}

/** Result of resolving availability for one outbox row. */
export interface ChannelAvailabilityDecision {
  /** Channels that may be dispatched (always includes `in_app` when requested). */
  allowed: NotificationChannel[]
  /** External legs that must be skipped, with the reason. */
  skipped: SkippedChannel[]
}

/**
 * External channels subject to the destination + marketing gate. The in-app
 * channel is deliberately not here: in-app notification-center delivery is
 * never consent-gated (both transactional and marketing in-app legs are
 * always allowed once requested, per the story's acceptance criteria).
 */
const EXTERNAL: ReadonlySet<string> = new Set(['email', 'sms'])

/** Whether the profile has verified the destination for a given channel. */
export function hasVerifiedDestination(
  channel: 'email' | 'sms',
  ctx: ChannelAvailabilityContext,
): boolean {
  if (channel === 'email') return ctx.verifiedEmail
  return ctx.verifiedPhone
}

/**
 * Evaluate the gate for one external channel. Returns whether it may be
 * dispatched and, when not, the machine-readable reason.
 *
 *   - `mandatory` / `system` — a verified destination is required; no consent.
 *   - `marketing` — verified destination AND explicit opt-in required.
 */
export function externalChannelAllowed(
  category: ChannelAvailabilityCategory,
  channel: 'email' | 'sms',
  ctx: ChannelAvailabilityContext,
): { allowed: boolean; reason?: ChannelSkipReason } {
  if (!hasVerifiedDestination(channel, ctx)) {
    return { allowed: false, reason: 'verified_destination_missing' }
  }
  if (category === 'marketing' && !ctx.marketingOptedIn[channel]) {
    return { allowed: false, reason: 'marketing_opt_in_required' }
  }
  return { allowed: true }
}

/**
 * Decide the deliverable channels and skipped legs for an outbox row.
 *
 * Pure and deterministic — the caller resolves the context from a loader
 * (e.g. `loadChannelAvailabilityContext`, which reads the profile's verified
 * destinations + marketing preference), then passes it here.
 */
export function resolveChannelAvailability(
  eventKey: string,
  requested: readonly NotificationChannel[],
  ctx: ChannelAvailabilityContext,
): ChannelAvailabilityDecision {
  const def = getNotificationTypeDefinition(eventKey)
  const category: ChannelAvailabilityCategory = def?.category ?? 'mandatory'

  const allowed: NotificationChannel[] = []
  const skipped: SkippedChannel[] = []

  for (const channel of requested) {
    if (channel === 'in_app') {
      // Never consent-gated: in-app is always delivered once requested.
      allowed.push(channel)
      continue
    }
    if (!EXTERNAL.has(channel)) {
      // Unknown/future non-external channel — do not gate it out.
      allowed.push(channel)
      continue
    }
    const external = channel as 'email' | 'sms'
    const gate = externalChannelAllowed(category, external, ctx)
    if (gate.allowed) {
      allowed.push(channel)
    } else if (gate.reason) {
      skipped.push({ channel: external, reason: gate.reason })
    }
  }

  return { allowed, skipped }
}

export type { NotificationChannel }