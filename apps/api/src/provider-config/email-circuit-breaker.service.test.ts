import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  EmailCircuitBreakerService,
  DEFAULT_EMAIL_BREAKER_CONFIG,
  type EmailBreakerState,
  type Clock,
  type EmailBreakerConfig,
} from './email-circuit-breaker.service'

/**
 * Circuit breaker service tests (E-05, T-05.06.06).
 *
 * Exercises the state machine on a deterministic fake clock + in-memory
 * `email_provider_configs` row so time-based transitions (failure window,
 * cooldown, half-open probe) are exact and fast:
 *
 *   CLOSED --5 failures in 5min--> OPEN (degraded) --60s cooldown--> HALF_OPEN
 *   HALF_OPEN --probe success--> CLOSED | --probe failure--> OPEN again
 *
 * Also asserts the persisted `UPDATE` writes the expected breaker columns so
 * the send path and the /metrics collector see the same state.
 */

/** Fake clock whose time is advanced explicitly by the test. */
class FakeClock implements Clock {
  private t = Date.UTC(2026, 0, 1, 0, 0, 0)
  now(): Date {
    return new Date(this.t)
  }
  advance(ms: number): void {
    this.t += ms
  }
}

interface BreakerRow {
  degraded: boolean
  degraded_reason: string | null
  consecutive_failures: number
  window_failures: number
  window_started_at: Date | null
  last_failure_at: Date | null
  opened_at: Date | null
  cooldown_until: Date | null
}

function buildHarness(config?: EmailBreakerConfig) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = new Map<string, BreakerRow>()
  const updates: string[] = []

  const pool = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> {
      updates.push(text)
      const lower = text.toLowerCase()
      if (lower.includes('from email_provider_configs') && lower.includes('where id =')) {
        const r = rows.get(String(params![0]))
        if (!r) return { rows: [] }
        return {
          rows: [
            {
              degraded: r.degraded,
              degradedReason: r.degraded_reason,
              consecutiveFailures: r.consecutive_failures,
              windowFailures: r.window_failures,
              windowStartedAt: r.window_started_at,
              lastFailureAt: r.last_failure_at,
              openedAt: r.opened_at,
              cooldownUntil: r.cooldown_until,
            },
          ],
        }
      }
      if (lower.includes('update email_provider_configs')) {
        const id = String(params![0])
        rows.set(id, {
          degraded: Boolean(params![1]),
          degraded_reason: (params![2] as string | null) ?? null,
          consecutive_failures: Number(params![3] ?? 0),
          window_failures: Number(params![4] ?? 0),
          window_started_at: (params![5] as Date | null) ?? null,
          last_failure_at: (params![6] as Date | null) ?? null,
          opened_at: (params![7] as Date | null) ?? null,
          cooldown_until: (params![8] as Date | null) ?? null,
        })
        return { rows: [], rowCount: 1 }
      }
      return { rows: [] }
    },
  }

  const clock = new FakeClock()
  const service = new EmailCircuitBreakerService(
    pool as never,
    config ?? DEFAULT_EMAIL_BREAKER_CONFIG,
    clock,
  )
  return { service, pool, clock, rows, updates }
}

const PROVIDER = '0194f000-0000-7000-8000-000000000001'

describe('EmailCircuitBreakerService (T-05.06.06)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('allows sends while healthy (closed)', async () => {
    const { service } = buildHarness()
    const d = await service.decision(PROVIDER)
    expect(d.allow).toBe(true)
    if (d.allow) expect(d.kind).toBe('closed')
  })

  it('accumulates failures and trips when the 5-in-5min threshold is met', async () => {
    const { service, clock, rows } = buildHarness()

    for (let i = 1; i <= 4; i++) {
      clock.advance(30_000)
      const state = await service.recordOutcome(PROVIDER, { ok: false, cause: `fail ${i}` })
      expect(state.degraded).toBe(false)
      expect(state.windowFailures).toBe(i)
      expect(state.consecutiveFailures).toBe(i)
    }

    // 5th consecutive failure within the 5-minute window trips the breaker.
    clock.advance(30_000)
    const tripped = await service.recordOutcome(PROVIDER, { ok: false, cause: 'fail 5' })
    expect(tripped.degraded).toBe(true)
    expect(tripped.degradedReason).toBe('fail 5')
    expect(tripped.windowFailures).toBe(5)
    expect(tripped.cooldownUntil).not.toBeNull()

    const row = rows.get(PROVIDER)
    expect(row?.degraded).toBe(true)
    expect(row?.opened_at).not.toBeNull()

    // Send path is now refused until the cooldown passes.
    const d = await service.decision(PROVIDER)
    expect(d.allow).toBe(false)
    if (!d.allow) {
      expect(d.kind).toBe('open')
      expect(d.degradedReason).toBe('fail 5')
    }
  })

  it('expires the failure window: spaced-out failures never trip', async () => {
    const { service, clock } = buildHarness()

    for (let i = 1; i <= 4; i++) {
      clock.advance(6 * 60_000) // each failure >5min apart resets the window
      const state = await service.recordOutcome(PROVIDER, { ok: false, cause: `spread ${i}` })
      expect(state.windowFailures).toBe(1) // window restarted each time
      expect(state.degraded).toBe(false)
    }
    clock.advance(6 * 60_000)
    const state = await service.recordOutcome(PROVIDER, { ok: false, cause: 'spread 5' })
    expect(state.windowFailures).toBe(1)
    expect(state.degraded).toBe(false)
  })

  it('a success resets the failure run before it trips', async () => {
    const { service, clock } = buildHarness()
    for (let i = 1; i <= 4; i++) {
      clock.advance(10_000)
      await service.recordOutcome(PROVIDER, { ok: false })
    }
    await service.recordOutcome(PROVIDER, { ok: true })
    const state = await service.recordOutcome(PROVIDER, { ok: false })
    expect(state.consecutiveFailures).toBe(1)
    expect(state.windowFailures).toBe(1)
    expect(state.degraded).toBe(false)
  })

  it('half-open probe: after cooldown one send is allowed, success resets', async () => {
    const { service, clock } = buildHarness()
    for (let i = 0; i < 5; i++) {
      clock.advance(10_000)
      await service.recordOutcome(PROVIDER, { ok: false })
    }

    // Still open inside the 60s cooldown.
    clock.advance(30_000)
    const blocked = await service.decision(PROVIDER)
    expect(blocked.allow).toBe(false)

    // Cooldown elapsed → half-open probe allowed.
    clock.advance(31_000)
    const probe = await service.decision(PROVIDER)
    expect(probe.allow).toBe(true)
    if (probe.allow) expect(probe.kind).toBe('half_open')

    // Probe succeeds → breaker reset to healthy.
    const after = await service.recordOutcome(PROVIDER, { ok: true, isProbe: true })
    expect(after.degraded).toBe(false)
    expect(after.consecutiveFailures).toBe(0)
    const d = await service.decision(PROVIDER)
    expect(d.allow).toBe(true)
  })

  it('half-open probe failure keeps the breaker open and restarts cooldown', async () => {
    const { service, clock } = buildHarness()
    for (let i = 0; i < 5; i++) {
      clock.advance(10_000)
      await service.recordOutcome(PROVIDER, { ok: false })
    }

    clock.advance(61_000)
    const probe = await service.decision(PROVIDER)
    expect(probe.allow).toBe(true)

    const after = await service.recordOutcome(PROVIDER, { ok: false, isProbe: true })
    expect(after.degraded).toBe(true)

    // Cooldown restarted → immediately refused again.
    const d = await service.decision(PROVIDER)
    expect(d.allow).toBe(false)
    if (!d.allow) expect(d.kind).toBe('open')
  })

  it('persists updates through the pool (send path and metrics see same state)', async () => {
    const { service, clock, updates } = buildHarness()
    for (let i = 0; i < 5; i++) {
      clock.advance(10_000)
      await service.recordOutcome(PROVIDER, { ok: false })
    }
    const updateSql = updates.find((u) => u.toLowerCase().includes('update email_provider_configs'))
    expect(updateSql).toBeDefined()
    expect(updateSql).toContain('degraded')
    expect(updateSql).toContain('cooldown_until')
    expect(updateSql).toContain('opened_at')
  })

  it('reads a neutral healthy state for an unknown provider', async () => {
    const { service } = buildHarness()
    const state: EmailBreakerState = await service.readState('no-such-provider')
    expect(state.degraded).toBe(false)
    expect(state.consecutiveFailures).toBe(0)
  })
})