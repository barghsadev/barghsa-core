import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AiPoliciesService as ServiceType } from './ai-policies.service.js'

/** Mocked pool: query() returns queued fixtures in order. */
function mockPool() {
  const mockQuery = vi.fn()
  const pool = { query: mockQuery }
  return { mockQuery, pool }
}

function policyBaseRow(over: Record<string, unknown> = {}) {
  return {
    id: 'pol-1',
    title: 'No financial advice',
    description: 'Agent must not give financial advice',
    policy_type: 'disallowed_actions',
    rules: { actions: ['financial_advice'] },
    enabled: true,
    created_at: '2026-08-28T00:00:00.000Z',
    updated_at: '2026-08-28T00:00:00.000Z',
    ...over,
  }
}

function groupBaseRow(over: Record<string, unknown> = {}) {
  return {
    id: 'grp-1',
    title: 'Consumer guardrails',
    description: '',
    created_at: '2026-08-28T00:00:00.000Z',
    updated_at: '2026-08-28T00:00:00.000Z',
    ...over,
  }
}

const ACTOR = 'user-admin-1'

/** Load AiPoliciesService with a mocked @barghsa/db pool. */
async function loadService(pool: { query: ReturnType<typeof vi.fn> }) {
  vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
  const { AiPoliciesService: Svc } = await import('./ai-policies.service.js')
  return new Svc() as ServiceType
}

let service: ServiceType

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('AiPoliciesService (T-09.11.03)', () => {
  describe('listPolicies', () => {
    it('returns policies with group-count aggregates', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery.mockResolvedValueOnce({
        rows: [
          { ...policyBaseRow(), group_count: 1 },
          { ...policyBaseRow({ id: 'pol-2', title: 'Response tone' }), group_count: 0 },
        ],
      })

      const result = await service.listPolicies()
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ id: 'pol-1', groupCount: 1, enabled: true })
      expect(result[1]).toMatchObject({
        id: 'pol-2',
        groupCount: 0,
        policyType: 'disallowed_actions',
      })
    })
  })

  describe('getPolicy', () => {
    it('throws 404 when the policy does not exist', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery.mockResolvedValueOnce({ rows: [] }) // findPolicy

      await expect(service.getPolicy('missing')).rejects.toMatchObject({
        status: 404,
        response: { error: 'AI_POLICY_NOT_FOUND' },
      })
    })

    it('returns the policy with its group memberships', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [policyBaseRow()] }) // findPolicy
        .mockResolvedValueOnce({ rows: [{ id: 'grp-1', title: 'Consumer guardrails' }] }) // groups

      const result = await service.getPolicy('pol-1')
      expect(result).toMatchObject({ id: 'pol-1', groupCount: 1 })
      expect(result.groups).toEqual([{ id: 'grp-1', title: 'Consumer guardrails' }])
    })
  })

  describe('createPolicy / updatePolicy / removePolicy', () => {
    it('creates a policy (enabled by default) and records an audit event', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [policyBaseRow()] }) // insert return
        .mockResolvedValueOnce({ rows: [] }) // audit insert

      const result = await service.createPolicy({
        title: 'No financial advice',
        description: '',
        policyType: 'disallowed_actions',
        rules: { actions: ['financial_advice'] },
        actorUserId: ACTOR,
        ip: '1.2.3.4',
      })
      expect(result).toMatchObject({ id: 'pol-1', groupCount: 0, enabled: true })
      const insertSql = String(mockQuery.mock.calls[0]![0])
      expect(insertSql).toContain('INSERT INTO ai_policies')
      expect(insertSql).toContain('$1, $2, $3, $4, $5, $6, $7, $8, $8')
      const auditSql = String(mockQuery.mock.calls[1]![0])
      expect(auditSql).toContain('INSERT INTO audit_log')
      expect(mockQuery.mock.calls[1]![1]).toContain('ai_policy_created')
    })

    it('creates a disabled policy when enabled:false is supplied', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [policyBaseRow({ enabled: false })] }) // insert return
        .mockResolvedValueOnce({ rows: [] }) // audit

      const result = await service.createPolicy({
        title: 'Draft guardrail',
        description: '',
        policyType: 'disallowed_actions',
        rules: { actions: ['x'] },
        enabled: false,
        actorUserId: ACTOR,
        ip: '1.2.3.4',
      })
      expect(result).toMatchObject({ enabled: false })
      // enabled is the 6th bind parameter (index 5): [id, title, desc, type, rules, enabled, ...].
      expect(mockQuery.mock.calls[0]![1]![5]).toBe(false)
    })

    it('throws 404 on update of a missing policy', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery.mockResolvedValueOnce({ rows: [] }) // findPolicy

      await expect(
        service.updatePolicy('missing', { title: 'x', actorUserId: ACTOR, ip: '1.2.3.4' }),
      ).rejects.toMatchObject({ status: 404 })
    })

    it('updates the enabled flag and recomputes group count', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [policyBaseRow()] }) // findPolicy
        .mockResolvedValueOnce({
          rows: [policyBaseRow({ enabled: false })],
        }) // update return
        .mockResolvedValueOnce({ rows: [{ count: 2 }] }) // group count
        .mockResolvedValueOnce({ rows: [] }) // audit

      const result = await service.updatePolicy('pol-1', {
        enabled: false,
        actorUserId: ACTOR,
        ip: '1.2.3.4',
      })
      expect(result).toMatchObject({ enabled: false, groupCount: 2 })
      // Audit metadata must record what changed (fidelity for guardrail edits).
      const auditMeta = String(mockQuery.mock.calls[3]![1])
      expect(auditMeta).toContain('ai_policy_updated')
      expect(auditMeta).toContain('"changedFields"')
      expect(auditMeta).toContain('"enabledBefore":true')
      expect(auditMeta).toContain('"enabledAfter":false')
    })

    it('rejects a rules-only update that violates the stored policy type', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      // Policy is a disallowed_actions policy; rules without an actions[] is invalid.
      mockQuery.mockResolvedValueOnce({ rows: [policyBaseRow()] }) // findPolicy

      await expect(
        service.updatePolicy('pol-1', {
          rules: { topics: ['finance'] },
          actorUserId: ACTOR,
          ip: '1.2.3.4',
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: { error: 'AI_POLICY_RULES_INVALID' },
      })
      // No UPDATE or audit should have been issued.
      const writes = mockQuery.mock.calls.filter((c) =>
        String(c[0]).toLowerCase().includes('update ai_policies') ||
        String(c[0]).includes('INSERT INTO audit_log'),
      )
      expect(writes).toHaveLength(0)
    })

    it('rejects a policy-type change without a fresh rules document', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery.mockResolvedValueOnce({ rows: [policyBaseRow()] }) // findPolicy

      await expect(
        service.updatePolicy('pol-1', {
          policyType: 'response_style',
          actorUserId: ACTOR,
          ip: '1.2.3.4',
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: { error: 'AI_POLICY_TYPE_WITHOUT_RULES' },
      })
    })

    it('accepts a rules-only update that matches the stored policy type', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [policyBaseRow()] }) // findPolicy
        .mockResolvedValueOnce({
          rows: [policyBaseRow({ rules: { actions: ['financial_advice', 'promises'] } })],
        }) // update return
        .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // group count
        .mockResolvedValueOnce({ rows: [] }) // audit

      const result = await service.updatePolicy('pol-1', {
        rules: { actions: ['financial_advice', 'promises'] },
        actorUserId: ACTOR,
        ip: '1.2.3.4',
      })
      expect(result).toMatchObject({ id: 'pol-1' })
      const auditMeta = String(mockQuery.mock.calls[3]![1])
      expect(auditMeta).toContain('"changedFields"')
      expect(auditMeta).toContain('"rulesChanged":true')
    })

    it('accepts a matching policyType + rules pair (effective-type branch)', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [policyBaseRow()] }) // findPolicy
        .mockResolvedValueOnce({
          rows: [
            policyBaseRow({
              policy_type: 'response_style',
              rules: { tone: 'friendly', language: 'fa' },
            }),
          ],
        }) // update return
        .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // group count
        .mockResolvedValueOnce({ rows: [] }) // audit

      const result = await service.updatePolicy('pol-1', {
        policyType: 'response_style',
        rules: { tone: 'friendly', language: 'fa' },
        actorUserId: ACTOR,
        ip: '1.2.3.4',
      })
      expect(result).toMatchObject({ policyType: 'response_style' })
      const auditMeta = String(mockQuery.mock.calls[3]![1])
      expect(auditMeta).toContain('"policyTypeBefore":"disallowed_actions"')
      expect(auditMeta).toContain('"policyTypeAfter":"response_style"')
    })

    it('rejects a mismatched policyType + rules pair', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery.mockResolvedValueOnce({ rows: [policyBaseRow()] }) // findPolicy

      await expect(
        service.updatePolicy('pol-1', {
          policyType: 'response_style',
          rules: { actions: ['financial_advice'] }, // actions[] is invalid for response_style
          actorUserId: ACTOR,
          ip: '1.2.3.4',
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: { error: 'AI_POLICY_RULES_INVALID' },
      })
    })

    it('records changedFields [] for an identical-value PUT (audit fidelity)', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      const existing = policyBaseRow() // rules { actions: ['financial_advice'] }, enabled true
      mockQuery
        .mockResolvedValueOnce({ rows: [existing] }) // findPolicy
        .mockResolvedValueOnce({ rows: [existing] }) // update return (no real change)
        .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // group count
        .mockResolvedValueOnce({ rows: [] }) // audit

      await service.updatePolicy('pol-1', {
        title: 'No financial advice',
        policyType: 'disallowed_actions',
        rules: { actions: ['financial_advice'] },
        enabled: true,
        actorUserId: ACTOR,
        ip: '1.2.3.4',
      })
      const auditMeta = String(mockQuery.mock.calls[3]![1])
      expect(auditMeta).toContain('"changedFields":[]')
      expect(auditMeta).toContain('"rulesChanged":false')
    })

    it('removes a policy and records the audit event', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [policyBaseRow()] }) // findPolicy
        .mockResolvedValueOnce({ rows: [] }) // delete
        .mockResolvedValueOnce({ rows: [] }) // audit

      await service.removePolicy('pol-1', ACTOR, '1.2.3.4')
      const deleteSql = String(mockQuery.mock.calls[1]![0])
      expect(deleteSql).toContain('DELETE FROM ai_policies')
    })
  })

  describe('group CRUD', () => {
    it('lists groups with member counts', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery.mockResolvedValueOnce({ rows: [{ ...groupBaseRow(), member_count: 3 }] })

      const result = await service.listGroups()
      expect(result[0]).toMatchObject({ id: 'grp-1', memberCount: 3 })
    })

    it('gets a group with its member policies', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [groupBaseRow()] }) // findGroup
        .mockResolvedValueOnce({
          rows: [
            { id: 'pol-1', title: 'No financial advice', policy_type: 'disallowed_actions', enabled: true },
          ],
        }) // members

      const result = await service.getGroup('grp-1')
      expect(result).toMatchObject({ id: 'grp-1', memberCount: 1 })
      expect(result.members).toEqual([
        { id: 'pol-1', title: 'No financial advice', policyType: 'disallowed_actions', enabled: true },
      ])
    })

    it('creates a group', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [groupBaseRow()] })
        .mockResolvedValueOnce({ rows: [] })

      const result = await service.createGroup({
        title: 'Consumer guardrails',
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
    it('links a policy into a group', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [groupBaseRow()] }) // findGroup
        .mockResolvedValueOnce({ rows: [policyBaseRow()] }) // findPolicy
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ group_id: 'grp-1' }] }) // insert member
        .mockResolvedValueOnce({ rows: [] }) // audit

      await expect(
        service.addGroupMember({
          groupId: 'grp-1',
          policyId: 'pol-1',
          actorUserId: ACTOR,
          ip: '1.2.3.4',
        }),
      ).resolves.toBeUndefined()
      const insertSql = String(mockQuery.mock.calls[2]![0])
      expect(insertSql).toContain('INSERT INTO ai_policy_group_members')
      expect(insertSql).toContain('ON CONFLICT (group_id, policy_id) DO NOTHING')
      // A real link emits an audit event.
      const auditCalls = mockQuery.mock.calls.filter((call) =>
        String(call[0]).includes('INSERT INTO audit_log'),
      )
      expect(auditCalls).toHaveLength(1)
      expect(auditCalls[0]![1]).toContain('ai_policy_group_member_added')
    })

    it('is idempotent: a no-op re-link emits no audit event', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [groupBaseRow()] }) // findGroup
        .mockResolvedValueOnce({ rows: [policyBaseRow()] }) // findPolicy
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // insert → conflict

      await expect(
        service.addGroupMember({
          groupId: 'grp-1',
          policyId: 'pol-1',
          actorUserId: ACTOR,
          ip: '1.2.3.4',
        }),
      ).resolves.toBeUndefined()
      const auditCalls = mockQuery.mock.calls.filter((call) =>
        String(call[0]).includes('INSERT INTO audit_log'),
      )
      expect(auditCalls).toHaveLength(0)
    })

    it('throws 404 when the member policy does not exist', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [groupBaseRow()] }) // findGroup
        .mockResolvedValueOnce({ rows: [] }) // findPolicy

      await expect(
        service.addGroupMember({
          groupId: 'grp-1',
          policyId: 'missing',
          actorUserId: ACTOR,
          ip: '1.2.3.4',
        }),
      ).rejects.toMatchObject({ status: 404, response: { error: 'AI_POLICY_NOT_FOUND' } })
    })

    it('removes a policy from a group', async () => {
      const { mockQuery } = mockPool()
      service = await loadService({ query: mockQuery })
      mockQuery
        .mockResolvedValueOnce({ rows: [groupBaseRow()] }) // findGroup
        .mockResolvedValueOnce({ rowCount: 1 }) // delete
        .mockResolvedValueOnce({ rows: [] }) // audit

      await expect(
        service.removeGroupMember('grp-1', 'pol-1', ACTOR, '1.2.3.4'),
      ).resolves.toBeUndefined()
    })
  })
})
