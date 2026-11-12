import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ErrorCodes } from '@barghsa/shared/errors';
import { securityRateLimitPolicyKeys } from '@barghsa/shared/rate-limit';
import type { z } from 'zod';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import {
  parseSecurityRateLimitUpdate,
  activateSecurityRateLimitRecovery,
  readSecurityRateLimitConfig,
  readSecurityRateLimitRecovery,
  SecurityRateLimitActivateSchema,
  SecurityRateLimitHistorySchema,
  SecurityRateLimitStageSchema,
  SecurityRateLimitUpdateSchema,
  stageSecurityRateLimitRecovery,
  updateSecurityRateLimitConfig,
} from './security-rate-limit-config.js';

function authorize(
  req: AuthenticatedRequest,
  permission: 'admin:config:read' | 'admin:config:write'
) {
  if (!hasStaffPermission(req, permission))
    throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
}

function parseRecovery<T>(schema: z.ZodType<T>, raw: unknown) {
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
  return parsed.data;
}

@ApiTags('Admin · Security')
@UseGuards(SessionAuthGuard)
@Controller('api/admin/config/security-rate-limits')
export class SecurityRateLimitConfigController {
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Read action rate limits and emergency rules' })
  get(@Req() req: AuthenticatedRequest) {
    authorize(req, 'admin:config:read');
    return readSecurityRateLimitConfig(req.session);
  }

  @Put()
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiZodBody(SecurityRateLimitUpdateSchema)
  @ApiOperation({ summary: 'Set a versioned action rate limit or temporary emergency rule' })
  update(@Body() raw: unknown, @Req() req: AuthenticatedRequest) {
    authorize(req, 'admin:config:write');
    return updateSecurityRateLimitConfig(
      parseSecurityRateLimitUpdate(raw),
      req.session,
      req.ip ?? 'unknown'
    );
  }

  @Get('rollback-history')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Read previous regular rate limits and the current recovery draft' })
  @ApiQuery({ name: 'policy', enum: [...securityRateLimitPolicyKeys] })
  @ApiQuery({ name: 'beforeVersion', required: false, type: Number })
  history(@Query() raw: unknown, @Req() req: AuthenticatedRequest) {
    authorize(req, 'admin:config:read');
    return readSecurityRateLimitRecovery(
      parseRecovery(SecurityRateLimitHistorySchema, raw),
      req.session
    );
  }

  @Post('rollback-draft')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiZodBody(SecurityRateLimitStageSchema)
  @ApiOperation({ summary: 'Prepare a recovery draft for a previously active regular limit' })
  stage(@Body() raw: unknown, @Req() req: AuthenticatedRequest) {
    authorize(req, 'admin:config:write');
    return stageSecurityRateLimitRecovery(
      parseRecovery(SecurityRateLimitStageSchema, raw),
      req.session,
      req.ip ?? 'unknown'
    );
  }

  @Post('rollback-activate')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @HttpCode(200)
  @ApiZodBody(SecurityRateLimitActivateSchema)
  @ApiOperation({
    summary: 'Activate the exact recovery draft and preserve the current emergency rule',
  })
  activate(@Body() raw: unknown, @Req() req: AuthenticatedRequest) {
    authorize(req, 'admin:config:write');
    return activateSecurityRateLimitRecovery(
      parseRecovery(SecurityRateLimitActivateSchema, raw),
      req.session,
      req.ip ?? 'unknown'
    );
  }
}
