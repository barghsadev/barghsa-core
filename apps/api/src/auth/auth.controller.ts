import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { ErrorCodes } from '@barghsa/shared/errors'
import { RateLimit } from '../rate-limit/rate-limit.decorator.js'
import { AuthService } from './auth.service.js'
import { RegisterSchema } from './dto/register.dto.js'
import type { RegisterResponse } from './dto/register.dto.js'
import type { RegisterVerifyResponse } from './dto/otp.dto.js'
import { VerifyOtpSchema, ResendOtpSchema } from './dto/otp.dto.js'
import { OtpService } from './otp.service.js'

/**
 * Session cookie configuration.
 * HttpOnly in all environments; Secure only in production (non-TLS dev exempted).
 */
const SESSION_COOKIE_NAME = 'barghsa_session'
const SESSION_COOKIE_PATH = '/'
const SESSION_COOKIE_SAMESITE = 'lax' as const

@ApiTags('Auth')
@Controller('api/auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name)

  constructor(private readonly authService: AuthService, private readonly otpService: OtpService) {}

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
  @RateLimit({ namespace: 'registration:ip-hourly', limit: 10, windowMs: 3_600_000 })
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
    const parsed = RegisterSchema.safeParse(rawBody)

    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      // Determine which specific error to surface
      const message = firstIssue?.message ?? ErrorCodes.VALIDATION_INPUT_INVALID.code

      if (message === ErrorCodes.AUTH_REGISTER_INVALID_USERNAME.code) {
        throw new HttpException(
          { statusCode: 400, error: message },
          HttpStatus.BAD_REQUEST,
        )
      }
      if (message === ErrorCodes.AUTH_REGISTER_WEAK_PASSWORD.code) {
        throw new HttpException(
          { statusCode: 422, error: message },
          422,
        )
      }

      // Generic validation failure
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        HttpStatus.BAD_REQUEST,
      )
    }

    // ── Delegate to service ─────────────────────────────────────────
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    return this.authService.register(parsed.data, ip)
  }

  /**
   * POST /api/auth/register/verify
   *
   * Verifies the OTP for a registration challenge, creates the user record,
   * creates a session, and returns session credentials.
   *
   * Rate limits:
   * - 5 verification attempts per IP per 60s
   */
  @Post('register/verify')
  @HttpCode(200)
  @RateLimit({ namespace: 'otp:verify:ip', limit: 5, windowMs: 60_000 })
  @ApiOperation({ summary: 'Verify OTP for registration' })
  @ApiResponse({
    status: 200,
    description: 'OTP verified. User created and session established.',
  })
  @ApiResponse({ status: 401, description: 'Invalid, expired, or max attempts exceeded' })
  @ApiResponse({ status: 429, description: 'Rate limited' })
  async verifyOtp(
    @Body() rawBody: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RegisterVerifyResponse> {
    const parsed = VerifyOtpSchema.safeParse(rawBody)

    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        HttpStatus.BAD_REQUEST,
      )
    }

    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'

    // Perform the complete registration: OTP verify → user create → session create
    const result = await this.authService.completeRegistration(
      parsed.data.challengeId,
      parsed.data.otp,
      ip,
    )

    // ── Set HttpOnly session cookie ─────────────────────────────────
    const isSecure = process.env.NODE_ENV === 'production'
    const sessionMaxAge = new Date(result.expiresAt).getTime() - Date.now()

    res.cookie(SESSION_COOKIE_NAME, result.sessionId, {
      httpOnly: true,
      secure: isSecure,
      sameSite: SESSION_COOKIE_SAMESITE,
      path: SESSION_COOKIE_PATH,
      maxAge: Math.max(0, sessionMaxAge),
    })

    this.logger.log(`Session established for user ${result.userId}`)

    return result
  }

  /**
   * POST /api/auth/register/resend
   *
   * Resends an OTP for a pending registration challenge.
   *
   * Rate limits:
   * - 3 resend attempts per IP per 120s
   */
  @Post('register/resend')
  @HttpCode(200)
  @RateLimit({ namespace: 'otp:resend:ip', limit: 3, windowMs: 120_000 })
  @ApiOperation({ summary: 'Resend OTP for registration' })
  @ApiResponse({
    status: 200,
    description: 'OTP resent. Returns the same challengeId.',
  })
  @ApiResponse({ status: 429, description: 'Rate limited' })
  async resendOtp(
    @Body() rawBody: unknown,
    @Req() req: Request,
  ): Promise<{ challengeId: string }> {
    const parsed = ResendOtpSchema.safeParse(rawBody)

    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        HttpStatus.BAD_REQUEST,
      )
    }

    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    return this.otpService.resendChallenge(parsed.data.challengeId, ip)
  }
}