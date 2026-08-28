import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { ErrorCodes } from '@barghsa/shared/errors'
import type { FailedNotificationsService as ServiceType } from './failed-notifications.service.js'
import {
  maskIdentifier,
  maskSensitiveData,
  toFailedNotificationDto,
} from './failed-notifications.service.js'

// ─── Helpers ──────────────────────────────────────────────────────────

function mockPool() {
  const mockQuery = vi.fn()
  const mockConnect = vi.fn()
  return { mockQuery, mockConnect, pool: { query: mockQuery, connect: mockConnect } }
}

function mockClient(calls: { sql: string; rows?: unknown[]; rowCount?: number }[]) {
  const mockClientQuery = vi.fn((...args: unknown[]) => {
    const norm = (s: string) => s.replace(/\s+/g, ' ')
    const sql = norm(String(args[0] ?? ''))
    const call = calls.find((c) => sql.includes(norm(c.sql)))
    if (call) return Promise.resolve({ rows: call.rows ?? [], rowCount: call.rowCount ?? 0 })
    // default: rollback/commit no-op
    return Promise.resolve({ rows: [], rowCount: 0 })
  })
  const mockRelease = vi.fn()
  return { mockClientQuery, mockRelease, client: { query: mockClientQuery, release: mockRelease } }
}

function mockDbModule(pool: { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }) {
  return { getDbPool: () => pool }
}

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

/** Load the service with a mocked @barghsa/db pool. */
async function loadService() {
  const { pool, mockQuery, mockConnect } = mockPool()
  vi.doMock('@barghsa/db', () => mockDbModule(pool))
  const { FailedNotificationsService: Svc } = await import('./failed-notifications.service.js')
  const service: ServiceType = new Svc()
  return { service, pool, mockQuery, mockConnect }
}

function httpStatus(error: unknown): number | undefined {
  if (error instanceof HttpException) return error.getStatus()
  return undefined
}

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) return error.getResponse() as Record<string, unknown>
  throw new Error(`expected HttpException, got ${String(error)}`)
}

const DL_ROW = {
  id: 'dl-1',
  outbox_id: 'ob-1',
  job_id: 'job-1',
  channel: 'email',
  event_key: 'profile_verified',
  severity: 'error',
  profile_id: 'profile-1234567890',
  user_id: null,
  cause: 'provider timeout',
  error_category: 'transient',
  attempts: 5,
  max_attempts: 5,
  status: 'open',
  resolved_by: null,
  resolved_at: null,
  created_at: new Date('2026-08-28T00:00:00Z'),
  // raw payload joined from notification_outbox
  payload: {
    email: 'user@example.com',
    name: 'Sara',
    profile_code: 'A-10',
    recovery: { token: 'abc123' },
    devices: ['x'],
  },
}

function returnRows(rows: Record<string, unknown>[]) {
  return { rows }
}

// ─── Masking unit tests ───────────────────────────────────────────────

describe('maskSensitiveData / maskIdentifier (T-09.09.03)', () => {
  it('partially masks emails and phone numbers regardless of key', () => {
    expect(maskSensitiveData('user@example.com', 'name')).toBe('u***r@***.com')
    expect(maskSensitiveData('09121234567', 'name')).toBe('*******4567')
  })

  it('fully redacts strings under sensitive keys', () => {
    expect(maskSensitiveData('s3cr3t', 'otp')).toBe('***')
    expect(maskSensitiveData('s3cr3t', 'recovery_token')).toBe('***')
    expect(maskSensitiveData('abc', 'not_sensitive')).toBe('abc')
    // Iranian financial identifiers in billing payloads.
    expect(maskSensitiveData('IR230570028180010453789101', 'sheba')).toBe('***')
    expect(maskSensitiveData('12341234', 'account_number')).toBe('***')
    expect(maskSensitiveData({ bill_id: 'B-123', amount: 250000 })).toEqual({
      bill_id: '***',
      amount: 250000,
    })
  })

  it('redacts non-string secrets under sensitive keys (no type leak)', () => {
    expect(maskSensitiveData(123456, 'otp')).toBe('***')
    expect(maskSensitiveData(4821, 'pin')).toBe('***')
    expect(maskSensitiveData(123456, 'amount')).toBe(123456)
    expect(maskSensitiveData(true, 'not_sensitive')).toBe(true)
  })

  it('redacts whole nested objects under a sensitive parent key', () => {
    expect(maskSensitiveData({ value: 'abc' }, 'token')).toBe('***')
    expect(maskSensitiveData({ otp: 123456, token: { bearer: 'x' } })).toEqual({
      otp: '***',
      token: '***',
    })
  })

  it('matches camelCase sensitive keys', () => {
    expect(
      maskSensitiveData({ otpCode: '123456', emailAddress: 'alice@corp.io', profileCode: 'A-10' }),
    ).toEqual({ otpCode: '***', emailAddress: 'a***e@***.io', profileCode: 'A-10' })
  })

  it('masks PII embedded inside longer strings (e.g. provider causes)', () => {
    expect(maskSensitiveData('SMTP 550 5.1.1 <user@example.com> unknown', 'cause')).toBe(
      'SMTP 550 5.1.1 <u***r@***.com> unknown',
    )
  })

  it('redacts single-use tokens inside URLs', () => {
    // URL-ish keys are fully redacted as sensitive keys.
    expect(maskSensitiveData({ verify_url: 'https://app/verify?token=abc123' })).toEqual({
      verify_url: '***',
    })
    expect(maskSensitiveData('https://app/reset?otp=482913', 'action_url')).toBe('***')
    // A token-bearing URL under a non-sensitive key has its secret param scrubbed.
    expect(maskSensitiveData('https://app/verify?token=abc123&r=1', 'raw')).toBe(
      'https://app/verify?token=***&r=1',
    )
  })

  it('recursively masks nested objects and arrays but keeps safe keys', () => {
    const out = maskSensitiveData({
      name: 'Sara',
      nested: { email: 'sara@corp.io', otp: '123456', ok: true },
      list: [{ phone: '02122334455' }],
    })
    expect(out).toEqual({
      name: 'Sara',
      nested: { email: 's***a@***.io', otp: '***', ok: true },
      list: [{ phone: '*******4455' }],
    })
  })

  it('maskIdentifier shortens ids and hides very short values', () => {
    expect(maskIdentifier('profile-1234567890')).toBe('pr...90')
    expect(maskIdentifier('abc')).toBe('***')
    expect(maskIdentifier(null)).toBeNull()
  })

  it('fully redacts numeric-string secrets under sensitive keys', () => {
    expect(maskSensitiveData('1234567890', 'otp')).toBe('***')
    expect(maskSensitiveData('4829139281', 'token')).toBe('***')
    expect(maskSensitiveData('0012345678', 'national_id')).toBe('***')
    // A genuine phone under a phone-ish key still partial-masks for triage.
    expect(maskSensitiveData('09121234567', 'phone')).toBe('*******4567')
  })
})

// ─── listFailedNotifications ───────────────────────────────────────────

describe('FailedNotificationsService.listFailedNotifications (T-09.09.03)', () => {
  it('lists rows newest-first, maps DTO and masks recipient + payload', async () => {
    const { service, mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce(returnRows([DL_ROW]))
    const result = await service.listFailedNotifications()
    expect(String(mockQuery.mock.calls[0]![0])).toContain(
      'ORDER BY dl.created_at DESC, dl.id DESC',
    )
    expect(result[0]).toMatchObject({
      id: 'dl-1',
      outboxId: 'ob-1',
      jobId: 'job-1',
      channel: 'email',
      eventKey: 'profile_verified',
      status: 'open',
      severity: 'error',
      recipientKey: 'pr...90',
    })
    expect(result[0]!.data).toEqual({
      email: 'u***r@***.com',
      name: 'Sara',
      profile_code: 'A-10',
      recovery: { token: '***' },
      devices: ['x'],
    })
  })

  it('passes status/severity/channel filters through', async () => {
    const { service, mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce(returnRows([]))
    await service.listFailedNotifications({
      status: 'open',
      severity: 'critical',
      channel: 'sms',
    })
    expect(String(mockQuery.mock.calls[0]![0])).toContain('dl.status = $1')
    expect(mockQuery.mock.calls[0]![1]).toEqual(['open', 'critical', 'sms', 50, 0])
  })

  it('rejects an invalid status with 400', async () => {
    const { service, mockQuery } = await loadService()
    const rejection = await service
      .listFailedNotifications({ status: 'bogus' as never })
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('rejects an invalid severity/channel with 400', async () => {
    const { service } = await loadService()
    expect(
      httpStatus(await service.listFailedNotifications({ severity: 'urgent' as never }).catch((e: unknown) => e)),
    ).toBe(400)
    expect(
      httpStatus(await service.listFailedNotifications({ channel: 'push' as never }).catch((e: unknown) => e)),
    ).toBe(400)
  })
})

// ─── retry / resolve / dismiss ─────────────────────────────────────────

describe('FailedNotificationsService transitions (T-09.09.03)', () => {
  it('retry re-queues the outbox + job, marks retried, and audits, atomically', async () => {
    const { service, mockQuery, mockConnect } = await loadService()
    const { mockClientQuery, mockRelease, client } = mockClient([
      { sql: 'BEGIN' },
      // SELECT ... FOR UPDATE
      {
        sql: 'FOR UPDATE OF dl',
        rows: [DL_ROW],
      },
      { sql: 'UPDATE notification_outbox' },
      { sql: 'UPDATE notification_job' },
      { sql: 'UPDATE notification_dead_letter' },
      { sql: 'INSERT INTO audit_log' },
      { sql: 'COMMIT' },
    ])
    mockConnect.mockResolvedValue(client)
    mockQuery.mockResolvedValueOnce(returnRows([DL_ROW]))
    mockClientQuery.mockImplementation((...args: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> => {
      const s = String(args[0] ?? '')
      if (s.includes('UPDATE notification_outbox') || s.includes('UPDATE notification_job')) {
        return Promise.resolve({ rows: [], rowCount: 1 })
      }
      if (s.includes('FOR UPDATE OF dl')) return Promise.resolve({ rows: [DL_ROW] as unknown[], rowCount: 0 })
      return Promise.resolve({ rows: [], rowCount: 0 })
    })

    await service.retryFailedNotification('dl-1', 'admin-1', '127.0.0.1')

    // outbox requeued
    const outboxUpdate = mockClientQuery.mock.calls.find(([s]) =>
      String(s).includes('UPDATE notification_outbox'),
    )![0] as string
    expect(outboxUpdate).toContain("SET status = 'queued', attempts = 0, locked_until = NULL")
    const jobUpdate = mockClientQuery.mock.calls.find(([s]) =>
      String(s).includes('UPDATE notification_job'),
    )![0] as string
    expect(jobUpdate).toContain("SET status = 'queued', attempts = 0, run_after = NOW()")

    const auditCall = mockClientQuery.mock.calls.find(([s]) =>
      String(s).includes('INSERT INTO audit_log'),
    )! as [string, unknown[]]
    expect(auditCall[1][2]).toBe('notification_retried')
    expect(auditCall[1][1]).toBe('admin-1')
    // dead-letter row marked retried by actor
    const dlUpdate = mockClientQuery.mock.calls.find(([s]) =>
      String(s).includes('UPDATE notification_dead_letter'),
    )!
    expect(String(dlUpdate[0])).toContain("SET status = $2")
    expect(dlUpdate[1]).toEqual(['dl-1', 'retried', 'admin-1', expect.any(Date)])
    expect(mockRelease).toHaveBeenCalled()
  })

  it('retry on a non-open row returns 409 and rolls back', async () => {
    const { service, mockConnect } = await loadService()
    const resolved = { ...DL_ROW, status: 'resolved' }
    const { client, mockRelease } = mockClient([
      { sql: 'BEGIN' },
      {
        sql: 'FOR UPDATE OF dl',
        rows: [resolved],
      },
      { sql: 'ROLLBACK' },
    ])
    mockConnect.mockResolvedValue(client)
    const rejection = await service
      .retryFailedNotification('dl-1', 'admin-1', '127.0.0.1')
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(409)
    expect(mockRelease).toHaveBeenCalled()
  })

  it('retry fails closed with 409 when the underlying job is a no-op (not retryable)', async () => {
    const { service, mockConnect } = await loadService()
    const { mockClientQuery, client, mockRelease } = mockClient([
      { sql: 'BEGIN' },
      { sql: 'FOR UPDATE OF dl', rows: [DL_ROW] },
      { sql: 'UPDATE notification_outbox' },
      { sql: 'UPDATE notification_job' },
    ])
    mockConnect.mockResolvedValue(client)
    // Both re-queue updates affect 0 rows -> not actually retryable.
    mockClientQuery.mockImplementation((...args: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> => {
      const s = String(args[0] ?? '')
      if (s.includes('UPDATE notification_outbox') || s.includes('UPDATE notification_job')) {
        return Promise.resolve({ rows: [], rowCount: 0 })
      }
      if (s.includes('FOR UPDATE OF dl')) return Promise.resolve({ rows: [DL_ROW] as unknown[], rowCount: 0 })
      return Promise.resolve({ rows: [], rowCount: 0 })
    })
    const rejection = await service
      .retryFailedNotification('dl-1', 'admin-1', '127.0.0.1')
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(409)
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 409,
      error: ErrorCodes.CONFLICT_STATE.code,
    })
    // No audit row was written for a failed retry.
    const auditCall = mockClientQuery.mock.calls.find(([s]) =>
      String(s).includes('INSERT INTO audit_log'),
    )
    expect(auditCall).toBeUndefined()
    expect(mockRelease).toHaveBeenCalled()
  })

  it('retry on a missing row returns 404', async () => {
    const { service, mockConnect } = await loadService()
    const { client } = mockClient([
      { sql: 'BEGIN' },
      {
        sql: 'FOR UPDATE OF dl',
        rows: [],
      },
    ])
    mockConnect.mockResolvedValue(client)
    const rejection = await service
      .retryFailedNotification('missing', 'admin-1', '127.0.0.1')
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(404)
  })

  it('resolve marks resolved without requeueing', async () => {
    const { service, mockQuery, mockConnect } = await loadService()
    const { mockClientQuery, client } = mockClient([
      { sql: 'BEGIN' },
      {
        sql: 'FOR UPDATE OF dl',
        rows: [DL_ROW],
      },
      { sql: 'UPDATE notification_dead_letter' },
      { sql: 'INSERT INTO audit_log' },
      { sql: 'COMMIT' },
    ])
    mockConnect.mockResolvedValue(client)
    mockQuery.mockResolvedValueOnce(returnRows([DL_ROW]))
    await service.resolveFailedNotification('dl-1', 'admin-1', '127.0.0.1')
    const calls = mockClientQuery.mock.calls.map(([s]) => String(s))
    expect(calls.some((s) => s.includes('UPDATE notification_outbox'))).toBe(false)
    const audit = mockClientQuery.mock.calls.find(([s]) => String(s).includes('INSERT INTO audit_log'))! as [string, unknown[]]
    expect(audit[1][2]).toBe('notification_resolved')
  })

  it('dismiss marks dismissed and audits', async () => {
    const { service, mockQuery, mockConnect } = await loadService()
    const { mockClientQuery, client } = mockClient([
      { sql: 'BEGIN' },
      {
        sql: 'FOR UPDATE OF dl',
        rows: [DL_ROW],
      },
      { sql: 'UPDATE notification_dead_letter' },
      { sql: 'INSERT INTO audit_log' },
      { sql: 'COMMIT' },
    ])
    mockConnect.mockResolvedValue(client)
    mockQuery.mockResolvedValueOnce(returnRows([DL_ROW]))
    await service.dismissFailedNotification('dl-1', 'admin-1', '127.0.0.1')
    const audit = mockClientQuery.mock.calls.find(([s]) => String(s).includes('INSERT INTO audit_log'))! as [string, unknown[]]
    expect(audit[1][2]).toBe('notification_dismissed')
    expect(audit[1][1]).toBe('admin-1')
  })
})

// ─── toFailedNotificationDto export guard ──────────────────────────────

describe('toFailedNotificationDto (exported, T-09.09.03)', () => {
  it('is exported for reuse and maps missing payload to null data', () => {
    const dto = toFailedNotificationDto({ ...DL_ROW, payload: null })
    expect(dto.data).toBeNull()
    expect(dto.severity).toBe('error')
  })
})
