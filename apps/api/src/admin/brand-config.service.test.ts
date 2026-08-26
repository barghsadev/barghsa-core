import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { BrandConfigService } from './brand-config.service.js'

// ─── Mock pool ──────────────────────────────────────────────────────────

const mockQuery = vi.fn()
const mockConnect = vi.fn()

vi.mock('@barghsa/db', () => ({
  getDbPool: () => ({
    query: mockQuery,
    connect: mockConnect,
  }),
}))

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cfg-1',
    config: { appTitle: 'Barghsa', primaryColor: '#2563eb' },
    version: 1,
    status: 'draft',
    created_by: 'user-1',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

// ─── Suite ───────────────────────────────────────────────────────────────

describe('BrandConfigService', () => {
  let service: BrandConfigService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new BrandConfigService()
  })

  describe('getActiveConfig', () => {
    it('returns the active config when one exists', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makeRow({ status: 'active' })] })

      const result = await service.getActiveConfig()

      expect(result.status).toBe('active')
      expect(result.config.appTitle).toBe('Barghsa')
      expect(mockQuery).toHaveBeenCalledTimes(1)
    })

    it('falls back to latest draft when no active config exists', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // no active
        .mockResolvedValueOnce({ rows: [makeRow({ status: 'draft' })] }) // latest draft

      const result = await service.getActiveConfig()

      expect(result.status).toBe('draft')
      expect(result.config.appTitle).toBe('Barghsa')
      expect(mockQuery).toHaveBeenCalledTimes(2)
    })

    it('returns default config when no configs exist at all', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // no active
        .mockResolvedValueOnce({ rows: [] }) // no draft

      const result = await service.getActiveConfig()

      expect(result.id).toBe('default')
      expect(result.version).toBe(0)
      expect(result.config.appTitle).toBe('Barghsa')
      expect(result.config.primaryColor).toBe('#2563eb')
    })
  })

  describe('listConfigs', () => {
    it('returns all configs ordered by version descending', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          makeRow({ id: 'cfg-2', version: 2 }),
          makeRow({ id: 'cfg-1', version: 1 }),
        ],
      })

      const result = await service.listConfigs()

      expect(result).toHaveLength(2)
      expect(result[0]!.version).toBe(2)
      expect(result[1]!.version).toBe(1)
    })

    it('returns empty array when no configs', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })
      const result = await service.listConfigs()
      expect(result).toHaveLength(0)
    })
  })

  describe('upsertDraft', () => {
    it('updates existing draft config', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'draft-1', version: 1 }] }) // existing draft
        .mockResolvedValueOnce({ rows: [makeRow({ id: 'draft-1', version: 1, config: { appTitle: 'Updated' } })] }) // update result

      const result = await service.upsertDraft({ appTitle: 'Updated' }, 'user-1')

      expect(result.id).toBe('draft-1')
      expect(result.config.appTitle).toBe('Updated')
    })

    it('creates new draft when none exists', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // no existing draft
        .mockResolvedValueOnce({ rows: [{ max_ver: 1 }] }) // max version
        .mockResolvedValueOnce({ rows: [makeRow({ id: 'new-draft', version: 2, config: { appTitle: 'New' } })] }) // insert result

      const result = await service.upsertDraft({ appTitle: 'New' }, 'user-1')

      expect(result.id).toBe('new-draft')
      expect(result.version).toBe(2)
      expect(result.config.appTitle).toBe('New')
    })

    it('creates first draft when no configs exist at all', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // no existing draft
        .mockResolvedValueOnce({ rows: [{ max_ver: 0 }] }) // max version = 0
        .mockResolvedValueOnce({ rows: [makeRow({ id: 'new-draft', version: 1, config: { appTitle: 'First' } })] }) // insert

      const result = await service.upsertDraft({ appTitle: 'First' }, 'user-1')

      expect(result.version).toBe(1)
    })
  })

  describe('activateDraft', () => {
    it('activates the draft and deactivates previous active', async () => {
      const mockClient = {
        query: vi.fn(),
        release: vi.fn(),
      }
      mockConnect.mockResolvedValue(mockClient)
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'draft-1', config: { appTitle: 'Barghsa' }, version: 2 }] }) // find draft

      // Transaction queries
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce(undefined) // deactivate active
        .mockResolvedValueOnce({ rows: [makeRow({ id: 'draft-1', status: 'active', version: 2 })] }) // activate draft
        .mockResolvedValueOnce(undefined) // COMMIT

      const result = await service.activateDraft('user-1')

      expect(result.id).toBe('draft-1')
      expect(result.status).toBe('active')
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN')
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
      expect(mockClient.release).toHaveBeenCalled()
    })

    it('throws 400 when no draft exists', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }) // no draft

      await expect(service.activateDraft('user-1')).rejects.toMatchObject({
        response: { statusCode: 400 },
      })
    })
  })
})