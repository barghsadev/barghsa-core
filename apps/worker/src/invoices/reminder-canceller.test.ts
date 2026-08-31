import { describe, it, expect, vi } from 'vitest'
import { REMINDER_STOP_STATES } from '@barghsa/shared/finance'
import {
  CANCEL_FUTURE_INVOICE_REMINDERS_SQL,
  CANCEL_SCHEDULED_REMINDERS_FOR_STOP_STATES_SQL,
  cancelFutureInvoiceReminders,
  cancelRemindersIfStopState,
  cancelScheduledRemindersForStoppedInvoices,
} from './reminder-canceller.js'

describe('reminder canceller contract (T-04.1.04.06)', () => {
  it('cancels only scheduled rows for one invoice', () => {
    expect(CANCEL_FUTURE_INVOICE_REMINDERS_SQL).toContain('UPDATE invoice_reminder_schedule')
    expect(CANCEL_FUTURE_INVOICE_REMINDERS_SQL).toContain("SET status = 'cancelled'")
    expect(CANCEL_FUTURE_INVOICE_REMINDERS_SQL).toContain('invoice_id = $1')
    expect(CANCEL_FUTURE_INVOICE_REMINDERS_SQL).toContain("status = 'scheduled'")
    expect(CANCEL_FUTURE_INVOICE_REMINDERS_SQL).not.toContain("status = 'sent'")
  })

  it('binds stop states as invoice_state[] for the catch-up UPDATE', () => {
    expect(CANCEL_SCHEDULED_REMINDERS_FOR_STOP_STATES_SQL).toContain(
      'i.state = ANY($1::invoice_state[])',
    )
    expect(CANCEL_SCHEDULED_REMINDERS_FOR_STOP_STATES_SQL).not.toContain('$1::text[]')
    expect(CANCEL_SCHEDULED_REMINDERS_FOR_STOP_STATES_SQL).toContain("s.status = 'scheduled'")
  })

  it('reports the number of rows rewritten for one invoice', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 4, rows: [] })
    const result = await cancelFutureInvoiceReminders({ query }, 'inv-1')
    expect(result).toEqual({ cancelled: 4 })
    expect(query).toHaveBeenCalledWith(CANCEL_FUTURE_INVOICE_REMINDERS_SQL, ['inv-1'])
  })

  it('cancels only when the invoice is in a stop state', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 2, rows: [] })
    expect(await cancelRemindersIfStopState({ query }, 'inv-1', 'Paid')).toBe(true)
    expect(await cancelRemindersIfStopState({ query }, 'inv-1', 'Cancelled')).toBe(true)
    expect(await cancelRemindersIfStopState({ query }, 'inv-1', 'Refunded')).toBe(true)
    expect(await cancelRemindersIfStopState({ query }, 'inv-1', 'Overdue')).toBe(false)
    expect(await cancelRemindersIfStopState({ query }, 'inv-1', 'PartiallyRefunded')).toBe(false)
    expect(query).toHaveBeenCalledTimes(3)
  })

  it('catch-up pass binds Paid / Cancelled / Refunded', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 6, rows: [] })
    const result = await cancelScheduledRemindersForStoppedInvoices({
      pool: { query } as never,
    })
    expect(result).toEqual({ cancelled: 6 })
    expect(query).toHaveBeenCalledWith(CANCEL_SCHEDULED_REMINDERS_FOR_STOP_STATES_SQL, [
      [...REMINDER_STOP_STATES],
    ])
  })
})
