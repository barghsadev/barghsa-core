import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { KnowledgeBasesService as ServiceType } from './knowledge-bases.service.js'

/** Mocked pool: query() returns queued fixtures in order. */
function mockPool() {
  const mockQuery = vi.fn()
  const pool = { query: mockQuery }
  return { mockQuery, pool }
}

function kbBaseRow(over: Record<string, unknown> = {}) {
  return {
    id: 'kb-1',
    title: 'Customer support FAQ',
    description: 'Common questions',
    created_at: '2026-08-28T00:00:00.000Z',
    updated_at: '2026-08-28T00:00:00.000Z',
    ...over,
  }
}

function docRow(over: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    kb_id: 'kb-1',
    storage_key: 'uploads/faq.pdf',
    file_name: 'faq.pdf',
    mime_type: 'application/pdf',
    size_bytes: 1024,
    processing_status: 'pending',
    processing_error: null,
    created_at: '2026-08-28T00:00:00.000Z',
    updated_at: '2026-08-28T00:00:00.000Z',
    ...over,
  }
}

function groupBaseRow(over: Record<string, unknown> = {}) {
  return {
    id: 'grp-1',
    title: 'Support KBs',
    description: '',
    created_at: '2026-08-28T00:00:00.000Z',
    updated_at: '2026-08-28T00:00:00.000Z',
    ...over,
  }
}

const ACTOR = 'user-admin-1'

/** Load KnowledgeBasesService with a mocked @barghsa/db pool. */
async function loadService(pool: { query: ReturnType<typeof vi.fn> }) {
  vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
  const { KnowledgeBasesService: Svc } = await import('./knowledge-bases.service.js')
  return new Svc() as ServiceType
}

let service: ServiceType

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('KnowledgeBasesService (T-09.11.02)', () => {
  describe('listKbs', () => {
    it('returns KBs with document and group counts', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery.mockResolvedValueOnce({
        rows: [
          { ...kbBaseRow(), document_count: 2, group_count: 1 },
          { ...kbBaseRow({ id: 'kb-2', title: 'Pricing' }), document_count: 0, group_count: 0 },
        ],
      })

      const result = await service.listKbs()
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        id: 'kb-1',
        documentCount: 2,
        groupCount: 1,
      })
      expect(result[1]).toMatchObject({ id: 'kb-2', documentCount: 0, groupCount: 0 })
    })
  })

  describe('getKb', () => {
    it('throws 404 when the KB does not exist', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery.mockResolvedValueOnce({ rows: [] }) // findKb

      await expect(service.getKb('missing')).rejects.toMatchObject({
        status: 404,
        response: { error: 'KB_NOT_FOUND' },
      })
    })

    it('returns the KB with documents and groups', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [kbBaseRow()] }) // findKb
        .mockResolvedValueOnce({
          rows: [
            docRow(),
            docRow({ id: 'doc-2', storage_key: 'uploads/guides.pdf', file_name: 'guides.pdf' }),
          ],
        }) // documents
        .mockResolvedValueOnce({ rows: [{ id: 'grp-1', title: 'Support KBs' }] }) // groups

      const result = await service.getKb('kb-1')
      expect(result).toMatchObject({ id: 'kb-1', documentCount: 2, groupCount: 1 })
      expect(result.documents[0]).toMatchObject({ processingStatus: 'pending' })
      expect(result.groups).toEqual([{ id: 'grp-1', title: 'Support KBs' }])
    })
  })

  describe('createKb / updateKb / removeKb', () => {
    it('creates a KB and records an audit event', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [kbBaseRow()] }) // insert return
        .mockResolvedValueOnce({ rows: [] }) // audit insert

      const result = await service.createKb({
        title: 'Customer support FAQ',
        description: 'Common questions',
        actorUserId: ACTOR,
        ip: '1.2.3.4',
      })
      expect(result).toMatchObject({ id: 'kb-1', documentCount: 0, groupCount: 0 })
      const insertSql = String(mockQuery.mock.calls[0]![0])
      expect(insertSql).toContain('INSERT INTO knowledge_bases')
      expect(insertSql).toContain('$4')
      const auditSql = String(mockQuery.mock.calls[1]![0])
      expect(auditSql).toContain('INSERT INTO audit_log')
      expect(mockQuery.mock.calls[1]![1]).toContain('kb_created')
    })

    it('throws 404 on update of a missing KB', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery.mockResolvedValueOnce({ rows: [] }) // findKb

      await expect(
        service.updateKb('missing', { title: 'x', actorUserId: ACTOR, ip: '1.2.3.4' }),
      ).rejects.toMatchObject({ status: 404 })
    })

    it('removes a KB and records the audit event', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [kbBaseRow()] }) // findKb
        .mockResolvedValueOnce({ rows: [] }) // delete
        .mockResolvedValueOnce({ rows: [] }) // audit

      await service.removeKb('kb-1', ACTOR, '1.2.3.4')
      const deleteSql = String(mockQuery.mock.calls[1]![0])
      expect(deleteSql).toContain('DELETE FROM knowledge_bases')
    })
  })

  describe('attachDocument', () => {
    it('throws 404 when the storage record does not exist', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [kbBaseRow()] }) // findKb
        .mockResolvedValueOnce({ rows: [] }) // storage record lookups

      await expect(
        service.attachDocument({
          kbId: 'kb-1',
          storageKey: 'uploads/ghost.pdf',
          actorUserId: ACTOR,
          ip: '1.2.3.4',
        }),
      ).rejects.toMatchObject({
        status: 404,
        response: { error: 'STORAGE_RECORD_NOT_FOUND' },
      })
    })

    it('rejects a removed storage record with 409', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [kbBaseRow()] }) // findKb
        .mockResolvedValueOnce({
          rows: [
            {
              storage_key: 'uploads/gone.pdf',
              file_name: 'gone.pdf',
              content_type: 'application/pdf',
              file_size: 5,
              status: 'removed',
            },
          ],
        })

      await expect(
        service.attachDocument({
          kbId: 'kb-1',
          storageKey: 'uploads/gone.pdf',
          actorUserId: ACTOR,
          ip: '1.2.3.4',
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: { error: 'STORAGE_RECORD_REMOVED' },
      })
    })

    it('attaches a document and snapshots metadata with pending status', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [kbBaseRow()] }) // findKb
        .mockResolvedValueOnce({
          rows: [
            {
              storage_key: 'uploads/faq.pdf',
              file_name: 'faq.pdf',
              content_type: 'application/pdf',
              file_size: 1024,
              status: 'active',
            },
          ],
        }) // storage record
        .mockResolvedValueOnce({ rows: [docRow()] }) // insert link
        .mockResolvedValueOnce({ rows: [] }) // audit

      const result = await service.attachDocument({
        kbId: 'kb-1',
        storageKey: 'uploads/faq.pdf',
        actorUserId: ACTOR,
        ip: '1.2.3.4',
      })
      expect(result).toMatchObject({
        storageKey: 'uploads/faq.pdf',
        fileName: 'faq.pdf',
        processingStatus: 'pending',
      })
      const insertSql = String(mockQuery.mock.calls[2]![0])
      expect(insertSql).toContain('ON CONFLICT (kb_id, storage_key) DO NOTHING')
    })

    it('is idempotent: re-attaching an existing key returns the existing link', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [kbBaseRow()] }) // findKb
        .mockResolvedValueOnce({
          rows: [
            {
              storage_key: 'uploads/faq.pdf',
              file_name: 'faq.pdf',
              content_type: 'application/pdf',
              file_size: 1024,
              status: 'active',
            },
          ],
        }) // storage record
        .mockResolvedValueOnce({ rows: [] }) // insert → conflict, no row
        .mockResolvedValueOnce({ rows: [docRow({ processing_status: 'ready' })] }) // existing link
        .mockResolvedValueOnce({ rows: [] }) // audit should NOT run for no-op

      const result = await service.attachDocument({
        kbId: 'kb-1',
        storageKey: 'uploads/faq.pdf',
        actorUserId: ACTOR,
        ip: '1.2.3.4',
      })
      expect(result).toMatchObject({ processingStatus: 'ready' })
      // No audit event on the idempotent no-op path.
      const auditCalls = mockQuery.mock.calls.filter((call) =>
        String(call[0]).includes('INSERT INTO audit_log'),
      )
      expect(auditCalls).toHaveLength(0)
    })
  })

  describe('detachDocument', () => {
    it('throws 404 when the link does not exist', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [kbBaseRow()] }) // findKb
        .mockResolvedValueOnce({ rowCount: 0 }) // delete

      await expect(
        service.detachDocument('kb-1', 'uploads/ghost.pdf', ACTOR, '1.2.3.4'),
      ).rejects.toMatchObject({
        status: 404,
        response: { error: 'KB_DOCUMENT_NOT_FOUND' },
      })
    })

    it('detaches the document and keeps the storage record', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [kbBaseRow()] }) // findKb
        .mockResolvedValueOnce({ rowCount: 1 }) // delete
        .mockResolvedValueOnce({ rows: [] }) // audit

      await expect(
        service.detachDocument('kb-1', 'uploads/faq.pdf', ACTOR, '1.2.3.4'),
      ).resolves.toBeUndefined()
      const deleteSql = String(mockQuery.mock.calls[1]![0])
      expect(deleteSql).toContain('DELETE FROM kb_documents')
    })
  })

  describe('group CRUD', () => {
    it('lists groups with member counts', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...groupBaseRow(), member_count: 3 }],
      })

      const result = await service.listGroups()
      expect(result[0]).toMatchObject({ id: 'grp-1', memberCount: 3 })
    })

    it('creates a group', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [groupBaseRow()] })
        .mockResolvedValueOnce({ rows: [] })

      const result = await service.createGroup({
        title: 'Support KBs',
        description: '',
        actorUserId: ACTOR,
        ip: '1.2.3.4',
      })
      expect(result).toMatchObject({ id: 'grp-1', memberCount: 0 })
    })

    it('throws 404 on delete of a missing group', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery.mockResolvedValueOnce({ rows: [] })

      await expect(service.removeGroup('missing', ACTOR, '1.2.3.4')).rejects.toMatchObject({
        status: 404,
      })
    })
  })

  describe('group membership', () => {
    it('links a KB into a group', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [groupBaseRow()] }) // findGroup
        .mockResolvedValueOnce({ rows: [kbBaseRow()] }) // findKb
        .mockResolvedValueOnce({ rows: [] }) // insert member
        .mockResolvedValueOnce({ rows: [] }) // audit

      await expect(
        service.addGroupMember({
          groupId: 'grp-1',
          kbId: 'kb-1',
          actorUserId: ACTOR,
          ip: '1.2.3.4',
        }),
      ).resolves.toBeUndefined()
      const insertSql = String(mockQuery.mock.calls[2]![0])
      expect(insertSql).toContain('INSERT INTO kb_group_members')
      expect(insertSql).toContain('ON CONFLICT (group_id, kb_id) DO NOTHING')
    })

    it('throws 404 when the member KB does not exist', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [groupBaseRow()] }) // findGroup
        .mockResolvedValueOnce({ rows: [] }) // findKb

      await expect(
        service.addGroupMember({
          groupId: 'grp-1',
          kbId: 'missing',
          actorUserId: ACTOR,
          ip: '1.2.3.4',
        }),
      ).rejects.toMatchObject({ status: 404, response: { error: 'KB_NOT_FOUND' } })
    })

    it('removes a KB from a group', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [groupBaseRow()] }) // findGroup
        .mockResolvedValueOnce({ rowCount: 1 }) // delete
        .mockResolvedValueOnce({ rows: [] }) // audit

      await expect(
        service.removeGroupMember('grp-1', 'kb-1', ACTOR, '1.2.3.4'),
      ).resolves.toBeUndefined()
    })
  })
})