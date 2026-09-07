import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrandConfigService } from './brand-config.service.js';

// ─── Mock pool ──────────────────────────────────────────────────────────

const mockQuery = vi.fn();
const mockConnect = vi.fn();

vi.mock('@barghsa/db', () => ({
  getDbPool: () => ({
    query: mockQuery,
    connect: mockConnect,
  }),
}));

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
  };
}

// ─── Suite ───────────────────────────────────────────────────────────────

describe('BrandConfigService', () => {
  let service: BrandConfigService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new BrandConfigService();
  });

  describe('getActiveConfig', () => {
    it('returns the active config when one exists', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makeRow({ status: 'active' })] });

      const result = await service.getActiveConfig();

      expect(result.status).toBe('active');
      expect(result.config.appTitle).toBe('Barghsa');
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('falls back to latest draft when no active config exists', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makeRow({ status: 'draft' })] }); // latest draft

      const result = await service.getActiveConfig(true);

      expect(result.status).toBe('draft');
      expect(result.config.appTitle).toBe('Barghsa');
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('returns default config when no configs exist at all', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // no active

      const result = await service.getActiveConfig();

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('default');
      expect(result.version).toBe(0);
      expect(result.config.appTitle).toBe('Barghsa');
      expect(result.config.primaryColor).toBe('#2563eb');
    });
  });

  describe('listConfigs', () => {
    it('returns all configs ordered by version descending', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeRow({ id: 'cfg-2', version: 2 }), makeRow({ id: 'cfg-1', version: 1 })],
      });

      const result = await service.listConfigs();

      expect(result).toHaveLength(2);
      expect(result[0]!.version).toBe(2);
      expect(result[1]!.version).toBe(1);
    });

    it('returns empty array when no configs', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const result = await service.listConfigs();
      expect(result).toHaveLength(0);
    });
  });
});
