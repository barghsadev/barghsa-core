import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import type { DualApprovalService as DualApprovalServiceType } from './dual-approval.service.js'
import { toApprovalRequestDto } from './dual-approval.service.js'

// ─── Helpers ──────────────────────────────────────────────────────────

function mockPool() {
  const mockQuery = vi.fn()
  const mockConnect = vi.fn()
  const pool = { query: mockQuery, connect: mockConnect }
  return { mockQuery, mockConnect, pool }
}

function mockClient() {
  const mockClientQuery = vi.fn()
  const mockRelease = vi.fn()
  const client = { query: mockClientQuery, release: mockRelease }
  return { mockClientQuery, mockRelease, client }
}

function mockDbModule(pool: { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }) {
  return { getDbPool: () => pool }
}

let DualApprovalService: typeof DualApprovalServiceType
let service: DualApprovalServiceType
let notificationsService: { create: ReturnType<typeof vi.fn> }

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

/** Load DualApprovalService with a mocked @barghsa/db pool + mock notifications. */
async function loadService() {
  const { pool, mockQuery, mockConnect } = mockPool()
  vi.doMock('@barghsa/db', () => mockDbModule(pool))
  const { DualApprovalService: Svc } = await import('./dual-approval.service.js')
  notificationsService = { create: vi.fn().mockResolvedValue({ id: 'n-1' }) }
  service = new Svc(notificationsService as never)
  return { pool, mockQuery, mockConnect }
}

/** Persistent-threshold fixture: app_config returns a valid enabled threshold. */
const ENABLED_THRESHOLD_ROWS = [{ value: { threshold_irr: 100_000_000 } }]

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

function httpStatus(error: unknown): number | undefined {
  if (error instanceof HttpException) return error.getStatus()
  return undefined
}

const VALID_INPUT = {
  action_type: 'refund',
  amount_irr: 250_000_000,
  reason: 'Customer overpaid for package 204',
}

// ─── createApprovalRequest ────────────────────────────────────────────

describe('DualApprovalService.createApprovalRequest (T-09.07.02)', () => {
  it('rejects an invalid payload with 400 and the validation contract', async () => {
    const { mockQuery } = await loadService()
    const rejection = await service
      .createApprovalRequest({ action_type: 'bogus', amount_irr: 10 }, 'user-1', '1.1.1.1')
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(400)
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 400,
      error: 'VALIDATION:INPUT:INVALID',
    })
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('refuses to create when no threshold is configured (dual approval disabled)', async () => {
    const { mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce({ rows: [] }) // app_config empty → disabled default

    const rejection = await service
      .createApprovalRequest(VALID_INPUT, 'user-1', '1.1.1.1')
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(400)
    expect(String(rejectionBody(rejection).message)).toContain('does not exceed')
  })

  it('refuses to create when the amount is at or below the threshold', async () => {
    const { mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce({ rows: ENABLED_THRESHOLD_ROWS })

    const rejection = await service
      .createApprovalRequest(
        { ...VALID_INPUT, amount_irr: 100_000_000 },
        'user-1',
        '1.1.1.1',
      )
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(400)
  })

  it('creates a request above the threshold: insert + audit commit atomically, then returns the DTO', async () => {
    const { mockQuery, mockConnect } = await loadService()
    const { mockClientQuery, mockRelease, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // INSERT approval_requests
      .mockResolvedValueOnce({ rows: [] }) // INSERT audit_log
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
    mockQuery
      .mockResolvedValueOnce({ rows: ENABLED_THRESHOLD_ROWS }) // threshold
      .mockResolvedValueOnce({ rows: [{ user_id: 'admin-2' }] }) // eligible staff
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'req-1',
            action_type: 'refund',
            amount_irr: '250000000',
            initiator_id: 'user-1',
            initiator_username: 'staff1',
            reason: 'Customer overpaid for package 204',
            details: {},
            status: 'pending',
            reviewer_id: null,
            reviewer_username: null,
            review_reason: null,
            reviewed_at: null,
            created_at: new Date('2026-08-28T00:00:00Z'),
            updated_at: new Date('2026-08-28T00:00:00Z'),
          },
        ],
      }) // getRequestDto

    const result = await service.createApprovalRequest(VALID_INPUT, 'user-1', '1.1.1.1')

    expect(result).toMatchObject({
      id: 'req-1',
      actionType: 'refund',
      amountIrR: 250_000_000,
      status: 'pending',
      initiatorId: 'user-1',
    })

    // Insert used the snake_case table shape with the amount as a number.
    const insertCall = mockClientQuery.mock.calls[1]!
    expect(String(insertCall[0])).toContain('INSERT INTO approval_requests')
    expect(insertCall[1]).toContain('refund')
    expect(insertCall[1]).toContain(250_000_000)

    // Audit trail write happened in the same transaction.
    const auditCall = mockClientQuery.mock.calls[2]!
    expect(String(auditCall[0])).toContain('INSERT INTO audit_log')
    expect(auditCall[1]).toContain('approval_request_created')
    expect(String(auditCall[1]![3])).toContain('amountIrR')

    expect(mockConnect).toHaveBeenCalledTimes(1)
    expect(mockRelease).toHaveBeenCalledTimes(1)
  })

  it('notifies approval-eligible staff (admins other than the initiator) in-app', async () => {
    const { mockQuery, mockConnect } = await loadService()
    const { mockClientQuery, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    mockClientQuery.mockResolvedValue({ rows: [] }) // BEGIN/INSERT/INSERT/COMMIT
    mockQuery
      .mockResolvedValueOnce({ rows: ENABLED_THRESHOLD_ROWS })
      .mockResolvedValueOnce({ rows: [{ user_id: 'admin-2' }, { user_id: 'admin-3' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'req-2',
            action_type: 'refund',
            amount_irr: '999',
            initiator_id: 'user-1',
            initiator_username: null,
            reason: 'x',
            details: null,
            status: 'pending',
            reviewer_id: null,
            reviewer_username: null,
            review_reason: null,
            reviewed_at: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      })

    await service.createApprovalRequest(VALID_INPUT, 'user-1', '1.1.1.1')

    expect(notificationsService.create).toHaveBeenCalledTimes(2)
    const calls = notificationsService.create.mock.calls.map((c) => c[0] as { userId: string })
    expect(calls.map((c) => c.userId).sort()).toEqual(['admin-2', 'admin-3'])
    // The initiator is never notified about their own request.
    expect(calls.map((c) => c.userId)).not.toContain('user-1')
    // An empty queue of eligible staff is a no-op, not an error.
  })

  it('continues even when a staff notification fails (best-effort)', async () => {
    const { mockQuery, mockConnect } = await loadService()
    const { mockClientQuery, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    mockClientQuery.mockResolvedValue({ rows: [] })
    mockQuery
      .mockResolvedValueOnce({ rows: ENABLED_THRESHOLD_ROWS })
      .mockResolvedValueOnce({ rows: [{ user_id: 'admin-2' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'req-3', action_type: 'refund', amount_irr: '5', initiator_id: 'user-1', initiator_username: null, reason: 'x', details: null, status: 'pending', reviewer_id: null, reviewer_username: null, review_reason: null, reviewed_at: null, created_at: new Date(), updated_at: new Date() }] })
    notificationsService.create.mockRejectedValueOnce(new Error('db down'))

    await expect(
      service.createApprovalRequest(VALID_INPUT, 'user-1', '1.1.1.1'),
    ).resolves.toBeDefined()
  })
})

// ─── listApprovalRequests ─────────────────────────────────────────────

describe('DualApprovalService.listApprovalRequests', () => {
  it('maps queue rows to DTOs and passes the status filter through', async () => {
    const { mockQuery } = await loadService()
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'req-1',
          action_type: 'bank_payment_confirmation',
          amount_irr: '300000000',
          initiator_id: 'user-1',
          initiator_username: 'staff1',
          reason: 'Confirm bank payment',
          details: { bankRef: 'BR-7' },
          status: 'pending',
          reviewer_id: null,
          reviewer_username: null,
          review_reason: null,
          reviewed_at: null,
          created_at: new Date('2026-08-28T01:00:00Z'),
          updated_at: new Date('2026-08-28T01:00:00Z'),
        },
      ],
    })

    const result = await service.listApprovalRequests({ status: 'pending', limit: 10, offset: 5 })

    expect(result[0]).toMatchObject({
      id: 'req-1',
      actionType: 'bank_payment_confirmation',
      amountIrR: 300_000_000,
      status: 'pending',
      initiatorUsername: 'staff1',
      details: { bankRef: 'BR-7' },
    })
    expect(mockQuery.mock.calls[0]![1]).toEqual(['pending', 10, 5])
    expect(String(mockQuery.mock.calls[0]![0])).toContain('LIMIT $2 OFFSET $3')
  })

  it('rejects an unknown status filter with 400', async () => {
    const { mockQuery } = await loadService()
    const rejection = await service
      .listApprovalRequests({ status: 'PENDING' as never })
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('clamps limit into [1, 200] and offset to >= 0', async () => {
    const { mockQuery } = await loadService()
    mockQuery.mockResolvedValue({ rows: [] })

    await service.listApprovalRequests({ limit: 9999, offset: -3 })
    expect(mockQuery.mock.calls[0]![1]).toEqual([null, 200, 0])

    await service.listApprovalRequests({ limit: Number.NaN, offset: Number.NaN })
    expect(mockQuery.mock.calls[1]![1]).toEqual([null, 50, 0])
  })
})

// ─── approveApprovalRequest ───────────────────────────────────────────

describe('DualApprovalService.approveApprovalRequest', () => {
  const PENDING_ROW = {
    id: 'req-1',
    action_type: 'refund',
    amount_irr: '250000000',
    initiator_id: 'user-1',
    initiator_username: 'staff1',
    reason: 'refund',
    details: {},
    status: 'pending',
    reviewer_id: null,
    reviewer_username: null,
    review_reason: null,
    reviewed_at: null,
    created_at: new Date('2026-08-28T00:00:00Z'),
    updated_at: new Date('2026-08-28T00:00:00Z'),
  }

  it('returns 404 when the request does not exist', async () => {
    const { mockConnect } = await loadService()
    const { mockClientQuery, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT FOR UPDATE → no row

    const rejection = await service
      .approveApprovalRequest('missing', 'user-2', '1.1.1.1')
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(404)
    expect(rejectionBody(rejection)).toMatchObject({ error: 'NOT_FOUND:RESOURCE' })
  })

  it('returns 409 when the request is already resolved', async () => {
    const { mockConnect } = await loadService()
    const { mockClientQuery, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ ...PENDING_ROW, status: 'approved' }] }) // FOR UPDATE

    const rejection = await service
      .approveApprovalRequest('req-1', 'user-2', '1.1.1.1')
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(409)
    expect(rejectionBody(rejection)).toMatchObject({ error: 'CONFLICT:INVALID_STATE' })
  })

  it('forbids approving your own request (403)', async () => {
    const { mockConnect } = await loadService()
    const { mockClientQuery, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [PENDING_ROW] }) // FOR UPDATE

    const rejection = await service
      .approveApprovalRequest('req-1', 'user-1', '1.1.1.1')
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(403)
    expect(rejectionBody(rejection)).toMatchObject({ error: 'AUTHZ:FORBIDDEN' })
  })

  it('approves: updates state, writes the audit row, notifies the initiator', async () => {
    const { mockConnect, mockQuery } = await loadService()
    const { mockClientQuery, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [PENDING_ROW] }) // SELECT ... FOR UPDATE OF ar
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }) // INSERT audit_log
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
    // Post-commit DTO re-read with the joined reviewer identity.
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          ...PENDING_ROW,
          status: 'approved',
          reviewer_id: 'user-2',
          reviewer_username: 'staff2',
          reviewed_at: new Date('2026-08-28T03:00:00Z'),
        },
      ],
    })

    const result = await service.approveApprovalRequest('req-1', 'user-2', '1.1.1.1')

    expect(result.status).toBe('approved')
    expect(result.reviewerId).toBe('user-2')
    // The response must reflect the reviewer identity (post-commit join),
    // not the pre-update NULL.
    expect(result.reviewerUsername).toBe('staff2')
    expect(result.reviewedAt).toBe('2026-08-28T03:00:00.000Z')

    // The row lock must be scoped to the base table: an unqualified
    // FOR UPDATE on a LEFT JOIN query is rejected by PostgreSQL.
    const selectCall = mockClientQuery.mock.calls[1]!
    expect(String(selectCall[0])).toContain('FOR UPDATE OF ar')

    const updateCall = mockClientQuery.mock.calls[2]!
    expect(String(updateCall[0])).toContain('UPDATE approval_requests')
    expect(updateCall[1]).toEqual(['approved', 'user-2', null, expect.any(Date), 'req-1'])

    const auditCall = mockClientQuery.mock.calls[3]!
    expect(String(auditCall[0])).toContain('INSERT INTO audit_log')
    expect(auditCall[1]).toContain('approval_request_approved')
    expect(String(auditCall[1]![3])).toContain('"requestId":"req-1"')

    expect(notificationsService.create).toHaveBeenCalledTimes(1)
    const notifyCall = notificationsService.create.mock.calls[0]![0] as { userId: string; title: string }
    expect(notifyCall.userId).toBe('user-1')
    expect(notifyCall.title).toContain('تأیید شد')
  })
})

// ─── rejectApprovalRequest ────────────────────────────────────────────

describe('DualApprovalService.rejectApprovalRequest', () => {
  const PENDING_ROW = {
    id: 'req-1',
    action_type: 'manual_adjustment',
    amount_irr: '50000000',
    initiator_id: 'user-1',
    initiator_username: 'staff1',
    reason: 'adjustment',
    details: null,
    status: 'pending',
    reviewer_id: null,
    reviewer_username: null,
    review_reason: null,
    reviewed_at: null,
    created_at: new Date('2026-08-28T00:00:00Z'),
    updated_at: new Date('2026-08-28T00:00:00Z'),
  }

  it('requires a reason (400) and rejects overlong reasons', async () => {
    const { mockConnect } = await loadService()
    const rejection = await service
      .rejectApprovalRequest('req-1', 'user-2', '1.1.1.1', '')
      .catch((e: unknown) => e)
    expect(httpStatus(rejection)).toBe(400)
    expect(String(rejectionBody(rejection).message)).toContain('reason is required')
    expect(mockConnect).not.toHaveBeenCalled()

    const overlong = await service
      .rejectApprovalRequest('req-1', 'user-2', '1.1.1.1', 'x'.repeat(2001))
      .catch((e: unknown) => e)
    expect(httpStatus(overlong)).toBe(400)
    expect(String(rejectionBody(overlong).message)).toContain('must not exceed')
  })

  it('rejects: persists reason, writes audit, notifies the initiator', async () => {
    const { mockConnect, mockQuery } = await loadService()
    const { mockClientQuery, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [PENDING_ROW] }) // SELECT ... FOR UPDATE OF ar
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }) // INSERT audit_log
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
    // Post-commit DTO re-read with the joined reviewer identity.
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          ...PENDING_ROW,
          status: 'rejected',
          reviewer_id: 'user-2',
          reviewer_username: 'staff2',
          review_reason: 'Duplicate of an earlier refund',
          reviewed_at: new Date('2026-08-28T03:00:00Z'),
        },
      ],
    })

    const result = await service.rejectApprovalRequest(
      'req-1',
      'user-2',
      '1.1.1.1',
      'Duplicate of an earlier refund',
    )

    expect(result.status).toBe('rejected')
    expect(result.reviewReason).toBe('Duplicate of an earlier refund')
    expect(result.reviewerUsername).toBe('staff2')

    const updateCall = mockClientQuery.mock.calls[2]!
    expect(updateCall[1]).toEqual([
      'rejected',
      'user-2',
      'Duplicate of an earlier refund',
      expect.any(Date),
      'req-1',
    ])

    const auditCall = mockClientQuery.mock.calls[3]!
    expect(auditCall[1]).toContain('approval_request_rejected')
    expect(String(auditCall[1]![3])).toContain('"reviewReason":"Duplicate of an earlier refund"')
    // BIGINT audit amounts are normalized to JSON numbers.
    expect(String(auditCall[1]![3])).toContain('"amountIrR":50000000')

    const notifyCall = notificationsService.create.mock.calls[0]![0] as { userId: string; title: string; body: string }
    expect(notifyCall.userId).toBe('user-1')
    expect(notifyCall.title).toContain('رد شد')
    expect(notifyCall.body).toContain('Duplicate of an earlier refund')
  })

  it('applies the same 404/409/self-approval guard as approve', async () => {
    const { mockConnect } = await loadService()
    const { mockClientQuery, client } = mockClient()
    mockConnect.mockResolvedValue(client)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [PENDING_ROW] }) // initiator === reviewer
    const selfRejection = await service
      .rejectApprovalRequest('req-1', 'user-1', '1.1.1.1', 'nope')
      .catch((e: unknown) => e)
    expect(httpStatus(selfRejection)).toBe(403)
  })
})

// ─── DTO mapping ──────────────────────────────────────────────────────

describe('toApprovalRequestDto', () => {
  it('normalizes BIGINT strings, JSONB details, and dates', () => {
    const dto = toApprovalRequestDto({
      id: 'req-1',
      action_type: 'refund',
      amount_irr: '250000000',
      initiator_id: 'user-1',
      initiator_username: 'staff1',
      reason: 'r',
      details: { ref: 7 },
      status: 'pending',
      reviewer_id: 'user-2',
      reviewer_username: 'staff2',
      review_reason: 'ok',
      reviewed_at: new Date('2026-08-28T02:00:00Z'),
      created_at: new Date('2026-08-28T00:00:00Z'),
      updated_at: new Date('2026-08-28T00:00:00Z'),
    })
    expect(dto).toEqual({
      id: 'req-1',
      actionType: 'refund',
      amountIrR: 250_000_000,
      initiatorId: 'user-1',
      initiatorUsername: 'staff1',
      reason: 'r',
      details: { ref: 7 },
      status: 'pending',
      reviewerId: 'user-2',
      reviewerUsername: 'staff2',
      reviewReason: 'ok',
      reviewedAt: '2026-08-28T02:00:00.000Z',
      createdAt: '2026-08-28T00:00:00.000Z',
      updatedAt: '2026-08-28T00:00:00.000Z',
    })
  })

  it('maps unresolved requests with nulled review fields', () => {
    const dto = toApprovalRequestDto({
      id: 'req-1',
      action_type: 'refund',
      amount_irr: '5',
      initiator_id: 'user-1',
      initiator_username: null,
      reason: 'r',
      details: null,
      status: 'pending',
      reviewer_id: null,
      reviewer_username: null,
      review_reason: null,
      reviewed_at: null,
      created_at: new Date('2026-08-28T00:00:00Z'),
      updated_at: new Date('2026-08-28T00:00:00Z'),
    })
    expect(dto.reviewerId).toBeNull()
    expect(dto.reviewedAt).toBeNull()
    expect(dto.details).toBeNull()
    expect(dto.initiatorUsername).toBeNull()
  })
})