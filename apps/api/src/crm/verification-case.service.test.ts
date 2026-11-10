import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VerificationCaseService } from './verification-case.service.js';
import { VerificationEvidenceService } from './verification-evidence.service.js';

// ─── Helpers ──────────────────────────────────────────────────────────

function mockPool() {
  const mockQuery = vi.fn();
  const mockConnect = vi.fn();
  const pool = { query: mockQuery, connect: mockConnect };
  return { mockQuery, mockConnect, pool };
}

let service: VerificationCaseService;

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

const VALID_PROFILE_ID = '00000000-0000-7000-8000-000000000001';
const VALID_USER_ID = '00000000-0000-7000-8000-000000000010';
const VALID_CASE_ID = '00000000-0000-7000-8000-000000000020';

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

  describe('reviewCase', () => {
    it.each([
      ['Open', 'Under Review', true],
      ['Open', 'Approved', false],
      ['Open', 'Rejected', true],
      ['Under Review', 'Under Review', false],
      ['Under Review', 'Approved', true],
      ['Under Review', 'Rejected', true],
      ['Approved', 'Under Review', false],
      ['Approved', 'Approved', false],
      ['Approved', 'Rejected', false],
      ['Rejected', 'Under Review', false],
      ['Rejected', 'Approved', false],
      ['Rejected', 'Rejected', false],
    ] as const)('%s to %s (allowed %s)', async (status, decision, allowed) => {
      const { pool, mockConnect } = mockPool();
      const actor = {
        userId: VALID_USER_ID,
        sessionId: '00000000-0000-7000-8000-000000000030',
        csrfToken: 'test-csrf',
      };
      const query = vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql.includes('FROM users')) return { rows: [{ user_id: actor.userId }] };
        if (sql.includes('FROM user_roles')) return { rows: [{ permissions: ['crm:verify'] }] };
        if (sql.includes('SELECT csrf_token')) {
          return {
            rows: [
              {
                active: true,
                fresh: true,
                csrf_token: actor.csrfToken,
                step_up_verified_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes('FROM profiles p')) {
          return {
            rows: [{ id: VALID_PROFILE_ID, profile_type: 'INDIVIDUAL', first_name: 'Old' }],
          };
        }
        if (sql.includes('FROM verification_cases WHERE')) {
          return {
            rows: [
              {
                profile_id: VALID_PROFILE_ID,
                created_by: 'other-reviewer',
                status,
                field_name: 'first_name',
                current_value: 'Old',
                requested_value: 'New',
                evidence_urls: ['sealed.pdf'],
              },
            ],
          };
        }
        if (sql.includes('UPDATE profiles SET')) return { rows: [{ id: VALID_PROFILE_ID }] };
        return { rows: [] };
      });
      const release = vi.fn();
      mockConnect.mockResolvedValue({ query, release });
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }));
      const { VerificationCaseService: Svc } = await import('./verification-case.service.js');
      const evidence = new VerificationEvidenceService();
      const validate = vi.spyOn(evidence, 'validate').mockResolvedValue(undefined);

      const result = new Svc(evidence).reviewCase(
        VALID_CASE_ID,
        { decision, reviewerNotes: 'Review notes' },
        actor,
        '203.0.113.10'
      );
      if (allowed) {
        await expect(result).resolves.toEqual({
          success: true,
          id: VALID_CASE_ID,
          status: decision,
          profileId: VALID_PROFILE_ID,
        });
        expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE verification_cases'), [
          decision,
          actor.userId,
          'Review notes',
          VALID_CASE_ID,
        ]);
        expect(query).toHaveBeenCalledWith(
          expect.stringContaining("'verification_case_reviewed'"),
          expect.any(Array)
        );
        expect(query).toHaveBeenCalledWith('COMMIT');
      } else {
        await expect(result).rejects.toThrow('Invalid correction state transition');
        expect(query).not.toHaveBeenCalledWith(
          expect.stringContaining('UPDATE verification_cases'),
          expect.any(Array)
        );
        expect(query).not.toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO audit_log'),
          expect.any(Array)
        );
        expect(query).toHaveBeenCalledWith('ROLLBACK');
      }
      const appliesCorrection = allowed && decision === 'Approved';
      expect(validate).toHaveBeenCalledTimes(appliesCorrection ? 1 : 0);
      expect(query.mock.calls.filter(([sql]) => sql.includes('UPDATE profiles SET'))).toHaveLength(
        appliesCorrection ? 1 : 0
      );
      expect(release).toHaveBeenCalledOnce();
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
