import { describe, it, expect } from 'vitest'
import {
  DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG,
  WALLET_TOP_UP_LIMIT_CONFIG_KEY,
  WALLET_TOP_UP_LIMIT_LOCK_NAMESPACE,
  validateWalletTopUpLimitConfig,
  toWalletTopUpLimitConfig,
  toOnlineTopUpLimitSnapshot,
  resolveOnlineTopUpLimitSnapshot,
  readExpectedWalletTopUpLimitVersion,
  onlineTopUpLimitVersionConflictMessage,
  ONLINE_TOP_UP_LIMIT_UNAVAILABLE_MESSAGE,
  onlineTopUpLimitExceededMessage,
  readOnlineTopUpLimitFromErrorBody,
  isValidWalletTopUpLimit,
  isOnlineWalletTopUpAllowed,
  parseOnlineTopUpAmountIrR,
} from './wallet-topup-config.js'

// ─── Contract constants ──────────────────────────────────────────────

describe('wallet-topup-config contract constants (T-09.10.01)', () => {
  it('defaults the per-transaction online top-up limit to 2,000,000,000 IRR', () => {
    expect(DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG).toEqual({ limitIrR: 2_000_000_000 })
  })

  it('stores under the finance.wallet_top_up_limit app_config key', () => {
    expect(WALLET_TOP_UP_LIMIT_CONFIG_KEY).toBe('finance.wallet_top_up_limit')
  })

  it('uses a stable advisory-lock namespace so submission and admin writes share a lock', () => {
    expect(WALLET_TOP_UP_LIMIT_LOCK_NAMESPACE).toBe('barghsa.finance.wallet_top_up_limit')
  })
})

// ─── Tests — validateWalletTopUpLimitConfig ──────────────────────────

describe('validateWalletTopUpLimitConfig (T-09.10.01)', () => {
  it('accepts a positive integer limit', () => {
    expect(validateWalletTopUpLimitConfig({ limit_irr: 1_000_000_000 })).toEqual({
      ok: true,
      issues: [],
    })
  })

  it('accepts the default value', () => {
    expect(validateWalletTopUpLimitConfig({ limit_irr: 2_000_000_000 })).toEqual({
      ok: true,
      issues: [],
    })
  })

  it('accepts zero (blocks all online top-ups)', () => {
    expect(validateWalletTopUpLimitConfig({ limit_irr: 0 })).toEqual({ ok: true, issues: [] })
  })

  it('accepts the camelCase alias', () => {
    expect(validateWalletTopUpLimitConfig({ limitIrR: 500_000_000 })).toEqual({
      ok: true,
      issues: [],
    })
  })

  it('rejects a missing limit', () => {
    const result = validateWalletTopUpLimitConfig({})
    expect(result.ok).toBe(false)
    expect(result.issues[0]).toContain('required')
  })

  it('rejects a non-object input', () => {
    expect(validateWalletTopUpLimitConfig(null).ok).toBe(false)
    expect(validateWalletTopUpLimitConfig(42).ok).toBe(false)
  })

  it('rejects a negative limit', () => {
    const result = validateWalletTopUpLimitConfig({ limit_irr: -1 })
    expect(result.ok).toBe(false)
    expect(result.issues[0]).toContain('between 0')
  })

  it('rejects a fractional limit', () => {
    expect(validateWalletTopUpLimitConfig({ limit_irr: 1.5 }).ok).toBe(false)
  })

  it('rejects a non-numeric limit', () => {
    expect(validateWalletTopUpLimitConfig({ limit_irr: 'abc' }).ok).toBe(false)
  })

  it('rejects coercible non-number payloads instead of silently accepting them', () => {
    // Number(true) === 1, Number([]) === 0, Number(['5']) === 5,
    // Number('2000000000') === 2000000000 — none of these may pass, or an
    // attacker could tune the ceiling with a stringified amount.
    expect(validateWalletTopUpLimitConfig({ limit_irr: true }).ok).toBe(false)
    expect(validateWalletTopUpLimitConfig({ limit_irr: false }).ok).toBe(false)
    expect(validateWalletTopUpLimitConfig({ limit_irr: [] }).ok).toBe(false)
    expect(validateWalletTopUpLimitConfig({ limit_irr: ['5'] }).ok).toBe(false)
    expect(validateWalletTopUpLimitConfig({ limit_irr: '2000000000' }).ok).toBe(false)
    expect(validateWalletTopUpLimitConfig({ limit_irr: {} }).ok).toBe(false)
  })

  it('rejects a limit above Number.MAX_SAFE_INTEGER', () => {
    expect(validateWalletTopUpLimitConfig({ limit_irr: Number.MAX_SAFE_INTEGER + 1 }).ok).toBe(
      false,
    )
  })
})

// ─── Tests — toWalletTopUpLimitConfig ────────────────────────────────

describe('toWalletTopUpLimitConfig (T-09.10.01)', () => {
  it('maps a snake_case input to the camelCase config', () => {
    expect(toWalletTopUpLimitConfig({ limit_irr: 1_500_000_000 })).toEqual({
      limitIrR: 1_500_000_000,
    })
  })

  it('falls back to the default on malformed input', () => {
    expect(toWalletTopUpLimitConfig(null)).toEqual(DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG)
    expect(toWalletTopUpLimitConfig({ limit_irr: 'nope' })).toEqual(
      DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG,
    )
    expect(toWalletTopUpLimitConfig({ limit_irr: -5 })).toEqual(
      DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG,
    )
    expect(toWalletTopUpLimitConfig({ limit_irr: true })).toEqual(
      DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG,
    )
    expect(toWalletTopUpLimitConfig({ limit_irr: ['2000000000'] })).toEqual(
      DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG,
    )
  })
})

// ─── Tests — isValidWalletTopUpLimit ─────────────────────────────────

describe('isValidWalletTopUpLimit (T-09.10.01)', () => {
  it('accepts integers within the safe range including 0', () => {
    expect(isValidWalletTopUpLimit(0)).toBe(true)
    expect(isValidWalletTopUpLimit(2_000_000_000)).toBe(true)
    expect(isValidWalletTopUpLimit(Number.MAX_SAFE_INTEGER)).toBe(true)
  })

  it('rejects out-of-range, fractional, and non-number values', () => {
    expect(isValidWalletTopUpLimit(-1)).toBe(false)
    expect(isValidWalletTopUpLimit(1.5)).toBe(false)
    expect(isValidWalletTopUpLimit(Number.MAX_SAFE_INTEGER + 1)).toBe(false)
    expect(isValidWalletTopUpLimit('2000000000')).toBe(false)
    expect(isValidWalletTopUpLimit(null)).toBe(false)
    expect(isValidWalletTopUpLimit(undefined)).toBe(false)
  })
})

// ─── Tests — isOnlineWalletTopUpAllowed ──────────────────────────────

describe('isOnlineWalletTopUpAllowed (T-09.10.01)', () => {
  it('allows amounts at or below the limit', () => {
    expect(isOnlineWalletTopUpAllowed({ limitIrR: 2_000_000_000 }, 2_000_000_000)).toBe(true)
    expect(isOnlineWalletTopUpAllowed({ limitIrR: 2_000_000_000 }, 1_000_000_000)).toBe(true)
    expect(isOnlineWalletTopUpAllowed({ limitIrR: 2_000_000_000 }, 1n)).toBe(true)
    expect(isOnlineWalletTopUpAllowed({ limitIrR: 2_000_000_000 }, 2_000_000_000n)).toBe(true)
  })

  it('rejects amounts above the limit', () => {
    expect(isOnlineWalletTopUpAllowed({ limitIrR: 2_000_000_000 }, 2_000_000_001)).toBe(false)
    expect(isOnlineWalletTopUpAllowed({ limitIrR: 500_000_000 }, 500_000_001n)).toBe(false)
  })

  it('blocks everything when the configured limit is 0 (kill switch)', () => {
    expect(isOnlineWalletTopUpAllowed({ limitIrR: 0 }, 1)).toBe(false)
    expect(isOnlineWalletTopUpAllowed({ limitIrR: 0 }, 1n)).toBe(false)
  })

  it('fails closed on non-positive amounts', () => {
    expect(isOnlineWalletTopUpAllowed({ limitIrR: 2_000_000_000 }, 0)).toBe(false)
    expect(isOnlineWalletTopUpAllowed({ limitIrR: 2_000_000_000 }, 0n)).toBe(false)
    expect(isOnlineWalletTopUpAllowed({ limitIrR: 2_000_000_000 }, -100)).toBe(false)
    expect(isOnlineWalletTopUpAllowed({ limitIrR: 2_000_000_000 }, -100n)).toBe(false)
  })

  it('fails closed on corrupt config or non-integer amounts', () => {
    expect(isOnlineWalletTopUpAllowed({ limitIrR: -1 }, 100)).toBe(false)
    expect(isOnlineWalletTopUpAllowed({ limitIrR: 2.5 }, 100)).toBe(false)
    expect(isOnlineWalletTopUpAllowed({ limitIrR: 2_000_000_000 }, 100.5)).toBe(false)
    expect(isOnlineWalletTopUpAllowed({ limitIrR: 2_000_000_000 }, '100' as never)).toBe(false)
  })
})

describe('resolveOnlineTopUpLimitSnapshot (T-04.2.02.06)', () => {
  it('serves the default 2e9 IRR ceiling at version 0 when nothing is persisted', () => {
    expect(resolveOnlineTopUpLimitSnapshot(null)).toEqual({
      ok: true,
      snapshot: { onlineTopUpLimit: 2_000_000_000, configVersion: 0 },
    })
    expect(resolveOnlineTopUpLimitSnapshot(undefined, 9)).toEqual({
      ok: true,
      snapshot: { onlineTopUpLimit: 2_000_000_000, configVersion: 0 },
    })
  })

  it('returns the persisted integer limit and its config version', () => {
    expect(resolveOnlineTopUpLimitSnapshot({ limit_irr: 50_000 }, 4)).toEqual({
      ok: true,
      snapshot: { onlineTopUpLimit: 50_000, configVersion: 4 },
    })
    expect(resolveOnlineTopUpLimitSnapshot({ limitIrR: 0 }, 2)).toEqual({
      ok: true,
      snapshot: { onlineTopUpLimit: 0, configVersion: 2 },
    })
  })

  it('fails closed on a present but corrupt persisted value', () => {
    expect(resolveOnlineTopUpLimitSnapshot({ limit_irr: '50000' }, 3)).toEqual({ ok: false })
    expect(resolveOnlineTopUpLimitSnapshot({ limit_irr: -1 }, 1)).toEqual({ ok: false })
    expect(resolveOnlineTopUpLimitSnapshot({ limit_irr: 1.5 }, 1)).toEqual({ ok: false })
    expect(resolveOnlineTopUpLimitSnapshot({}, 1)).toEqual({ ok: false })
    expect(resolveOnlineTopUpLimitSnapshot('50000', 1)).toEqual({ ok: false })
  })
})

describe('readExpectedWalletTopUpLimitVersion (T-04.2.02.06)', () => {
  it('treats a missing token as an unconstrained write', () => {
    expect(readExpectedWalletTopUpLimitVersion({ limit_irr: 1 })).toEqual({
      ok: true,
      expectedVersion: undefined,
    })
  })

  it('accepts a non-negative integer expected_version or expectedVersion', () => {
    expect(readExpectedWalletTopUpLimitVersion({ expected_version: 0 })).toEqual({
      ok: true,
      expectedVersion: 0,
    })
    expect(readExpectedWalletTopUpLimitVersion({ expectedVersion: 4 })).toEqual({
      ok: true,
      expectedVersion: 4,
    })
  })

  it('rejects a present but invalid expected version', () => {
    expect(readExpectedWalletTopUpLimitVersion({ expected_version: -1 })).toEqual({ ok: false })
    expect(readExpectedWalletTopUpLimitVersion({ expected_version: 1.5 })).toEqual({ ok: false })
    expect(readExpectedWalletTopUpLimitVersion({ expected_version: '1' })).toEqual({ ok: false })
  })
})

describe('onlineTopUpLimitVersionConflictMessage (T-04.2.02.06)', () => {
  it('names the stale expected version and the locked current version', () => {
    expect(onlineTopUpLimitVersionConflictMessage(2, 5)).toBe(
      'Online top-up limit config version 2 is stale; current version is 5',
    )
    expect(ONLINE_TOP_UP_LIMIT_UNAVAILABLE_MESSAGE).toContain('unavailable')
  })
})

describe('toOnlineTopUpLimitSnapshot (T-04.2.02.06)', () => {
  it('records onlineTopUpLimit and a non-negative integer config version', () => {
    expect(toOnlineTopUpLimitSnapshot({ limitIrR: 50_000 }, 4)).toEqual({
      onlineTopUpLimit: 50_000,
      configVersion: 4,
    })
  })

  it('treats a missing or invalid version as 0 (unpersisted default)', () => {
    expect(toOnlineTopUpLimitSnapshot(DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG, null)).toEqual({
      onlineTopUpLimit: 2_000_000_000,
      configVersion: 0,
    })
    expect(toOnlineTopUpLimitSnapshot({ limitIrR: 1 }, undefined).configVersion).toBe(0)
    expect(toOnlineTopUpLimitSnapshot({ limitIrR: 1 }, -1).configVersion).toBe(0)
    expect(toOnlineTopUpLimitSnapshot({ limitIrR: 1 }, 1.5).configVersion).toBe(0)
  })
})

describe('online top-up limit exceeded 400 body (T-04.2.02.06)', () => {
  it('names the amount and the versioned ceiling that was enforced', () => {
    expect(
      onlineTopUpLimitExceededMessage(100_001n, { onlineTopUpLimit: 100_000, configVersion: 4 }),
    ).toBe(
      'Online top-up amount 100001 IRR exceeds the configured per-transaction limit of 100000 IRR',
    )
  })

  it('reads a valid snapshot from a 400 body so the client can retry with a reduced amount', () => {
    expect(
      readOnlineTopUpLimitFromErrorBody({
        message: 'Online top-up amount 100001 IRR exceeds the configured per-transaction limit of 50000 IRR',
        onlineTopUpLimit: 50_000,
        configVersion: 2,
      }),
    ).toEqual({ onlineTopUpLimit: 50_000, configVersion: 2 })
    expect(
      readOnlineTopUpLimitFromErrorBody({
        error: {
          code: 'VALIDATION:INPUT:INVALID',
          message: 'Online top-up amount 100001 IRR exceeds the configured per-transaction limit of 50000 IRR',
          onlineTopUpLimit: 50_000,
          configVersion: 2,
        },
      }),
    ).toEqual({ onlineTopUpLimit: 50_000, configVersion: 2 })
  })

  it('fails closed on a missing or invalid ceiling in the error body', () => {
    expect(readOnlineTopUpLimitFromErrorBody(null)).toBeNull()
    expect(readOnlineTopUpLimitFromErrorBody({ message: 'exceeds' })).toBeNull()
    expect(
      readOnlineTopUpLimitFromErrorBody({ onlineTopUpLimit: -1, configVersion: 1 }),
    ).toBeNull()
    expect(
      readOnlineTopUpLimitFromErrorBody({ onlineTopUpLimit: '50000', configVersion: 1 }),
    ).toBeNull()
  })
})

// ─── Tests — parseOnlineTopUpAmountIrR (T-04.2.02.01) ────────────────

describe('parseOnlineTopUpAmountIrR (T-04.2.02.01)', () => {
  it('accepts a positive safe integer, bigint, or digit string', () => {
    expect(parseOnlineTopUpAmountIrR(100_000)).toBe(100_000n)
    expect(parseOnlineTopUpAmountIrR(2_000_000_000n)).toBe(2_000_000_000n)
    expect(parseOnlineTopUpAmountIrR('1500000')).toBe(1_500_000n)
    expect(parseOnlineTopUpAmountIrR(' 42 ')).toBe(42n)
  })

  it('rejects zero, negative, fractional, padded, and non-numeric values', () => {
    expect(parseOnlineTopUpAmountIrR(0)).toBeNull()
    expect(parseOnlineTopUpAmountIrR(0n)).toBeNull()
    expect(parseOnlineTopUpAmountIrR(-1)).toBeNull()
    expect(parseOnlineTopUpAmountIrR(-1n)).toBeNull()
    expect(parseOnlineTopUpAmountIrR(1.5)).toBeNull()
    expect(parseOnlineTopUpAmountIrR('01')).toBeNull()
    expect(parseOnlineTopUpAmountIrR('0')).toBeNull()
    expect(parseOnlineTopUpAmountIrR('1e3')).toBeNull()
    expect(parseOnlineTopUpAmountIrR('100.0')).toBeNull()
    expect(parseOnlineTopUpAmountIrR('abc')).toBeNull()
    expect(parseOnlineTopUpAmountIrR(true)).toBeNull()
    expect(parseOnlineTopUpAmountIrR(null)).toBeNull()
    expect(parseOnlineTopUpAmountIrR(undefined)).toBeNull()
    expect(parseOnlineTopUpAmountIrR({})).toBeNull()
  })

  it('rejects amounts that cannot fit in signed int8', () => {
    expect(parseOnlineTopUpAmountIrR('9223372036854775808')).toBeNull()
    expect(parseOnlineTopUpAmountIrR(9_223_372_036_854_775_807n + 1n)).toBeNull()
  })
})
