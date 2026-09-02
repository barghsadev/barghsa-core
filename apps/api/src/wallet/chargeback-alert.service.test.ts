import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WALLET_CHARGEBACK_REASON } from '@barghsa/shared/finance'
import {
  ChargebackAlertService,
  COUNT_UNRESOLVED_CHARGEBACKS_SQL,
  FIND_FINANCE_ALERT_RECIPIENTS_SQL,
  LIST_UNRESOLVED_CHARGEBACKS_SQL,
  SELECT_FINANCE_CHARGEBACK_OUTBOX_ID_SQL,
  enqueueFinanceChargebackAlert,
} from './chargeback-alert.service.js'

const mockPool = {
  query: vi.fn(),
}

vi.mock('@barghsa/db', () => ({
  getDbPool: () => mockPool,
}))

const EVENT_ID = 'evt-cb-alert-1'
const PROFILE_ID = '11111111-1111-7111-8111-111111111111'
const USER_ID = 'staff-finance-1'

function notification() {
  return {
    type: 'chargeback' as const,
    merchantId: 'm-1',
    merchantOrderId: null,
    providerRefId: 'psp-1',
    authority: null,
    amountIrR: 75_000n,
    reason: WALLET_CHARGEBACK_REASON,
  }
}

describe('ChargebackAlertService (T-04.2.04.03)', () => {
  beforeEach(() => {
    mockPool.query.mockReset()
  })

  it('enqueues an immediate in-app + email outbox row per finance recipient', async () => {
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql.includes('FROM profiles')) {
          return { rows: [{ profile_id: PROFILE_ID, user_id: USER_ID }] }
        }
        if (sql.includes('INSERT INTO notification_outbox')) {
          return { rows: [{ id: 'outbox-1' }], rowCount: 1 }
        }
        return { rows: [], rowCount: 1 }
      }),
    }
    const service = new ChargebackAlertService()
    const result = await service.notifyUnresolved(client, {
      eventId: EVENT_ID,
      status: 'unmatched',
      notification: notification(),
      walletId: null,
      originalTransactionId: null,
    })
    expect(result).toEqual({ recipients: 1, inserted: 1 })
    expect(FIND_FINANCE_ALERT_RECIPIENTS_SQL).toContain("p.is_default = TRUE")
    expect(FIND_FINANCE_ALERT_RECIPIENTS_SQL).toContain('role_id = $1')
    const outboxCall = client.query.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO notification_outbox'),
    )
    expect(outboxCall?.[1]).toEqual([
      PROFILE_ID,
      USER_ID,
      'finance.chargeback_unresolved',
      expect.objectContaining({
        event_id: EVENT_ID,
        status: 'unmatched',
        amount_irr: '75000',
        link_route: '/admin',
      }),
      ['in_app', 'email'],
      'queued',
      `finance.chargeback_unresolved:${EVENT_ID}:${PROFILE_ID}`,
      5,
      null,
    ])
    const jobCall = client.query.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO notification_job'),
    )
    expect(jobCall?.[1]).toEqual([
      'outbox-1',
      'in_app',
      'queued',
      'urgent',
      5,
      'outbox-1',
      'email',
      'queued',
      'urgent',
      5,
    ])
    expect(client.query.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining(['BEGIN', 'COMMIT']),
    )
  })

  it('skips reversed chargebacks and does not write the outbox', async () => {
    const client = { query: vi.fn() }
    const service = new ChargebackAlertService()
    const result = await service.notifyUnresolved(client, {
      eventId: EVENT_ID,
      status: 'reversed',
      notification: notification(),
      walletId: PROFILE_ID,
      originalTransactionId: 'tx-1',
    })
    expect(result).toEqual({ recipients: 0, inserted: 0 })
    expect(client.query).not.toHaveBeenCalled()
  })

  it('reuses the existing outbox and upserts jobs when the idempotency key already exists', async () => {
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql.includes('INSERT INTO notification_outbox')) {
          return { rows: [], rowCount: 0 }
        }
        if (sql.includes(SELECT_FINANCE_CHARGEBACK_OUTBOX_ID_SQL) || sql.includes('WHERE idempotency_key = $1')) {
          return { rows: [{ id: 'outbox-existing' }] }
        }
        return { rows: [] }
      }),
    }
    const result = await enqueueFinanceChargebackAlert(client, {
      profileId: PROFILE_ID,
      userId: USER_ID,
      eventId: EVENT_ID,
      payload: { event_id: EVENT_ID },
    })
    expect(result).toEqual({ outboxId: 'outbox-existing', inserted: false })
    const jobCall = client.query.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO notification_job'),
    )
    expect(jobCall?.[1]?.[0]).toBe('outbox-existing')
    expect(jobCall?.[1]?.[5]).toBe('outbox-existing')
  })

  it('creates missing notification jobs when a retry follows a failed job insert', async () => {
    let outboxPersisted = false
    let jobInserts = 0
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [] }
        }
        if (sql.includes('INSERT INTO notification_outbox')) {
          if (outboxPersisted) return { rows: [], rowCount: 0 }
          outboxPersisted = true
          return { rows: [{ id: 'outbox-1' }], rowCount: 1 }
        }
        if (sql.includes('WHERE idempotency_key = $1')) {
          return { rows: outboxPersisted ? [{ id: 'outbox-1' }] : [] }
        }
        if (sql.includes('INSERT INTO notification_job')) {
          jobInserts += 1
          if (jobInserts === 1) {
            throw new Error('simulated job insert failure')
          }
          return { rows: [], rowCount: 2 }
        }
        return { rows: [] }
      }),
    }
    const input = {
      profileId: PROFILE_ID,
      userId: USER_ID,
      eventId: EVENT_ID,
      payload: { event_id: EVENT_ID },
    }

    await expect(enqueueFinanceChargebackAlert(client, input)).rejects.toThrow(
      'simulated job insert failure',
    )
    expect(outboxPersisted).toBe(true)
    expect(client.query.mock.calls.some((call) => call[0] === 'ROLLBACK')).toBe(true)

    const retry = await enqueueFinanceChargebackAlert(client, input)
    expect(retry).toEqual({ outboxId: 'outbox-1', inserted: false })
    const jobCalls = client.query.mock.calls.filter((call) =>
      String(call[0]).includes('INSERT INTO notification_job'),
    )
    expect(jobCalls).toHaveLength(2)
    expect(jobCalls[1]?.[1]).toEqual([
      'outbox-1',
      'in_app',
      'queued',
      'urgent',
      5,
      'outbox-1',
      'email',
      'queued',
      'urgent',
      5,
    ])
  })

  it('aggregates unmatched and reversal-failed rows for the dashboard warning', async () => {
    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('GROUP BY status')) {
        return {
          rows: [
            { status: 'unmatched', n: 2 },
            { status: 'unresolved', n: 1 },
          ],
        }
      }
      if (sql.includes('ORDER BY created_at DESC')) {
        return {
          rows: [
            {
              event_id: EVENT_ID,
              status: 'unmatched',
              wallet_id: null,
              original_transaction_id: null,
              raw: { amountIrR: '75000', reason: WALLET_CHARGEBACK_REASON },
              created_at: new Date('2026-09-02T06:00:00.000Z'),
            },
          ],
        }
      }
      return { rows: [] }
    })
    const service = new ChargebackAlertService()
    const warning = await service.getDashboardWarning()
    expect(COUNT_UNRESOLVED_CHARGEBACKS_SQL).toContain("status IN ('unmatched', 'unresolved')")
    expect(LIST_UNRESOLVED_CHARGEBACKS_SQL).toContain('LIMIT $1')
    expect(warning).toEqual({
      count: 3,
      unmatchedCount: 2,
      reversalFailedCount: 1,
      items: [
        {
          eventId: EVENT_ID,
          status: 'unmatched',
          amountIrR: '75000',
          walletId: null,
          originalTransactionId: null,
          reason: WALLET_CHARGEBACK_REASON,
          createdAt: '2026-09-02T06:00:00.000Z',
        },
      ],
    })
  })
})
