import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Pool } from 'pg'
import {
  scanServiceBreaches,
  SERVICE_TARGET_BREACHED_EVENT_KEY,
} from './breach-scanner.js'

/**
 * Breach scanner unit tests (S-09.08, T-09.08.01).
 *
 * `scanServiceBreaches` is exercised with an injected fake pool (recording
 * SQL + params) and an injected `enqueue` stub, so the full scan pipeline —
 * config load, breached-item queries, recipient resolution, ledger dedup,
 * outbox enqueue, and episode pruning — is covered DB-free at unit level.
 */

interface FakeDb {
  pool: { connect: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn> }
  client: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>
    release: ReturnType<typeof vi.fn>
  }
  calls: Array<{ sql: string; params: unknown[] }>
}

/**
 * Build a fake pool whose queries dispatch on SQL content.
 * @param onSql content matcher → response
 */
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
  return {
    pool: db.pool as unknown as Pool,
    enqueue,
    now: () => NOW,
    logger: { warn: vi.fn(), info: vi.fn() },
    ...overrides,
  }
}

beforeEach(() => {
  enqueue.mockClear()
})

describe('scanServiceBreaches (T-09.08.01)', () => {
  it('is a no-op when no config row is persisted', async () => {
    const db = makeFakeDb((sql) => {
      if (sql.includes('FROM app_config')) return { rows: [] }
      return { rows: [] }
    })
    const result = await scanServiceBreaches(scanOptions(db))
    expect(result.enabled).toBe(false)
    expect(db.pool.connect).not.toHaveBeenCalled()
  })

  it('alerts the assigned staff of a breached ticket via the outbox', async () => {
    const db = makeFakeDb((sql) => {
      if (sql.includes('FROM app_config')) {
        return { rows: [{ value: { ticket: 48, verification_case: null } }] }
      }
      if (sql.includes('FROM tickets')) {
        return { rows: [{ id: 'ticket-1', recipient_user_id: 'staff-1' }] }
      }
      if (sql.includes('FROM profiles')) {
        return { rows: [{ id: 'profile-1', user_id: 'staff-1' }] }
      }
      if (sql.includes('INSERT INTO service_breach_alerts')) {
        return { rows: [{ id: 'ledger-1' }] }
      }
      if (sql.includes('DELETE FROM service_breach_alerts')) {
        return { rowCount: 0 }
      }
      return { rows: [] }
    })

    const result = await scanServiceBreaches(scanOptions(db))

    expect(result.enabled).toBe(true)
    expect(result.alerted).toBe(1)
    expect(result.scanned).toEqual({ ticket: 1, verification_case: 0 })

    // The breach query applies the ticket open-statuses + target cutoff.
    const breachCall = db.calls.find((c) => c.sql.includes('FROM tickets'))
    expect(breachCall!.params[0]).toEqual(['open', 'in_progress', 'waiting_staff'])
    expect(breachCall!.params[1]).toBeInstanceOf(Date)

    // Ledger dedup insert carries a positive target snapshot.
    const ledgerCall = db.calls.find((c) => c.sql.includes('INSERT INTO service_breach_alerts'))
    expect(ledgerCall!.params).toEqual(['ticket', 'ticket-1', 48])

    // Outbox enqueue: in_app channel, per-item idempotency key.
    expect(enqueue).toHaveBeenCalledTimes(1)
    const enqArgs = enqueue.mock.calls[0]!
    expect(enqArgs[0]).toBe(db.client)
    expect(enqArgs[1]).toMatchObject({
      profileId: 'profile-1',
      userId: 'staff-1',
      eventKey: SERVICE_TARGET_BREACHED_EVENT_KEY,
      channels: ['in_app'],
      payload: { service_type: 'ticket', item_id: 'ticket-1', target_hours: 48 },
    })
    expect(String(enqArgs[1].idempotencyKey)).toContain('ticket-1:profile-1')
  })

  it('does not re-alert an item whose breach episode is already recorded', async () => {
    const db = makeFakeDb((sql) => {
      if (sql.includes('FROM app_config')) {
        return { rows: [{ value: { ticket: 48 } }] }
      }
      if (sql.includes('FROM tickets')) {
        return { rows: [{ id: 'ticket-1', recipient_user_id: 'staff-1' }] }
      }
      if (sql.includes('FROM profiles')) {
        return { rows: [{ id: 'profile-1', user_id: 'staff-1' }] }
      }
      if (sql.includes('INSERT INTO service_breach_alerts')) {
        return { rows: [] } // ON CONFLICT DO NOTHING — already alerted
      }
      if (sql.includes('DELETE FROM service_breach_alerts')) {
        return { rowCount: 0 }
      }
      return { rows: [] }
    })

    const result = await scanServiceBreaches(scanOptions(db))
    expect(result.alerted).toBe(0)
    expect(result.skippedDuplicates).toBe(1)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('alerts the creator of a breached verification case', async () => {
    const db = makeFakeDb((sql) => {
      if (sql.includes('FROM app_config')) {
        return { rows: [{ value: { verification_case: 72 } }] }
      }
      if (sql.includes('FROM verification_cases')) {
        return { rows: [{ id: 'case-1', recipient_user_id: 'staff-2' }] }
      }
      if (sql.includes('FROM profiles')) {
        return { rows: [{ id: 'profile-2', user_id: 'staff-2' }] }
      }
      if (sql.includes('INSERT INTO service_breach_alerts')) {
        return { rows: [{ id: 'ledger-2' }] }
      }
      if (sql.includes('DELETE FROM service_breach_alerts')) {
        return { rowCount: 0 }
      }
      return { rows: [] }
    })

    const result = await scanServiceBreaches(scanOptions(db))
    expect(result.alerted).toBe(1)
    expect(result.scanned).toEqual({ ticket: 0, verification_case: 1 })

    const breachCall = db.calls.find((c) => c.sql.includes('FROM verification_cases'))
    expect(breachCall!.params[0]).toEqual(['Open', 'Under Review'])

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue.mock.calls[0]![1]).toMatchObject({
      profileId: 'profile-2',
      userId: 'staff-2',
      payload: { service_type: 'verification_case', item_id: 'case-1', target_hours: 72 },
    })
  })

  it('falls back to platform admins for unassigned tickets', async () => {
    const db = makeFakeDb((sql) => {
      if (sql.includes('FROM app_config')) {
        return { rows: [{ value: { ticket: 24 } }] }
      }
      if (sql.includes('FROM tickets')) {
        return { rows: [{ id: 'ticket-2', recipient_user_id: null }] }
      }
      if (sql.includes('FROM users')) {
        return { rows: [{ user_id: 'admin-1' }, { user_id: 'admin-2' }] }
      }
      if (sql.includes('FROM profiles')) {
        return {
          rows: [
            { id: 'profile-a1', user_id: 'admin-1' },
            { id: 'profile-a2', user_id: 'admin-2' },
          ],
        }
      }
      if (sql.includes('INSERT INTO service_breach_alerts')) {
        return { rows: [{ id: 'ledger-3' }] }
      }
      if (sql.includes('DELETE FROM service_breach_alerts')) {
        return { rowCount: 0 }
      }
      return { rows: [] }
    })

    const result = await scanServiceBreaches(scanOptions(db))
    expect(result.alerted).toBe(1)
    expect(enqueue).toHaveBeenCalledTimes(2)
    const profiles = enqueue.mock.calls.map((c) => c[1].profileId)
    expect(profiles.sort()).toEqual(['profile-a1', 'profile-a2'])
  })

  it('prunes ledger rows whose episode ended (item no longer breached)', async () => {
    const db = makeFakeDb((sql) => {
      if (sql.includes('FROM app_config')) {
        return { rows: [{ value: { ticket: 48 } }] }
      }
      // NOTE: order matters — the DELETE anti-join embeds `FROM tickets` in
      // its subquery, so the DELETE branch must be matched first.
      if (sql.includes('DELETE FROM service_breach_alerts')) {
        return { rowCount: 3 }
      }
      if (sql.includes('FROM tickets')) {
        return { rows: [] } // no breached items now
      }
      return { rows: [] }
    })

    const result = await scanServiceBreaches(scanOptions(db))
    expect(result.pruned).toBe(3)
    const pruneCall = db.calls.find((c) => c.sql.includes('DELETE FROM service_breach_alerts'))
    expect(pruneCall!.params[0]).toBe('ticket')
  })

  it('skips corrupt config values (types degrade to disabled)', async () => {
    const db = makeFakeDb((sql) => {
      if (sql.includes('FROM app_config')) {
        return { rows: [{ value: { ticket: 0, verification_case: 'soon' } }] }
      }
      return { rows: [] }
    })

    const result = await scanServiceBreaches(scanOptions(db))
    expect(result.enabled).toBe(true)
    expect(result.scanned).toEqual({ ticket: 0, verification_case: 0 })
    expect(db.pool.connect).not.toHaveBeenCalled()
  })

  it('isolates a failing service type and still scans the others', async () => {
    const db = makeFakeDb((sql) => {
      if (sql.includes('FROM app_config')) {
        return { rows: [{ value: { ticket: 48, verification_case: 24 } }] }
      }
      if (sql.includes('FROM tickets')) {
        throw new Error('tickets table exploded')
      }
      if (sql.includes('FROM verification_cases')) {
        return { rows: [] }
      }
      if (sql.includes('DELETE FROM service_breach_alerts')) {
        return { rowCount: 0 }
      }
      return { rows: [] }
    })

    const result = await scanServiceBreaches(scanOptions(db))
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('ticket')
    expect(result.errors[0]).toContain('tickets table exploded')
    // verification_case was still scanned to completion.
    expect(result.scanned.verification_case).toBe(0)
    expect(result.scanned.ticket).toBe(0)
  })
})