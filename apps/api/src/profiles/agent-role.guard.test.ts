import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AgentRoleGuard } from './agent-role.guard.js'
import { AgentsService } from './agents.service.js'
import { AGENT_PERMISSION_KEY } from './agent-permission.decorator.js'

describe('AgentRoleGuard', () => {
  let guard: AgentRoleGuard
  let mockAgentsService: AgentsService
  let mockReflector: Reflector
  let mockGetRequest: any
  let mockGetResponse: any
  let mockHttp: any
  let mockContext: any

  beforeEach(() => {
    mockAgentsService = {
      getAgentRoles: vi.fn(),
    } as any

    mockReflector = {
      get: vi.fn(),
    } as any

    mockGetResponse = {
      setHeader: vi.fn(),
    }

    mockGetRequest = {
      session: { userId: 'user-1' },
      params: { profileId: 'prof-1' },
    }

    mockHttp = {
      getRequest: vi.fn(() => mockGetRequest),
      getResponse: vi.fn(() => mockGetResponse),
    }

    mockContext = {
      switchToHttp: vi.fn(() => mockHttp),
      getHandler: vi.fn(),
      getClass: vi.fn(),
    }

    guard = new AgentRoleGuard(mockReflector, mockAgentsService)
  })

  it('allows access when the required permission is granted by the user role', async () => {
    vi.mocked(mockReflector.get).mockReturnValue('orders:create')
    vi.mocked(mockAgentsService.getAgentRoles).mockResolvedValue(['Manager'])

    const result = await guard.canActivate(mockContext)
    expect(result).toBe(true)
  })

  it('allows Owner access to any permission', async () => {
    vi.mocked(mockReflector.get).mockReturnValue('profile:transfer-ownership')
    vi.mocked(mockAgentsService.getAgentRoles).mockResolvedValue(['Owner'])

    const result = await guard.canActivate(mockContext)
    expect(result).toBe(true)
  })

  it('throws ForbiddenException when the user role lacks the required permission', async () => {
    vi.mocked(mockReflector.get).mockReturnValue('orders:create')
    vi.mocked(mockAgentsService.getAgentRoles).mockResolvedValue(['Finance'])

    await expect(guard.canActivate(mockContext)).rejects.toThrow(ForbiddenException)
  })

  it('throws ForbiddenException when the user is not an agent of the profile', async () => {
    vi.mocked(mockReflector.get).mockReturnValue('orders:view')
    vi.mocked(mockAgentsService.getAgentRoles).mockResolvedValue([])

    await expect(guard.canActivate(mockContext)).rejects.toThrow(ForbiddenException)
  })

  it('throws ForbiddenException when there is no authenticated session', async () => {
    vi.mocked(mockReflector.get).mockReturnValue('orders:view')
    mockGetRequest.session = undefined

    await expect(guard.canActivate(mockContext)).rejects.toThrow(ForbiddenException)
  })

  it('throws ForbiddenException when there is no profile ID in route params', async () => {
    vi.mocked(mockReflector.get).mockReturnValue('orders:view')
    mockGetRequest.params = {}

    await expect(guard.canActivate(mockContext)).rejects.toThrow(ForbiddenException)
  })

  it('allows access when no @RequireAgentPermission() is set (pass-through)', async () => {
    vi.mocked(mockReflector.get).mockReturnValue(undefined)

    const result = await guard.canActivate(mockContext)
    expect(result).toBe(true)
  })

  it('supports additive roles — Manager + Finance combined', async () => {
    vi.mocked(mockReflector.get).mockReturnValue('wallet:charge')
    vi.mocked(mockAgentsService.getAgentRoles).mockResolvedValue(['Manager', 'Finance'])

    const result = await guard.canActivate(mockContext)
    expect(result).toBe(true)
  })

  it('supports extracting profile ID from request.params.id as fallback', async () => {
    vi.mocked(mockReflector.get).mockReturnValue('orders:view')
    mockGetRequest.params = { id: 'prof-2' }
    vi.mocked(mockAgentsService.getAgentRoles).mockResolvedValue(['Manager'])

    const result = await guard.canActivate(mockContext)
    expect(result).toBe(true)
    expect(mockAgentsService.getAgentRoles).toHaveBeenCalledWith('prof-2', 'user-1')
  })
})