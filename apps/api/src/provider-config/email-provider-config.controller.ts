import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  EmailProviderConfigService,
  type CreateProviderInput,
  type EmailProviderConfigResult,
  type UpdateProviderInput,
} from './email-provider-config.service'
import { SessionAuthGuard } from '../session/session.guard'
import type { AuthenticatedRequest } from '../session/session.guard'
import { StepUpGuard, RequiresStepUp } from '../session/step-up.guard'

export const CreateProviderSchema = z.object({
  transport: z.enum(['smtp', 'resend']),
  label: z.string().min(1).max(120),
  config: z.record(z.string(), z.unknown()),
})

export const UpdateProviderSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
})

export const RecordTestSchema = z.object({
  passed: z.boolean(),
  error: z.string().max(1000).optional(),
})

/**
 * Optional body for `POST :id/test-connection`. `recipient` is required for
 * the Resend transport (the admin's email to which the test-send is delivered);
 * SMTP ignores it.
 */
export const TestConnectionSchema = z.object({
  recipient: z.string().email().optional(),
})

function httpError(code: string, message: string, statusCode = 409): never {
  throw new HttpException({ statusCode, error: code, message }, statusCode)
}

/**
 * Admin endpoints for email provider configuration & lifecycle (E-05, T-05.06.01).
 *
 * Every route requires an authenticated session with the
 * `admin:notification-providers:edit` capability (T-09.06.01; currently mapped
 * to platform admin `req.session.isAdmin`). All mutation endpoints additionally
 * require recent step-up verification via `@RequiresStepUp()` (StepUpGuard),
 * so a freshly-reauthenticated password/OTP is needed to create, update, test,
 * activate, disable, or roll back a provider configuration. Transport-specific
 * config fields, connection tests, secrets encryption and masking arrive in
 * T-05.06.02–05; this API owns the durable entity and the
 * Draft/Test/Active/Superseded/Disabled lifecycle.
 */
@ApiTags('Admin · Email Provider')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/email-providers')
export class EmailProviderConfigController {
  constructor(private readonly service: EmailProviderConfigService) {}

  /**
   * Permission gate for email-provider admin operations (T-09.06.01).
   *
   * The acceptance criteria require the `admin:notification-providers:edit`
   * capability. Today the session model exposes only `isAdmin` (platform
   * admin); granular staff-role permissions arrive with the role system
   * (T-09.05). Until then, `admin:notification-providers:edit` maps to a
   * platform admin session, matching the established `admin:notifications:edit`
   * enforcement in AdminController. Centralized here so the capability check
   * is a single enforcement point for all mutation endpoints.
   */
  private assertProviderEditPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      httpError('AUTHZ:FORBIDDEN', 'Admin role required to manage notification providers', 403)
    }
  }

  @Get()
  @ApiOperation({ summary: 'List email provider configurations' })
  @ApiResponse({ status: 200, description: 'All provider configs, newest first.' })
  async list(@Req() req: AuthenticatedRequest): Promise<EmailProviderConfigResult[]> {
    this.assertProviderEditPermission(req)
    return this.service.list()
  }

  @Post()
  @HttpCode(201)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Create a draft email provider configuration' })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: z.infer<typeof CreateProviderSchema>,
  ): Promise<EmailProviderConfigResult> {
    this.assertProviderEditPermission(req)
    const parsed = CreateProviderSchema.safeParse(body)
    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_PARSE_ZOD.code },
        400,
      )
    }
    const input: CreateProviderInput = {
      transport: parsed.data.transport,
      label: parsed.data.label,
      config: parsed.data.config,
      createdBy: req.session.userId,
    }
    return this.service.create(input)
  }

  @Put(':id')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Update a draft email provider configuration' })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof UpdateProviderSchema>,
  ): Promise<EmailProviderConfigResult> {
    this.assertProviderEditPermission(req)
    const parsed = UpdateProviderSchema.safeParse(body)
    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_PARSE_ZOD.code },
        400,
      )
    }
    const input: UpdateProviderInput = {}
    if (parsed.data.label !== undefined) input.label = parsed.data.label
    if (parsed.data.config !== undefined) input.config = parsed.data.config
    return this.service.update(id, input)
  }

  @Post(':id/test')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Record a test-send result for a draft' })
  async recordTest(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof RecordTestSchema>,
  ): Promise<EmailProviderConfigResult> {
    this.assertProviderEditPermission(req)
    const parsed = RecordTestSchema.safeParse(body)
    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_PARSE_ZOD.code },
        400,
      )
    }
    return this.service.recordTest(id, {
      passed: parsed.data.passed,
      ...(parsed.data.error !== undefined ? { error: parsed.data.error } : {}),
    })
  }

  @Post(':id/test-connection')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Run a live connection test and record the outcome',
    description:
      'SMTP: performs a real SMTP handshake against the draft config and persists ' +
      'the result as last_test_status; SSRF guard rejects private/internal ' +
      'destinations unless allow-listed. Resend: validates the sending domain is ' +
      'verified and sends a real test email to body.recipient (the admin email).',
  })
  @ApiResponse({ status: 200, description: 'Test outcome with the updated config state.' })
  async testConnection(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body?: z.infer<typeof TestConnectionSchema>,
  ): Promise<EmailProviderConfigResult & { test: { ok: boolean; error: string | null } }> {
    this.assertProviderEditPermission(req)
    const parsed = body === undefined ? null : TestConnectionSchema.safeParse(body)
    if (body !== undefined && !parsed!.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_PARSE_ZOD.code },
        400,
      )
    }
    const { ok, error, result } = await this.service.testConnection(
      id,
      parsed?.data?.recipient,
    )
    return { ...result, test: { ok, error } }
  }

  @Post(':id/activate')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Activate a tested draft provider configuration' })
  async activate(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<EmailProviderConfigResult> {
    this.assertProviderEditPermission(req)
    return this.service.activate(id, req.session.userId)
  }

  @Post(':id/disable')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Disable a provider configuration' })
  disable(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<EmailProviderConfigResult> {
    this.assertProviderEditPermission(req)
    return this.service.disable(id)
  }

  @Post(':id/rollback')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Roll back to a superseded/disabled version' })
  rollback(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<EmailProviderConfigResult> {
    this.assertProviderEditPermission(req)
    return this.service.rollback(id, req.session.userId)
  }
}