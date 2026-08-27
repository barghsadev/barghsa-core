import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { AdminService, type UpdateStaffRolesResult, type StaffRoleDto, type EffectivePermissionsResult } from './admin.service.js'
import { BrandConfigService } from './brand-config.service.js'
import { TosService } from '../tos/tos.service.js'
import {
  NotificationTemplateService,
  type NotificationTemplateResult,
  type CreateNotificationTemplateInput,
  type PageTemplatesOptions,
  type RenderedTemplate,
} from '../notifications/notification-template.service.js'
import { NotificationsService } from '../notifications/notifications.service.js'
import type { TosVersionDetail, UpdateTosVersionFields } from '../tos/tos.service.js'
import { StepUpGuard, RequiresStepUp } from '../session/step-up.guard.js'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { ErrorCodes } from '@barghsa/shared/errors'

/**
 * Zod schema for the create-staff-user request body.
 */
export const CreateStaffUserSchema = z.object({
  username: z
    .string()
    .min(1, { message: 'VALIDATION:INPUT:MISSING' })
    .max(255)
    .refine(
      (val) => {
        // Must be a valid email or E.164 phone number
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        const e164Re = /^\+[1-9]\d{6,14}$/
        return emailRe.test(val) || e164Re.test(val)
      },
      { message: 'AUTH:REGISTER:INVALID_USERNAME' },
    ),
  firstName: z.string().min(1, { message: 'VALIDATION:INPUT:MISSING' }).max(100),
  lastName: z.string().min(1, { message: 'VALIDATION:INPUT:MISSING' }).max(100),
  roleIds: z.array(z.string().uuid()).optional().default([]),
  activationMethod: z.enum(['tempPassword', 'link']),
})

export type CreateStaffUserDto = z.infer<typeof CreateStaffUserSchema>

/**
 * Zod schema for brand config body (T-09.01.01).
 *
 * Validates the config JSON for the PUT /api/admin/branding/config endpoint.
 */
const hexColorRe = /^#[0-9a-fA-F]{6}$/

export const UpsertBrandConfigSchema = z.object({
  config: z.object({
    appTitle: z.string().min(1).max(100).optional().default('Barghsa'),
    slogan: z.string().max(200).optional().default(''),
    primaryColor: z.string().regex(hexColorRe, 'Must be a valid 6-char hex color').optional().default('#2563eb'),
    secondaryColor: z.string().regex(hexColorRe, 'Must be a valid 6-char hex color').optional().default('#64748b'),
    accentColor: z.string().regex(hexColorRe, 'Must be a valid 6-char hex color').optional().default('#f59e0b'),
    logoUrl: z.string().url().nullable().optional().default(null),
    faviconUrl: z.string().url().nullable().optional().default(null),
    darkMode: z.boolean().optional().default(false),
  }),
})
export interface BrandConfigDto {
  id: string
  config: Record<string, unknown>
  version: number
  status: 'draft' | 'active'
  createdBy: string
  createdAt: string
  updatedAt: string
}

/**
 * Zod schema for the profile-verification-mode request body.
 */
export const SetProfileVerificationModeSchema = z.object({
  mode: z.enum(['DISABLED', 'MANUAL', 'API']),
})

export type SetProfileVerificationModeDto = z.infer<typeof SetProfileVerificationModeSchema>

/**
 * Zod schema for the update-staff-roles request body.
 */
export const UpdateStaffRolesSchema = z.object({
  roleIds: z.array(z.string().min(1, { message: 'VALIDATION:INPUT:MISSING' })),
  reason: z.string().max(500).optional(),
})

/**
 * API response for the create-staff-user endpoint.
 */
export interface CreateStaffUserApiResponse {
  userId: string
  username: string
  activationMethod: 'tempPassword' | 'link'
  temporaryPassword?: string
  activationToken?: string
  message: string
}

/**
 * Admin controller for staff management endpoints.
 *
 * All routes require authentication with admin (isAdmin) privileges.
 * Routes are prefixed with /api/admin.
 *
 * @UseGuards(SessionAuthGuard) — requires valid authenticated session.
 */
@ApiTags('Admin')
@Controller('api/admin')
@UseGuards(SessionAuthGuard)
export class AdminController {
  private readonly logger = new Logger(AdminController.name)

  /**
   * Permission gate for notification-template admin operations.
   *
   * The acceptance criteria for T-09.04.01 require the `admin:notifications:edit`
   * capability. Today the session model exposes only `isAdmin` (platform admin);
   * granular staff-role permissions arrive with the role system (T-09.05).
   * Until then, `admin:notifications:edit` maps to a platform admin session.
   * Centralized here so the capability check is a single enforcement point.
   */
  private assertNotificationPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }
  }

  constructor(
    private readonly adminService: AdminService,
    private readonly brandConfigService: BrandConfigService,
    private readonly tosService: TosService,
    private readonly notificationTemplateService: NotificationTemplateService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Permission gate for notification delivery configuration (S-09.06).
   *
   * The S-09.06 notification-delivery surface (email providers, SMS.ir
   * providers, and the daytime delivery window) is protected by the
   * `admin:notification-providers:edit` capability. Today the session model
   * exposes only `isAdmin` (platform admin); granular staff-role permissions
   * arrive with the role system (T-09.05). Until then the capability maps to a
   * platform admin session, matching the email (T-09.06.01) and SMS (T-09.06.02)
   * provider controllers. Centralized here as a single enforcement point so the
   * whole S-09.06 surface uses one check.
   */
  private assertNotificationDeliveryEditPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      throw new HttpException(
        {
          statusCode: 403,
          error: ErrorCodes.AUTHZ_FORBIDDEN.code,
          message: 'Admin role required to manage notification delivery configuration',
        },
        403,
      )
    }
  }

  /**
   * POST /api/admin/users/create-staff
   *
   * Creates a new staff user. Permission: admin or staff with admin:users:create role.
   *
   * The user is created with:
   * - A unique username (email or E.164 phone)
   * - First and last name
   * - An auto-created, verified individual profile
   * - Activation via temporary password (shown once) or activation link (24h)
   *
   * Rate limits:
   * - 10 creations per IP per hour
   */
  @Post('users/create-staff')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a new staff user (admin)' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['username', 'firstName', 'lastName', 'activationMethod'],
      properties: {
        username: { type: 'string', description: 'Email or E.164 phone number' },
        firstName: { type: 'string', description: 'Staff first name' },
        lastName: { type: 'string', description: 'Staff last name' },
        roleIds: { type: 'array', items: { type: 'string', format: 'uuid' }, description: 'Initial role IDs (optional)' },
        activationMethod: { type: 'string', enum: ['tempPassword', 'link'], description: 'How the staff user activates their account' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Staff user created successfully.',
    schema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'New staff user UUID' },
        username: { type: 'string', description: 'Normalized username' },
        activationMethod: { type: 'string', enum: ['tempPassword', 'link'] },
        temporaryPassword: { type: 'string', description: 'Temporary password (shown once, only for tempPassword method)' },
        activationToken: { type: 'string', description: 'Activation token for constructing the activation link (only for link method)' },
        message: { type: 'string', description: 'Human-readable success message' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 409, description: 'Username already taken' })
  async createStaffUser(
    @Body() rawBody: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<CreateStaffUserApiResponse> {
    // ── Permission check: admin only ─────────────────────────────
    const isAdmin = req.session.isAdmin ?? false

    if (!isAdmin) {
      this.logger.warn(
        `Non-admin user ${req.session.userId} attempted to create a staff user`,
      )
      throw new HttpException(
        {
          statusCode: 403,
          error: ErrorCodes.AUTHZ_FORBIDDEN.code,
          message: 'Admin role required',
        },
        403,
      )
    }

    // ── Validate with Zod ────────────────────────────────────────
    const parsed = CreateStaffUserSchema.safeParse(rawBody)

    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      const message = firstIssue?.message ?? ErrorCodes.VALIDATION_INPUT_INVALID.code

      if (message === 'AUTH:REGISTER:INVALID_USERNAME') {
        throw new HttpException(
          { statusCode: 400, error: message },
          400,
        )
      }

      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        400,
      )
    }

    // ── Delegate to service ──────────────────────────────────────
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    const result = await this.adminService.createStaffUser(
      parsed.data,
      req.session.userId,
      ip,
    )

    this.logger.log(
      `Staff user created: userId=${result.userId}, username=${result.username}, ` +
      `method=${result.activationMethod}, actor=${req.session.userId}`,
    )

    // Build response — include activation-specific fields
    const response: CreateStaffUserApiResponse = {
      userId: result.userId,
      username: result.username,
      activationMethod: result.activationMethod,
      message: result.message,
    }

    if (result.activationMethod === 'tempPassword' && 'temporaryPassword' in result) {
      response.temporaryPassword = result.temporaryPassword
    }

    if (result.activationMethod === 'link' && 'activationToken' in result) {
      response.activationToken = result.activationToken
    }

    return response
  }

  /**
   * PUT /api/admin/users/:userId/roles
   *
   * Replaces the role set for a staff user (idempotent).
   * Requires step-up authentication.
   *
   * Permission: admin only (isAdmin session flag).
   *
   * @param userId - UUID of the target staff user
   * @param rawBody - { roleIds: string[], reason?: string }
   * @param req - Authenticated request with session
   */
  @Put('users/:userId/roles')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Update staff user roles (requires step-up)' })
  @ApiParam({ name: 'userId', description: 'Staff user UUID' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['roleIds'],
      properties: {
        roleIds: { type: 'array', items: { type: 'string' }, description: 'Role IDs to assign' },
        reason: { type: 'string', description: 'Optional reason for the role change' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Roles updated successfully.',
    schema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        roleIds: { type: 'array', items: { type: 'string' } },
        previousRoleIds: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid role IDs' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin role required or step-up needed' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async updateStaffRoles(
    @Param('userId') userId: string,
    @Body() rawBody: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<UpdateStaffRolesResult> {
    // ── Permission check: admin only ─────────────────────────────
    const isAdmin = req.session.isAdmin ?? false

    if (!isAdmin) {
      this.logger.warn(
        `Non-admin user ${req.session.userId} attempted to update roles for user ${userId}`,
      )
      throw new HttpException(
        {
          statusCode: 403,
          error: ErrorCodes.AUTHZ_FORBIDDEN.code,
          message: 'Admin role required',
        },
        403,
      )
    }

    // ── Validate with Zod ────────────────────────────────────────
    const parsed = UpdateStaffRolesSchema.safeParse(rawBody)

    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        400,
      )
    }

    // ── Delegate to service ──────────────────────────────────────
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    const result = await this.adminService.updateStaffRoles(
      userId,
      parsed.data.roleIds,
      req.session.userId,
      ip,
      parsed.data.reason,
    )

    this.logger.log(
      `Roles updated for user ${userId}: [${result.previousRoleIds.join(',')}] → ` +
      `[${result.roleIds.join(',')}], actor=${req.session.userId}`,
    )

    return result
  }

  /**
   * GET /api/admin/roles
   *
   * Lists all staff roles with their permission sets (T-09.05.01).
   * Roles are grouped by module on the client. Predefined roles are
   * shown read-only; custom role creation is a future extension.
   * Permission: admin or staff with `admin:roles:edit` (currently admin only).
   */
  @Get('roles')
  @ApiOperation({ summary: 'List staff roles and their permissions' })
  @ApiResponse({
    status: 200,
    description: 'List of staff roles with permissions.',
    schema: { type: 'array', items: { type: 'object' } },
  })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async listRoles(@Req() req: AuthenticatedRequest): Promise<StaffRoleDto[]> {
    if (!(req.session.isAdmin ?? false)) {
      this.logger.warn(`Non-admin user ${req.session.userId} attempted to list staff roles`)
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }
    return this.adminService.listStaffRoles()
  }

  /**
   * GET /api/admin/users/:userId/effective-permissions
   *
   * Resolves the effective permission set for a staff user by taking the union
   * of permissions across their assigned roles (deny-by-default, additive).
   * Platform admins resolve to the wildcard set.
   * Permission: admin or with `staff:roles:view` (currently: admin only).
   */
  @Get('users/:userId/effective-permissions')
  @ApiOperation({ summary: 'Get effective permissions for a staff user' })
  @ApiParam({ name: 'userId', description: 'Staff user UUID' })
  @ApiResponse({
    status: 200,
    description: 'Effective permissions for the user.',
    schema: { type: 'object' },
  })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getEffectivePermissions(
    @Param('userId') userId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<EffectivePermissionsResult> {
    if (!(req.session.isAdmin ?? false)) {
      this.logger.warn(`Non-admin user ${req.session.userId} attempted to read effective permissions`)
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }
    return this.adminService.getEffectivePermissions(userId)
  }

  /**
   * GET /api/admin/config/profile-verification-mode
   *
   * Returns the current profile verification mode.
   * Values: 'DISABLED' | 'MANUAL' | 'API'
   */
  @Get('config/profile-verification-mode')
  @ApiOperation({ summary: 'Get profile verification mode' })
  @ApiResponse({ status: 200, description: 'Current verification mode.', schema: { type: 'object', properties: { mode: { type: 'string', enum: ['DISABLED', 'MANUAL', 'API'] } } } })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async getProfileVerificationMode(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ mode: 'DISABLED' | 'MANUAL' | 'API' }> {
    const isAdmin = req.session.isAdmin ?? false
    if (!isAdmin) {
      this.logger.warn(`Non-admin user ${req.session.userId} attempted to read profile verification mode`)
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }
    return this.adminService.getProfileVerificationMode()
  }

  /**
   * PUT /api/admin/config/profile-verification-mode
   *
   * Sets the profile verification mode. Changing it affects all profiles.
   * Values: 'DISABLED' | 'MANUAL' | 'API'
   */
  @Put('config/profile-verification-mode')
  @ApiOperation({ summary: 'Set profile verification mode' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['mode'],
      properties: { mode: { type: 'string', enum: ['DISABLED', 'MANUAL', 'API'] } },
    },
  })
  @ApiResponse({ status: 200, description: 'Verification mode updated.', schema: { type: 'object', properties: { mode: { type: 'string', enum: ['DISABLED', 'MANUAL', 'API'] } } } })
  @ApiResponse({ status: 400, description: 'Invalid mode' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async setProfileVerificationMode(
    @Body() rawBody: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ mode: 'DISABLED' | 'MANUAL' | 'API' }> {
    const isAdmin = req.session.isAdmin ?? false
    if (!isAdmin) {
      this.logger.warn(`Non-admin user ${req.session.userId} attempted to set profile verification mode`)
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }

    const parsed = SetProfileVerificationModeSchema.safeParse(rawBody)
    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Mode must be one of: DISABLED, MANUAL, API' },
        400,
      )
    }

    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    return this.adminService.setProfileVerificationMode(parsed.data.mode, req.session.userId, ip)
  }

  // ───────────────────────────────────────────────────────────────────────
  // Brand Config (T-09.01.01)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * GET /api/admin/branding/config
   *
   * Returns the active brand configuration for the public-facing UI.
   * Permission: admin or staff with admin:branding:read role.
   */
  @Get('branding/config')
  @ApiOperation({ summary: 'Get active brand configuration' })
  @ApiResponse({ status: 200, description: 'Active brand configuration.', schema: { type: 'object' } })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async getActiveBrandConfig(
    @Req() req: AuthenticatedRequest,
  ): Promise<BrandConfigDto> {
    if (!(req.session.isAdmin ?? false)) {
      this.logger.warn(`Non-admin user ${req.session.userId} attempted to read brand config`)
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }
    return this.brandConfigService.getActiveConfig()
  }

  /**
   * GET /api/admin/branding/configs
   *
   * Lists all brand config versions (draft + active).
   * Permission: admin or staff with admin:branding:read role.
   */
  @Get('branding/configs')
  @ApiOperation({ summary: 'List all brand config versions' })
  @ApiResponse({ status: 200, description: 'List of brand configs.', schema: { type: 'array', items: { type: 'object' } } })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async listBrandConfigs(
    @Req() req: AuthenticatedRequest,
  ): Promise<BrandConfigDto[]> {
    if (!(req.session.isAdmin ?? false)) {
      this.logger.warn(`Non-admin user ${req.session.userId} attempted to list brand configs`)
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }
    return this.brandConfigService.listConfigs()
  }

  /**
   * PUT /api/admin/branding/config
   *
   * Creates or updates a draft brand config. If no draft exists, creates a new
   * draft version based on the active config. Permission: admin only.
   */
  @Put('branding/config')
  @ApiOperation({ summary: 'Upsert draft brand configuration' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        config: { type: 'object', description: 'Brand config JSON (appTitle, colors, etc.)' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Draft config updated.', schema: { type: 'object' } })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async upsertBrandConfig(
    @Body() rawBody: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<BrandConfigDto> {
    if (!(req.session.isAdmin ?? false)) {
      this.logger.warn(`Non-admin user ${req.session.userId} attempted to update brand config`)
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }

    // Validate with Zod
    const parsed = UpsertBrandConfigSchema.safeParse(rawBody)

    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: firstIssue?.message ?? 'Invalid brand config',
        },
        400,
      )
    }

    return this.brandConfigService.upsertDraft(parsed.data.config, req.session.userId)
  }

  /**
   * POST /api/admin/branding/activate
   *
   * Activates the current draft config. The previous active config is
   * deactivated and the draft becomes the new active config. Permission: admin only.
   */
  @Post('branding/activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activate draft brand configuration' })
  @ApiResponse({ status: 200, description: 'Draft config activated.', schema: { type: 'object' } })
  @ApiResponse({ status: 400, description: 'No draft config to activate' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async activateBrandConfig(
    @Req() req: AuthenticatedRequest,
  ): Promise<BrandConfigDto> {
    if (!(req.session.isAdmin ?? false)) {
      this.logger.warn(`Non-admin user ${req.session.userId} attempted to activate brand config`)
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }
    return this.brandConfigService.activateDraft(req.session.userId)
  }

  // ───────────────────────────────────────────────────────────────────────
  // Admin: TOS management (T-09.03.01)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * GET /api/admin/tos/versions
   *
   * Lists all TOS versions (draft + published).
   * Permission: admin or staff with admin:tos:edit role (currently admin only).
   */
  @Get('tos/versions')
  @ApiOperation({ summary: 'List all TOS versions' })
  @ApiResponse({ status: 200, description: 'List of TOS versions.' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async listTosVersions(
    @Req() req: AuthenticatedRequest,
  ) {
    if (!(req.session.isAdmin ?? false)) {
      this.logger.warn(`Non-admin user ${req.session.userId} attempted to list TOS versions`)
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }
    return this.tosService.listVersions()
  }

  /**
   * GET /api/admin/tos/versions/:id
   *
   * Get a specific TOS version by ID.
   */
  @Get('tos/versions/:id')
  @ApiOperation({ summary: 'Get a TOS version by ID' })
  @ApiParam({ name: 'id', description: 'TOS version UUID' })
  @ApiResponse({ status: 200, description: 'TOS version details.' })
  @ApiResponse({ status: 404, description: 'Version not found' })
  async getTosVersion(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<TosVersionDetail> {
    if (!(req.session.isAdmin ?? false)) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }
    return this.tosService.getVersion(id)
  }

  /**
   * POST /api/admin/tos/versions
   *
   * Creates a new draft TOS version.
   * Only one draft can exist at a time.
   */
  @Post('tos/versions')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a new draft TOS version' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['versionId', 'contentFa', 'contentEn'],
      properties: {
        versionId: { type: 'string', description: 'Human-readable version ID, e.g. "v2"' },
        contentFa: { type: 'string', description: 'Persian TOS content (Markdown)' },
        contentEn: { type: 'string', description: 'English TOS content (Markdown)' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Draft TOS version created.' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'Draft or version ID already exists' })
  async createTosVersion(
    @Body() rawBody: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<TosVersionDetail> {
    if (!(req.session.isAdmin ?? false)) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }

    const schema = z.object({
      versionId: z.string().min(1).max(50),
      contentFa: z.string().min(1),
      contentEn: z.string().min(1),
    })

    const parsed = schema.safeParse(rawBody)
    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        400,
      )
    }

    return this.tosService.createVersion(parsed.data, req.session.userId)
  }

  /**
   * PUT /api/admin/tos/versions/:id
   *
   * Updates a draft TOS version. Only draft versions can be updated.
   */
  @Put('tos/versions/:id')
  @ApiOperation({ summary: 'Update a draft TOS version' })
  @ApiParam({ name: 'id', description: 'TOS version UUID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        versionId: { type: 'string', description: 'Human-readable version ID' },
        contentFa: { type: 'string', description: 'Persian TOS content (Markdown)' },
        contentEn: { type: 'string', description: 'English TOS content (Markdown)' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Draft TOS version updated.' })
  @ApiResponse({ status: 400, description: 'Version is not a draft' })
  @ApiResponse({ status: 404, description: 'Version not found' })
  async updateTosVersion(
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<TosVersionDetail> {
    if (!(req.session.isAdmin ?? false)) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }

    const schema = z.object({
      versionId: z.string().min(1).max(50).optional(),
      contentFa: z.string().min(1).optional(),
      contentEn: z.string().min(1).optional(),
    })

    const parsed = schema.safeParse(rawBody)
    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        400,
      )
    }

    // Filter to only defined fields for the service call
    const updateFields: Record<string, unknown> = {}
    if (parsed.data.versionId !== undefined) updateFields.versionId = parsed.data.versionId
    if (parsed.data.contentFa !== undefined) updateFields.contentFa = parsed.data.contentFa
    if (parsed.data.contentEn !== undefined) updateFields.contentEn = parsed.data.contentEn

    // At least one field must be provided
    if (Object.keys(updateFields).length === 0) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'At least one field must be provided' },
        400,
      )
    }

    return this.tosService.updateVersion(id, updateFields as UpdateTosVersionFields, req.session.userId)
  }

  /**
   * POST /api/admin/tos/versions/:id/publish
   *
   * Publishes a draft TOS version.
   * If changeType is 'major', the new version becomes active and users must re-accept.
   * If changeType is 'minor', the current active version stays active.
   */
  @Post('tos/versions/:id/publish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publish a draft TOS version' })
  @ApiParam({ name: 'id', description: 'TOS version UUID' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['changeType'],
      properties: {
        changeType: { type: 'string', enum: ['major', 'minor'], description: 'Material change (major) → triggers re-acceptance' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'TOS version published.' })
  @ApiResponse({ status: 400, description: 'Version is not a draft' })
  @ApiResponse({ status: 404, description: 'Version not found' })
  async publishTosVersion(
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<TosVersionDetail> {
    if (!(req.session.isAdmin ?? false)) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }

    const schema = z.object({
      changeType: z.enum(['major', 'minor']),
    })

    const parsed = schema.safeParse(rawBody)
    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        400,
      )
    }

    return this.tosService.publishVersion(id, parsed.data, req.session.userId)
  }

  /**
   * DELETE /api/admin/tos/versions/:id
   *
   * Discards a draft TOS version. Published versions cannot be deleted.
   */
  @Delete('tos/versions/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete (discard) a draft TOS version' })
  @ApiParam({ name: 'id', description: 'TOS version UUID' })
  @ApiResponse({ status: 204, description: 'Draft discarded.' })
  @ApiResponse({ status: 400, description: 'Version is published and cannot be deleted' })
  @ApiResponse({ status: 404, description: 'Version not found' })
  async deleteTosVersion(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    if (!(req.session.isAdmin ?? false)) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }

    await this.tosService.deleteVersion(id)
  }

  // ───────────────────────────────────────────────────────────────────────
  // Admin: Notification Templates (T-09.04.01)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * GET /api/admin/notifications/templates
   *
   * Lists all notification templates with optional filtering by
   * locale, channel, or status.
   * Permission: admin:notifications:edit (mapped to platform admin; granular staff roles land in T-09.05).
   */
  @Get('notifications/templates')
  @ApiOperation({ summary: 'List notification templates' })
  @ApiResponse({ status: 200, description: 'List of notification templates.', schema: { type: 'array', items: { type: 'object' } } })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async listNotificationTemplates(
    @Query('locale') locale: string | undefined,
    @Query('channel') channel: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<NotificationTemplateResult[]> {
    this.assertNotificationPermission(req)

    const options: PageTemplatesOptions = {}
    if (locale === 'fa' || locale === 'en') options.locale = locale
    if (channel === 'email' || channel === 'sms' || channel === 'in_app') options.channel = channel
    if (status === 'draft' || status === 'active') options.status = status

    return this.notificationTemplateService.list(options)
  }

  /**
   * GET /api/admin/notifications/templates/:id
   *
   * Get a specific notification template by ID.
   */
  @Get('notifications/templates/:id')
  @ApiOperation({ summary: 'Get a notification template by ID' })
  @ApiParam({ name: 'id', description: 'Notification template UUID' })
  @ApiResponse({ status: 200, description: 'Notification template details.', schema: { type: 'object' } })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async getNotificationTemplate(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<NotificationTemplateResult> {
    this.assertNotificationPermission(req)
    return this.notificationTemplateService.getById(id)
  }

  /**
   * POST /api/admin/notifications/templates
   *
   * Creates a new draft notification template.
   * Each event_key+channel+locale combination can have at most one template.
   */
  @Post('notifications/templates')
  @HttpCode(201)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Create a new draft notification template' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['eventKey', 'channel', 'locale', 'bodyTemplate', 'variables'],
      properties: {
        eventKey: { type: 'string', description: 'Event key, e.g. "profile_verified"' },
        channel: { type: 'string', enum: ['email', 'sms', 'in_app'] },
        locale: { type: 'string', enum: ['fa', 'en'] },
        subject: { type: 'string', description: 'Email subject (email channel only)' },
        bodyTemplate: { type: 'string', description: 'Template body with {{variable}} placeholders' },
        variables: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'string', description: 'Variable name (legacy string form)' },
              {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Placeholder name' },
                  description: { type: 'string', nullable: true, description: 'Human-readable description' },
                },
                required: ['name'],
              },
            ],
          },
          description: 'Allow-listed variable names (+ optional descriptions)',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Draft template created.' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'Template already exists for this event+channel+locale' })
  async createNotificationTemplate(
    @Body() rawBody: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<NotificationTemplateResult> {
    this.assertNotificationPermission(req)

    const schema = z.object({
      eventKey: z.string().min(1).max(100),
      channel: z.enum(['email', 'sms', 'in_app']),
      locale: z.enum(['fa', 'en']),
      subject: z.string().max(200).nullable().optional(),
      bodyTemplate: z.string().min(1),
      variables: z
        .array(
          z.union([
            z.string().min(1),
            z.object({
              name: z.string().min(1).max(100),
              description: z.string().max(500).nullable().optional(),
            }),
          ]),
        )
        .default([]),
    })

    const parsed = schema.safeParse(rawBody)
    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        400,
      )
    }

    const input: CreateNotificationTemplateInput = {
      eventKey: parsed.data.eventKey,
      channel: parsed.data.channel,
      locale: parsed.data.locale,
      subject: parsed.data.subject ?? null,
      bodyTemplate: parsed.data.bodyTemplate,
      variables: parsed.data.variables,
    }

    return this.notificationTemplateService.create(input, req.session.userId)
  }

  /**
   * PUT /api/admin/notifications/templates/:id
   *
   * Updates a draft notification template. Only draft templates can be updated.
   */
  @Put('notifications/templates/:id')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Update a draft notification template' })
  @ApiParam({ name: 'id', description: 'Notification template UUID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Email subject' },
        bodyTemplate: { type: 'string', description: 'Template body' },
        variables: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'string', description: 'Variable name (legacy string form)' },
              {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Placeholder name' },
                  description: { type: 'string', nullable: true, description: 'Human-readable description' },
                },
                required: ['name'],
              },
            ],
          },
          description: 'Allow-listed variable names (+ optional descriptions)',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Draft template updated.' })
  @ApiResponse({ status: 400, description: 'Template is not a draft' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async updateNotificationTemplate(
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<NotificationTemplateResult> {
    this.assertNotificationPermission(req)

    const schema = z.object({
      subject: z.string().max(200).nullable().optional(),
      bodyTemplate: z.string().min(1).optional(),
      variables: z
        .array(
          z.union([
            z.string().min(1),
            z.object({
              name: z.string().min(1).max(100),
              description: z.string().max(500).nullable().optional(),
            }),
          ]),
        )
        .optional(),
    })

    const parsed = schema.safeParse(rawBody)
    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        400,
      )
    }

    // At least one field must be provided
    const hasChanges = parsed.data.subject !== undefined ||
      parsed.data.bodyTemplate !== undefined ||
      parsed.data.variables !== undefined

    if (!hasChanges) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'At least one field must be provided' },
        400,
      )
    }

    const input: Record<string, unknown> = {}
    if (parsed.data.subject !== undefined) input.subject = parsed.data.subject
    if (parsed.data.bodyTemplate !== undefined) input.bodyTemplate = parsed.data.bodyTemplate
    if (parsed.data.variables !== undefined) input.variables = parsed.data.variables

    return this.notificationTemplateService.update(id, input, req.session.userId)
  }

  /**
   * POST /api/admin/notifications/templates/:id/publish
   *
   * Publishes a draft notification template, making it the active template
   * for its event_key+channel+locale combination.
   */
  @Post('notifications/templates/:id/publish')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Publish a draft notification template' })
  @ApiParam({ name: 'id', description: 'Notification template UUID' })
  @ApiResponse({ status: 200, description: 'Template published.' })
  @ApiResponse({ status: 400, description: 'Template is not a draft' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async publishNotificationTemplate(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<NotificationTemplateResult> {
    this.assertNotificationPermission(req)
    return this.notificationTemplateService.publish(id, req.session.userId)
  }

  /**
   * POST /api/admin/notifications/templates/:id/unpublish
   *
   * Unpublishes an active notification template, reverting it to draft.
   */
  @Post('notifications/templates/:id/unpublish')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Unpublish an active notification template' })
  @ApiParam({ name: 'id', description: 'Notification template UUID' })
  @ApiResponse({ status: 200, description: 'Template unpublished.' })
  @ApiResponse({ status: 400, description: 'Template is not active' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async unpublishNotificationTemplate(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<NotificationTemplateResult> {
    this.assertNotificationPermission(req)
    return this.notificationTemplateService.unpublish(id, req.session.userId)
  }

  /**
   * DELETE /api/admin/notifications/templates/:id
   *
   * Deletes a draft notification template. Active templates must be
   * unpublished first.
   */
  @Delete('notifications/templates/:id')
  @HttpCode(204)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Delete a draft notification template' })
  @ApiParam({ name: 'id', description: 'Notification template UUID' })
  @ApiResponse({ status: 204, description: 'Template deleted.' })
  @ApiResponse({ status: 400, description: 'Template is active' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async deleteNotificationTemplate(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    this.assertNotificationPermission(req)
    await this.notificationTemplateService.delete(id, req.session.userId)
  }

  /**
   * POST /api/admin/notifications/templates/preview
   *
   * Renders a template body against allow-listed variables with sample data,
   * without persisting anything. Used by the frontend preview pane.
   * Permission: admin:notifications:edit (mapped to platform admin; granular staff roles land in T-09.05).
   */
  @Post('notifications/templates/preview')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Preview a rendered notification template body' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['bodyTemplate', 'variables'],
      properties: {
        bodyTemplate: { type: 'string', description: 'Template body with {{variable}} placeholders' },
        variables: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'string', description: 'Variable name (legacy string form)' },
              {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Placeholder name' },
                  description: { type: 'string', nullable: true, description: 'Human-readable description' },
                },
                required: ['name'],
              },
            ],
          },
          description: 'Allow-listed variable names (+ optional descriptions)',
        },
        sampleData: { type: 'object', description: 'Optional sample values keyed by variable name' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Rendered template body.' })
  @ApiResponse({ status: 400, description: 'Template validation error' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async previewNotificationTemplateBody(
    @Body() rawBody: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<RenderedTemplate> {
    this.assertNotificationPermission(req)

    const schema = z.object({
      bodyTemplate: z.string().min(1),
      variables: z
        .array(
          z.union([
            z.string().min(1),
            z.object({
              name: z.string().min(1).max(100),
              description: z.string().max(500).nullable().optional(),
            }),
          ]),
        )
        .default([]),
      sampleData: z.record(z.string(), z.string()).optional(),
    })

    const parsed = schema.safeParse(rawBody)
    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        400,
      )
    }

    return this.notificationTemplateService.previewFromBody(
      parsed.data.bodyTemplate,
      parsed.data.variables,
      parsed.data.sampleData,
    )
  }

  /**
   * POST /api/admin/notifications/templates/:id/test-send
   *
   * Renders a template and delivers it to the admin's own verified destination
   * (or an allow-listed dev test address). The destination must belong to the
   * acting admin's contact (users.email/mobile/username) or match
   * TEST_SEND_ALLOWLIST (dev/test only) — see T-05.04.04. When no destination
   * is supplied, the in-app default (the admin's own inbox) is used.
   * Out-of-app email/SMS transport is pending E-05 (T-05.06), so delivery is
   * in-app today. Permission: admin:notifications:edit (mapped to platform
   * admin; granular staff roles land in T-09.05).
   */
  @Post('notifications/templates/:id/test-send')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Test-send a rendered notification template' })
  @ApiParam({ name: 'id', description: 'Notification template UUID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description:
            'Verified destination (email or phone) belonging to the admin, or an allow-listed dev test address',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Test message delivered.' })
  @ApiResponse({ status: 403, description: 'Destination not owned / not allow-listed, or admin role required' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async testSendNotificationTemplate(
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ ok: boolean; destination: 'in_app'; lastTestStatus: 'delivered' | 'failed' }> {
    this.assertNotificationPermission(req)

    const parsed = z
      .object({
        destination: z.string().trim().max(320).optional(),
      })
      .safeParse(rawBody ?? {})
    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        400,
      )
    }

    const destination = parsed.data.destination
    return this.notificationTemplateService.testSend(
      id,
      req.session.userId,
      destination !== undefined ? { destination } : undefined,
    )
  }

  /**
   * GET /api/admin/notifications/delivery-logs
   *
   * Lists delivery-attempt log rows written by the worker (E-05, T-05.01.05).
   * Filterable by notification id, channel, and status; newest-first with
   * limit + offset pagination. Read-only: the append-only delivery log is
   * written exclusively by the outbox worker.
   * Permission: admin (isAdmin session flag).
   */
  @Get('notifications/delivery-logs')
  @ApiOperation({ summary: 'List notification delivery logs (admin)' })
  @ApiQuery({ name: 'notificationId', required: false, type: String })
  @ApiQuery({ name: 'channel', required: false, enum: ['in_app', 'email', 'sms'] })
  @ApiQuery({ name: 'status', required: false, enum: ['delivered', 'failed'] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of delivery log rows.', schema: { type: 'array', items: { type: 'object' } } })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async listDeliveryLogs(
    @Req() req: AuthenticatedRequest,
    @Query('notificationId') notificationId?: string,
    @Query('channel') channel?: 'in_app' | 'email' | 'sms',
    @Query('status') status?: 'delivered' | 'failed',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    if (!(req.session.isAdmin ?? false)) {
      this.logger.warn(`Non-admin user ${req.session.userId} attempted to read delivery logs`)
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }
    const options: {
      notificationId?: string
      channel?: 'in_app' | 'email' | 'sms'
      status?: 'delivered' | 'failed'
      limit?: number
      offset?: number
    } = {}
    if (notificationId) options.notificationId = notificationId
    if (channel) options.channel = channel
    if (status) options.status = status
    const parsedLimit = limit !== undefined ? parseInt(limit, 10) : NaN
    const parsedOffset = offset !== undefined ? parseInt(offset, 10) : NaN
    // Ignore non-numeric limit/offset so malformed queries fall back to the
    // service defaults instead of producing a NaN SQL binding (500 today).
    if (Number.isFinite(parsedLimit)) options.limit = parsedLimit
    if (Number.isFinite(parsedOffset)) options.offset = parsedOffset
    return this.notificationsService.findDeliveryLogs(options)
  }

  /**
   * GET /api/admin/notifications/dead-letters
   *
   * Lists dead-letter records written by the outbox worker when a
   * notification job exhausts its retry budget (E-05, T-05.01.06).
   * Filterable by status / severity / channel; open items surface first with
   * limit + offset pagination.
   * Permission: admin (isAdmin session flag).
   */
  @Get('notifications/dead-letters')
  @ApiOperation({ summary: 'List notification dead-letter records (admin)' })
  @ApiQuery({ name: 'status', required: false, enum: ['open', 'retried', 'resolved', 'dismissed'] })
  @ApiQuery({ name: 'severity', required: false, enum: ['error', 'critical'] })
  @ApiQuery({ name: 'channel', required: false, enum: ['in_app', 'email', 'sms'] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of dead-letter rows.', schema: { type: 'array', items: { type: 'object' } } })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async listDeadLetters(
    @Req() req: AuthenticatedRequest,
    @Query('status') status?: 'open' | 'retried' | 'resolved' | 'dismissed',
    @Query('severity') severity?: 'error' | 'critical',
    @Query('channel') channel?: 'in_app' | 'email' | 'sms',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    if (!(req.session.isAdmin ?? false)) {
      this.logger.warn(`Non-admin user ${req.session.userId} attempted to read dead-letters`)
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }
    const options: {
      status?: 'open' | 'retried' | 'resolved' | 'dismissed'
      severity?: 'error' | 'critical'
      channel?: 'in_app' | 'email' | 'sms'
      limit?: number
      offset?: number
    } = {}
    if (status) options.status = status
    if (severity) options.severity = severity
    if (channel) options.channel = channel
    const parsedLimit = limit !== undefined ? parseInt(limit, 10) : NaN
    const parsedOffset = offset !== undefined ? parseInt(offset, 10) : NaN
    if (Number.isFinite(parsedLimit)) options.limit = parsedLimit
    if (Number.isFinite(parsedOffset)) options.offset = parsedOffset
    return this.notificationsService.listDeadLetters(options)
  }

  /**
   * POST /api/admin/notifications/dead-letters/:id/retry
   *
   * Re-queues a dead-lettered notification job (same idempotency key, so
   * re-processing cannot double-deliver) for the worker to pick up again.
   * Permission: admin (isAdmin session flag).
   */
  @Post('notifications/dead-letters/:id/retry')
  @HttpCode(200)
  @ApiOperation({ summary: 'Retry a dead-lettered notification (admin)' })
  @ApiParam({ name: 'id', description: 'Dead-letter record UUID' })
  @ApiResponse({ status: 200, description: 'Dead-letter record re-queued.', schema: { type: 'object' } })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 404, description: 'Dead-letter record not found' })
  async retryDeadLetter(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    if (!(req.session.isAdmin ?? false)) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }
    const result = await this.notificationsService.deadLetterAction(id, 'retry', req.session.userId)
    if (result === null) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Dead-letter record not found' },
        404,
      )
    }
    this.logger.log(`Admin ${req.session.userId} retried dead-letter ${id}`)
    return result
  }

  /**
   * POST /api/admin/notifications/dead-letters/:id/resolve
   *
   * Marks a dead-letter record final (no further retry). Idempotent.
   * Permission: admin (isAdmin session flag).
   */
  @Post('notifications/dead-letters/:id/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resolve a dead-lettered notification (admin)' })
  @ApiParam({ name: 'id', description: 'Dead-letter record UUID' })
  @ApiResponse({ status: 200, description: 'Dead-letter record resolved.', schema: { type: 'object' } })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 404, description: 'Dead-letter record not found' })
  async resolveDeadLetter(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    if (!(req.session.isAdmin ?? false)) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }
    const result = await this.notificationsService.deadLetterAction(id, 'resolve', req.session.userId)
    if (result === null) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Dead-letter record not found' },
        404,
      )
    }
    this.logger.log(`Admin ${req.session.userId} resolved dead-letter ${id}`)
    return result
  }

  /**
   * POST /api/admin/notifications/dead-letters/:id/dismiss
   *
   * Dismisses a dead-letter record from the active view. Idempotent.
   * Permission: admin (isAdmin session flag).
   */
  @Post('notifications/dead-letters/:id/dismiss')
  @HttpCode(200)
  @ApiOperation({ summary: 'Dismiss a dead-lettered notification (admin)' })
  @ApiParam({ name: 'id', description: 'Dead-letter record UUID' })
  @ApiResponse({ status: 200, description: 'Dead-letter record dismissed.', schema: { type: 'object' } })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 404, description: 'Dead-letter record not found' })
  async dismissDeadLetter(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    if (!(req.session.isAdmin ?? false)) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }
    const result = await this.notificationsService.deadLetterAction(id, 'dismiss', req.session.userId)
    if (result === null) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Dead-letter record not found' },
        404,
      )
    }
    this.logger.log(`Admin ${req.session.userId} dismissed dead-letter ${id}`)
    return result
  }

  // ───────────────────────────────────────────────────────────────────────
  // Delivery-window config (E-05, T-05.03.03)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * GET /api/admin/config/delivery-window
   *
   * Returns the current admin-configurable delivery window as
   * `{ timezone, startHour, endHour }`. Falls back to the default
   * 09:00–21:00 Asia/Tehran window when no value is persisted.
   * Permission: `admin:notification-providers:edit` (today: platform admin).
   */
  @Get('config/delivery-window')
  @ApiOperation({ summary: 'Get the delivery window configuration (admin)' })
  @ApiResponse({
    status: 200,
    description: 'Current delivery window config.',
    schema: {
      type: 'object',
      properties: {
        timezone: { type: 'string', example: 'Asia/Tehran' },
        startHour: { type: 'number', example: 9 },
        endHour: { type: 'number', example: 21 },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async getDeliveryWindow(@Req() req: AuthenticatedRequest) {
    this.assertNotificationDeliveryEditPermission(req)
    return this.adminService.getDeliveryWindowConfig()
  }

  /**
   * PUT /api/admin/config/delivery-window
   *
   * Persists a new delivery window. Body: `{ timezone, start_hour, end_hour }`.
   * Validated server-side: start < end, length >= 4 hours, valid IANA timezone.
   * Changes take effect for newly-scheduled messages; already-scheduled
   * messages keep their original timing (per story T-05.03.03).
   * Permission: `admin:notification-providers:edit` (T-09.06.03).
   *
   * Step-up on this mutation is deliberately deferred: the delivery-window
   * admin panel (T-05.03.03, `DeliveryWindowConfigPanel.tsx`) uses a raw fetch
   * and the web app does not implement the step-up challenge flow yet, so
   * requiring step-up here would regress the working save path. It must land
   * together with the client-side step-up flow (same follow-up as the
   * T-09.06.01/02 provider-config UI).
   */
  @Put('config/delivery-window')
  @ApiOperation({ summary: 'Update the delivery window configuration (admin)' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['timezone', 'start_hour', 'end_hour'],
      properties: {
        timezone: { type: 'string', example: 'Asia/Tehran' },
        start_hour: { type: 'number', example: 9, minimum: 0, maximum: 23 },
        end_hour: { type: 'number', example: 21, minimum: 0, maximum: 23 },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Delivery window updated.',
    schema: {
      type: 'object',
      properties: {
        timezone: { type: 'string' },
        startHour: { type: 'number' },
        endHour: { type: 'number' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async setDeliveryWindow(@Body() rawBody: unknown, @Req() req: AuthenticatedRequest) {
    this.assertNotificationDeliveryEditPermission(req)
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    return this.adminService.setDeliveryWindowConfig(rawBody, req.session.userId, ip)
  }

  /**
   * Permission gate for financial threshold configuration (S-09.07).
   *
   * The S-09.07 dual-approval/financial-threshold surface (T-09.07.01) is
   * protected by the `admin:financial:edit` capability. Today the session
   * model exposes only `isAdmin` (platform admin); granular staff-role
   * permissions arrive with the role system (T-09.05). Until then the
   * capability maps to a platform admin session, matching the S-09.06
   * notification-delivery gates. Centralized here as a single enforcement
   * point so the whole S-09.07 surface uses one check.
   */
  private assertFinancialThresholdPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      throw new HttpException(
        {
          statusCode: 403,
          error: ErrorCodes.AUTHZ_FORBIDDEN.code,
          message: 'Admin role required to manage financial threshold configuration',
        },
        403,
      )
    }
  }

  /**
   * GET /api/admin/config/dual-approval-threshold
   *
   * Returns the current admin-configurable dual-approval threshold as
   * `{ thresholdIrR }`. Falls back to `{ thresholdIrR: 0 }` (dual approval
   * disabled) when no value is persisted.
   * Permission: `admin:financial:edit` (today: platform admin).
   */
  @Get('config/dual-approval-threshold')
  @ApiOperation({ summary: 'Get the dual-approval threshold configuration (admin)' })
  @ApiResponse({
    status: 200,
    description: 'Current dual-approval threshold config.',
    schema: {
      type: 'object',
      properties: {
        thresholdIrR: { type: 'number', example: 500000000 },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async getDualApprovalThreshold(@Req() req: AuthenticatedRequest) {
    this.assertFinancialThresholdPermission(req)
    return this.adminService.getDualApprovalThresholdConfig()
  }

  /**
   * PUT /api/admin/config/dual-approval-threshold
   *
   * Persists a new dual-approval threshold. Body: `{ threshold_irr }`.
   * Validated server-side: integer IRR between 0 and `Number.MAX_SAFE_INTEGER`
   * (0 = dual approval disabled). Changes are versioned and audited.
   * Permission: `admin:financial:edit` (T-09.07.01).
   *
   * Step-up on this mutation is deliberately deferred: the web app does not
   * implement the step-up challenge flow yet (admin config panels use raw
   * fetch), so requiring step-up here would regress the working save path. It
   * must land together with the client-side step-up flow (same follow-up as
   * the T-09.06.01/02/03 admin config UI). The emergency override (reason +
   * elevated permission + immediate alert + audit) is likewise deferred until
   * the step-up flow and alert pipeline exist.
   */
  @Put('config/dual-approval-threshold')
  @ApiOperation({ summary: 'Update the dual-approval threshold configuration (admin)' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['threshold_irr'],
      properties: {
        threshold_irr: { type: 'number', example: 500000000, minimum: 0 },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Dual-approval threshold updated.',
    schema: {
      type: 'object',
      properties: {
        thresholdIrR: { type: 'number' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async setDualApprovalThreshold(@Body() rawBody: unknown, @Req() req: AuthenticatedRequest) {
    this.assertFinancialThresholdPermission(req)
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    return this.adminService.setDualApprovalThresholdConfig(rawBody, req.session.userId, ip)
  }

  /**
   * Permission gate for service response target configuration (S-09.08).
   *
   * The S-09.08 service-targets surface (T-09.08.01) is protected by the
   * `admin:service-targets:edit` capability. Today the session model exposes
   * only `isAdmin` (platform admin); granular staff-role permissions arrive
   * with the role system (T-09.05). Until then the capability maps to a
   * platform admin session, matching the S-09.06 / S-09.07 gates. Centralized
   * here as a single enforcement point for the whole S-09.08 config surface.
   */
  private assertServiceTargetsEditPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      throw new HttpException(
        {
          statusCode: 403,
          error: ErrorCodes.AUTHZ_FORBIDDEN.code,
          message: 'Admin role required to manage service response targets',
        },
        403,
      )
    }
  }

  /**
   * GET /api/admin/config/service-response-targets
   *
   * Returns the admin-configured response targets per service type (hours),
   * defaulting every type to `null` (disabled) when nothing has been
   * persisted yet.
   */
  @Get('config/service-response-targets')
  @ApiOperation({ summary: 'Get the service response targets configuration (admin)' })
  @ApiResponse({
    status: 200,
    description: 'Current service response targets (hours per service type).',
    schema: {
      type: 'object',
      properties: {
        ticket: { type: 'number', nullable: true },
        verification_case: { type: 'number', nullable: true },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async getServiceResponseTargets(@Req() req: AuthenticatedRequest) {
    this.assertServiceTargetsEditPermission(req)
    return this.adminService.getServiceResponseTargets()
  }

  /**
   * PUT /api/admin/config/service-response-targets
   *
   * Persists a new service response target map. Body is a flat map of
   * service type → target hours (`null` disables a type); the map is a
   * full replace — types omitted from the payload become disabled.
   *
   * Note: breached targets create staff alerts but do not promise a service
   * level to customers.
   */
  @Put('config/service-response-targets')
  @ApiOperation({ summary: 'Update the service response targets configuration (admin)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        ticket: { type: 'number', nullable: true, example: 48, minimum: 1 },
        verification_case: { type: 'number', nullable: true, example: 72, minimum: 1 },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Service response targets updated.',
    schema: {
      type: 'object',
      properties: {
        ticket: { type: 'number', nullable: true },
        verification_case: { type: 'number', nullable: true },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async setServiceResponseTargets(@Body() rawBody: unknown, @Req() req: AuthenticatedRequest) {
    this.assertServiceTargetsEditPermission(req)
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    return this.adminService.setServiceResponseTargets(rawBody, req.session.userId, ip)
  }
}
