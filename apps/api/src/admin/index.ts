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

/**
 * Input for updating a staff user's roles.
 */
export interface UpdateStaffRolesInput {
  roleIds: string[]
  reason?: string
}