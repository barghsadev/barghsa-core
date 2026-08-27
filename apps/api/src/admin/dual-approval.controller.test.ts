import { describe, it, expect, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { DualApprovalController } from './dual-approval.controller.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { ErrorCodes } from '@barghsa/shared/errors'

// ─── Fixtures ──────────────────────────────────────────────────────────

const adminReq = {
  session: { isAdmin: true, userId: 'admin-1' },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest

const nonAdminReq = {
  session: { isAdmin: false, userId: 'staff-1' },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest

const DTO = {
  id: 'req-1',
  actionType: 'refund',
  amountIrR: 250_000_000,
  initiatorId: 'admin-1',
  initiatorUsername: 'boss',
  reason: 'refund',
  details: {},
  status: 'pending',
  reviewerId: null,
  reviewerUsername: null,
  reviewReason: null,
  reviewedAt: null,
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z',
}

function makeController() {
  const createApprovalRequest = vi.fn().mockResolvedValue(DTO)
  const listApprovalRequests = vi.fn().mockResolvedValue([DTO])
  const approveApprovalRequest = vi.fn().mockResolvedValue({ ...DTO, status: 'approved' })
  const rejectApprovalRequest = vi.fn().mockResolvedValue({ ...DTO, status: 'rejected' })
  const service = { createApprovalRequest, listApprovalRequests, approveApprovalRequest, rejectApprovalRequest }
  const controller = new DualApprovalController(service as never)
  return { controller, service }
}

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

// ─── Permission gate (S-09.07) ────────────────────────────────────────

describe('DualApprovalController permission gate (S-09.07, admin:financial:edit)', () => {
  it('rejects non-admins on create with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller, service } = makeController()
    const rejection = await controller
      .createApprovalRequest({ action_type: 'refund', amount_irr: 1, reason: 'x' }, nonAdminReq)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
    expect(service.createApprovalRequest).not.toHaveBeenCalled()
  })

  it('rejects non-admins on list with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller, service } = makeController()
    const rejection = await controller
      .listApprovalRequests(undefined, undefined, undefined, nonAdminReq)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(service.listApprovalRequests).not.toHaveBeenCalled()
  })

  it('rejects non-admins on approve with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller, service } = makeController()
    const rejection = await controller
      .approveApprovalRequest('req-1', nonAdminReq)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(service.approveApprovalRequest).not.toHaveBeenCalled()
  })

  it('rejects non-admins on reject with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller, service } = makeController()
    const rejection = await controller
      .rejectApprovalRequest('req-1', { reason: 'nope' }, nonAdminReq)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(service.rejectApprovalRequest).not.toHaveBeenCalled()
  })

  it('forbids reject without a reason even for admins', async () => {
    const { controller, service } = makeController()
    const rejection = await controller
      .rejectApprovalRequest('req-1', {}, adminReq)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(service.rejectApprovalRequest).not.toHaveBeenCalled()
  })
})

// ─── Happy-path delegation ────────────────────────────────────────────

describe('DualApprovalController delegation', () => {
  it('creates a request and passes the actor ip to the service', async () => {
    const { controller, service } = makeController()
    const body = { action_type: 'refund', amount_irr: 250_000_000, reason: 'refund' }
    const result = await controller.createApprovalRequest(body, adminReq)
    expect(result.id).toBe('req-1')
    expect(service.createApprovalRequest).toHaveBeenCalledWith(body, 'admin-1', '127.0.0.1')
  })

  it('lists requests with parsed query params', async () => {
    const { controller, service } = makeController()
    const result = await controller.listApprovalRequests('pending', '25', '10', adminReq)
    expect(result).toHaveLength(1)
    expect(service.listApprovalRequests).toHaveBeenCalledWith({
      status: 'pending',
      limit: 25,
      offset: 10,
    })
  })

  it('omits missing query params so service defaults apply', async () => {
    const { controller, service } = makeController()
    await controller.listApprovalRequests(undefined, undefined, undefined, adminReq)
    expect(service.listApprovalRequests).toHaveBeenCalledWith({})
  })

  it('approves and delegates the actor id/ip', async () => {
    const { controller, service } = makeController()
    const result = await controller.approveApprovalRequest('req-1', adminReq)
    expect(result.status).toBe('approved')
    expect(service.approveApprovalRequest).toHaveBeenCalledWith('req-1', 'admin-1', '127.0.0.1')
  })

  it('rejects with a trimmed reason', async () => {
    const { controller, service } = makeController()
    const result = await controller.rejectApprovalRequest(
      'req-1',
      { reason: '  duplicate  ' },
      adminReq,
    )
    expect(result.status).toBe('rejected')
    expect(service.rejectApprovalRequest).toHaveBeenCalledWith(
      'req-1',
      'admin-1',
      '127.0.0.1',
      'duplicate',
    )
  })
})