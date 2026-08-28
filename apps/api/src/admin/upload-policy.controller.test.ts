import { describe, it, expect, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { UploadPolicyController } from './upload-policy.controller.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { ErrorCodes } from '@barghsa/shared/errors'

const adminReq = {
  session: { isAdmin: true, userId: 'admin-1' },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest

const nonAdminReq = {
  session: { isAdmin: false, userId: 'admin-1' },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest

const POLICY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const policyDto = {
  id: POLICY_ID,
  category: 'document',
  allowedExtensions: ['.pdf', '.docx'],
  maxSizeBytes: 5 * 1024 * 1024,
  effectiveFrom: '2026-01-01T00:00:00Z',
  effectiveUntil: null,
  createdBy: 'admin-1',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  status: 'current',
}

function makeController() {
  const service = {
    list: vi.fn().mockResolvedValue([policyDto]),
    create: vi.fn().mockResolvedValue(policyDto),
    end: vi.fn().mockResolvedValue(policyDto),
  }
  const controller = new UploadPolicyController(service as never)
  return { controller, service }
}

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

describe('Upload policy permission gate (T-09.12.05)', () => {
  it('rejects non-admin on list with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller } = makeController()
    const rejection = await controller.list(nonAdminReq).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
  })

  it('rejects non-admin on every mutation', async () => {
    const { controller } = makeController()
    const attempts: Promise<unknown>[] = [
      controller.create(nonAdminReq, { category: 'document', allowedExtensions: ['.pdf'], maxSizeBytes: 1024 }),
      controller.end(nonAdminReq, POLICY_ID, {}),
    ]
    for (const attempt of attempts) {
      const rejection = await attempt.catch((e: unknown) => e)
      expect(rejection).toMatchObject({ status: 403 })
      expect(rejectionBody(rejection)).toMatchObject({ error: ErrorCodes.AUTHZ_FORBIDDEN.code })
    }
  })
})

describe('UploadPolicyController (T-09.12.05)', () => {
  it('list delegates and forwards the category filter', async () => {
    const { controller, service } = makeController()
    const result = await controller.list(adminReq, 'image')
    expect(service.list).toHaveBeenCalledWith('image')
    expect(result).toEqual([policyDto])
  })

  it('list rejects an invalid category filter with 400', async () => {
    const { controller, service } = makeController()
    const rejection = await controller.list(adminReq, 'contract').catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(service.list).not.toHaveBeenCalled()
  })

  it('create validates the payload and delegates with actor context', async () => {
    const { controller, service } = makeController()
    const result = await controller.create(adminReq, {
      category: 'document',
      allowedExtensions: ['.PDF', '.docx'],
      maxSizeBytes: 5 * 1024 * 1024,
      effectiveFrom: '2026-02-01T00:00:00.000Z',
    })
    expect(service.create).toHaveBeenCalledWith({
      category: 'document',
      allowedExtensions: ['.PDF', '.docx'],
      maxSizeBytes: 5 * 1024 * 1024,
      effectiveFrom: '2026-02-01T00:00:00.000Z',
      actorUserId: 'admin-1',
      ip: '127.0.0.1',
    })
    expect(result).toEqual(policyDto)
  })

  it('create rejects an unknown category with 400', async () => {
    const { controller, service } = makeController()
    const rejection = await controller
      .create(adminReq, { category: 'general', allowedExtensions: ['.pdf'], maxSizeBytes: 1024 } as never)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(service.create).not.toHaveBeenCalled()
  })

  it('create rejects malformed extension tokens with 400', async () => {
    const { controller, service } = makeController()
    const rejection = await controller
      .create(adminReq, { category: 'document', allowedExtensions: ['exe'], maxSizeBytes: 1024 })
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(rejectionBody(rejection)).toMatchObject({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code })
    expect(service.create).not.toHaveBeenCalled()
  })

  it('create rejects an empty extension list with 400', async () => {
    const { controller, service } = makeController()
    const rejection = await controller
      .create(adminReq, { category: 'document', allowedExtensions: [], maxSizeBytes: 1024 })
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(service.create).not.toHaveBeenCalled()
  })

  it('create rejects a max size above the global cap with 400', async () => {
    const { controller, service } = makeController()
    const rejection = await controller
      .create(adminReq, {
        category: 'video',
        allowedExtensions: ['.mp4'],
        maxSizeBytes: 100 * 1024 * 1024 + 1,
      })
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(service.create).not.toHaveBeenCalled()
  })

  it('end validates the id and delegates', async () => {
    const { controller, service } = makeController()
    const result = await controller.end(adminReq, POLICY_ID, {
      effectiveUntil: '2026-08-28T12:00:00.000Z',
    })
    expect(service.end).toHaveBeenCalledWith({
      id: POLICY_ID,
      effectiveUntil: '2026-08-28T12:00:00.000Z',
      actorUserId: 'admin-1',
      ip: '127.0.0.1',
    })
    expect(result).toEqual(policyDto)
  })

  it('end rejects a malformed id with 400', async () => {
    const { controller, service } = makeController()
    const rejection = await controller.end(adminReq, 'not-a-uuid', {}).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(service.end).not.toHaveBeenCalled()
  })

  it('end accepts an empty body (defaults effectiveUntil to now in the service)', async () => {
    const { controller, service } = makeController()
    await controller.end(adminReq, POLICY_ID, {})
    expect(service.end).toHaveBeenCalledWith({
      id: POLICY_ID,
      actorUserId: 'admin-1',
      ip: '127.0.0.1',
    })
  })
})