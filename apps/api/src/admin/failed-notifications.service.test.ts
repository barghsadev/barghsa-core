import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
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
    const sql = String(args[0] ?? '')
    const call = calls.find((c) => sql.includes(c.sql))
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

  it('fully redacts values under sensitive keys', () => {
    expect(maskSensitiveData('s3cr3t', 'otp')).toBe('***')
    expect(maskSensitiveData('s3cr3t', 'recovery_token')).toBe('***')
    expect(maskSensitiveData('abc', 'not_sensitive')).toBe('abc')
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
    expect(maskIdentifier('profile-1234567890')).toBe('pr…90')
    expect(maskIdentifier('abc')).toBe('***')
    expect(maskIdentifier(null)).toBeNull()
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
      recipientKey: 'pr…90',
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
        sql: 'SELECT dl.*, ob.payload\n           FROM notification_dead_letter dl\n           LEFT JOIN notification_outbox ob ON ob.id = dl.outbox_id\n          WHERE dl.id = $1\n          FOR UPDATE OF dl',
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
        sql: 'SELECT dl.*, ob.payload\n           FROM notification_dead_letter dl\n           LEFT JOIN notification_outbox ob ON ob.id = dl.outbox_id\n          WHERE dl.id = $1\n          FOR UPDATE OF dl',
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

  it('retry on a missing row returns 404', async () => {
    const { service, mockConnect } = await loadService()
    const { client } = mockClient([
      { sql: 'BEGIN' },
      {
        sql: 'SELECT dl.*, ob.payload\n           FROM notification_dead_letter dl\n           LEFT JOIN notification_outbox ob ON ob.id = dl.outbox_id\n          WHERE dl.id = $1\n          FOR UPDATE OF dl',
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
        sql: 'SELECT dl.*, ob.payload\n           FROM notification_dead_letter dl\n           LEFT JOIN notification_outbox ob ON ob.id = dl.outbox_id\n          WHERE dl.id = $1\n          FOR UPDATE OF dl',
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
        sql: 'SELECT dl.*, ob.payload\n           FROM notification_dead_letter dl\n           LEFT JOIN notification_outbox ob ON ob.id = dl.outbox_id\n          WHERE dl.id = $1\n          FOR UPDATE OF dl',
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
