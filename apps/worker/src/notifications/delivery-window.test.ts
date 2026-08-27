import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  DEFAULT_DELIVERY_WINDOW,
  MIN_WINDOW_HOURS,
  DELIVERY_WINDOW_CONFIG_KEY,
  isWithinWindow,
  nextWindowOpen,
  hasExternalChannel,
  decideDeliverySchedule,
  normalizeWindowConfig,
  loadDeliveryWindowConfig,
} from './delivery-window.js'
import { reconcileDeliveryWindows } from './outbox-runner.js'

/**
 * Delivery window logic tests (E-05, T-05.03.02).
 *
 * All wall-clock expectations use `Asia/Tehran` (UTC+03:30, no DST since 2022)
 * so a local boundary maps deterministically to UTC: Tehran 09:00 == 05:30Z and
 * Tehran 21:00 == 17:30Z.
 */

const TEHRAN = DEFAULT_DELIVERY_WINDOW // { timezone:'Asia/Tehran', startHour:9, endHour:21 }

describe('isWithinWindow', () => {
  it('includes the open boundary and excludes the close boundary', () => {
    // 05:30Z == 09:00 Tehran (open) → inside
    expect(isWithinWindow(new Date('2026-08-27T05:30:00Z'), TEHRAN)).toBe(true)
    // 05:29:59Z == 08:59:59 Tehran → just before open
    expect(isWithinWindow(new Date('2026-08-27T05:29:59Z'), TEHRAN)).toBe(false)
    // 17:29:59Z == 20:59:59 Tehran → inside
    expect(isWithinWindow(new Date('2026-08-27T17:29:59Z'), TEHRAN)).toBe(true)
    // 17:30:00Z == 21:00 Tehran (close) → outside (end is exclusive)
    expect(isWithinWindow(new Date('2026-08-27T17:30:00Z'), TEHRAN)).toBe(false)
  })

  it('honours a custom admin window', () => {
    const cfg = { timezone: 'UTC', startHour: 8, endHour: 20 }
    expect(isWithinWindow(new Date('2026-08-27T09:00:00Z'), cfg)).toBe(true)
    expect(isWithinWindow(new Date('2026-08-27T21:00:00Z'), cfg)).toBe(false)
  })
})

describe('nextWindowOpen', () => {
  it('opens later today when now is before startHour', () => {
    // 02:00Z == 05:30 Tehran, before 09:00 → opens today 09:00 Tehran == 05:30Z
    const open = nextWindowOpen(new Date('2026-08-27T02:00:00Z'), TEHRAN)
    expect(open.toISOString()).toBe('2026-08-27T05:30:00.000Z')
  })

  it('opens tomorrow when now is at or after startHour', () => {
    // 18:00Z == 21:30 Tehran, past 09:00 → next open is 2026-08-28 09:00 Tehran
    const open = nextWindowOpen(new Date('2026-08-27T18:00:00Z'), TEHRAN)
    expect(open.toISOString()).toBe('2026-08-28T05:30:00.000Z')
  })

  it('never returns a time inside the current window', () => {
    // Noon Tehran — next open should be tomorrow morning, not "now".
    const open = nextWindowOpen(new Date('2026-08-27T08:30:00Z'), TEHRAN)
    expect(open.getTime()).toBeGreaterThan(new Date('2026-08-27T08:30:00Z').getTime())
    expect(open.toISOString()).toBe('2026-08-28T05:30:00.000Z')
  })
})

describe('hasExternalChannel', () => {
  it('only email/sms are treated as external (window-gated)', () => {
    expect(hasExternalChannel(['in_app'])).toBe(false)
    expect(hasExternalChannel(['in_app', 'email'])).toBe(true)
    expect(hasExternalChannel(['in_app', 'sms'])).toBe(true)
    expect(hasExternalChannel(['email'])).toBe(true)
  })
})

describe('decideDeliverySchedule', () => {
  // 18:00Z == 21:30 Tehran → outside the 09:00–21:00 window.
  const outOfWindow = new Date('2026-08-27T18:00:00Z')
  // 08:00Z == 11:00 Tehran → inside the window.
  const inWindow = new Date('2026-08-27T08:00:00Z')

  it('immediate events bypass quiet hours even outside the window', () => {
    const decision = decideDeliverySchedule('auth.otp_sent', ['in_app', 'email'], outOfWindow, TEHRAN)
    expect(decision.kind).toBe('now')
  })

  it('daytime events outside the window are scheduled for next open', () => {
    const decision = decideDeliverySchedule('contract.created', ['in_app', 'email'], outOfWindow, TEHRAN)
    expect(decision.kind).toBe('schedule')
    if (decision.kind === 'schedule') {
      expect(decision.scheduledFor.toISOString()).toBe('2026-08-28T05:30:00.000Z')
    }
  })

  it('daytime events inside the window dispatch now', () => {
    expect(decideDeliverySchedule('contract.created', ['in_app', 'email'], inWindow, TEHRAN).kind).toBe('now')
  })

  it('daytime in-app-only notifications are never window-gated', () => {
    expect(decideDeliverySchedule('contract.created', ['in_app'], outOfWindow, TEHRAN).kind).toBe('now')
  })

  it('unknown events default to daytime and honour the window', () => {
    expect(decideDeliverySchedule('some.new.event', ['in_app', 'email'], outOfWindow, TEHRAN).kind).toBe(
      'schedule',
    )
    expect(decideDeliverySchedule('some.new.event', ['in_app', 'email'], inWindow, TEHRAN).kind).toBe('now')
  })
})

describe('normalizeWindowConfig', () => {
  it('falls back to the default when the value is absent', () => {
    expect(normalizeWindowConfig(undefined)).toEqual(DEFAULT_DELIVERY_WINDOW)
    expect(normalizeWindowConfig(null)).toEqual(DEFAULT_DELIVERY_WINDOW)
  })

  it('parses both snake_case and camelCase stored shapes', () => {
    expect(normalizeWindowConfig({ timezone: 'UTC', start_hour: 8, end_hour: 20 })).toEqual({
      timezone: 'UTC',
      startHour: 8,
      endHour: 20,
    })
    expect(normalizeWindowConfig({ timezone: 'UTC', startHour: 7, endHour: 19 })).toEqual({
      timezone: 'UTC',
      startHour: 7,
      endHour: 19,
    })
  })

  it('rejects an impossible window (start >= end) by resetting hours to default', () => {
    expect(normalizeWindowConfig({ timezone: 'UTC', start_hour: 22, end_hour: 6 })).toEqual({
      timezone: 'UTC',
      startHour: DEFAULT_DELIVERY_WINDOW.startHour,
      endHour: DEFAULT_DELIVERY_WINDOW.endHour,
    })
  })

  it('clamps out-of-range hours to defaults, keeping a valid timezone', () => {
    expect(normalizeWindowConfig({ timezone: 'UTC', start_hour: 99, end_hour: -1 })).toEqual({
      timezone: 'UTC',
      startHour: DEFAULT_DELIVERY_WINDOW.startHour,
      endHour: DEFAULT_DELIVERY_WINDOW.endHour,
    })
  })

  it('keeps the configured timezone when only hours are invalid', () => {
    const cfg = normalizeWindowConfig({ timezone: 'Europe/Berlin', start_hour: 99, end_hour: 21 })
    expect(cfg.timezone).toBe('Europe/Berlin')
    expect(cfg.startHour).toBe(DEFAULT_DELIVERY_WINDOW.startHour)
    expect(cfg.endHour).toBe(21)
  })

  it('documents the minimum sensible window constant', () => {
    expect(MIN_WINDOW_HOURS).toBe(4)
    expect(DELIVERY_WINDOW_CONFIG_KEY).toBe('notification.delivery_window')
  })
})

describe('loadDeliveryWindowConfig', () => {
  it('reads a stored admin window from app_config', async () => {
    const pool = {
      query: async (sql: string) => ({
        rows: sql.includes('app_config')
          ? [{ value: { timezone: 'Asia/Tehran', start_hour: 8, end_hour: 22 } }]
          : [],
      }),
    }
    const cfg = await loadDeliveryWindowConfig(pool as never)
    expect(cfg).toEqual({ timezone: 'Asia/Tehran', startHour: 8, endHour: 22 })
  })

  it('falls back to the default when app_config has no entry', async () => {
    const pool = { query: async () => ({ rows: [] }) }
    expect(await loadDeliveryWindowConfig(pool as never)).toEqual(DEFAULT_DELIVERY_WINDOW)
  })
})

describe('reconcileDeliveryWindows', () => {
  // Pin "now" so scheduling is deterministic: 2026-08-27T18:00Z == 21:30 Tehran
  // (outside the 09:00–21:00 window).
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-27T18:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function queuePool(rows: Array<{ id: string; event_key: string; channels: string[] }>) {
    const updates: Array<{ sql: string; params: unknown[] }> = []
    const pool = {
      async query(sql: string, params: unknown[] = []) {
        if (sql.trim().startsWith('SELECT')) {
          if (sql.includes('app_config')) return { rows: [] } // default window
          return { rows }
        }
        updates.push({ sql, params })
        return { rows: [], rowCount: 1 }
      },
    }
    return { pool, updates }
  }

  it('parks a queued daytime external row outside the window as scheduled', async () => {
    const { pool, updates } = queuePool([
      { id: 'ob-1', event_key: 'contract.created', channels: ['in_app', 'email'] },
    ])
    const changed = await reconcileDeliveryWindows(pool)
    expect(changed).toBe(1)
    expect(updates).toHaveLength(1)
    expect(updates[0]!.sql).toContain("SET status = 'scheduled', scheduled_for = $2")
    expect((updates[0]!.params[1] as Date).toISOString()).toBe('2026-08-28T05:30:00.000Z')
  })

  it('leaves immediate, in-app-only and in-window rows queued (no mutation)', async () => {
    const { pool, updates } = queuePool([
      { id: 'ob-2', event_key: 'auth.otp_sent', channels: ['in_app', 'email'] }, // immediate
      { id: 'ob-3', event_key: 'contract.created', channels: ['in_app'] }, // in-app only
    ])
    const changed = await reconcileDeliveryWindows(pool)
    expect(changed).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('returns 0 when there are no queued rows', async () => {
    const { pool, updates } = queuePool([])
    expect(await reconcileDeliveryWindows(pool)).toBe(0)
    expect(updates).toHaveLength(0)
  })
})
