import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpException,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Response } from 'express';
import { ErrorCodes } from '@barghsa/shared/errors';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { setCsrfCookie, setRefreshCookie, setSessionCookie } from '../session/cookie.helper.js';
import { OtpStepUpService } from './otp-step-up.service.js';

const SendSchema = z.object({}).strict();
const VerifySchema = z
  .object({ challengeId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) })
  .strict();
@ApiTags('Auth')
@UseGuards(SessionAuthGuard)
@Controller('api/auth/step-up/otp')
export class OtpStepUpController {
  constructor(private readonly service: OtpStepUpService) {}
  @Post('send')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Send a session-bound sensitive-action OTP to an existing login identifier',
  })
  @ApiZodBody(SendSchema)
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['challengeId', 'expiresAt', 'channel'],
      properties: {
        challengeId: { type: 'string', format: 'uuid' },
        expiresAt: { type: 'string', format: 'date-time' },
        channel: { type: 'string', enum: ['email', 'sms'] },
      },
    },
  })
  @RateLimit({
    namespace: 'otp-step-up-send',
    scope: 'user',
    limit: 10,
    windowMs: 60_000,
    security: true,
  })
  send(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    if (!SendSchema.safeParse(body).success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
    return this.service.send(req.session, req.ip ?? 'unknown');
  }
  @Post('verify')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Consume a session-bound OTP and rotate the session and CSRF credentials',
  })
  @ApiZodBody(VerifySchema)
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['verified', 'stepUpVerifiedAt'],
      properties: {
        verified: { type: 'boolean', enum: [true] },
        stepUpVerifiedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @RateLimit({
    namespace: 'otp-step-up-verify',
    scope: 'user',
    limit: 15,
    windowMs: 60_000,
    security: true,
  })
  async verify(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response
  ) {
    const parsed = VerifySchema.safeParse(body);
    if (!parsed.success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
    const rotated = await this.service.verify(
      req.session,
      parsed.data.challengeId,
      parsed.data.code,
      req.ip ?? 'unknown'
    );
    setSessionCookie(res, rotated.sessionId, rotated.expiresAt);
    setRefreshCookie(res, rotated.refreshToken, rotated.expiresAt);
    setCsrfCookie(res, rotated.csrfToken);
    return { verified: true, stepUpVerifiedAt: rotated.stepUpVerifiedAt.toISOString() };
  }
}
