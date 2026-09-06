import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
} from './delivery-window.js';
import { reconcileDeliveryWindows } from './outbox-runner.js';

/**
 * Delivery window logic tests (E-05, T-05.03.02).
 *
 * All wall-clock expectations use `Asia/Tehran` (UTC+03:30, no DST since 2022)
 * so a local boundary maps deterministically to UTC: Tehran 09:00 == 05:30Z and
 * Tehran 21:00 == 17:30Z.
 */

const TEHRAN = DEFAULT_DELIVERY_WINDOW; // { timezone:'Asia/Tehran', startHour:9, endHour:21 }

describe('isWithinWindow', () => {
  it('includes the open boundary and excludes the close boundary', () => {
    // 05:30Z == 09:00 Tehran (open) → inside
    expect(isWithinWindow(new Date('2026-08-27T05:30:00Z'), TEHRAN)).toBe(true);
    // 05:29:59Z == 08:59:59 Tehran → just before open
    expect(isWithinWindow(new Date('2026-08-27T05:29:59Z'), TEHRAN)).toBe(false);
    // 17:29:59Z == 20:59:59 Tehran → inside
    expect(isWithinWindow(new Date('2026-08-27T17:29:59Z'), TEHRAN)).toBe(true);
    // 17:30:00Z == 21:00 Tehran (close) → outside (end is exclusive)
    expect(isWithinWindow(new Date('2026-08-27T17:30:00Z'), TEHRAN)).toBe(false);
  });

  it('honours a custom admin window', () => {
    const cfg = { timezone: 'UTC', startHour: 8, endHour: 20 };
    expect(isWithinWindow(new Date('2026-08-27T09:00:00Z'), cfg)).toBe(true);
    expect(isWithinWindow(new Date('2026-08-27T21:00:00Z'), cfg)).toBe(false);
  });
});

describe('nextWindowOpen', () => {
  it('opens later today when now is before startHour', () => {
    // 02:00Z == 05:30 Tehran, before 09:00 → opens today 09:00 Tehran == 05:30Z
    const open = nextWindowOpen(new Date('2026-08-27T02:00:00Z'), TEHRAN);
    expect(open.toISOString()).toBe('2026-08-27T05:30:00.000Z');
  });

  it('opens tomorrow when now is at or after startHour', () => {
    // 18:00Z == 21:30 Tehran, past 09:00 → next open is 2026-08-28 09:00 Tehran
    const open = nextWindowOpen(new Date('2026-08-27T18:00:00Z'), TEHRAN);
    expect(open.toISOString()).toBe('2026-08-28T05:30:00.000Z');
  });

  it('never returns a time inside the current window', () => {
    // Noon Tehran — next open should be tomorrow morning, not "now".
    const open = nextWindowOpen(new Date('2026-08-27T08:30:00Z'), TEHRAN);
    expect(open.getTime()).toBeGreaterThan(new Date('2026-08-27T08:30:00Z').getTime());
    expect(open.toISOString()).toBe('2026-08-28T05:30:00.000Z');
  });
});

describe('hasExternalChannel', () => {
  it('only email/sms are treated as external (window-gated)', () => {
    expect(hasExternalChannel(['in_app'])).toBe(false);
    expect(hasExternalChannel(['in_app', 'email'])).toBe(true);
    expect(hasExternalChannel(['in_app', 'sms'])).toBe(true);
    expect(hasExternalChannel(['email'])).toBe(true);
  });
});

describe('decideDeliverySchedule', () => {
  // 18:00Z == 21:30 Tehran → outside the 09:00–21:00 window.
  const outOfWindow = new Date('2026-08-27T18:00:00Z');
  // 08:00Z == 11:00 Tehran → inside the window.
  const inWindow = new Date('2026-08-27T08:00:00Z');

  it('immediate events bypass quiet hours even outside the window', () => {
    const decision = decideDeliverySchedule(
      'auth.otp_sent',
      ['in_app', 'email'],
      outOfWindow,
      TEHRAN
    );
    expect(decision.kind).toBe('now');
  });

  it('daytime events outside the window are scheduled for next open', () => {
    const decision = decideDeliverySchedule(
      'contract.created',
      ['in_app', 'email'],
      outOfWindow,
      TEHRAN
    );
    expect(decision.kind).toBe('schedule');
    if (decision.kind === 'schedule') {
      expect(decision.scheduledFor.toISOString()).toBe('2026-08-28T05:30:00.000Z');
    }
  });

  it('daytime events inside the window dispatch now', () => {
    expect(
      decideDeliverySchedule('contract.created', ['in_app', 'email'], inWindow, TEHRAN).kind
    ).toBe('now');
  });

  it('daytime in-app-only notifications are never window-gated', () => {
    expect(decideDeliverySchedule('contract.created', ['in_app'], outOfWindow, TEHRAN).kind).toBe(
      'now'
    );
  });

  it('unknown events default to daytime and honour the window', () => {
    expect(
      decideDeliverySchedule('some.new.event', ['in_app', 'email'], outOfWindow, TEHRAN).kind
    ).toBe('schedule');
    expect(
      decideDeliverySchedule('some.new.event', ['in_app', 'email'], inWindow, TEHRAN).kind
    ).toBe('now');
  });
});

describe('normalizeWindowConfig', () => {
  it('falls back to the default when the value is absent', () => {
    expect(normalizeWindowConfig(undefined)).toEqual(DEFAULT_DELIVERY_WINDOW);
    expect(normalizeWindowConfig(null)).toEqual(DEFAULT_DELIVERY_WINDOW);
  });

  it('parses both snake_case and camelCase stored shapes', () => {
    expect(normalizeWindowConfig({ timezone: 'UTC', start_hour: 8, end_hour: 20 })).toEqual({
      timezone: 'UTC',
      startHour: 8,
      endHour: 20,
    });
    expect(normalizeWindowConfig({ timezone: 'UTC', startHour: 7, endHour: 19 })).toEqual({
      timezone: 'UTC',
      startHour: 7,
      endHour: 19,
    });
  });

  it('rejects an impossible window (start >= end) by resetting hours to default', () => {
    expect(normalizeWindowConfig({ timezone: 'UTC', start_hour: 22, end_hour: 6 })).toEqual({
      timezone: 'UTC',
      startHour: DEFAULT_DELIVERY_WINDOW.startHour,
      endHour: DEFAULT_DELIVERY_WINDOW.endHour,
    });
  });

  it('clamps out-of-range hours to defaults, keeping a valid timezone', () => {
    expect(normalizeWindowConfig({ timezone: 'UTC', start_hour: 99, end_hour: -1 })).toEqual({
      timezone: 'UTC',
      startHour: DEFAULT_DELIVERY_WINDOW.startHour,
      endHour: DEFAULT_DELIVERY_WINDOW.endHour,
    });
  });

  it('keeps the configured timezone when only hours are invalid', () => {
    const cfg = normalizeWindowConfig({ timezone: 'Europe/Berlin', start_hour: 99, end_hour: 21 });
    expect(cfg.timezone).toBe('Europe/Berlin');
    expect(cfg.startHour).toBe(DEFAULT_DELIVERY_WINDOW.startHour);
    expect(cfg.endHour).toBe(21);
  });

  it('documents the minimum sensible window constant', () => {
    expect(MIN_WINDOW_HOURS).toBe(4);
    expect(DELIVERY_WINDOW_CONFIG_KEY).toBe('notification.delivery_window');
  });
});

describe('loadDeliveryWindowConfig', () => {
  it('reads a stored admin window from app_config', async () => {
    const pool = {
      query: async (sql: string) => ({
        rows: sql.includes('app_config')
          ? [{ value: { timezone: 'Asia/Tehran', start_hour: 8, end_hour: 22 } }]
          : [],
      }),
    };
    const cfg = await loadDeliveryWindowConfig(pool as never);
    expect(cfg).toEqual({ timezone: 'Asia/Tehran', startHour: 8, endHour: 22 });
  });

  it('falls back to the default when app_config has no entry', async () => {
    const pool = { query: async () => ({ rows: [] }) };
    expect(await loadDeliveryWindowConfig(pool as never)).toEqual(DEFAULT_DELIVERY_WINDOW);
  });
});

describe('reconcileDeliveryWindows', () => {
  // Pin "now" so scheduling is deterministic: 2026-08-27T18:00Z == 21:30 Tehran
  // (outside the 09:00–21:00 window).
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-27T18:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function queuePool(rows: Array<{ id: string; event_key: string; channels: string[] }>) {
    const updates: Array<{ sql: string; params: unknown[] }> = [];
    const scheduled = new Map<string, unknown>();
    const pool = {
      async query(sql: string, params: unknown[] = []) {
        if (sql.trim().startsWith('SELECT')) {
          if (sql.includes('app_config')) return { rows: [] }; // default window
          if (sql.startsWith('SELECT channel,status'))
            return {
              rows: rows.flatMap((row) =>
                row.channels.map((channel) => ({
                  channel,
                  status: 'queued',
                  run_after: scheduled.get(`${row.id}:${channel}`) ?? null,
                }))
              ),
            };
          return {
            rows: rows.map((row) => ({
              ...row,
              jobs: row.channels.map((channel) => ({ channel, status: 'queued', run_after: null })),
            })),
          };
        }
        if (sql.includes('UPDATE notification_job'))
          scheduled.set(`${params[0]}:${params[1]}`, params[2]);
        updates.push({ sql, params });
        return { rows: [], rowCount: 1 };
      },
    };
    return { pool, updates };
  }

  it('parks a queued daytime external row outside the window as scheduled', async () => {
    const { pool, updates } = queuePool([
      { id: 'ob-1', event_key: 'contract.created', channels: ['in_app', 'email'] },
    ]);
    const changed = await reconcileDeliveryWindows(pool);
    expect(changed).toBe(1);
    const jobUpdate = updates.find((update) => update.sql.includes('UPDATE notification_job'))!;
    expect(jobUpdate.params[1]).toBe('email');
    expect((jobUpdate.params[2] as Date).toISOString()).toBe('2026-08-28T05:30:00.000Z');
    expect(
      updates.find((update) => update.sql.includes('UPDATE notification_outbox'))?.params[1]
    ).toBe('queued');
  });

  it('leaves immediate, in-app-only and in-window rows queued (no mutation)', async () => {
    const { pool, updates } = queuePool([
      { id: 'ob-2', event_key: 'auth.otp_sent', channels: ['in_app', 'email'] }, // immediate
      { id: 'ob-3', event_key: 'contract.created', channels: ['in_app'] }, // in-app only
    ]);
    const changed = await reconcileDeliveryWindows(pool);
    expect(changed).toBe(0);
    expect(updates.every((update) => !update.sql.includes('UPDATE notification_job'))).toBe(true);
  });

  it('returns 0 when there are no queued rows', async () => {
    const { pool, updates } = queuePool([]);
    expect(await reconcileDeliveryWindows(pool)).toBe(0);
    expect(updates).toHaveLength(0);
  });
});

it('advances one local calendar day across a spring DST change', () => {
  expect(
    nextWindowOpen(new Date('2026-03-28T22:30:00Z'), {
      timezone: 'Europe/Berlin',
      startHour: 9,
      endHour: 21,
    }).toISOString()
  ).toBe('2026-03-29T07:00:00.000Z');
});
it('falls back safely for an invalid stored timezone', () => {
  expect(
    normalizeWindowConfig({ timezone: 'not/a-zone', start_hour: 9, end_hour: 21 }).timezone
  ).toBe(DEFAULT_DELIVERY_WINDOW.timezone);
});
it('uses the first valid local minute for a nonexistent spring boundary', () => {
  expect(
    nextWindowOpen(new Date('2026-03-28T22:30:00Z'), {
      timezone: 'Europe/Berlin',
      startHour: 2,
      endHour: 9,
    }).toISOString()
  ).toBe('2026-03-29T01:00:00.000Z');
});
it('uses the first occurrence of a repeated fall boundary', () => {
  expect(
    nextWindowOpen(new Date('2026-10-24T21:30:00Z'), {
      timezone: 'Europe/Berlin',
      startHour: 2,
      endHour: 9,
    }).toISOString()
  ).toBe('2026-10-25T00:00:00.000Z');
});
