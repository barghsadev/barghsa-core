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
  SmsProviderConfigService,
  type CreateSmsProviderInput,
  type SmsProviderConfigResult,
  type UpdateSmsProviderInput,
} from './sms-provider-config.service'
import { SmsirConfigSchema } from './smsir-config.schema'
import { SessionAuthGuard } from '../session/session.guard'
import type { AuthenticatedRequest } from '../session/session.guard'
import { StepUpGuard, RequiresStepUp } from '../session/step-up.guard'

export const CreateSmsProviderSchema = z.object({
  label: z.string().min(1).max(120),
  config: SmsirConfigSchema,
})

export const UpdateSmsProviderSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  config: SmsirConfigSchema.partial().optional(),
})

export const RecordSmsTestSchema = z.object({
  passed: z.boolean(),
  error: z.string().max(1000).optional(),
})

function httpError(code: string, message: string, statusCode = 409): never {
  throw new HttpException({ statusCode, error: code, message }, statusCode)
}

/**
 * Admin endpoints for SMS.ir provider configuration & lifecycle (T-09.06.02).
 *
 * Mirrors the email provider config controller (T-05.06.x / T-09.06.01) and
 * applies the same security posture:
 * - Every route requires an authenticated session with the
 *   `admin:notification-providers:edit` capability (mapped to platform admin
 *   `req.session.isAdmin` today, matching the email provider controller).
 * - All mutation endpoints additionally require recent step-up verification via
 *   `@RequiresStepUp()` (StepUpGuard).
 *
 * The SMS.ir base URL is application-managed and not exposed here; the admin
 * surface edits credential/limit/template-mapping fields only.
 */
@ApiTags('Admin · SMS Provider')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/sms-providers')
export class SmsProviderConfigController {
  constructor(private readonly service: SmsProviderConfigService) {}

  /** Same capability gate as the email provider controller (T-09.06.01). */
  private assertProviderEditPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      httpError('AUTHZ:FORBIDDEN', 'Admin role required to manage notification providers', 403)
    }
  }

  @Get()
  @ApiOperation({ summary: 'List SMS provider configurations' })
  @ApiResponse({ status: 200, description: 'All provider configs, newest first.' })
  async list(@Req() req: AuthenticatedRequest): Promise<SmsProviderConfigResult[]> {
    this.assertProviderEditPermission(req)
    return this.service.list()
  }

  @Get('template-event-keys')
  @ApiOperation({ summary: 'List event keys with a live notification template for SMS mapping' })
  @ApiResponse({ status: 200, description: 'Set of event keys the admin can map to an SMS.ir template.' })
  async templateEventKeys(@Req() req: AuthenticatedRequest): Promise<string[]> {
    this.assertProviderEditPermission(req)
    return [...(await this.service.availableTemplateEventKeys())]
  }

  @Post()
  @HttpCode(201)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Create a draft SMS.ir provider configuration' })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: z.infer<typeof CreateSmsProviderSchema>,
  ): Promise<SmsProviderConfigResult> {
    this.assertProviderEditPermission(req)
    const parsed = CreateSmsProviderSchema.safeParse(body)
    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_PARSE_ZOD.code },
        400,
      )
    }
    const input: CreateSmsProviderInput = {
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
  @ApiOperation({ summary: 'Update a draft SMS.ir provider configuration' })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof UpdateSmsProviderSchema>,
  ): Promise<SmsProviderConfigResult> {
    this.assertProviderEditPermission(req)
    const parsed = UpdateSmsProviderSchema.safeParse(body)
    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_PARSE_ZOD.code },
        400,
      )
    }
    const input: UpdateSmsProviderInput = {}
    if (parsed.data.label !== undefined) input.label = parsed.data.label
    if (parsed.data.config !== undefined) input.config = parsed.data.config
    return this.service.update(id, input)
  }

  @Post(':id/test')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Record a connection-test result for a draft' })
  async recordTest(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof RecordSmsTestSchema>,
  ): Promise<SmsProviderConfigResult> {
    this.assertProviderEditPermission(req)
    const parsed = RecordSmsTestSchema.safeParse(body)
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
    summary: 'Run a live SMS.ir credential/connection check and record the outcome',
    description:
      'Validates the draft SMS.ir credentials and (when available) account credit, ' +
      'then persists the result as last_test_status.',
  })
  @ApiResponse({ status: 200, description: 'Test outcome with the updated config state.' })
  async testConnection(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<SmsProviderConfigResult & { test: { ok: boolean; error: string | null } }> {
    this.assertProviderEditPermission(req)
    const { ok, error, result } = await this.service.testConnection(id)
    return { ...result, test: { ok, error } }
  }

  @Post(':id/activate')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Activate a tested draft SMS provider configuration' })
  async activate(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<SmsProviderConfigResult> {
    this.assertProviderEditPermission(req)
    return this.service.activate(id, req.session.userId)
  }

  @Post(':id/disable')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Disable an SMS provider configuration' })
  disable(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<SmsProviderConfigResult> {
    this.assertProviderEditPermission(req)
    return this.service.disable(id)
  }

  @Post(':id/rollback')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Roll back to a superseded/disabled SMS provider version' })
  rollback(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<SmsProviderConfigResult> {
    this.assertProviderEditPermission(req)
    return this.service.rollback(id, req.session.userId)
  }
}