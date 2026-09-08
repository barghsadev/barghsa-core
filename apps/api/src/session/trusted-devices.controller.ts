import { Controller, Delete, Get, HttpException, Param, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import { ErrorCodes } from '@barghsa/shared/errors';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { readDeviceCookie } from './cookie.helper.js';
import { SessionAuthGuard, type AuthenticatedRequest } from './session.guard.js';
import { SessionService } from './session.service.js';
import { RequiresStepUp, StepUpGuard } from './step-up.guard.js';

@ApiTags('Sessions')
@Controller('api/auth/trusted-devices')
@UseGuards(SessionAuthGuard)
export class TrustedDevicesController {
  constructor(private readonly sessions: SessionService) {}

  @Get()
  @RateLimit({ namespace: 'trusted-devices:list:user', limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: 'List unexpired device trust for current user' })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'userAgent', 'ip', 'trustedAt', 'expiresAt', 'isCurrentDevice'],
        properties: {
          id: { type: 'string' },
          userAgent: { type: 'string', nullable: true },
          ip: { type: 'string', nullable: true },
          trustedAt: { type: 'string', format: 'date-time' },
          expiresAt: { type: 'string', format: 'date-time' },
          isCurrentDevice: { type: 'boolean' },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  list(@Req() req: AuthenticatedRequest) {
    const cookie = readDeviceCookie(req);
    return this.sessions.getTrustedDevices(
      req.session.userId,
      cookie ? createHash('sha256').update(cookie).digest('hex') : null
    );
  }

  @Delete(':id')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @RateLimit({ namespace: 'trusted-devices:revoke:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Remove own device trust after step-up; existing sessions remain active',
  })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      required: ['revoked'],
      properties: { revoked: { type: 'boolean', enum: [true] } },
    },
  })
  @ApiResponse({ status: 401, description: 'Session is no longer active' })
  @ApiResponse({ status: 403, description: 'CSRF or recent step-up required' })
  @ApiResponse({ status: 404, description: 'Device trust not found for this user' })
  revoke(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    if (!id || id.length > 128)
      throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
    return this.sessions.revokeTrustedDevice(
      req.session.userId,
      req.session.sessionId,
      id,
      req.ip ?? null
    );
  }
}
