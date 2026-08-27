import { describe, it, expect } from 'vitest'
import {
  writeDeadLetter,
  deadLetterSeverity,
  severityForEvent,
  type WriteDeadLetterInput,
} from './dead-letter.js'

/**
 * Dead-letter writer unit tests (E-05, T-05.01.06).
 *
 * `writeDeadLetter` is exercised with an injected recording pool to verify the
 * inserted columns, the derived severity (critical for urgent/security event
 * types), error-category classification, and that secret-bearing causes are
 * sanitized before persistence.
 */

function makePool() {
  const inserts: Array<{ sql: string; params: unknown[] }> = []
  const pool = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(sql: string, params?: any[]) {
      inserts.push({ sql, params: params ?? [] })
      return { rows: [], rowCount: 1 }
    },
  }
  return { pool, inserts }
}

const base: WriteDeadLetterInput = {
  outboxId: 'ob-1',
  jobId: 'job-1',
  channel: 'email',
  eventKey: 'invoice_available',
  profileId: 'prof-1',
  userId: null,
  attempts: 5,
  maxAttempts: 5,
  idempotencyKey: 'k-1',
}

describe('deadLetterSeverity', () => {
  it('classifies urgent / security event types as critical', () => {
    expect(deadLetterSeverity('otp_sent')).toBe('critical')
    expect(severityForEvent('profile_verified')).toBe('critical')
  })

  it('classifies ordinary event types as error', () => {
    expect(deadLetterSeverity('invoice_available')).toBe('error')
    expect(deadLetterSeverity('welcome_email')).toBe('error')
  })
})

describe('writeDeadLetter', () => {
  it('inserts a row with derived severity and open status', async () => {
    const { pool, inserts } = makePool()
    await writeDeadLetter(pool, base)
    const sql = inserts[0]!.sql
    expect(sql).toContain('INSERT INTO notification_dead_letter')
    expect(sql).toContain('ON CONFLICT (job_id) DO UPDATE')
    const p = inserts[0]!.params
    expect(p[0]).toBe('ob-1')
    expect(p[1]).toBe('job-1')
    expect(p[2]).toBe('email')
    expect(p[3]).toBe('invoice_available')
    // Severity at index 4, derived (not passed) = 'error' for non-urgent.
    expect(p[4]).toBe('error')
    // status 'open' is the final literal in the VALUES list.
    expect(String(sql)).toContain("'open'")
  })

  it('marks urgent event types critical', async () => {
    const { pool, inserts } = makePool()
    await writeDeadLetter(pool, { ...base, eventKey: 'otp_sent' })
    expect(inserts[0]!.params[4]).toBe('critical')
  })

  it('honors an explicit severity override', async () => {
    const { pool, inserts } = makePool()
    await writeDeadLetter(pool, { ...base, severity: 'critical' })
    expect(inserts[0]!.params[4]).toBe('critical')
  })

  it('sanitizes secret-bearing causes and classifies the error', async () => {
    const { pool, inserts } = makePool()
    await writeDeadLetter(pool, {
      ...base,
      cause: 'HTTP 422 validation rejected with api_key=secret456',
    })
    const p = inserts[0]!.params
    const cause = String(p[7])
    expect(cause).not.toContain('secret456')
    expect(cause).toContain('[REDACTED]')
    // error_category at index 8 derives 'permanent' from the 422 message.
    expect(p[8]).toBe('permanent')
  })

  it('falls back to provider category for ambiguous causes', async () => {
    const { pool, inserts } = makePool()
    await writeDeadLetter(pool, { ...base, cause: 'weird provider noise' })
    expect(inserts[0]!.params[8]).toBe('provider')
  })

  it('stores attempts and idempotency key', async () => {
    const { pool, inserts } = makePool()
    await writeDeadLetter(pool, base)
    const p = inserts[0]!.params
    expect(p[9]).toBe(5) // attempts
    expect(p[10]).toBe(5) // maxAttempts
    expect(p[11]).toBe('k-1') // idempotencyKey
  })

  it('uses the injected pool when provided', async () => {
    const { pool, inserts } = makePool()
    await writeDeadLetter(pool, base)
    expect(inserts).toHaveLength(1)
  })
})
