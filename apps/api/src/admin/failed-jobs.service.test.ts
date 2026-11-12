import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { FailedJobsService as ServiceType } from './failed-jobs.service.js';
import { toFailedJobDto } from './failed-jobs.service.js';

vi.mock('../session/session-step-up.js', () => ({
  requireCurrentSession: vi.fn().mockResolvedValue(undefined),
  requireSessionStepUp: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./staff-mutation-permission.js', () => ({
  requireStaffMutationPermission: vi.fn().mockResolvedValue(undefined),
}));

// ─── Helpers ──────────────────────────────────────────────────────────

function mockPool() {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
  const mockConnect = vi.fn().mockResolvedValue({
    query: (sql: string, params?: unknown[]) =>
      sql === "SELECT current_setting('barghsa.actor_context', true) AS context"
        ? Promise.resolve({ rows: [{ context: 'staff' }] })
        : mockQuery(sql, ...(params ? [params] : [])),
    release: vi.fn(),
  });
  return { mockQuery, mockConnect, pool: { connect: mockConnect } };
}

function mockDbModule(pool: { connect: ReturnType<typeof vi.fn> }) {
  return { getDbPool: () => pool };
}

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

/** Load the service with a mocked @barghsa/db pool. */
async function loadService() {
  const { pool, mockQuery, mockConnect } = mockPool();
  vi.doMock('@barghsa/db', () => mockDbModule(pool));
  const { FailedJobsService: Svc } = await import('./failed-jobs.service.js');
  const service: ServiceType = new Svc();
  return { service, pool, mockQuery, mockConnect };
}

function httpStatus(error: unknown): number | undefined {
  if (error instanceof HttpException) return error.getStatus();
  return undefined;
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
};
const actor = { userId: 'staff', sessionId: 'session', csrfToken: 'csrf' };

// ─── listFailedJobs ───────────────────────────────────────────────────

describe('FailedJobsService.listFailedJobs (T-09.09.02)', () => {
  it('lists jobs, maps rows to DTOs with a human label, newest-first', async () => {
    const { service, mockQuery } = await loadService();
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [JOB_ROW] });
    const result = await service.listFailedJobs({}, actor);
    expect(result[0]).toMatchObject({
      id: 'job-1',
      jobType: 'service_breach_scan',
      jobLabel: 'Service response-target breach scan',
      status: 'failed',
      attempts: 1,
      maxAttempts: 5,
      resolvedById: null,
    });
    expect(mockQuery).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(String(mockQuery.mock.calls[1]![0])).toContain(
      'ORDER BY bj.first_failed_at DESC, bj.id DESC'
    );
    expect(mockQuery).toHaveBeenLastCalledWith('COMMIT');
  });

  it('passes status/jobType filters through to the query', async () => {
    const { service, mockQuery } = await loadService();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await service.listFailedJobs(
      { status: 'dead_letter', jobType: 'service_escalation_scan' },
      actor
    );
    const params = mockQuery.mock.calls[1]![1] as unknown[];
    expect(params[0]).toBe('dead_letter');
    expect(params[1]).toBe('service_escalation_scan');
  });

  it('rejects an invalid status filter with 400 without querying', async () => {
    const { service, mockConnect } = await loadService();
    const rejection = await service
      .listFailedJobs({ status: 'bogus' as never }, actor)
      .catch((e: unknown) => e);
    expect(httpStatus(rejection)).toBe(400);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('rejects an unknown jobType filter with 400 without querying', async () => {
    const { service, mockConnect } = await loadService();
    const rejection = await service
      .listFailedJobs({ jobType: 'not_a_job' }, actor)
      .catch((e: unknown) => e);
    expect(httpStatus(rejection)).toBe(400);
    expect(mockConnect).not.toHaveBeenCalled();
  });
});

// ─── retryFailedJob ───────────────────────────────────────────────────

// State transitions are covered through the migrated HTTP fixture.
describe('toFailedJobDto', () => {
  it('maps timestamps, join username, and the human job label', () => {
    const dto = toFailedJobDto({
      ...JOB_ROW,
      job_type: 'notification_outbox_poll',
      resolved_by_id: 'u-9',
      resolved_by_username: 'admin9',
      resolved_at: new Date('2026-08-28T01:00:00Z'),
    });
    expect(dto.jobType).toBe('notification_outbox_poll');
    expect(dto.jobLabel).toBe('Notification outbox poll');
    expect(dto.resolvedByUsername).toBe('admin9');
    expect(dto.resolvedAt).toBe('2026-08-28T01:00:00.000Z');
  });

  it('treats null resolved_at/next_run_at as null', () => {
    const dto = toFailedJobDto(JOB_ROW);
    expect(dto.resolvedAt).toBeNull();
    expect(dto.nextRunAt).toBeNull();
    expect(dto.resolvedById).toBeNull();
  });
});
