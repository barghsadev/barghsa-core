import { describe, it, expect, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { FailedNotificationsController } from './failed-notifications.controller.js'
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
  const retry = vi.fn().mockResolvedValue({ id: 'dl-1', status: 'retried' })
  const resolve = vi.fn().mockResolvedValue({ id: 'dl-1', status: 'resolved' })
  const dismiss = vi.fn().mockResolvedValue({ id: 'dl-1', status: 'dismissed' })
  const service = {
    listFailedNotifications: list,
    retryFailedNotification: retry,
    resolveFailedNotification: resolve,
    dismissFailedNotification: dismiss,
  }
  const controller = new FailedNotificationsController(service as never)
  return { controller, service }
}

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

// ─── Permission gates (T-09.09.03) ─────────────────────────────────────

describe('failed-notifications permission gates (T-09.09.03)', () => {
  it('rejects non-admin on list with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller } = makeController()
    const rejection = await controller
      .list(undefined, undefined, undefined, undefined, undefined, nonAdminReq)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
  })

  it('rejects non-admin on retry/resolve/dismiss', async () => {
    const { controller } = makeController()
    for (const promise of [
      controller.retry('dl-1', nonAdminReq),
      controller.resolve('dl-1', nonAdminReq),
      controller.dismiss('dl-1', nonAdminReq),
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
    await controller.list(undefined, undefined, undefined, undefined, undefined, nonAdminReq).catch((e: unknown) => e)
    expect(service.listFailedNotifications).not.toHaveBeenCalled()
  })

  it('passes filters to the service for admin', async () => {
    const { controller, service } = makeController()
    await controller.list('open', 'critical', 'email', '10', '0', adminReq)
    expect(service.listFailedNotifications).toHaveBeenCalledWith({
      status: 'open',
      severity: 'critical',
      channel: 'email',
      limit: 10,
      offset: 0,
    })
  })

  it('rejects an invalid limit with 400 before touching the service', async () => {
    const { controller, service } = makeController()
    const rejection = await controller
      .list(undefined, undefined, undefined, '0', undefined, adminReq)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(service.listFailedNotifications).not.toHaveBeenCalled()
  })

  it('calls retry/resolve/dismiss services for admin with derived ip', async () => {
    const { controller, service } = makeController()
    await controller.retry('dl-1', adminReq)
    expect(service.retryFailedNotification).toHaveBeenCalledWith('dl-1', 'admin-1', '127.0.0.1')
    await controller.resolve('dl-2', adminReq)
    expect(service.resolveFailedNotification).toHaveBeenCalledWith('dl-2', 'admin-1', '127.0.0.1')
    await controller.dismiss('dl-3', adminReq)
    expect(service.dismissFailedNotification).toHaveBeenCalledWith('dl-3', 'admin-1', '127.0.0.1')
  })
})
