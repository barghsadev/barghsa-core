import { hasStaffPermission } from '../session/staff-permissions.js';
import {
  Body,
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { ContractElectricityLimits } from '@barghsa/shared/admin';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { StepUpGuard, RequiresStepUp } from '../session/step-up.guard.js';
import { ContractElectricityLimitsService } from './contract-electricity-limits.service.js';
import { assertContractLimitFields } from './limit-settings-fields.js';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { activationHistoryQuery } from './config-activation-history.js';
import {
  activateContractLimitRecovery,
  stageContractLimitRecovery,
} from './contract-limit-recovery.js';

function requestIp(req: AuthenticatedRequest): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

/**
 * Admin endpoints for contract electricity limit configuration
 * (S-09.12, T-09.12.06) — API slice.
 *
 * Three admin-configurable limits, consumed by the electricity ordering
 * flow at draft time (later slices: T-03.06.01.02, T-04.6.01.01):
 *
 *   - `max_quantity_increase_percent` — max % quantity-increase request
 *     on a contracted electricity quantity (0..1000, 0 forbids);
 *   - `max_contract_duration_months` — max advanced-order contract
 *     duration in Jalali months (1..1200);
 *   - `lead_time_days` — min lead time before an advanced order start
 *     (0..36500, 0 = start can be today).
 *
 * Body uses the snake_case wire shape; responses use camelCase. GET
 * returns the documented defaults when nothing is persisted
 * ({ 20, 24, 0 }). Changes affect NEW DRAFTS ONLY — existing contracts
 * and confirmed orders are never re-validated.
 *
 * Security posture (mirrors the S-09.12 admin controllers):
 * - Every route requires an authenticated session with the
 *   `admin:catalogue:edit` capability (same gate as the electricity
 *   ordering settings surface, T-09.10.02). Capabilities are read from current database roles.
 * - The mutation additionally requires recent step-up verification via
 *   `@RequiresStepUp()` (StepUpGuard) — consistent with the VAT and
 *   upload-policy mutation endpoints.
 *
 * The admin web UI slice (number inputs per setting with the
 * "Changes apply to new orders only, not existing contracts." note;
 * fa/en dicts, RTL/a11y) is deferred.
 */
@ApiTags('Admin · Contract Electricity Limits')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/config/contract-electricity-limits')
export class ContractElectricityLimitsController {
  constructor(private readonly service: ContractElectricityLimitsService) {}

  /** Single enforcement point for the `admin:catalogue:edit` capability. */
  private assertElectricitySettingsPermission(req: AuthenticatedRequest): void {
    if (!hasStaffPermission(req, 'admin:catalogue:edit')) {
      throw new HttpException(
        {
          statusCode: HttpStatus.FORBIDDEN,
          error: ErrorCodes.AUTHZ_FORBIDDEN.code,
          message: 'Admin role required to manage contract electricity limits',
        },
        HttpStatus.FORBIDDEN
      );
    }
  }

  @Get()
  @ApiOperation({
    summary: 'Get contract electricity limits configuration (admin)',
    description:
      'Current maxQuantityIncreasePercent / maxContractDuration / leadTimeDays. ' +
      'Returns the documented defaults (20, 24 Jalali months, 0 days) when nothing is persisted.',
  })
  @ApiResponse({
    status: 200,
    description: 'Current contract electricity limits.',
    schema: {
      type: 'object',
      required: ['maxQuantityIncreasePercent', 'maxContractDuration', 'leadTimeDays'],
      properties: {
        maxQuantityIncreasePercent: {
          type: 'integer',
          example: 20,
          minimum: 0,
          maximum: 1000,
        },
        maxContractDuration: { type: 'integer', example: 24, minimum: 1, maximum: 1200 },
        leadTimeDays: { type: 'integer', example: 0, minimum: 0, maximum: 36500 },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async get(@Req() req: AuthenticatedRequest): Promise<ContractElectricityLimits> {
    this.assertElectricitySettingsPermission(req);
    return this.service.get();
  }

  @Get('rollback-history')
  @ApiOperation({ summary: 'Read earlier contract limit revisions and the current recovery draft' })
  @ApiQuery({ name: 'beforeVersion', required: false, type: Number })
  async recoveryHistory(@Req() req: AuthenticatedRequest, @Query() raw: unknown) {
    this.assertElectricitySettingsPermission(req);
    const parsed = activationHistoryQuery.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Invalid recovery history query');
    return this.service.recoveryHistory(req.session, parsed.data.beforeVersion);
  }

  @Post('rollback-draft')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Prepare a contract limit recovery draft' })
  @ApiZodBody(stageContractLimitRecovery)
  async stageRecovery(@Req() req: AuthenticatedRequest, @Body() raw: unknown) {
    this.assertElectricitySettingsPermission(req);
    const parsed = stageContractLimitRecovery.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Invalid recovery draft request');
    return this.service.stageRecovery(parsed.data, req.session, requestIp(req));
  }

  @Post('rollback-activate')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Activate the exact contract limit recovery draft as a new revision' })
  @ApiZodBody(activateContractLimitRecovery)
  async activateRecovery(@Req() req: AuthenticatedRequest, @Body() raw: unknown) {
    this.assertElectricitySettingsPermission(req);
    const parsed = activateContractLimitRecovery.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Invalid recovery activation request');
    return this.service.activateRecovery(parsed.data, req.session, requestIp(req));
  }

  @Put()
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Update contract electricity limits configuration (admin)',
    description:
      'Persists new limits. Values: max_quantity_increase_percent (integer 0..1000, 0 forbids ' +
      'increases), max_contract_duration_months (integer 1..1200 Jalali months), lead_time_days ' +
      '(integer 0..36500; 0 = start can be today). Changes apply to new orders/drafts only — ' +
      'existing contracts are never re-validated.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['max_quantity_increase_percent', 'max_contract_duration_months', 'lead_time_days'],
      properties: {
        max_quantity_increase_percent: { type: 'integer', example: 20, minimum: 0, maximum: 1000 },
        max_contract_duration_months: { type: 'integer', example: 24, minimum: 1, maximum: 1200 },
        lead_time_days: { type: 'integer', example: 0, minimum: 0, maximum: 36500 },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Contract electricity limits updated.',
    schema: {
      type: 'object',
      properties: {
        maxQuantityIncreasePercent: { type: 'integer' },
        maxContractDuration: { type: 'integer' },
        leadTimeDays: { type: 'integer' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async update(
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown>
  ): Promise<ContractElectricityLimits> {
    this.assertElectricitySettingsPermission(req);
    assertContractLimitFields(body);
    return this.service.update({
      raw: body,
      actor: req.session,
      ip: requestIp(req),
    });
  }
}
