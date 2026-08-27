import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
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
} from './email-provider-config.service'
import { SessionAuthGuard } from '../session/session.guard'
import type { AuthenticatedRequest } from '../session/session.guard'

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
 * Every route requires an authenticated session with admin privileges
 * (`req.session.isAdmin`). Transport-specific config fields, connection tests,
 * secrets encryption and masking arrive in T-05.06.02–05; this API owns the
 * durable entity and the Draft/Test/Active/Superseded/Disabled lifecycle.
 */
@ApiTags('Admin · Email Provider')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/email-providers')
export class EmailProviderConfigController {
  constructor(private readonly service: EmailProviderConfigService) {}

  private assertAdmin(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      httpError('FORBIDDEN:ROLE', 'Admin privileges required', 403)
    }
  }

  @Get()
  @ApiOperation({ summary: 'List email provider configurations' })
  @ApiResponse({ status: 200, description: 'All provider configs, newest first.' })
  async list(@Req() req: AuthenticatedRequest): Promise<EmailProviderConfigResult[]> {
    this.assertAdmin(req)
    return this.service.list()
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a draft email provider configuration' })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: z.infer<typeof CreateProviderSchema>,
  ): Promise<EmailProviderConfigResult> {
    this.assertAdmin(req)
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

  @Post(':id/test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Record a test-send result for a draft' })
  async recordTest(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof RecordTestSchema>,
  ): Promise<EmailProviderConfigResult> {
    this.assertAdmin(req)
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
    this.assertAdmin(req)
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
  @ApiOperation({ summary: 'Activate a tested draft provider configuration' })
  async activate(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<EmailProviderConfigResult> {
    this.assertAdmin(req)
    return this.service.activate(id)
  }

  @Post(':id/disable')
  @HttpCode(200)
  @ApiOperation({ summary: 'Disable a provider configuration' })
  disable(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<EmailProviderConfigResult> {
    this.assertAdmin(req)
    return this.service.disable(id)
  }

  @Post(':id/rollback')
  @HttpCode(200)
  @ApiOperation({ summary: 'Roll back to a superseded/disabled version' })
  rollback(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<EmailProviderConfigResult> {
    this.assertAdmin(req)
    return this.service.rollback(id, req.session.userId)
  }
}