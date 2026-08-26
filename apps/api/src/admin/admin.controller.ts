import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Logger,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { AdminService, type UpdateStaffRolesResult } from './admin.service.js'
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

  constructor(private readonly adminService: AdminService) {}

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
}