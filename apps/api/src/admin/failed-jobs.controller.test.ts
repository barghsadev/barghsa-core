import { describe, it, expect, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { FailedJobsController } from './failed-jobs.controller.js'
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

function makeController() {
  const list = vi.fn().mockResolvedValue([])
  const retry = vi.fn().mockResolvedValue({ id: 'job-1', status: 'retrying' })
  const retryBulk = vi.fn().mockResolvedValue([])
  const resolve = vi.fn().mockResolvedValue({ id: 'job-1', status: 'resolved' })
  const service = {
    listFailedJobs: list,
    retryFailedJob: retry,
    retryFailedJobsBulk: retryBulk,
    resolveFailedJob: resolve,
  }
  const controller = new FailedJobsController(service as never)
  return { controller, service }
}

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

// ─── Permission gates (T-09.09.02) ────────────────────────────────────

describe('failed-jobs permission gates (T-09.09.02)', () => {
  it('rejects non-admin on list with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller } = makeController()
    const rejection = await controller
      .listFailedJobs(undefined, undefined, undefined, undefined, nonAdminReq)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
  })

  it('rejects non-admin on retry/resolve/retry-bulk with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller } = makeController()
    for (const promise of [
      controller.retryJob('job-1', nonAdminReq),
      controller.resolveJob('job-1', nonAdminReq),
      controller.retryBulk({ ids: ['job-1'] }, nonAdminReq),
    ]) {
      const rejection = await promise.catch((e: unknown) => e)
      expect(rejection).toMatchObject({ status: 403 })
      expect(rejectionBody(rejection)).toMatchObject({
        statusCode: 403,
        error: ErrorCodes.AUTHZ_FORBIDDEN.code,
      })
    }
  })

  it('does not call the service when the permission gate rejects', async () => {
    const { controller, service } = makeController()
    await controller.listFailedJobs(undefined, undefined, undefined, undefined, nonAdminReq).catch((e: unknown) => e)
    expect(service.listFailedJobs).not.toHaveBeenCalled()
  })

  it('ensures admin list passes through the view permission', async () => {
    const { controller } = makeController()
    await expect(
      controller.listFailedJobs(undefined, undefined, undefined, undefined, adminReq),
    ).resolves.toEqual([])
  })

  it('passes filters to the service for admin', async () => {
    const { controller, service } = makeController()
    await controller.listFailedJobs('dead_letter', 'service_breach_scan', '10', '0', adminReq)
    expect(service.listFailedJobs).toHaveBeenCalledWith({
      status: 'dead_letter',
      jobType: 'service_breach_scan',
      limit: 10,
      offset: 0,
    })
  })

  it('rejects an invalid limit with 400 before touching the service', async () => {
    const { controller, service } = makeController()
    const rejection = await controller
      .listFailedJobs(undefined, undefined, '0', undefined, adminReq)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(service.listFailedJobs).not.toHaveBeenCalled()
  })
})

// ─── Body validation ───────────────────────────────────────────────────

describe('failed-jobs body validation', () => {
  it('rejects an empty ids array on retry-bulk with 400', async () => {
    const { controller, service } = makeController()
    const rejection = await controller.retryBulk({ ids: [] }, adminReq).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 400,
      error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
    })
    expect(service.retryFailedJobsBulk).not.toHaveBeenCalled()
  })

  it('rejects a non-array ids body on retry-bulk with 400', async () => {
    const { controller, service } = makeController()
    const rejection = await controller.retryBulk({ ids: 'job-1' }, adminReq).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(service.retryFailedJobsBulk).not.toHaveBeenCalled()
  })

  it('passes a valid ids body through to the service for admin', async () => {
    const { controller, service } = makeController()
    await controller.retryBulk({ ids: ['job-1', 'job-2'] }, adminReq)
    expect(service.retryFailedJobsBulk).toHaveBeenCalledWith(
      ['job-1', 'job-2'],
      'admin-1',
      '127.0.0.1',
    )
  })

  it('calls the single-retry service for admin with the derived ip', async () => {
    const { controller, service } = makeController()
    await controller.retryJob('job-1', adminReq)
    expect(service.retryFailedJob).toHaveBeenCalledWith('job-1', 'admin-1', '127.0.0.1')
  })

  it('calls the resolve service for admin', async () => {
    const { controller, service } = makeController()
    await controller.resolveJob('job-1', adminReq)
    expect(service.resolveFailedJob).toHaveBeenCalledWith('job-1', 'admin-1', '127.0.0.1')
  })
})
