import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  KnowledgeBasesController,
  KbGroupsController,
} from './knowledge-bases.controller.js'
import type { KnowledgeBasesService } from './knowledge-bases.service.js'

// ─── Mock service ─────────────────────────────────────────────────────────

const mockListKbs = vi.fn()
const mockGetKb = vi.fn()
const mockCreateKb = vi.fn()
const mockUpdateKb = vi.fn()
const mockRemoveKb = vi.fn()
const mockAttachDocument = vi.fn()
const mockDetachDocument = vi.fn()
const mockListGroups = vi.fn()
const mockGetGroup = vi.fn()
const mockCreateGroup = vi.fn()
const mockUpdateGroup = vi.fn()
const mockRemoveGroup = vi.fn()
const mockAddGroupMember = vi.fn()
const mockRemoveGroupMember = vi.fn()

const mockService = {
  listKbs: mockListKbs,
  getKb: mockGetKb,
  createKb: mockCreateKb,
  updateKb: mockUpdateKb,
  removeKb: mockRemoveKb,
  attachDocument: mockAttachDocument,
  detachDocument: mockDetachDocument,
  listGroups: mockListGroups,
  getGroup: mockGetGroup,
  createGroup: mockCreateGroup,
  updateGroup: mockUpdateGroup,
  removeGroup: mockRemoveGroup,
  addGroupMember: mockAddGroupMember,
  removeGroupMember: mockRemoveGroupMember,
} as unknown as KnowledgeBasesService

const adminReq = {
  session: { isAdmin: true, userId: 'admin-1' },
  ip: '10.0.0.8',
  socket: { remoteAddress: '10.0.0.8' },
} as never

const nonAdminReq = {
  session: { isAdmin: false, userId: 'admin-1' },
  ip: '10.0.0.8',
} as never

function baseKb(over: Record<string, unknown> = {}) {
  return {
    id: 'kb-1',
    title: 'Customer support FAQ',
    description: 'Common questions',
    documentCount: 0,
    groupCount: 0,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
    ...over,
  }
}

function baseDoc(over: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    kbId: 'kb-1',
    storageKey: 'uploads/faq.pdf',
    fileName: 'faq.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    processingStatus: 'pending',
    processingError: null,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
    ...over,
  }
}

function baseGroup(over: Record<string, unknown> = {}) {
  return {
    id: 'grp-1',
    title: 'Support KBs',
    description: '',
    memberCount: 0,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
    ...over,
  }
}

describe('KnowledgeBasesController (T-09.11.02)', () => {
  let controller: KnowledgeBasesController

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new KnowledgeBasesController(mockService)
  })

  describe('permission gate (admin:ai:kb)', () => {
    it('rejects non-admin sessions on every route with 403', async () => {
      await expect(controller.list(nonAdminReq)).rejects.toMatchObject({ status: 403 })
      await expect(controller.get(nonAdminReq, 'kb-1')).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.create(nonAdminReq, { title: 'x', description: '' }),
      ).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.update(nonAdminReq, 'kb-1', { title: 'y' }),
      ).rejects.toMatchObject({ status: 403 })
      await expect(controller.remove(nonAdminReq, 'kb-1')).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.attachDocument(nonAdminReq, 'kb-1', { storageKey: 'uploads/x.pdf' }),
      ).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.detachDocument(nonAdminReq, 'kb-1', 'uploads/x.pdf'),
      ).rejects.toMatchObject({ status: 403 })
      expect(mockListKbs).not.toHaveBeenCalled()
      expect(mockAttachDocument).not.toHaveBeenCalled()
    })

    it('allows platform-admin sessions', async () => {
      mockListKbs.mockResolvedValue([])
      await expect(controller.list(adminReq)).resolves.toEqual([])
    })
  })

  describe('POST /api/admin/knowledge-bases', () => {
    it('rejects an invalid body (empty title) and never calls the service', async () => {
      await expect(controller.create(adminReq, { title: '', description: '' })).rejects.toMatchObject(
        { status: 400 },
      )
      expect(mockCreateKb).not.toHaveBeenCalled()
    })

    it('creates a KB with a description defaulting to empty', async () => {
      mockCreateKb.mockResolvedValue(baseKb())
      const result = await controller.create(adminReq, { title: 'Customer support FAQ' })
      expect(result).toMatchObject({ id: 'kb-1' })
      expect(mockCreateKb).toHaveBeenCalledWith({
        title: 'Customer support FAQ',
        description: '',
        actorUserId: 'admin-1',
        ip: '10.0.0.8',
      })
    })
  })

  describe('PUT /api/admin/knowledge-bases/:id', () => {
    it('rejects an empty update body', async () => {
      await expect(controller.update(adminReq, 'kb-1', {})).rejects.toMatchObject({
        status: 400,
      })
      expect(mockUpdateKb).not.toHaveBeenCalled()
    })

    it('forwards only provided fields', async () => {
      mockUpdateKb.mockResolvedValue(baseKb({ title: 'Renamed FAQ' }))
      const result = await controller.update(adminReq, 'kb-1', { title: 'Renamed FAQ' })
      expect(result).toMatchObject({ title: 'Renamed FAQ' })
      expect(mockUpdateKb).toHaveBeenCalledWith('kb-1', {
        title: 'Renamed FAQ',
        actorUserId: 'admin-1',
        ip: '10.0.0.8',
      })
    })
  })

  describe('DELETE /api/admin/knowledge-bases/:id', () => {
    it('deletes the KB', async () => {
      mockRemoveKb.mockResolvedValue(undefined)
      await expect(controller.remove(adminReq, 'kb-1')).resolves.toBeUndefined()
      expect(mockRemoveKb).toHaveBeenCalledWith('kb-1', 'admin-1', '10.0.0.8')
    })
  })

  describe('POST /api/admin/knowledge-bases/:id/documents', () => {
    it('rejects a missing storageKey', async () => {
      await expect(
        controller.attachDocument(adminReq, 'kb-1', {} as never),
      ).rejects.toMatchObject({ status: 400 })
      expect(mockAttachDocument).not.toHaveBeenCalled()
    })

    it('attaches a document by storage key', async () => {
      mockAttachDocument.mockResolvedValue(baseDoc())
      const result = await controller.attachDocument(adminReq, 'kb-1', {
        storageKey: 'uploads/faq.pdf',
      })
      expect(result).toMatchObject({ storageKey: 'uploads/faq.pdf' })
      expect(mockAttachDocument).toHaveBeenCalledWith({
        kbId: 'kb-1',
        storageKey: 'uploads/faq.pdf',
        actorUserId: 'admin-1',
        ip: '10.0.0.8',
      })
    })
  })

  describe('DELETE /api/admin/knowledge-bases/:id/documents/:storageKey', () => {
    it('detaches the document', async () => {
      mockDetachDocument.mockResolvedValue(undefined)
      await expect(
        controller.detachDocument(adminReq, 'kb-1', 'uploads/faq.pdf'),
      ).resolves.toBeUndefined()
      expect(mockDetachDocument).toHaveBeenCalledWith('kb-1', 'uploads/faq.pdf', 'admin-1', '10.0.0.8')
    })
  })
})

describe('KbGroupsController (T-09.11.02)', () => {
  let controller: KbGroupsController

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new KbGroupsController(mockService)
  })

  describe('permission gate (admin:ai:kb)', () => {
    it('rejects non-admin sessions on every route with 403', async () => {
      await expect(controller.list(nonAdminReq)).rejects.toMatchObject({ status: 403 })
      await expect(controller.get(nonAdminReq, 'grp-1')).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.create(nonAdminReq, { title: 'x', description: '' }),
      ).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.update(nonAdminReq, 'grp-1', { title: 'y' }),
      ).rejects.toMatchObject({ status: 403 })
      await expect(controller.remove(nonAdminReq, 'grp-1')).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.addMember(nonAdminReq, 'grp-1', { kbId: 'kb-1' }),
      ).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.removeMember(nonAdminReq, 'grp-1', 'kb-1'),
      ).rejects.toMatchObject({ status: 403 })
      expect(mockListGroups).not.toHaveBeenCalled()
      expect(mockAddGroupMember).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/admin/kb-groups', () => {
    it('creates a group', async () => {
      mockCreateGroup.mockResolvedValue(baseGroup())
      const result = await controller.create(adminReq, { title: 'Support KBs' })
      expect(result).toMatchObject({ id: 'grp-1' })
      expect(mockCreateGroup).toHaveBeenCalledWith({
        title: 'Support KBs',
        description: '',
        actorUserId: 'admin-1',
        ip: '10.0.0.8',
      })
    })
  })

  describe('POST /api/admin/kb-groups/:id/members', () => {
    it('links a KB into the group', async () => {
      mockAddGroupMember.mockResolvedValue(undefined)
      await expect(controller.addMember(adminReq, 'grp-1', { kbId: 'kb-1' })).resolves.toBeUndefined()
      expect(mockAddGroupMember).toHaveBeenCalledWith({
        groupId: 'grp-1',
        kbId: 'kb-1',
        actorUserId: 'admin-1',
        ip: '10.0.0.8',
      })
    })

    it('rejects a missing kbId', async () => {
      await expect(controller.addMember(adminReq, 'grp-1', {} as never)).rejects.toMatchObject({
        status: 400,
      })
      expect(mockAddGroupMember).not.toHaveBeenCalled()
    })
  })

  describe('DELETE /api/admin/kb-groups/:id/members/:kbId', () => {
    it('removes the KB from the group', async () => {
      mockRemoveGroupMember.mockResolvedValue(undefined)
      await expect(
        controller.removeMember(adminReq, 'grp-1', 'kb-1'),
      ).resolves.toBeUndefined()
      expect(mockRemoveGroupMember).toHaveBeenCalledWith('grp-1', 'kb-1', 'admin-1', '10.0.0.8')
    })
  })
})