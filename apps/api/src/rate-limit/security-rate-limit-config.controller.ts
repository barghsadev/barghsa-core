import { Body, Controller, Get, HttpException, Put, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ErrorCodes } from '@barghsa/shared/errors';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import {
  parseSecurityRateLimitUpdate,
  readSecurityRateLimitConfig,
  SecurityRateLimitUpdateSchema,
  updateSecurityRateLimitConfig,
} from './security-rate-limit-config.js';

@ApiTags('Admin · Security')
@UseGuards(SessionAuthGuard)
@Controller('api/admin/config/security-rate-limits')
export class SecurityRateLimitConfigController {
  @Get()
  @ApiOperation({ summary: 'Read action rate limits and emergency rules' })
  get(@Req() req: AuthenticatedRequest) {
    if (!hasStaffPermission(req, 'admin:config:read')) {
      throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
    }
    return readSecurityRateLimitConfig();
  }

  @Put()
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiZodBody(SecurityRateLimitUpdateSchema)
  @ApiOperation({ summary: 'Set a versioned action rate limit or temporary emergency rule' })
  update(@Body() raw: unknown, @Req() req: AuthenticatedRequest) {
    if (!hasStaffPermission(req, 'admin:config:write')) {
      throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
    }
    return updateSecurityRateLimitConfig(
      parseSecurityRateLimitUpdate(raw),
      req.session,
      req.ip ?? 'unknown'
    );
  }
}
