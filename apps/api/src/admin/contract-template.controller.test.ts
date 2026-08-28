import { describe, it, expect, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { ContractTemplateController } from './contract-template.controller.js'
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

const TEMPLATE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const templateDto = {
  id: TEMPLATE_ID,
  name: 'Power Contract',
  description: null,
  status: 'active',
  createdBy: 'admin-1',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  versionCount: 1,
  latestVersion: {
    versionNumber: 1,
    storageKey: 'contract-templates/key.docx',
    fileName: 'power.docx',
    contentType: 'text/plain',
    fileSize: 42,
    placeholders: ['customerName', 'amount'],
    createdBy: 'admin-1',
    createdAt: '2026-01-01T00:00:00Z',
  },
}

const versionDto = {
  versionNumber: 2,
  storageKey: 'contract-templates/key2.docx',
  fileName: 'power2.docx',
  contentType: 'text/plain',
  fileSize: 50,
  placeholders: ['customerName'],
  createdBy: 'admin-1',
  createdAt: '2026-01-01T00:00:00Z',
}

function makeController() {
  const service = {
    list: vi.fn().mockResolvedValue([templateDto]),
    get: vi.fn().mockResolvedValue(templateDto),
    create: vi.fn().mockResolvedValue(templateDto),
    update: vi.fn().mockResolvedValue(templateDto),
    uploadVersion: vi.fn().mockResolvedValue(versionDto),
    delete: vi.fn().mockResolvedValue({ deleted: true }),
  }
  const controller = new ContractTemplateController(service as never)
  return { controller, service }
}

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

describe('Contract template permission gate (T-09.12.04)', () => {
  it('rejects non-admin on list with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller } = makeController()
    const rejection = await controller.list(nonAdminReq).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
  })

  it('rejects non-admin on get and every mutation', async () => {
    const { controller } = makeController()
    const attempts: Promise<unknown>[] = [
      controller.get(nonAdminReq, TEMPLATE_ID),
      controller.create(nonAdminReq, { name: 'X' }),
      controller.update(nonAdminReq, TEMPLATE_ID, { status: 'inactive' }),
      controller.uploadVersion(nonAdminReq, TEMPLATE_ID, { fileName: 'a.docx', contentType: 'text/plain', content: 'x' }),
      controller.delete(nonAdminReq, TEMPLATE_ID),
    ]
    for (const attempt of attempts) {
      const rejection = await attempt.catch((e: unknown) => e)
      expect(rejection).toMatchObject({ status: 403 })
      expect(rejectionBody(rejection)).toMatchObject({ error: ErrorCodes.AUTHZ_FORBIDDEN.code })
    }
  })
})

describe('ContractTemplateController (T-09.12.04)', () => {
  it('list calls the service with admin session', async () => {
    const { controller, service } = makeController()
    const result = await controller.list(adminReq)
    expect(service.list).toHaveBeenCalledTimes(1)
    expect(result).toEqual([templateDto])
  })

  it('get validates the id is a UUID and delegates', async () => {
    const { controller, service } = makeController()
    const result = await controller.get(adminReq, TEMPLATE_ID)
    expect(service.get).toHaveBeenCalledWith(TEMPLATE_ID)
    expect(result.id).toBe(TEMPLATE_ID)
  })

  it('get rejects a malformed id with 400', async () => {
    const { controller, service } = makeController()
    const rejection = await controller.get(adminReq, 'not-a-uuid').catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(service.get).not.toHaveBeenCalled()
  })

  it('create passes trimmed name + description and actor metadata to the service', async () => {
    const { controller, service } = makeController()
    await controller.create(adminReq, { name: ' New Template ', description: 'desc' })
    expect(service.create).toHaveBeenCalledWith({
      name: 'New Template',
      description: 'desc',
      actorUserId: 'admin-1',
      ip: '127.0.0.1',
    })
  })

  it('update passes only provided fields plus actor metadata', async () => {
    const { controller, service } = makeController()
    await controller.update(adminReq, TEMPLATE_ID, { status: 'inactive' })
    expect(service.update).toHaveBeenCalledWith(TEMPLATE_ID, {
      status: 'inactive',
      actorUserId: 'admin-1',
      ip: '127.0.0.1',
    })
  })

  it('uploadVersion delegates the file payload', async () => {
    const { controller, service } = makeController()
    const result = await controller.uploadVersion(adminReq, TEMPLATE_ID, {
      fileName: 'power.docx',
      contentType: 'text/plain',
      content: '{{x}}',
    })
    expect(service.uploadVersion).toHaveBeenCalledWith(TEMPLATE_ID, {
      fileName: 'power.docx',
      contentType: 'text/plain',
      content: '{{x}}',
      actorUserId: 'admin-1',
      ip: '127.0.0.1',
    })
    expect(result.versionNumber).toBe(2)
  })

  it('delete delegates the actor metadata', async () => {
    const { controller, service } = makeController()
    const result = await controller.delete(adminReq, TEMPLATE_ID)
    expect(service.delete).toHaveBeenCalledWith(TEMPLATE_ID, 'admin-1', '127.0.0.1')
    expect(result.deleted).toBe(true)
  })
})
