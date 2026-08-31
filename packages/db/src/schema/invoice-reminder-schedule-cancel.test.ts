import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CANCEL_FUTURE_INVOICE_REMINDERS_SQL } from './invoice-reminder-schedule.js'

const MIGRATION_PATH = resolve(
  __dirname,
  '../../drizzle/0063_cancel_reminders_on_invoice_stop_state.sql',
)
const JOURNAL_PATH = resolve(__dirname, '../../drizzle/meta/_journal.json')
const MIGRATION = readFileSync(MIGRATION_PATH, 'utf8')

describe('invoice reminder cancel-on-stop-state (T-04.1.04.06)', () => {
  it('migration 0063 cancels only scheduled rows for Paid / Cancelled / Refunded', () => {
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION cancel_future_invoice_reminders')
    expect(MIGRATION).toContain("SET status = 'cancelled'")
    expect(MIGRATION).toContain("status = 'scheduled'")
    expect(MIGRATION).toContain("ARRAY['Paid', 'Cancelled', 'Refunded']::invoice_state[]")
    expect(MIGRATION).toContain('trg_cancel_invoice_reminders_on_stop_state')
    expect(MIGRATION).toContain('AFTER UPDATE OF state ON invoices')
    expect(MIGRATION).toContain('OLD.state IS DISTINCT FROM NEW.state')
    expect(MIGRATION).not.toContain('PartiallyRefunded')
    expect(MIGRATION).not.toContain('Overdue')
  })

  it('exported UPDATE matches the trigger function rewrite', () => {
    expect(CANCEL_FUTURE_INVOICE_REMINDERS_SQL).toContain('UPDATE invoice_reminder_schedule')
    expect(CANCEL_FUTURE_INVOICE_REMINDERS_SQL).toContain("SET status = 'cancelled'")
    expect(CANCEL_FUTURE_INVOICE_REMINDERS_SQL).toContain('invoice_id = $1')
    expect(CANCEL_FUTURE_INVOICE_REMINDERS_SQL).toContain("status = 'scheduled'")
    expect(MIGRATION).toContain("WHERE invoice_id = p_invoice_id")
    expect(MIGRATION).toContain("AND status = 'scheduled'")
  })

  it('migration 0063 is idempotent', () => {
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION cancel_future_invoice_reminders')
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION trg_fn_cancel_invoice_reminders_on_stop_state')
    expect(MIGRATION).toContain(
      'DROP TRIGGER IF EXISTS trg_cancel_invoice_reminders_on_stop_state ON invoices',
    )
  })

  it('migration 0063 is registered in the Drizzle journal so migrate() applies it', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; idx: number; when: number }>
    }
    const entry = journal.entries.find(
      (row) => row.tag === '0063_cancel_reminders_on_invoice_stop_state',
    )
    expect(entry).toBeDefined()
    expect(entry!.idx).toBe(63)
    const prior = journal.entries.find(
      (row) => row.tag === '0062_create_invoice_reminder_offset_toggles',
    )
    expect(prior).toBeDefined()
    expect(entry!.when).toBeGreaterThan(prior!.when)
  })
})
