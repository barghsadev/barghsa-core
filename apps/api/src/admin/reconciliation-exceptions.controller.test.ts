import { describe, it, expect, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { ReconciliationExceptionsController } from './reconciliation-exceptions.controller.js'
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
  const investigate = vi.fn().mockResolvedValue({ id: 'r-1', status: 'investigating' })
  const resolve = vi.fn().mockResolvedValue({ id: 'r-1', status: 'resolved' })
  const close = vi.fn().mockResolvedValue({ id: 'r-1', status: 'closed' })
  const service = { listReconciliationExceptions: list, investigateReconciliationException: investigate, resolveReconciliationException: resolve, closeReconciliationException: close }
  const controller = new ReconciliationExceptionsController(service as never)
  return { controller, service }
}

/** Extract the HttpException payload an assertion helper can check. */
function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

// ─── Permission gates (T-09.09.01) ────────────────────────────────────

describe('reconciliation-exceptions permission gates (T-09.09.01)', () => {
  it('rejects non-admin on list with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller } = makeController()
    const rejection = await controller
      .listReconciliationItems(undefined, undefined, undefined, undefined, nonAdminReq)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
  })

  it('rejects non-admin on investigate/resolve/close with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller } = makeController()
    for (const promise of [
      controller.investigateItem('ex-1', nonAdminReq),
      controller.resolveItem('ex-1', { note: 'ok' }, nonAdminReq),
      controller.closeItem('ex-1', { note: 'ok' }, nonAdminReq),
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
    await controller.listReconciliationItems(undefined, undefined, undefined, undefined, nonAdminReq).catch((e: unknown) => e)
    expect(service.listReconciliationExceptions).not.toHaveBeenCalled()
  })

  it('ensures admin list passes through the view permission', async () => {
    const { controller } = makeController()
    await expect(
      controller.listReconciliationItems(undefined, undefined, undefined, undefined, adminReq),
    ).resolves.toEqual([])
  })

  it('passes filters to the service for admin', async () => {
    const { controller, service } = makeController()
    await controller.listReconciliationItems('open', 'high', '10', '0', adminReq)
    expect(service.listReconciliationExceptions).toHaveBeenCalledWith({
      status: 'open',
      severity: 'high',
      limit: 10,
      offset: 0,
    })
  })

  it('investigate requires the resolve permission', async () => {
    const { controller } = makeController()
    const rejection = await controller.investigateItem('ex-1', nonAdminReq).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
  })

  it('resolve requires the resolve permission', async () => {
    const { controller } = makeController()
    const rejection = await controller.resolveItem('ex-1', { note: 'ok' }, nonAdminReq).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
  })

  it('close requires the resolve permission', async () => {
    const { controller } = makeController()
    const rejection = await controller.closeItem('ex-1', { note: 'ok' }, nonAdminReq).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
  })
})

// ─── Body validation ───────────────────────────────────────────────────

describe('reconciliation-exceptions body validation', () => {
  it('rejects a missing note on resolve with 400', async () => {
    const { controller, service } = makeController()
    const rejection = await controller
      .resolveItem('ex-1', {}, adminReq)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 400,
      error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
    })
    expect(service.resolveReconciliationException).not.toHaveBeenCalled()
  })

  it('rejects a missing note on close with 400', async () => {
    const { controller, service } = makeController()
    const rejection = await controller
      .closeItem('ex-1', {}, adminReq)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(service.closeReconciliationException).not.toHaveBeenCalled()
  })

  it('passes the actor id and ip to resolve for admin', async () => {
    const { controller, service } = makeController()
    await controller.resolveItem('ex-1', { note: 'fixed' }, adminReq)
    expect(service.resolveReconciliationException).toHaveBeenCalledWith(
      'ex-1',
      'admin-1',
      '127.0.0.1',
      'fixed',
    )
  })

  it('passes limit/offset to the service when valid', async () => {
    const { controller, service } = makeController()
    await controller.listReconciliationItems(undefined, undefined, '25', '5', adminReq)
    expect(service.listReconciliationExceptions).toHaveBeenCalledWith({
      limit: 25,
      offset: 5,
    })
  })

  it('rejects an out-of-range limit with 400', async () => {
    const { controller, service } = makeController()
    const rejection = await controller
      .listReconciliationItems(undefined, undefined, '0', '5', adminReq)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 400,
      error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
    })
    expect(service.listReconciliationExceptions).not.toHaveBeenCalled()
  })

  it('rejects a non-numeric offset with 400', async () => {
    const { controller, service } = makeController()
    const rejection = await controller
      .listReconciliationItems(undefined, undefined, '10', 'abc', adminReq)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 400,
      error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
    })
    expect(service.listReconciliationExceptions).not.toHaveBeenCalled()
  })
})