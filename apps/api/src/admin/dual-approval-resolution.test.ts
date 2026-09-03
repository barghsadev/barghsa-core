import { describe, it, expect, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  applyApprovalRequestResolutionOnClient,
  APPROVAL_REQUEST_APPROVED_EVENT,
  APPROVAL_REQUEST_REJECTED_EVENT,
} from './dual-approval-resolution.js'

function mockClient() {
  const query = vi.fn().mockResolvedValue({ rows: [] })
  return { query }
}

const BASE = {
  requestId: 'req-1',
  reviewerUserId: 'user-2',
  ip: '10.0.0.9',
  now: new Date('2026-09-03T12:00:00.000Z'),
  initiatorId: 'user-1',
  status: 'pending',
  actionType: 'bank_payment_confirmation',
  amountIrR: '500000',
  correlationId: 'corr-1',
}

describe('applyApprovalRequestResolutionOnClient', () => {
  it('approves a pending request and writes approval_request_approved', async () => {
    const client = mockClient()
    await applyApprovalRequestResolutionOnClient(client, {
      ...BASE,
      decision: 'approve',
      reviewReason: null,
    })

    expect(client.query).toHaveBeenCalledTimes(2)
    expect(String(client.query.mock.calls[0]![0])).toContain('UPDATE approval_requests')
    expect(client.query.mock.calls[0]![1]).toEqual([
      'approved',
      'user-2',
      null,
      BASE.now,
      'req-1',
    ])

    const audit = client.query.mock.calls[1]!
    expect(String(audit[0])).toContain('INSERT INTO audit_log')
    expect(audit[1]).toContain(APPROVAL_REQUEST_APPROVED_EVENT)
    expect(String(audit[1]![3])).toContain('"requestId":"req-1"')
    expect(String(audit[1]![3])).toContain('"initiatorUserId":"user-1"')
    expect(String(audit[1]![3])).toContain('"reviewerUserId":"user-2"')
    expect(String(audit[1]![3])).toContain('"amountIrR":500000')
    expect(audit[1]![4]).toBe('corr-1')
    expect(audit[1]![5]).toBe('10.0.0.9')
  })

  it('rejects a pending request and writes approval_request_rejected', async () => {
    const client = mockClient()
    await applyApprovalRequestResolutionOnClient(client, {
      ...BASE,
      decision: 'reject',
      reviewReason: 'Duplicate',
    })

    expect(client.query.mock.calls[0]![1]?.[0]).toBe('rejected')
    expect(client.query.mock.calls[1]![1]).toContain(APPROVAL_REQUEST_REJECTED_EVENT)
    expect(String(client.query.mock.calls[1]![1]![3])).toContain('"reviewReason":"Duplicate"')
  })

  it('forbids the initiator from resolving their own request', async () => {
    const client = mockClient()
    const rejection = await applyApprovalRequestResolutionOnClient(client, {
      ...BASE,
      reviewerUserId: 'user-1',
      decision: 'approve',
      reviewReason: null,
    }).catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getStatus()).toBe(403)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
    expect(client.query).not.toHaveBeenCalled()
  })

  it('conflicts when the request is already resolved', async () => {
    const client = mockClient()
    const rejection = await applyApprovalRequestResolutionOnClient(client, {
      ...BASE,
      status: 'approved',
      decision: 'approve',
      reviewReason: null,
    }).catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getStatus()).toBe(409)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.CONFLICT_STATE.code,
    })
    expect(client.query).not.toHaveBeenCalled()
  })
})
