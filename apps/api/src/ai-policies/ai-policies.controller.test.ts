import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PoliciesController, PolicyGroupsController } from './ai-policies.controller.js'
import type { AiPoliciesService } from './ai-policies.service.js'

// ─── Mock service ─────────────────────────────────────────────────────────

const mockListPolicies = vi.fn()
const mockGetPolicy = vi.fn()
const mockCreatePolicy = vi.fn()
const mockUpdatePolicy = vi.fn()
const mockRemovePolicy = vi.fn()
const mockListGroups = vi.fn()
const mockGetGroup = vi.fn()
const mockCreateGroup = vi.fn()
const mockUpdateGroup = vi.fn()
const mockRemoveGroup = vi.fn()
const mockAddGroupMember = vi.fn()
const mockRemoveGroupMember = vi.fn()

const mockService = {
  listPolicies: mockListPolicies,
  getPolicy: mockGetPolicy,
  createPolicy: mockCreatePolicy,
  updatePolicy: mockUpdatePolicy,
  removePolicy: mockRemovePolicy,
  listGroups: mockListGroups,
  getGroup: mockGetGroup,
  createGroup: mockCreateGroup,
  updateGroup: mockUpdateGroup,
  removeGroup: mockRemoveGroup,
  addGroupMember: mockAddGroupMember,
  removeGroupMember: mockRemoveGroupMember,
} as unknown as AiPoliciesService

const adminReq = {
  session: { isAdmin: true, userId: 'admin-1' },
  ip: '10.0.0.8',
  socket: { remoteAddress: '10.0.0.8' },
} as never

const nonAdminReq = {
  session: { isAdmin: false, userId: 'admin-1' },
  ip: '10.0.0.8',
} as never

function basePolicy(over: Record<string, unknown> = {}) {
  return {
    id: 'pol-1',
    title: 'No financial advice',
    description: '',
    policyType: 'disallowed_actions',
    rules: { actions: ['financial_advice'] },
    enabled: true,
    groupCount: 0,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
    ...over,
  }
}

function baseGroup(over: Record<string, unknown> = {}) {
  return {
    id: 'grp-1',
    title: 'Consumer guardrails',
    description: '',
    memberCount: 0,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
    ...over,
  }
}

describe('PoliciesController (T-09.11.03)', () => {
  let controller: PoliciesController

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new PoliciesController(mockService)
  })

  describe('permission gate (admin:ai:policies)', () => {
    it('rejects non-admin sessions on every route with 403', async () => {
      await expect(controller.list(nonAdminReq)).rejects.toMatchObject({ status: 403 })
      await expect(controller.get(nonAdminReq, 'pol-1')).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.create(nonAdminReq, {
          title: 'x',
          policyType: 'disallowed_actions',
          rules: { actions: ['a'] },
        } as never),
      ).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.update(nonAdminReq, 'pol-1', { title: 'y' } as never),
      ).rejects.toMatchObject({ status: 403 })
      await expect(controller.remove(nonAdminReq, 'pol-1')).rejects.toMatchObject({ status: 403 })
      expect(mockListPolicies).not.toHaveBeenCalled()
      expect(mockCreatePolicy).not.toHaveBeenCalled()
    })

    it('allows platform-admin sessions', async () => {
      mockListPolicies.mockResolvedValue([])
      await expect(controller.list(adminReq)).resolves.toEqual([])
    })
  })

  describe('POST /api/admin/policies', () => {
    it('rejects a body with an invalid rules shape for the type', async () => {
      // disallowed_actions requires a non-empty actions[].
      await expect(
        controller.create(adminReq, {
          title: 'Bad',
          policyType: 'disallowed_actions',
          rules: {},
        } as never),
      ).rejects.toMatchObject({ status: 400 })
      expect(mockCreatePolicy).not.toHaveBeenCalled()
    })

    it('creates a policy with validated structured rules', async () => {
      mockCreatePolicy.mockResolvedValue(basePolicy())
      const result = await controller.create(adminReq, {
        title: 'No financial advice',
        policyType: 'disallowed_actions',
        rules: { actions: ['financial_advice'] },
      } as never)
      expect(result).toMatchObject({ id: 'pol-1' })
      expect(mockCreatePolicy).toHaveBeenCalledWith({
        title: 'No financial advice',
        description: '',
        policyType: 'disallowed_actions',
        rules: { actions: ['financial_advice'] },
        actorUserId: 'admin-1',
        ip: '10.0.0.8',
      })
    })

    it('forwards an optional enabled:false so a policy can be created disabled', async () => {
      mockCreatePolicy.mockResolvedValue(basePolicy({ enabled: false }))
      const result = await controller.create(adminReq, {
        title: 'Draft guardrail',
        policyType: 'disallowed_actions',
        rules: { actions: ['financial_advice'] },
        enabled: false,
      } as never)
      expect(result).toMatchObject({ enabled: false })
      expect(mockCreatePolicy).toHaveBeenCalledWith({
        title: 'Draft guardrail',
        description: '',
        policyType: 'disallowed_actions',
        rules: { actions: ['financial_advice'] },
        enabled: false,
        actorUserId: 'admin-1',
        ip: '10.0.0.8',
      })
    })
  })

  describe('PUT /api/admin/policies/:id', () => {
    it('rejects an empty update body', async () => {
      await expect(controller.update(adminReq, 'pol-1', {} as never)).rejects.toMatchObject({
        status: 400,
      })
      expect(mockUpdatePolicy).not.toHaveBeenCalled()
    })

    it('rejects a mismatched policyType + rules pair (controller superRefine)', async () => {
      await expect(
        controller.update(adminReq, 'pol-1', {
          policyType: 'response_style',
          rules: { actions: ['financial_advice'] },
        } as never),
      ).rejects.toMatchObject({ status: 400 })
      expect(mockUpdatePolicy).not.toHaveBeenCalled()
    })

    it('forwards only provided fields and the enabled toggle', async () => {
      mockUpdatePolicy.mockResolvedValue(basePolicy({ enabled: false }))
      const result = await controller.update(adminReq, 'pol-1', { enabled: false } as never)
      expect(result).toMatchObject({ enabled: false })
      expect(mockUpdatePolicy).toHaveBeenCalledWith('pol-1', {
        enabled: false,
        actorUserId: 'admin-1',
        ip: '10.0.0.8',
      })
    })
  })

  describe('DELETE /api/admin/policies/:id', () => {
    it('deletes the policy', async () => {
      mockRemovePolicy.mockResolvedValue(undefined)
      await expect(controller.remove(adminReq, 'pol-1')).resolves.toBeUndefined()
      expect(mockRemovePolicy).toHaveBeenCalledWith('pol-1', 'admin-1', '10.0.0.8')
    })
  })
})

describe('PolicyGroupsController (T-09.11.03)', () => {
  let controller: PolicyGroupsController

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new PolicyGroupsController(mockService)
  })

  describe('permission gate (admin:ai:policies)', () => {
    it('rejects non-admin sessions on every route with 403', async () => {
      await expect(controller.list(nonAdminReq)).rejects.toMatchObject({ status: 403 })
      await expect(controller.get(nonAdminReq, 'grp-1')).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.create(nonAdminReq, { title: 'x', description: '' } as never),
      ).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.update(nonAdminReq, 'grp-1', { title: 'y' } as never),
      ).rejects.toMatchObject({ status: 403 })
      await expect(controller.remove(nonAdminReq, 'grp-1')).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.addMember(nonAdminReq, 'grp-1', { policyId: 'pol-1' } as never),
      ).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.removeMember(nonAdminReq, 'grp-1', 'pol-1'),
      ).rejects.toMatchObject({ status: 403 })
      expect(mockListGroups).not.toHaveBeenCalled()
      expect(mockAddGroupMember).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/admin/policy-groups', () => {
    it('creates a group', async () => {
      mockCreateGroup.mockResolvedValue(baseGroup())
      const result = await controller.create(adminReq, { title: 'Consumer guardrails' } as never)
      expect(result).toMatchObject({ id: 'grp-1' })
      expect(mockCreateGroup).toHaveBeenCalledWith({
        title: 'Consumer guardrails',
        description: '',
        actorUserId: 'admin-1',
        ip: '10.0.0.8',
      })
    })
  })

  describe('POST /api/admin/policy-groups/:id/members', () => {
    it('links a policy into the group', async () => {
      mockAddGroupMember.mockResolvedValue(undefined)
      await expect(
        controller.addMember(adminReq, 'grp-1', { policyId: 'pol-1' } as never),
      ).resolves.toBeUndefined()
      expect(mockAddGroupMember).toHaveBeenCalledWith({
        groupId: 'grp-1',
        policyId: 'pol-1',
        actorUserId: 'admin-1',
        ip: '10.0.0.8',
      })
    })

    it('rejects a missing policyId', async () => {
      await expect(controller.addMember(adminReq, 'grp-1', {} as never)).rejects.toMatchObject({
        status: 400,
      })
      expect(mockAddGroupMember).not.toHaveBeenCalled()
    })
  })

  describe('DELETE /api/admin/policy-groups/:id/members/:policyId', () => {
    it('removes the policy from the group', async () => {
      mockRemoveGroupMember.mockResolvedValue(undefined)
      await expect(
        controller.removeMember(adminReq, 'grp-1', 'pol-1'),
      ).resolves.toBeUndefined()
      expect(mockRemoveGroupMember).toHaveBeenCalledWith('grp-1', 'pol-1', 'admin-1', '10.0.0.8')
    })
  })
})
