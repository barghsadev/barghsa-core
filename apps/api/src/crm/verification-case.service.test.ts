import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VerificationCaseService } from './verification-case.service.js';

// ─── Helpers ──────────────────────────────────────────────────────────

function mockPool() {
  const mockQuery = vi.fn();
  const mockConnect = vi.fn();
  const pool = { query: mockQuery, connect: mockConnect };
  return { mockQuery, mockConnect, pool };
}

function mockClient() {
  const mockClientQuery = vi.fn();
  const mockRelease = vi.fn();
  const client = { query: mockClientQuery, release: mockRelease };
  return { mockClientQuery, mockRelease, client };
}

let service: VerificationCaseService;

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

const VALID_PROFILE_ID = '00000000-0000-7000-8000-000000000001';
const VALID_USER_ID = '00000000-0000-7000-8000-000000000010';
const VALID_CASE_ID = '00000000-0000-7000-8000-000000000020';
const IP = '127.0.0.1';

describe('VerificationCaseService', () => {
  describe('listCases', () => {
    it('returns empty list when no cases exist', async () => {
      const { mockQuery, pool } = mockPool();
      mockQuery.mockResolvedValueOnce({ rows: [{ cnt: 0 }] }).mockResolvedValueOnce({ rows: [] });
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }));

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js');
      service = new Svc();

      const result = await service.listCases({ limit: 20, offset: 0 });

      expect(result).toEqual({ cases: [], total: 0 });
    });

    it('lists cases with default Open status filter', async () => {
      const { mockQuery, pool } = mockPool();
      mockQuery.mockResolvedValueOnce({ rows: [{ cnt: 2 }] }).mockResolvedValueOnce({
        rows: [
          {
            id: VALID_CASE_ID,
            profile_id: VALID_PROFILE_ID,
            field_name: 'first_name',
            requested_value: 'Jane',
            reason: 'Name correction',
            status: 'Open',
            created_by: VALID_USER_ID,
            created_at: '2026-08-26T10:00:00.000Z',
            updated_at: '2026-08-26T10:00:00.000Z',
          },
          {
            id: 'case-002',
            profile_id: VALID_PROFILE_ID,
            field_name: 'last_name',
            requested_value: 'Smith',
            reason: 'Legal name',
            status: 'Under Review',
            created_by: VALID_USER_ID,
            created_at: '2026-08-25T10:00:00.000Z',
            updated_at: '2026-08-25T10:00:00.000Z',
          },
        ],
      });
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }));

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js');
      service = new Svc();

      const result = await service.listCases({ limit: 20, offset: 0 });
      expect('error' in result).toBe(false);

      if (!('error' in result)) {
        expect(result.total).toBe(2);
        expect(result.cases).toHaveLength(2);
        expect(result.cases[0]!.id).toBe(VALID_CASE_ID);
        expect(result.cases[0]!.fieldName).toBe('first_name');
      }
    });

    it('filters by profileId', async () => {
      const { mockQuery, pool } = mockPool();
      mockQuery.mockResolvedValueOnce({ rows: [{ cnt: 1 }] }).mockResolvedValueOnce({
        rows: [
          {
            id: VALID_CASE_ID,
            profile_id: VALID_PROFILE_ID,
            field_name: 'first_name',
            requested_value: 'Jane',
            reason: 'Name correction',
            status: 'Open',
            created_by: VALID_USER_ID,
            created_at: '2026-08-26T10:00:00.000Z',
            updated_at: '2026-08-26T10:00:00.000Z',
          },
        ],
      });
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }));

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js');
      service = new Svc();

      const result = await service.listCases({ profileId: VALID_PROFILE_ID, limit: 20, offset: 0 });

      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.total).toBe(1);
      }
      expect(mockQuery.mock.calls[0]![0]).toContain('profile_id = $1');
    });
  });

  describe('getCase', () => {
    it('returns null when case not found', async () => {
      const { mockQuery, pool } = mockPool();
      mockQuery.mockResolvedValueOnce({ rows: [] });
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }));

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js');
      service = new Svc();

      const result = await service.getCase('nonexistent');

      expect(result).toBeNull();
    });

    it('returns full case detail', async () => {
      const { mockQuery, pool } = mockPool();
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: VALID_CASE_ID,
            profile_id: VALID_PROFILE_ID,
            profile_type: 'INDIVIDUAL',
            field_name: 'first_name',
            current_value: 'John',
            requested_value: 'Jane',
            evidence_urls: JSON.stringify(['https://s3.example.com/doc1.pdf']),
            reason: 'Name correction',
            status: 'Open',
            created_by: VALID_USER_ID,
            created_at: '2026-08-26T10:00:00.000Z',
            reviewed_by: null,
            reviewed_at: null,
            reviewer_notes: null,
            updated_at: '2026-08-26T10:00:00.000Z',
          },
        ],
      });
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }));

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js');
      service = new Svc();

      const result = await service.getCase(VALID_CASE_ID);

      expect(result).not.toBeNull();
      const detail = result as NonNullable<typeof result>;
      expect('id' in detail).toBe(true);
      if ('id' in detail) {
        expect(detail.id).toBe(VALID_CASE_ID);
        expect(detail.fieldName).toBe('first_name');
        expect(detail.evidenceUrls).toEqual(['https://s3.example.com/doc1.pdf']);
        expect(detail.reviewedBy).toBeNull();
      }
    });
  });

  describe('additional list filters', () => {
    it('filters by status filter', async () => {
      const { mockQuery, pool } = mockPool();
      mockQuery.mockResolvedValueOnce({ rows: [{ cnt: 2 }] }).mockResolvedValueOnce({
        rows: [
          {
            id: VALID_CASE_ID,
            profile_id: VALID_PROFILE_ID,
            field_name: 'first_name',
            requested_value: 'Jane',
            reason: 'Name correction',
            status: 'Open',
            created_by: VALID_USER_ID,
            created_at: '2026-08-26T10:00:00.000Z',
            updated_at: '2026-08-26T10:00:00.000Z',
          },
        ],
      });
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }));

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js');
      service = new Svc();

      const result = await service.listCases({ status: 'Open', limit: 20, offset: 0 });

      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.total).toBe(2);
      }
      // Verify WHERE clause includes status filter
      expect(mockQuery.mock.calls[0]![0]).toContain('status = $1');
    });

    it('filters by createdBy', async () => {
      const { mockQuery, pool } = mockPool();
      mockQuery.mockResolvedValueOnce({ rows: [{ cnt: 1 }] }).mockResolvedValueOnce({
        rows: [
          {
            id: VALID_CASE_ID,
            profile_id: VALID_PROFILE_ID,
            field_name: 'first_name',
            requested_value: 'Jane',
            reason: 'Name correction',
            status: 'Open',
            created_by: VALID_USER_ID,
            created_at: '2026-08-26T10:00:00.000Z',
            updated_at: '2026-08-26T10:00:00.000Z',
          },
        ],
      });
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }));

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js');
      service = new Svc();

      const result = await service.listCases({ createdBy: VALID_USER_ID, limit: 20, offset: 0 });

      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.total).toBe(1);
      }
      expect(mockQuery.mock.calls[0]![0]).toContain('created_by = $1');
    });
  });
});
