import { hasStaffPermission } from '../session/staff-permissions.js';
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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  EmailProviderConfigService,
  type CreateProviderInput,
  type EmailProviderConfigResult,
  type UpdateProviderInput,
} from './email-provider-config.service';
import { SessionAuthGuard } from '../session/session.guard';
import type { AuthenticatedRequest } from '../session/session.guard';
import { StepUpGuard, RequiresStepUp } from '../session/step-up.guard';

export const CreateProviderSchema = z.object({
  transport: z.enum(['smtp', 'resend']),
  label: z.string().min(1).max(120),
  config: z.record(z.string(), z.unknown()),
});

export const UpdateProviderSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const RecordTestSchema = z.object({
  passed: z.boolean(),
  error: z.string().max(1000).optional(),
});

/**
 * Optional body for `POST :id/test-connection`. `recipient` is required for
 * the Resend transport (the admin's email to which the test-send is delivered);
 * SMTP ignores it.
 */
export const TestConnectionSchema = z.object({
  recipient: z.string().email().optional(),
});

function httpError(code: string, message: string, statusCode = 409): never {
  throw new HttpException({ statusCode, error: code, message }, statusCode);
}

/**
 * Admin endpoints for email provider configuration & lifecycle (E-05, T-05.06.01).
 *
 * Every route requires an authenticated session with the
 * `admin:notification-providers:edit` capability (T-09.06.01). All mutation endpoints additionally
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
   * capability. Capabilities are read from current database roles.  Centralized here so the capability check
   * is a single enforcement point for all mutation endpoints.
   */
  private assertProviderEditPermission(req: AuthenticatedRequest): void {
    if (!hasStaffPermission(req, 'admin:notification-providers:edit')) {
      httpError('AUTHZ:FORBIDDEN', 'Admin role required to manage notification providers', 403);
    }
  }

  @Get()
  @ApiOperation({ summary: 'List email provider configurations' })
  @ApiResponse({ status: 200, description: 'All provider configs, newest first.' })
  async list(@Req() req: AuthenticatedRequest): Promise<EmailProviderConfigResult[]> {
    this.assertProviderEditPermission(req);
    return this.service.list();
  }

  @Post()
  @HttpCode(201)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Create a draft email provider configuration' })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: z.infer<typeof CreateProviderSchema>
  ): Promise<EmailProviderConfigResult> {
    this.assertProviderEditPermission(req);
    const parsed = CreateProviderSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_PARSE_ZOD.code },
        400
      );
    }
    const input: CreateProviderInput = {
      transport: parsed.data.transport,
      label: parsed.data.label,
      config: parsed.data.config,
      createdBy: req.session.userId,
    };
    return this.service.create(input, req.session);
  }

  @Put(':id')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Update a draft email provider configuration' })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof UpdateProviderSchema>
  ): Promise<EmailProviderConfigResult> {
    this.assertProviderEditPermission(req);
    const parsed = UpdateProviderSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_PARSE_ZOD.code },
        400
      );
    }
    const input: UpdateProviderInput = {};
    if (parsed.data.label !== undefined) input.label = parsed.data.label;
    if (parsed.data.config !== undefined) input.config = parsed.data.config;
    return this.service.update(id, input, req.session.userId, req.session);
  }

  @Post(':id/test')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Reject client-supplied test results', deprecated: true })
  @ApiResponse({ status: 409, description: 'Use the live test-connection endpoint.' })
  async recordTest(
    @Req() req: AuthenticatedRequest,
    @Param('id') _id: string,
    @Body() body: z.infer<typeof RecordTestSchema>
  ): Promise<EmailProviderConfigResult> {
    this.assertProviderEditPermission(req);
    const parsed = RecordTestSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_PARSE_ZOD.code },
        400
      );
    }
    throw new HttpException(
      {
        statusCode: 409,
        error: 'PROVIDER_SERVER_TEST_REQUIRED',
        message: 'Run a live connection test; client-supplied results cannot authorize activation.',
      },
      409
    );
  }

  @Post(':id/test-connection')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Run a live connection test and record the outcome',
    description:
      'SMTP verifies the connection and requires acceptance of a test email; Resend checks ' +
      'the sending domain and sends a test email. Both use the current staff member’s verified ' +
      'email by default; an explicit recipient must match that contact. The SMTP network guard ' +
      'continues to reject private/internal destinations unless allow-listed.',
  })
  @ApiResponse({ status: 200, description: 'Test outcome with the updated config state.' })
  async testConnection(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body?: z.infer<typeof TestConnectionSchema>
  ): Promise<EmailProviderConfigResult & { test: { ok: boolean; error: string | null } }> {
    this.assertProviderEditPermission(req);
    const parsed = body === undefined ? null : TestConnectionSchema.safeParse(body);
    if (body !== undefined && !parsed!.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_PARSE_ZOD.code },
        400
      );
    }
    const { ok, error, result } = await this.service.testConnection(
      id,
      parsed?.data?.recipient,
      req.session.userId,
      req.session
    );
    return { ...result, test: { ok, error } };
  }

  @Post(':id/activate')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Activate a tested draft provider configuration' })
  async activate(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string
  ): Promise<EmailProviderConfigResult> {
    this.assertProviderEditPermission(req);
    return this.service.activate(id, req.session.userId, req.session);
  }

  @Post(':id/disable')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Disable a provider configuration' })
  disable(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string
  ): Promise<EmailProviderConfigResult> {
    this.assertProviderEditPermission(req);
    return this.service.disable(id, req.session.userId, req.session);
  }

  @Post(':id/rollback')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Roll back to a superseded/disabled version' })
  rollback(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string
  ): Promise<EmailProviderConfigResult> {
    this.assertProviderEditPermission(req);
    return this.service.rollback(id, req.session.userId, req.session);
  }
}
