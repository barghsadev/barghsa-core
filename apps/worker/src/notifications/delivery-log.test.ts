import { describe, it, expect } from 'vitest'
import { classifyDeliveryError, writeDeliveryLog, type WriteDeliveryLogInput } from './delivery-log.js'

/**
 * Delivery log writer unit tests (E-05, T-05.01.05).
 *
 * `writeDeliveryLog` is exercised with an injected recording pool to verify
 * the inserted columns, the delivered/failed status derivation, and that
 * secret-bearing error details are sanitized and error_category is derived.
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

const base: WriteDeliveryLogInput = {
  notificationId: 'ob-1',
  channel: 'in_app',
  delivered: true,
  attemptNumber: 1,
  providerRef: 'real-ref',
  latencyMs: 42,
}

describe('classifyDeliveryError', () => {
  it('classifies 4xx/validation as permanent', () => {
    expect(classifyDeliveryError('provider: 422 Validation failed')).toBe('permanent')
    expect(classifyDeliveryError('recipient not found')).toBe('permanent')
  })

  it('classifies timeouts and 5xx as transient', () => {
    expect(classifyDeliveryError('connection timeout after 10s')).toBe('transient')
    expect(classifyDeliveryError('SMTP 503 service unavailable')).toBe('transient')
  })

  it('falls back to provider for ambiguous errors', () => {
    expect(classifyDeliveryError('weird provider noise')).toBe('provider')
  })
})

describe('writeDeliveryLog', () => {
  it('inserts a delivered row with status delivered and no error fields', async () => {
    const { pool, inserts } = makePool()
    await writeDeliveryLog(pool, base)
    const sql = inserts[0]!.sql
    expect(sql).toContain('INSERT INTO notification_delivery_log')
    const p = inserts[0]!.params
    expect(p[0]).toBe('ob-1')
    expect(p[1]).toBe('in_app')
    expect(p[2]).toBe('delivered')
    expect(p[3]).toBe(1)
    expect(p[4]).toBe('real-ref')
    expect(p[5]).toBe(42)
    // Delivered rows carry no error category/detail.
    expect(p[6]).toBeNull()
    expect(p[7]).toBeNull()
  })

  it('inserts a failed row with a classified error category', async () => {
    const { pool, inserts } = makePool()
    await writeDeliveryLog(pool, {
      ...base,
      delivered: false,
      providerRef: null,
      latencyMs: 120,
      error: 'HTTP 422 validation rejected the payload',
    })
    const p = inserts[0]!.params
    expect(p[2]).toBe('failed')
    expect(p[4]).toBeNull()
    expect(p[6]).toBe('permanent')
    expect(String(p[7])).toContain('validation rejected')
  })

  it('sanitizes secret-bearing error details', async () => {
    const { pool, inserts } = makePool()
    await writeDeliveryLog(pool, {
      ...base,
      delivered: false,
      error: 'auth failed with api_key=secret456 token=abc123',
    })
    const p = inserts[0]!.params
    const detail = String(p[7])
    expect(detail).not.toContain('secret456')
    expect(detail).not.toContain('abc123')
    expect(detail).toContain('[REDACTED]')
  })

  it('leaves error fields null when no error is supplied on a failure', async () => {
    const { pool, inserts } = makePool()
    await writeDeliveryLog(pool, { ...base, delivered: false })
    const p = inserts[0]!.params
    expect(p[6]).toBeNull()
    expect(p[7]).toBeNull()
  })
})