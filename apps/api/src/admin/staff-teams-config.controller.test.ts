import { describe, it, expect, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { AdminController } from './admin.controller.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { DEFAULT_STAFF_ASSIGNMENT_RULES } from '@barghsa/shared/admin'
import { ErrorCodes } from '@barghsa/shared/errors'

// ─── Fixtures ──────────────────────────────────────────────────────────

const adminReq = {
  session: { isAdmin: true, userId: 'admin-1' },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest

const nonAdminReq = {
  session: { isAdmin: false, userId: 'admin-1' },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest

function makeController() {
  const listStaffTeams = vi.fn().mockResolvedValue([])
  const createStaffTeam = vi.fn().mockResolvedValue({ id: 'team-1', name: 'Billing' })
  const updateStaffTeam = vi.fn().mockResolvedValue({ id: 'team-1', name: 'Billing Plus' })
  const deleteStaffTeam = vi.fn().mockResolvedValue({ deleted: true })
  const getStaffAssignmentRules = vi.fn().mockResolvedValue(DEFAULT_STAFF_ASSIGNMENT_RULES)
  const setStaffAssignmentRules = vi.fn().mockResolvedValue(DEFAULT_STAFF_ASSIGNMENT_RULES)
  const adminService = {
    listStaffTeams,
    createStaffTeam,
    updateStaffTeam,
    deleteStaffTeam,
    getStaffAssignmentRules,
    setStaffAssignmentRules,
  }
  const controller = new AdminController(
    adminService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  )
  return { controller, adminService }
}

/** Extract the HttpException payload an assertion helper can check. */
function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

// ─── Tests — permission gate (T-09.08.02) ─────────────────────────────

describe('staff-teams permission gate (T-09.08.02)', () => {
  it.each([
    ['listStaffTeams', (c: AdminController, r: AuthenticatedRequest) => c.listStaffTeams(r)],
    ['createStaffTeam', (c: AdminController, r: AuthenticatedRequest) => c.createStaffTeam({ name: 'X' }, r)],
    ['updateStaffTeam', (c: AdminController, r: AuthenticatedRequest) => c.updateStaffTeam('t', { name: 'X' }, r)],
    ['deleteStaffTeam', (c: AdminController, r: AuthenticatedRequest) => c.deleteStaffTeam('t', r)],
    ['getStaffAssignmentRules', (c: AdminController, r: AuthenticatedRequest) => c.getStaffAssignmentRules(r)],
    ['setStaffAssignmentRules', (c: AdminController, r: AuthenticatedRequest) => c.setStaffAssignmentRules({}, r)],
  ])('rejects non-admin on %s with the AUTHZ_FORBIDDEN contract', async (_name, call) => {
    const { controller } = makeController()
    const rejection = await call(controller, nonAdminReq).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
  })

  it('does not call the service when the permission gate rejects', async () => {
    const { controller, adminService } = makeController()
    await controller.setStaffAssignmentRules({}, nonAdminReq).catch((e: unknown) => e)
    expect(adminService.setStaffAssignmentRules).not.toHaveBeenCalled()
  })

  it('allows admin to list teams and delegates to the service', async () => {
    const { controller, adminService } = makeController()
    await expect(controller.listStaffTeams(adminReq)).resolves.toEqual([])
    expect(adminService.listStaffTeams).toHaveBeenCalledTimes(1)
  })

  it('allows admin to create a team and passes actor/ip to the service', async () => {
    const { controller, adminService } = makeController()
    const result = await controller.createStaffTeam({ name: 'Billing', memberUserIds: [] }, adminReq)
    expect(result).toMatchObject({ id: 'team-1' })
    expect(adminService.createStaffTeam).toHaveBeenCalledWith(
      { name: 'Billing', memberUserIds: [] },
      'admin-1',
      '127.0.0.1',
    )
  })

  it('allows admin to update a team and passes the id to the service', async () => {
    const { controller, adminService } = makeController()
    const result = await controller.updateStaffTeam('team-1', { name: 'Billing Plus' }, adminReq)
    expect(result).toMatchObject({ name: 'Billing Plus' })
    expect(adminService.updateStaffTeam).toHaveBeenCalledWith(
      'team-1',
      { name: 'Billing Plus' },
      'admin-1',
      '127.0.0.1',
    )
  })

  it('allows admin to delete a team and passes the id to the service', async () => {
    const { controller, adminService } = makeController()
    const result = await controller.deleteStaffTeam('team-1', adminReq)
    expect(result).toEqual({ deleted: true })
    expect(adminService.deleteStaffTeam).toHaveBeenCalledWith('team-1', 'admin-1', '127.0.0.1')
  })

  it('allows admin to read assignment rules and delegates to the service', async () => {
    const { controller, adminService } = makeController()
    await expect(controller.getStaffAssignmentRules(adminReq)).resolves.toEqual(
      DEFAULT_STAFF_ASSIGNMENT_RULES,
    )
    expect(adminService.getStaffAssignmentRules).toHaveBeenCalledTimes(1)
  })

  it('allows admin to write assignment rules and passes actor/ip to the service', async () => {
    const { controller, adminService } = makeController()
    const payload = { ticket: { teamId: 'team-1', strategy: 'round_robin' } }
    await controller.setStaffAssignmentRules(payload, adminReq)
    expect(adminService.setStaffAssignmentRules).toHaveBeenCalledWith(
      payload,
      'admin-1',
      '127.0.0.1',
    )
  })
})
