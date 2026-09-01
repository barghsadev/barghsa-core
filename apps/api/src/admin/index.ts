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
export { DueAtOverrideController } from './due-at-override.controller.js'
export { ReminderOffsetToggleController } from './reminder-offset-toggle.controller.js'
export { ReminderOffsetToggleService } from './reminder-offset-toggle.service.js'
export { BankReceiptConfirmationController } from './bank-receipt-confirmation.controller.js'
export {
  ReconciliationExceptionsController,
  ResolutionNoteSchema,
} from './reconciliation-exceptions.controller.js'
export {
  ReconciliationExceptionsService,
  toReconciliationExceptionDto,
  validateResolutionNote,
  type ReconciliationExceptionDto,
  type ListReconciliationExceptionsOptions,
} from './reconciliation-exceptions.service.js'
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