import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { AuthService } from './auth.service.js';
import { RegisterSchema } from './dto/register.dto.js';
import type { RegisterResponse } from './dto/register.dto.js';

@ApiTags('Auth')
@Controller('api/auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  /**
   * POST /api/auth/register
   *
   * Registers a new user and returns a challengeId for OTP verification.
   *
   * Rate limits:
   * - 3 attempts per IP per 60s
   * - 10 attempts per IP per 3600s (1h)
   */
  @Post('register')
  @HttpCode(200)
  @RateLimit({ namespace: 'registration:ip', limit: 3, windowMs: 60_000 })
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({
    status: 200,
    description: 'Registration accepted. Returns challengeId for OTP step.',
    schema: {
      type: 'object',
      properties: {
        challengeId: { type: 'string', description: 'Opaque challenge ID for OTP verification' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid username or TOS not accepted' })
  @ApiResponse({ status: 409, description: 'Username already taken' })
  @ApiResponse({ status: 422, description: 'Weak password' })
  @ApiResponse({ status: 429, description: 'Rate limited' })
  async register(
    @Body() rawBody: unknown,
    @Req() req: Request,
  ): Promise<RegisterResponse> {
    // ── Validate with Zod ───────────────────────────────────────────
    const parsed = RegisterSchema.safeParse(rawBody);

    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      // Determine which specific error to surface
      const message = firstIssue?.message ?? ErrorCodes.VALIDATION_INPUT_INVALID.code;

      if (message === ErrorCodes.AUTH_REGISTER_INVALID_USERNAME.code) {
        throw new HttpException(
          { statusCode: 400, error: message, message },
          HttpStatus.BAD_REQUEST,
        );
      }
      if (message === ErrorCodes.AUTH_REGISTER_WEAK_PASSWORD.code) {
        throw new HttpException(
          { statusCode: 422, error: message, message },
          422,
        );
      }

      // Generic validation failure
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message },
        HttpStatus.BAD_REQUEST,
      );
    }

    // ── Delegate to service ─────────────────────────────────────────
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.authService.register(parsed.data, ip);
  }
}