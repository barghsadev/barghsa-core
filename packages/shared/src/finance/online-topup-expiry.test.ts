import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ONLINE_TOPUP_PENDING_TTL_MS,
  ONLINE_TOPUP_CALLBACK_OPEN_STATES,
  ONLINE_TOPUP_CHANNEL,
  ONLINE_TOPUP_EXPIRED_STATE,
  ONLINE_TOPUP_EXPIRY_AUDIT_EVENT,
  ONLINE_TOPUP_EXPIRY_REASON,
  ONLINE_TOPUP_EXPIRY_TRANSITION,
  ONLINE_TOPUP_INTENT_RELEASE_STATES,
  isEligibleForOnlineTopUpExpiry,
  isOnlineTopUpCallbackOpenState,
  isOnlineTopUpChannel,
  isOnlineTopUpIntentReleasable,
  isOnlineTopUpPendingPastTtl,
  onlineTopUpExpiryCutoff,
  parseOnlineTopUpCreatedAt,
  parseOnlineTopUpPendingTtlMs,
  readOnlineTopUpChannel,
} from './online-topup-expiry.js'

const NOW = new Date('2026-09-02T12:00:00.000Z')
const TTL = DEFAULT_ONLINE_TOPUP_PENDING_TTL_MS
const PAST = new Date(NOW.getTime() - TTL - 1)
const BOUNDARY = new Date(NOW.getTime() - TTL)
const RECENT = new Date(NOW.getTime() - 60_000)

describe('online top-up expiry contract (T-04.2.02.07)', () => {
  it('expires only online Pending top-ups and keeps them reconcilable', () => {
    expect(ONLINE_TOPUP_CHANNEL).toBe('online')
    expect(DEFAULT_ONLINE_TOPUP_PENDING_TTL_MS).toBe(30 * 60 * 1000)
    expect(ONLINE_TOPUP_EXPIRED_STATE).toBe('Rejected')
    expect(ONLINE_TOPUP_EXPIRY_REASON).toBe('Pending online top-up expired beyond TTL')
    expect(ONLINE_TOPUP_EXPIRY_AUDIT_EVENT).toBe('wallet.online_topup.expired')
    expect(ONLINE_TOPUP_EXPIRY_TRANSITION).toBe('expire_pending')
    expect(ONLINE_TOPUP_CALLBACK_OPEN_STATES).toEqual([
      'Pending',
      'Failed',
      'Rejected',
      'Released',
    ])
    expect(ONLINE_TOPUP_INTENT_RELEASE_STATES).toEqual(['Pending', 'Failed', 'Rejected'])
  })
})

describe('parseOnlineTopUpCreatedAt', () => {
  it('returns a Date instance unchanged when valid', () => {
    expect(parseOnlineTopUpCreatedAt(PAST)).toBe(PAST)
  })

  it('parses an ISO string', () => {
    expect(parseOnlineTopUpCreatedAt(PAST.toISOString())?.toISOString()).toBe(PAST.toISOString())
  })

  it('returns null for missing or invalid values', () => {
    expect(parseOnlineTopUpCreatedAt(null)).toBeNull()
    expect(parseOnlineTopUpCreatedAt(undefined)).toBeNull()
    expect(parseOnlineTopUpCreatedAt('')).toBeNull()
    expect(parseOnlineTopUpCreatedAt('   ')).toBeNull()
    expect(parseOnlineTopUpCreatedAt('not-a-date')).toBeNull()
    expect(parseOnlineTopUpCreatedAt(new Date('nope'))).toBeNull()
  })
})

describe('isOnlineTopUpPendingPastTtl', () => {
  it('is true only when createdAt is strictly older than now minus TTL', () => {
    expect(isOnlineTopUpPendingPastTtl(PAST, NOW, TTL)).toBe(true)
    expect(isOnlineTopUpPendingPastTtl(PAST.toISOString(), NOW, TTL)).toBe(true)
    expect(isOnlineTopUpPendingPastTtl(BOUNDARY, NOW, TTL)).toBe(false)
    expect(isOnlineTopUpPendingPastTtl(RECENT, NOW, TTL)).toBe(false)
    expect(isOnlineTopUpPendingPastTtl(NOW, NOW, TTL)).toBe(false)
  })

  it('is false when createdAt, now, or ttl is invalid', () => {
    expect(isOnlineTopUpPendingPastTtl(null, NOW, TTL)).toBe(false)
    expect(isOnlineTopUpPendingPastTtl(PAST, new Date('nope'), TTL)).toBe(false)
    expect(isOnlineTopUpPendingPastTtl(PAST, NOW, Number.NaN)).toBe(false)
    expect(isOnlineTopUpPendingPastTtl(PAST, NOW, -1)).toBe(false)
  })
})

describe('onlineTopUpExpiryCutoff', () => {
  it('subtracts the TTL from now', () => {
    expect(onlineTopUpExpiryCutoff(NOW, TTL).toISOString()).toBe(BOUNDARY.toISOString())
  })
})

describe('channel helpers', () => {
  it('accepts only the online channel', () => {
    expect(isOnlineTopUpChannel('online')).toBe(true)
    expect(isOnlineTopUpChannel('bank_receipt')).toBe(false)
    expect(isOnlineTopUpChannel(null)).toBe(false)
  })

  it('reads metadata.channel from a ledger object', () => {
    expect(readOnlineTopUpChannel({ channel: 'online' })).toBe('online')
    expect(readOnlineTopUpChannel({ channel: 'bank_receipt' })).toBe('bank_receipt')
    expect(readOnlineTopUpChannel({})).toBeNull()
    expect(readOnlineTopUpChannel(null)).toBeNull()
    expect(readOnlineTopUpChannel('online')).toBeNull()
  })
})

describe('callback open / release states', () => {
  it('treats Rejected as reconcilable but not already Released as releasable', () => {
    expect(isOnlineTopUpCallbackOpenState('Rejected')).toBe(true)
    expect(isOnlineTopUpCallbackOpenState('Completed')).toBe(false)
    expect(isOnlineTopUpIntentReleasable('Rejected')).toBe(true)
    expect(isOnlineTopUpIntentReleasable('Released')).toBe(false)
  })
})

describe('isEligibleForOnlineTopUpExpiry', () => {
  const eligible = {
    type: 'topup',
    state: 'Pending',
    channel: 'online',
    createdAt: PAST,
  }

  it('marks an online Pending top-up that is past TTL', () => {
    expect(isEligibleForOnlineTopUpExpiry(eligible, NOW, TTL)).toBe(true)
  })

  it('refuses bank-receipt Pendings even when old', () => {
    expect(
      isEligibleForOnlineTopUpExpiry({ ...eligible, channel: 'bank_receipt' }, NOW, TTL),
    ).toBe(false)
  })

  it('refuses rows that are not yet past TTL or have no createdAt', () => {
    expect(isEligibleForOnlineTopUpExpiry({ ...eligible, createdAt: RECENT }, NOW, TTL)).toBe(
      false,
    )
    expect(isEligibleForOnlineTopUpExpiry({ ...eligible, createdAt: BOUNDARY }, NOW, TTL)).toBe(
      false,
    )
    expect(isEligibleForOnlineTopUpExpiry({ ...eligible, createdAt: null }, NOW, TTL)).toBe(false)
  })

  it('refuses every non-Pending or non-topup row even when past TTL', () => {
    for (const state of ['Failed', 'Rejected', 'Released', 'Completed']) {
      expect(isEligibleForOnlineTopUpExpiry({ ...eligible, state }, NOW, TTL)).toBe(false)
    }
    expect(isEligibleForOnlineTopUpExpiry({ ...eligible, type: 'payment' }, NOW, TTL)).toBe(
      false,
    )
  })
})

describe('parseOnlineTopUpPendingTtlMs', () => {
  it('returns the default when unset or blank', () => {
    expect(parseOnlineTopUpPendingTtlMs(undefined)).toBe(DEFAULT_ONLINE_TOPUP_PENDING_TTL_MS)
    expect(parseOnlineTopUpPendingTtlMs('')).toBe(DEFAULT_ONLINE_TOPUP_PENDING_TTL_MS)
    expect(parseOnlineTopUpPendingTtlMs('  ')).toBe(DEFAULT_ONLINE_TOPUP_PENDING_TTL_MS)
  })

  it('accepts a positive millisecond integer of at least one second', () => {
    expect(parseOnlineTopUpPendingTtlMs('15000')).toBe(15_000)
  })

  it('falls back when the value is invalid or shorter than one second', () => {
    expect(parseOnlineTopUpPendingTtlMs('nope')).toBe(DEFAULT_ONLINE_TOPUP_PENDING_TTL_MS)
    expect(parseOnlineTopUpPendingTtlMs('0')).toBe(DEFAULT_ONLINE_TOPUP_PENDING_TTL_MS)
    expect(parseOnlineTopUpPendingTtlMs('999')).toBe(DEFAULT_ONLINE_TOPUP_PENDING_TTL_MS)
    expect(parseOnlineTopUpPendingTtlMs('-5000')).toBe(DEFAULT_ONLINE_TOPUP_PENDING_TTL_MS)
  })
})
