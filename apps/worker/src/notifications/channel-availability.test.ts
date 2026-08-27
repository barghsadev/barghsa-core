import { describe, it, expect } from 'vitest'
import {
  resolveChannelAvailability,
  hasVerifiedDestination,
  type ChannelAvailabilityContext,
} from './channel-availability.js'

/**
 * Channel availability rules tests (E-05, T-05.05.02).
 *
 * Exercises the verified-destination + marketing-opt-in gate across the
 * auth categories: `mandatory`, `system`, `marketing`.
 */

const noVerified: ChannelAvailabilityContext = {
  verifiedEmail: false,
  verifiedPhone: false,
  marketingOptedIn: {},
}

const emailVerifiedNoConsent: ChannelAvailabilityContext = {
  verifiedEmail: true,
  verifiedPhone: false,
  marketingOptedIn: {},
}

const emailVerifiedMarketingOptedIn: ChannelAvailabilityContext = {
  verifiedEmail: true,
  verifiedPhone: false,
  marketingOptedIn: { email: true },
}

const smsVerifiedMarketingOptedIn: ChannelAvailabilityContext = {
  verifiedEmail: false,
  verifiedPhone: true,
  marketingOptedIn: { sms: true },
}

const noDestinationSmsOptedIn: ChannelAvailabilityContext = {
  verifiedEmail: false,
  verifiedPhone: false,
  marketingOptedIn: { sms: true },
}

describe('hasVerifiedDestination', () => {
  it('maps email to verifiedEmail and sms to verifiedPhone', () => {
    expect(hasVerifiedDestination('email', emailVerifiedNoConsent)).toBe(true)
    expect(hasVerifiedDestination('email', noVerified)).toBe(false)
    expect(hasVerifiedDestination('sms', smsVerifiedMarketingOptedIn)).toBe(true)
    expect(hasVerifiedDestination('sms', emailVerifiedNoConsent)).toBe(false)
  })
})

describe('resolveChannelAvailability — mandatory / system events', () => {
  it('keeps in_app even with no verified destination, skipping external legs', () => {
    const d = resolveChannelAvailability('auth.otp_sent', ['in_app', 'email', 'sms'], noVerified)
    expect(d.allowed).toEqual(['in_app'])
    expect(d.skipped.map((s) => [s.channel, s.reason])).toEqual([
      ['email', 'verified_destination_missing'],
      ['sms', 'verified_destination_missing'],
    ])
  })

  it('allows an email leg only when the destination is verified', () => {
    const d = resolveChannelAvailability('auth.otp_sent', ['in_app', 'email'], emailVerifiedNoConsent)
    expect(d.allowed).toEqual(['in_app', 'email'])
    expect(d.skipped).toEqual([])
  })

  it('does not require marketing consent for mandatory events', () => {
    // Verified email + no marketing consent → mandatory email still delivered.
    const d = resolveChannelAvailability('contract.cancelled', ['in_app', 'email'], emailVerifiedNoConsent)
    expect(d.allowed).toEqual(['in_app', 'email'])
    expect(d.skipped).toEqual([])
  })

  it('gated sms requires verified phone regardless of consent for system events', () => {
    // sms destination verified + opted in → delivered; no destination → skipped
    const d = resolveChannelAvailability('system.service_outage', ['in_app', 'sms'], smsVerifiedMarketingOptedIn)
    expect(d.allowed).toEqual(['in_app', 'sms'])
    expect(d.skipped).toEqual([])
  })
})

describe('resolveChannelAvailability — marketing events', () => {
  it('keeps in_app but skips email when no opt-in', () => {
    const d = resolveChannelAvailability('marketing.promotion', ['in_app', 'email'], emailVerifiedNoConsent)
    expect(d.allowed).toEqual(['in_app'])
    expect(d.skipped.map((s) => [s.channel, s.reason])).toEqual([['email', 'marketing_opt_in_required']])
  })

  it('sends email marketing only when opted in AND destination verified', () => {
    const d = resolveChannelAvailability(
      'marketing.promotion',
      ['in_app', 'email'],
      emailVerifiedMarketingOptedIn,
    )
    expect(d.allowed).toEqual(['in_app', 'email'])
    expect(d.skipped).toEqual([])
  })

  it('sends sms marketing only when opted in AND phone destination verified', () => {
    const d = resolveChannelAvailability('marketing.promotion', ['in_app', 'sms'], smsVerifiedMarketingOptedIn)
    expect(d.allowed).toEqual(['in_app', 'sms'])
    expect(d.skipped).toEqual([])
  })

  it('skips sms marketing when no verified phone even if opted in', () => {
    const d = resolveChannelAvailability('marketing.promotion', ['in_app', 'sms'], noDestinationSmsOptedIn)
    expect(d.allowed).toEqual(['in_app'])
    expect(d.skipped.map((s) => [s.channel, s.reason])).toEqual([['sms', 'verified_destination_missing']])
  })
})

describe('resolveChannelAvailability — defaults & unknown events', () => {
  it('treats an unknown event key as mandatory (safe default, in-app always)', () => {
    const d = resolveChannelAvailability('future.unknown_event', ['in_app', 'email'], noVerified)
    expect(d.allowed).toEqual(['in_app'])
    expect(d.skipped.map((s) => [s.channel, s.reason])).toEqual([['email', 'verified_destination_missing']])
  })

  it('keeps only requested channels and never fabricates a channel', () => {
    const d = resolveChannelAvailability('auth.otp_sent', ['in_app'], noVerified)
    expect(d.allowed).toEqual(['in_app'])
    expect(d.skipped).toEqual([])
  })

  it('keeps in_app unchanged when no external channel is requested', () => {
    const d = resolveChannelAvailability('marketing.promotion', ['in_app'], noVerified)
    expect(d.allowed).toEqual(['in_app'])
    expect(d.skipped).toEqual([])
  })
})