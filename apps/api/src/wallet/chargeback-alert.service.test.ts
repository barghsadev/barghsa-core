import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WALLET_CHARGEBACK_REASON } from '@barghsa/shared/finance'
import {
  ChargebackAlertService,
  COUNT_UNRESOLVED_CHARGEBACKS_SQL,
  FIND_FINANCE_ALERT_RECIPIENTS_SQL,
  LIST_UNRESOLVED_CHARGEBACKS_SQL,
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

  it('is a no-op insert when the same event is already alerted to that profile', async () => {
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql.includes('INSERT INTO notification_outbox')) {
          return { rows: [], rowCount: 0 }
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
    expect(result).toEqual({ outboxId: null, inserted: false })
    expect(client.query.mock.calls.some((call) => String(call[0]).includes('notification_job'))).toBe(
      false,
    )
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
