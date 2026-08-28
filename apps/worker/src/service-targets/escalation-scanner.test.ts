import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Pool } from 'pg'
import {
  scanServiceEscalations,
  SERVICE_ESCALATED_EVENT_KEY,
  DEFAULT_ESCALATION_BATCH_SIZE,
} from './escalation-scanner.js'

/**
 * Escalation scanner unit tests (S-09.08, T-09.08.03).
 *
 * `scanServiceEscalations` is exercised with an injected fake pool (recording
 * SQL + params) and an injected `enqueue` stub, so the full escalation
 * pipeline — config load, due-row fetch, source re-verify, atomic ledger
 * claim, recipient resolution (team vs admin), outbox enqueue, no-recipient
 * revert — is covered DB-free at unit level.
 */

interface FakeDb {
  pool: { connect: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn> }
  client: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>
    release: ReturnType<typeof vi.fn>
  }
  calls: Array<{ sql: string; params: unknown[] }>
}

function makeFakeDb(onSql: (sql: string, params: unknown[]) => { rows?: unknown[]; rowCount?: number }): FakeDb {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const respond = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params })
    const result = onSql(sql, params)
    return { rows: result.rows ?? [], rowCount: result.rowCount ?? 0 }
  }
  const client = { query: respond, release: vi.fn() }
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
    query: respond,
  }
  return { pool: pool as never, client, calls }
}

const enqueue = vi.fn().mockResolvedValue({ outboxId: 'ob-1', inserted: true })
const NOW = new Date('2026-08-28T10:00:00Z')

function scanOptions(db: FakeDb, overrides: Record<string, unknown> = {}) {
  const logger = { warn: vi.fn(), info: vi.fn() }
  return {
    pool: db.pool as unknown as Pool,
    enqueue,
    now: () => NOW,
    logger,
    ...overrides,
  }
}

beforeEach(() => {
  enqueue.mockClear()
})

/** Default dispatch helper: an enabled policy, a due ticket, team members, fresh claim. */
function defaultHandler(rows: Array<{ ledger_id: string; item_id: string; responsible_user_id: string | null }> = [{ ledger_id: 'l1', item_id: 'ticket-1', responsible_user_id: 'staff-1' }]) {
  return (sql: string, params: unknown[]): { rows?: unknown[]; rowCount?: number } => {
    if (sql.includes('FROM app_config')) {
      return {
        rows: [
          {
            value: {
              ticket: {
                level2: { delayHours: 24, channels: ['in_app', 'email'] },
                level3: { delayHours: 48, channels: ['in_app'] },
              },
              verification_case: null,
            },
          },
        ],
      }
    }
    // The level-2 fetch joins service_breach_alerts to tickets.
    if (sql.includes('JOIN tickets')) {
      // Only the level-2 (expected_level=1, alerted_at base) query returns rows.
      return params[1] === 1 ? { rows } : { rows: [] }
    }
    if (sql.includes('JOIN verification_cases')) return { rows: [] }
    // Team resolution: staff-1 is a member of a team; its member is teamlead-1.
    if (sql.includes('FROM staff_team_members')) {
      return { rows: [{ user_id: 'teamlead-1' }] }
    }
    if (sql.includes('FROM users')) {
      return { rows: [{ user_id: 'admin-1' }] }
    }
    if (sql.includes('FROM profiles')) {
      const ids = (Array.isArray(params[0]) ? params[0] : []) as string[]
      const all = [
        { id: 'profile-lead', user_id: 'teamlead-1' },
        { id: 'profile-admin', user_id: 'admin-1' },
      ]
      return { rows: all.filter((p) => ids.includes(p.user_id)) }
    }
    if (sql.includes('UPDATE service_breach_alerts')) {
      // Distinguish the advance claim (RETURNING) from the revert (no RETURNING).
      return sql.includes('RETURNING id') ? { rows: [{ id: 'l1' }], rowCount: 1 } : { rowCount: 0 }
    }
    return { rows: [] }
  }
}

describe('scanServiceEscalations (T-09.08.03)', () => {
  it('disables and does nothing when no escalation policy is persisted', async () => {
    const db = makeFakeDb((sql) => {
      if (sql.includes('FROM app_config')) return { rows: [] }
      return { rows: [] }
    })
    const result = await scanServiceEscalations(scanOptions(db))
    expect(result.enabled).toBe(false)
    expect(enqueue).not.toHaveBeenCalled()
    expect(db.pool.connect).not.toHaveBeenCalled()
  })

  it('escalates an un-responded breached ticket to level 2 (team lead) with the level channels', async () => {
    const db = makeFakeDb(defaultHandler())
    const result = await scanServiceEscalations(scanOptions(db))

    expect(result.enabled).toBe(true)
    expect(result.escalated.ticket.level2).toBe(1)
    expect(result.escalated.ticket.level3).toBe(0)

    // The level-2 fetch re-verifies source openness AND the per-episode
    // target-hours cutoff, and filters by the escalation delay (base column).
    const l2Call = db.calls.find((c) => c.sql.includes('JOIN tickets') && c.params[1] === 1)
    expect(l2Call).toBeDefined()
    expect(l2Call!.params[0]).toBe('ticket')
    expect(l2Call!.params[1]).toBe(1) // expected escalation_level
    expect(l2Call!.params[2]).toBeInstanceOf(Date) // cutoff = now - 24h
    expect(l2Call!.sql).toContain('updated_at <= $4 - (l.target_hours * INTERVAL \'1 hour\')')
    expect(l2Call!.sql).toContain('l.alerted_at <= $3')
    expect(db.calls.some((c) => c.sql.includes('FROM profiles') && Array.isArray(c.params[0]) && (c.params[0] as string[]).includes('teamlead-1'))).toBe(true)

    // Ledger claim: expected level 1 → 2.
    const claim = db.calls.find((c) => c.sql.includes('RETURNING id'))
    expect(claim!.params).toEqual(['l1', 1, 2, NOW])

    // Enqueue to the team lead, via the configured level-2 channels.
    expect(enqueue).toHaveBeenCalledTimes(1)
    const enq = enqueue.mock.calls[0]!
    expect(enq[1]).toMatchObject({
      profileId: 'profile-lead',
      userId: 'teamlead-1',
      eventKey: SERVICE_ESCALATED_EVENT_KEY,
      channels: ['in_app', 'email'],
      payload: { service_type: 'ticket', item_id: 'ticket-1', escalation_level: 2 },
    })
  })

  it('uses escalated_at as the level-3 base and escalates to admin only after its delay', async () => {
    // Ticket already at level 2; level 3 due (escalated_at base).
    const db = makeFakeDb((sql, params) => {
      if (sql.includes('FROM app_config')) {
        return { rows: [{ value: { ticket: { level2: { delayHours: 24, channels: ['in_app'] }, level3: { delayHours: 48, channels: ['in_app'] } } } }] }
      }
      if (sql.includes('JOIN tickets')) {
        // level 2 query (expected 1) → none; level 3 query (expected 2) → one.
        return params[1] === 2 ? { rows: [{ ledger_id: 'l2', item_id: 'ticket-2', responsible_user_id: 'staff-2' }] } : { rows: [] }
      }
      if (sql.includes('FROM users')) return { rows: [{ user_id: 'admin-1' }] }
      if (sql.includes('FROM profiles')) return { rows: [{ id: 'profile-admin', user_id: 'admin-1' }] }
      if (sql.includes('RETURNING id')) return { rows: [{ id: 'l2' }], rowCount: 1 }
      return { rows: [] }
    })

    const result = await scanServiceEscalations(scanOptions(db))
    expect(result.escalated.ticket.level2).toBe(0)
    expect(result.escalated.ticket.level3).toBe(1)

    const l3Call = db.calls.find((c) => c.sql.includes('JOIN tickets') && c.params[1] === 2)
    expect(l3Call!.sql).toContain('l.escalated_at <= $3')
    expect(l3Call!.params[2]).toBeInstanceOf(Date)

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue.mock.calls[0]![1]).toMatchObject({
      profileId: 'profile-admin',
      userId: 'admin-1',
      channels: ['in_app'],
      payload: { escalation_level: 3 },
    })
  })

  it('falls back to platform admins when the responsible user is in no team', async () => {
    const db = makeFakeDb((sql, params) => {
      if (sql.includes('FROM app_config')) {
        return { rows: [{ value: { ticket: { level2: { delayHours: 24, channels: ['in_app'] }, level3: { delayHours: 48, channels: ['in_app'] } } } }] }
      }
      if (sql.includes('JOIN tickets')) return params[1] === 1 ? { rows: [{ ledger_id: 'l1', item_id: 't1', responsible_user_id: 'solo-1' }] } : { rows: [] }
      // solo-1 has no team memberships.
      if (sql.includes('FROM staff_team_members')) return { rows: [] }
      if (sql.includes('FROM users')) return { rows: [{ user_id: 'admin-9' }] }
      if (sql.includes('FROM profiles')) return { rows: [{ id: 'pa', user_id: 'admin-9' }] }
      if (sql.includes('RETURNING id')) return { rows: [{ id: 'l1' }], rowCount: 1 }
      return { rows: [] }
    })

    const result = await scanServiceEscalations(scanOptions(db))
    expect(result.escalated.ticket.level2).toBe(1)
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue.mock.calls[0]![1]).toMatchObject({ profileId: 'pa', userId: 'admin-9' })
  })

  it('falls back to admins for an unassigned item (no responsible user)', async () => {
    const db = makeFakeDb((sql, params) => {
      if (sql.includes('FROM app_config')) {
        return { rows: [{ value: { ticket: { level2: { delayHours: 24, channels: ['in_app'] }, level3: { delayHours: 48, channels: ['in_app'] } } } }] }
      }
      if (sql.includes('JOIN tickets')) return params[1] === 1 ? { rows: [{ ledger_id: 'l1', item_id: 't1', responsible_user_id: null }] } : { rows: [] }
      if (sql.includes('FROM users')) return { rows: [{ user_id: 'admin-9' }] }
      if (sql.includes('FROM profiles')) return { rows: [{ id: 'pa', user_id: 'admin-9' }] }
      if (sql.includes('RETURNING id')) return { rows: [{ id: 'l1' }], rowCount: 1 }
      return { rows: [] }
    })

    const result = await scanServiceEscalations(scanOptions(db))
    expect(result.escalated.ticket.level2).toBe(1)
    expect(enqueue.mock.calls[0]![1]).toMatchObject({ profileId: 'pa', userId: 'admin-9' })
  })

  it('does not claim and re-evaluates when no deliverable recipient exists', async () => {
    const db = makeFakeDb((sql, params) => {
      if (sql.includes('FROM app_config')) {
        return { rows: [{ value: { ticket: { level2: { delayHours: 24, channels: ['in_app'] }, level3: { delayHours: 48, channels: ['in_app'] } } } }] }
      }
      if (sql.includes('JOIN tickets')) return params[1] === 1 ? { rows: [{ ledger_id: 'l1', item_id: 't1', responsible_user_id: 'ghost-1' }] } : { rows: [] }
      if (sql.includes('FROM staff_team_members')) return { rows: [] }
      if (sql.includes('FROM users')) return { rows: [] } // no admins
      // The claim is never issued because recipients resolve to none first.
      return { rows: [] }
    })

    const options = scanOptions(db)
    const result = await scanServiceEscalations(options)
    expect(result.escalated.ticket.level2).toBe(0)
    expect(enqueue).not.toHaveBeenCalled()
    // No advance claim was even attempted (recipients resolution came up empty).
    expect(db.calls.some((c) => c.sql.includes('UPDATE service_breach_alerts'))).toBe(false)
    // An aggregated warning makes the no-recipient skip observable without an error.
    expect(options.logger.warn).toHaveBeenCalledWith(expect.stringContaining('t1'))
  })

  it('skips an escalation whose claim was already won by a concurrent scan', async () => {
    const db = makeFakeDb((sql, params) => {
      if (sql.includes('FROM app_config')) {
        return { rows: [{ value: { ticket: { level2: { delayHours: 24, channels: ['in_app'] }, level3: { delayHours: 48, channels: ['in_app'] } } } }] }
      }
      if (sql.includes('JOIN tickets')) return params[1] === 1 ? { rows: [{ ledger_id: 'l1', item_id: 't1', responsible_user_id: 'staff-1' }] } : { rows: [] }
      if (sql.includes('FROM staff_team_members')) return { rows: [{ user_id: 'lead-1' }] }
      if (sql.includes('FROM profiles')) return { rows: [{ id: 'pl', user_id: 'lead-1' }] }
      // The claim UPDATE matched 0 rows (a concurrent scan already set level 2).
      if (sql.includes('RETURNING id')) return { rows: [], rowCount: 0 }
      return { rows: [] }
    })

    const result = await scanServiceEscalations(scanOptions(db))
    expect(result.escalated.ticket.level2).toBe(0)
    expect(result.skippedConcurrent).toBe(1)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('does not report an escalation whose transaction rolled back on a later candidate', async () => {
    // First candidate escalates fine; a second candidate throws during
    // enqueue, rolling back the whole per-type transaction — so the first
    // candidate must not be reported as escalated (counters apply on COMMIT).
    const db = makeFakeDb((sql, params) => {
      if (sql.includes('FROM app_config')) {
        return { rows: [{ value: { ticket: { level2: { delayHours: 24, channels: ['in_app'] }, level3: { delayHours: 48, channels: ['in_app'] } } } }] }
      }
      if (sql.includes('JOIN tickets')) {
        return params[1] === 1
          ? { rows: [{ ledger_id: 'l1', item_id: 't1', responsible_user_id: 'staff-1' }, { ledger_id: 'l2', item_id: 't2', responsible_user_id: 'staff-2' }] }
          : { rows: [] }
      }
      if (sql.includes('FROM staff_team_members')) return { rows: [{ user_id: 'lead-1' }] }
      if (sql.includes('FROM profiles')) return { rows: [{ id: 'pl', user_id: 'lead-1' }] }
      if (sql.includes('RETURNING id')) return { rows: [{ id: params[0] }], rowCount: 1 }
      return { rows: [] }
    })
    // First candidate enqueues OK; second candidate's enqueue throws.
    enqueue
      .mockResolvedValueOnce({ outboxId: 'ob-1', inserted: true })
      .mockRejectedValueOnce(new Error('transport gone'))

    const result = await scanServiceEscalations(scanOptions(db))
    // The per-type transaction rolled back, so the committed escalation count is 0.
    expect(result.escalated.ticket.level2).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('ticket')
    expect(result.errors[0]).toContain('transport gone')
  })

  it('isolates a failing service type and still scans the others', async () => {
    const db = makeFakeDb((sql, params) => {
      if (sql.includes('FROM app_config')) {
        return {
          rows: [
            {
              value: {
                ticket: { level2: { delayHours: 24, channels: ['in_app'] }, level3: { delayHours: 48, channels: ['in_app'] } },
                verification_case: { level2: { delayHours: 24, channels: ['in_app'] }, level3: { delayHours: 48, channels: ['in_app'] } },
              },
            },
          ],
        }
      }
      if (sql.includes('JOIN tickets')) throw new Error('tickets exploded')
      if (sql.includes('JOIN verification_cases')) return { rows: [] }
      return { rows: [] }
    })

    const result = await scanServiceEscalations(scanOptions(db))
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('ticket')
    // verification_case still scanned to completion (both tiers ran).
    expect(result.escalated.verification_case.level2).toBe(0)
    expect(result.escalated.verification_case.level3).toBe(0)
    expect(db.calls.filter((c) => c.sql === 'BEGIN').length).toBeGreaterThanOrEqual(1)
  })

  it('respects the batch size when fetching candidates', async () => {
    const db = makeFakeDb(defaultHandler())
    await scanServiceEscalations(scanOptions(db, { batchSize: 7 }))
    const l2Call = db.calls.find((c) => c.sql.includes('JOIN tickets') && c.params[1] === 1)
    expect(l2Call!.params[5]).toBe(7)
    // Default export still 200.
    expect(DEFAULT_ESCALATION_BATCH_SIZE).toBe(200)
  })

  it('escalates a verification case creator to their team', async () => {
    const db = makeFakeDb((sql, params) => {
      if (sql.includes('FROM app_config')) {
        return { rows: [{ value: { verification_case: { level2: { delayHours: 24, channels: ['in_app'] }, level3: { delayHours: 48, channels: ['in_app'] } } } }] }
      }
      if (sql.includes('JOIN verification_cases')) return params[1] === 1 ? { rows: [{ ledger_id: 'lc', item_id: 'case-1', responsible_user_id: 'staff-c' }] } : { rows: [] }
      if (sql.includes('FROM staff_team_members')) return { rows: [{ user_id: 'teamlead-c' }] }
      if (sql.includes('FROM profiles')) return { rows: [{ id: 'pc', user_id: 'teamlead-c' }] }
      if (sql.includes('RETURNING id')) return { rows: [{ id: 'lc' }], rowCount: 1 }
      return { rows: [] }
    })

    const result = await scanServiceEscalations(scanOptions(db))
    expect(result.escalated.verification_case.level2).toBe(1)
    const vcCall = db.calls.find((c) => c.sql.includes('JOIN verification_cases') && c.params[1] === 1)
    expect(vcCall!.params[0]).toBe('verification_case')
    expect(enqueue.mock.calls[0]![1]).toMatchObject({
      profileId: 'pc',
      payload: { service_type: 'verification_case' },
    })
  })
})