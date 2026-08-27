export { AdminModule } from './admin.module.js'
export { AdminService } from './admin.service.js'
export type {
  ActivationMethod,
  CreateStaffUserInput,
  CreateStaffUserResult,
  EffectivePermissionsResult,
  PermissionDescriptor,
  StaffRoleDto,
  UpdateStaffRolesResult,
} from './admin.service.js'
export { AdminController, CreateStaffUserSchema, type CreateStaffUserDto } from './admin.controller.js'
export { DualApprovalController, RejectApprovalRequestSchema } from './dual-approval.controller.js'
export {
  DualApprovalService,
  DUAL_APPROVAL_ACTION_TYPES,
  toApprovalRequestDto,
  sanitizeLimit,
  sanitizeOffset,
  type ApprovalRequestDto,
  type ListApprovalRequestsOptions,
} from './dual-approval.service.js'

/**
 * Input for updating a staff user's roles.
 */
export interface UpdateStaffRolesInput {
  roleIds: string[]
  reason?: string
}