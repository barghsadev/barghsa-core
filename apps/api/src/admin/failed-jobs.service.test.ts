import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import type { FailedJobsService as ServiceType } from './failed-jobs.service.js'
import { toFailedJobDto } from './failed-jobs.service.js'

// ─── Helpers ──────────────────────────────────────────────────────────

function mockPool() {
  const mockQuery = vi.fn()
  const mockConnect = vi.fn()
  return { mockQuery, mockConnect, pool: { query: mockQuery, connect: mockConnect } }
}

function mockClient() {
  const mockClientQuery = vi.fn()
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
  const { FailedJobsService: Svc } = await import('./failed-jobs.service.js')
  const service: ServiceType = new Svc()
  return { service, pool, mockQuery, mockConnect }
}

function httpStatus(error: unknown): number | undefined {
  if (error instanceof HttpException) return error.getStatus()
  return undefined
}

const JOB_ROW = {
  id: 'job-1',
  job_type: 'service_breach_scan',
  status: 'failed',
  error: 'scan blew up',
  error_category: 'transient',
  attempts: 1,
  max_attempts: 5,
  payload: { errors: 3 },
  first_failed_at: new Date('2026-08-28T00:00:00Z'),
  last_run_at: new Date('2026-08-28T00:00:00Z'),
  next_run_at: null,
  resolved_by_id: null,
  resolved_by_username: null,
  resolved_at: null,
  created_at: new Date('2026-08-28T00:00:00Z'),
  updated_at: new Date('2026-08-28T00:00:00Z'),
}

function returnRow(row: Record<string, unknown>) {
  return { rows: [row] }
}

// ─── listFailedJobs ───────────────────────────────────────────────────

describe('FailedJobsService.listFailedJobs (T-09.09.02)', () => {
  it('lists jobs, maps rows to DTOs with a human label, newest-first', async () => {
    const { service, mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce({ rows: [JOB_ROW] })
    const result = await service.listFailedJobs()
    expect(result[0]).toMatchObject({
      id: 'job-1',
      jobType: 'service_breach_scan',
      jobLabel: 'Service response-target breach scan',
      status: 'failed',
      attempts: 1,
      maxAttempts: 5,
      resolvedById: null,
    })
    expect(String(mockQuery.mock.calls[0]![0])).toContain(
      'ORDER BY bj.first_failed_at DESC, bj.id DESC',
    )
  })

  it('passes status/jobType filters through to the query', async () => {
    const { service, mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await service.listFailedJobs({ status: 'dead_letter', jobType: 'service_escalation_scan' })
    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[0]).toBe('dead_letter')
    expect(params[1]).toBe('service_escalation_scan')
  })

  it('rejects an invalid status filter with 400 without querying', async () => {
    const { service, mockQuery } = await loadService()
    const rejection = await service
      .listFailedJobs({ status: 'bogus' as never })
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('rejects an unknown jobType filter with 400 without querying', async () => {
    const { service, mockQuery } = await loadService()
    const rejection = await service
      .listFailedJobs({ jobType: 'not_a_job' })
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })
})

// ─── retryFailedJob ───────────────────────────────────────────────────

describe('FailedJobsService.retryFailedJob (T-09.09.02)', () => {
  it('moves failed → retrying, resets the attempt budget, and audits', async () => {
    const { service, mockConnect, mockQuery } = await loadService()
    const { mockClientQuery, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce(returnRow(JOB_ROW)) // locked SELECT
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }) // audit INSERT
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
    mockQuery.mockResolvedValueOnce(
      returnRow({ ...JOB_ROW, status: 'retrying', attempts: 1, next_run_at: new Date() }),
    ) // DTO read

    const dto = await service.retryFailedJob('job-1', 'admin-1', '1.1.1.1')

    expect(dto).toMatchObject({ id: 'job-1', status: 'retrying', attempts: 1 })

    const updateCall = mockClientQuery.mock.calls[2]!
    expect(String(updateCall[0])).toContain("status = 'retrying'")
    expect(updateCall[1]![0]).toBe('job-1')
    // resetAttempts=true → attempts reset to 1
    expect(updateCall[1]![1]).toBe(true)
    expect(mockClientQuery.mock.calls[3]![1]![2]).toBe('job_retry_requested')
    expect(mockClientQuery.mock.calls[3]![1]![3]).toContain('backgroundJobId')
  })

  it('rejects a retry on a resolved job with 409 and never issues an UPDATE', async () => {
    const { service, mockConnect } = await loadService()
    const { mockClientQuery, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce(returnRow({ ...JOB_ROW, status: 'resolved' })) // locked SELECT
    const rejection = await service
      .retryFailedJob('job-1', 'admin', '1.1.1.1')
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(409)
    const calls = mockClientQuery.mock.calls.map((c) => String(c[0]))
    expect(calls.some((sql) => sql.includes('UPDATE background_jobs'))).toBe(false)
    expect(calls.some((sql) => sql.includes('INSERT INTO audit_log'))).toBe(false)
  })

  it('returns 404 for a missing job', async () => {
    const { service, mockConnect } = await loadService()
    const { mockClientQuery, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // locked SELECT empty
    const rejection = await service
      .retryFailedJob('missing', 'admin', '1.1.1.1')
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(404)
  })
})

// ─── retryFailedJobsBulk ──────────────────────────────────────────────

describe('FailedJobsService.retryFailedJobsBulk (T-09.09.02)', () => {
  it('rejects an empty ids array with 400', async () => {
    const { service, mockQuery } = await loadService()
    const rejection = await service
      .retryFailedJobsBulk([], 'admin', '1.1.1.1')
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('retries every retryable id', async () => {
    const { service, mockConnect, mockQuery } = await loadService()
    const { mockClientQuery, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    // Two happy-path transitions: BEGIN/SELECT/UPDATE/audit/COMMIT each.
    for (let i = 0; i < 2; i++) {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce(returnRow(JOB_ROW)) // locked SELECT
        .mockResolvedValueOnce({ rows: [] }) // UPDATE
        .mockResolvedValueOnce({ rows: [] }) // audit INSERT
        .mockResolvedValueOnce({ rows: [] }) // COMMIT
      mockQuery.mockResolvedValueOnce(returnRow({ ...JOB_ROW, status: 'retrying' })) // DTO
    }

    const results = await service.retryFailedJobsBulk(['job-1', 'job-2'], 'admin', '1.1.1.1')

    expect(results).toHaveLength(2)
    expect(results.every((r) => r.status === 'retrying')).toBe(true)
  })

  it('skips an id that is already resolved (409) without aborting the batch', async () => {
    const { service, mockConnect, mockQuery } = await loadService()
    const { mockClientQuery, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    // job-1 happy path.
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce(returnRow(JOB_ROW)) // SELECT
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }) // audit
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
    mockQuery.mockResolvedValueOnce(returnRow({ ...JOB_ROW, status: 'retrying' })) // DTO job-1
    // job-2 already resolved → 409 → skipped.
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce(returnRow({ ...JOB_ROW, status: 'resolved' })) // SELECT

    const results = await service.retryFailedJobsBulk(['job-1', 'job-2'], 'admin', '1.1.1.1')

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ id: 'job-1', status: 'retrying' })
  })

  it('skips an id that is missing (404) without aborting the batch', async () => {
    const { service, mockConnect, mockQuery } = await loadService()
    const { mockClientQuery, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    // job-1 happy path.
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce(returnRow(JOB_ROW)) // SELECT
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }) // audit
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
    mockQuery.mockResolvedValueOnce(returnRow({ ...JOB_ROW, status: 'retrying' })) // DTO job-1
    // missing job: SELECT returns empty row-set → 404 → skipped.
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT (empty)

    const results = await service.retryFailedJobsBulk(['job-1', 'missing'], 'admin', '1.1.1.1')

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ id: 'job-1', status: 'retrying' })
  })
})

// ─── resolveFailedJob ─────────────────────────────────────────────────

describe('FailedJobsService.resolveFailedJob (T-09.09.02)', () => {
  it('moves failed → resolved, records the resolver, and audits', async () => {
    const { service, mockConnect, mockQuery } = await loadService()
    const { mockClientQuery, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce(returnRow(JOB_ROW)) // locked SELECT
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }) // audit INSERT
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
    mockQuery.mockResolvedValueOnce(
      returnRow({
        ...JOB_ROW,
        status: 'resolved',
        resolved_by_id: 'admin-1',
        resolved_at: new Date('2026-08-28T01:00:00Z'),
      }),
    ) // DTO read

    const dto = await service.resolveFailedJob('job-1', 'admin-1', '1.1.1.1')

    expect(dto).toMatchObject({
      id: 'job-1',
      status: 'resolved',
      resolvedById: 'admin-1',
      resolvedAt: '2026-08-28T01:00:00.000Z',
    })

    const updateCall = mockClientQuery.mock.calls[2]!
    expect(String(updateCall[0])).toContain("status = 'resolved'")
    expect(updateCall[1]![0]).toBe('job-1')
    expect(updateCall[1]![1]).toBe('admin-1')
    expect(mockClientQuery.mock.calls[3]![1]![2]).toBe('job_resolved')
  })

  it('rejects a resolve when already resolved with 409', async () => {
    const { service, mockConnect } = await loadService()
    const { mockClientQuery, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce(returnRow({ ...JOB_ROW, status: 'resolved' })) // locked SELECT
    const rejection = await service
      .resolveFailedJob('job-1', 'admin', '1.1.1.1')
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(409)
    const calls = mockClientQuery.mock.calls.map((c) => String(c[0]))
    expect(calls.some((sql) => sql.includes('UPDATE background_jobs'))).toBe(false)
  })
})

// ─── toFailedJobDto ───────────────────────────────────────────────────

describe('toFailedJobDto', () => {
  it('maps timestamps, join username, and the human job label', () => {
    const dto = toFailedJobDto({
      ...JOB_ROW,
      job_type: 'notification_outbox_poll',
      resolved_by_id: 'u-9',
      resolved_by_username: 'admin9',
      resolved_at: new Date('2026-08-28T01:00:00Z'),
    })
    expect(dto.jobType).toBe('notification_outbox_poll')
    expect(dto.jobLabel).toBe('Notification outbox poll')
    expect(dto.resolvedByUsername).toBe('admin9')
    expect(dto.resolvedAt).toBe('2026-08-28T01:00:00.000Z')
  })

  it('treats null resolved_at/next_run_at as null', () => {
    const dto = toFailedJobDto(JOB_ROW)
    expect(dto.resolvedAt).toBeNull()
    expect(dto.nextRunAt).toBeNull()
    expect(dto.resolvedById).toBeNull()
  })
})
