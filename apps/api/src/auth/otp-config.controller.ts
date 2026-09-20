import { Body, Controller, Get, HttpException, Put, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ErrorCodes } from '@barghsa/shared/errors';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import {
  parseOtpConfigUpdate,
  readOtpConfig,
  updateOtpConfig,
  UpdateOtpConfigSchema,
} from './otp-config.js';

const responseSchema = {
  type: 'object',
  required: ['ttlSeconds', 'version'],
  properties: {
    ttlSeconds: { type: 'integer', minimum: 60, maximum: 900 },
    version: { type: 'integer', minimum: 0 },
  },
};

@ApiTags('Admin · Authentication')
@UseGuards(SessionAuthGuard)
@Controller('api/admin/config/otp')
export class OtpConfigController {
  @Get()
  @ApiOperation({ summary: 'Read the OTP lifetime and settings version' })
  @ApiOkResponse({ schema: responseSchema })
  async get(@Req() req: AuthenticatedRequest) {
    if (!hasStaffPermission(req, 'admin:config:read')) {
      throw new HttpException({ statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
    }
    return readOtpConfig();
  }

  @Put()
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiZodBody(UpdateOtpConfigSchema)
  @ApiOperation({ summary: 'Set the lifetime for newly sent OTP codes' })
  @ApiOkResponse({ schema: responseSchema })
  async update(@Body() raw: unknown, @Req() req: AuthenticatedRequest) {
    if (!hasStaffPermission(req, 'admin:config:write')) {
      throw new HttpException({ statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
    }
    return updateOtpConfig(parseOtpConfigUpdate(raw), req.session, req.ip ?? 'unknown');
  }
}
