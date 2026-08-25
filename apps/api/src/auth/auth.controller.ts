import { randomBytes, createHash } from 'node:crypto'
import { Controller, Post, HttpCode, HttpStatus, HttpException, Logger, Body, Req, Res } from '@nestjs/common'
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
import type { LoginResponse } from './dto/login.dto.js'
import { LoginSchema } from './dto/login.dto.js'
import type { LoginVerifyResponse } from './dto/login.dto.js'
import {
  LoginVerifySchema,
  LoginResendSchema,
  type LoginVerifyInput,
  type LoginResendInput,
} from './dto/login.dto.js'
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
   * POST /api/auth/login
   *
   * Authenticates a user with username (email or E.164 phone) and password.
   * Uses Argon2id for password verification.
   *
   * On success:
   * - If risk-based OTP is not required → creates a session and sets HttpOnly cookie.
   * - If OTP is required → returns `{ requiresOtp: true, challengeId }` for step-up.
   *
   * Rate limits (security-critical, PostgreSQL-backend):
   * - 5 attempts per account-and-IP per 15 minutes
   * - 50 attempts per IP per 15 minutes (broad spraying mitigation)
   *
   * Error response is always generic ("Invalid username or password")
   * to avoid revealing whether the username exists.
   */
  @Post('login')
  @HttpCode(200)
  @RateLimit({ namespace: 'login:account-ip', limit: 5, windowMs: 900_000 })
  @RateLimit({ namespace: 'login:ip', limit: 50, windowMs: 900_000 })
  @ApiOperation({ summary: 'Authenticate a user' })
  @ApiResponse({
    status: 200,
    description: 'Login result. May return session credentials or require OTP step-up.',
    schema: {
      type: 'object',
      properties: {
        requiresOtp: { type: 'boolean', description: 'Whether step-up OTP is needed' },
        challengeId: { type: 'string', description: 'Challenge ID for OTP step (when requiresOtp is true)' },
        userId: { type: 'string', description: 'User UUID (when requiresOtp is false)' },
        sessionId: { type: 'string', description: 'Session identifier (when requiresOtp is false)' },
        csrfToken: { type: 'string', description: 'CSRF token (when requiresOtp is false)' },
        expiresAt: { type: 'string', description: 'Session expiry timestamp (when requiresOtp is false)' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid username or password (generic)' })
  @ApiResponse({ status: 429, description: 'Rate limited' })
  async login(
    @Body() rawBody: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    // ── Validate with Zod ───────────────────────────────────────────
    const parsed = LoginSchema.safeParse(rawBody)

    if (!parsed.success) {
      // Generic credential error — never reveal which field is invalid
      throw new HttpException(
        { statusCode: 401, error: ErrorCodes.AUTH_LOGIN_INVALID_CREDENTIALS.code },
        HttpStatus.UNAUTHORIZED,
      )
    }

    // ── Delegate to service ─────────────────────────────────────────
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    const result = await this.authService.login(parsed.data, ip)

    // If OTP is not required, set the session cookie
    if (!result.requiresOtp) {
      const isSecure = process.env.NODE_ENV === 'production'
      const sessionMaxAge = new Date(result.expiresAt!).getTime() - Date.now()

      res.cookie(SESSION_COOKIE_NAME, result.sessionId!, {
        httpOnly: true,
        secure: isSecure,
        sameSite: SESSION_COOKIE_SAMESITE,
        path: SESSION_COOKIE_PATH,
        maxAge: Math.max(0, sessionMaxAge),
      })

      this.logger.log(`Session established for user ${result.userId}`)
    }

    return result
  }

  /**
   * POST /api/auth/login/verify
   *
   * Verifies the OTP for a login step-up challenge, creates a session,
   * and optionally marks the device as trusted.
   *
   * Rate limits:
   * - 5 verification attempts per IP per 60s
   */
  @Post('login/verify')
  @HttpCode(200)
  @RateLimit({ namespace: 'otp:login:verify:ip', limit: 5, windowMs: 60_000 })
  @ApiOperation({ summary: 'Verify OTP for login step-up' })
  @ApiResponse({
    status: 200,
    description: 'OTP verified. Session established.',
  })
  @ApiResponse({ status: 401, description: 'Invalid, expired, or max attempts exceeded' })
  @ApiResponse({ status: 429, description: 'Rate limited' })
  async verifyLoginOtp(
    @Body() rawBody: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginVerifyResponse> {
    const parsed = LoginVerifySchema.safeParse(rawBody)

    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        HttpStatus.BAD_REQUEST,
      )
    }

    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    const userAgent = req.headers['user-agent'] ?? ''
    const deviceFingerprint = parsed.data.trustDevice
      ? createHash('sha256').update(userAgent).digest('hex')
      : undefined

    // Perform login OTP verification → session creation
    const result = await this.authService.completeLogin(
      parsed.data.challengeId,
      parsed.data.otp,
      ip,
      parsed.data.trustDevice,
      deviceFingerprint,
      userAgent,
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

    this.logger.log(`Session established for user ${result.userId} via login OTP`)

    return result
  }

  /**
   * POST /api/auth/login/resend
   *
   * Resends an OTP for a pending login challenge.
   *
   * Rate limits:
   * - 3 resend attempts per IP per 120s
   */
  @Post('login/resend')
  @HttpCode(200)
  @RateLimit({ namespace: 'otp:login:resend:ip', limit: 3, windowMs: 120_000 })
  @ApiOperation({ summary: 'Resend OTP for login' })
  @ApiResponse({
    status: 200,
    description: 'OTP resent. Returns the same challengeId.',
  })
  @ApiResponse({ status: 429, description: 'Rate limited' })
  async resendLoginOtp(
    @Body() rawBody: unknown,
    @Req() req: Request,
  ): Promise<{ challengeId: string }> {
    const parsed = LoginResendSchema.safeParse(rawBody)

    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        HttpStatus.BAD_REQUEST,
      )
    }

    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    return this.otpService.resendChallenge(parsed.data.challengeId, ip)
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