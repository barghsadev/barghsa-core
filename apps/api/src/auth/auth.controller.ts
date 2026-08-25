import { createHash } from 'node:crypto'
import {
  Controller,
  Post,
  HttpCode,
  HttpStatus,
  HttpException,
  Logger,
  Body,
  Req,
  Res,
  UseGuards,
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
import type { LoginResponse } from './dto/login.dto.js'
import { LoginSchema } from './dto/login.dto.js'
import type { LoginVerifyResponse } from './dto/login.dto.js'
import {
  LoginVerifySchema,
  LoginResendSchema,
  type LoginVerifyInput,
  type LoginResendInput,
} from './dto/login.dto.js'
import type { ForceChangePasswordInput } from './dto/force-change-password.dto.js'
import { ForceChangePasswordSchema } from './dto/force-change-password.dto.js'
import { OtpService } from './otp.service.js'
import type { ForgotPasswordInput, ForgotPasswordResponse } from './dto/forgot-password.dto.js'
import { ForgotPasswordSchema } from './dto/forgot-password.dto.js'
import type { ResetPasswordInput, ResetPasswordResponse } from './dto/reset-password.dto.js'
import { ResetPasswordSchema } from './dto/reset-password.dto.js'
import { SessionService } from '../session/session.service.js'
import {
  SESSION_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  setSessionCookie,
  setRefreshCookie,
  clearSessionCookie,
  clearRefreshCookie,
  setCsrfCookie,
  clearCsrfCookie,
} from '../session/cookie.helper.js'
import { SkipCsrf } from '../session/csrf.guard.js'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'

@ApiTags('Auth')
@Controller('api/auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name)

  constructor(
    private readonly authService: AuthService,
    private readonly otpService: OtpService,
    private readonly sessionService: SessionService,
  ) {}

  /**
   * POST /api/auth/register
   *
   * Registers a new user and returns a challengeId for OTP verification.
   *
   * Rate limits:
   * - 3 attempts per IP per 60s
   * - 10 attempts per IP per 3600s (1h)
   */
  @SkipCsrf()
  @Post('register')
  @HttpCode(200)
  @RateLimit({ namespace: 'registration:ip', limit: 3, windowMs: 60_000, security: true })
  @RateLimit({ namespace: 'registration:ip-hourly', limit: 10, windowMs: 3_600_000, security: true })
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
  @SkipCsrf()
  @Post('login')
  @HttpCode(200)
  @RateLimit({ namespace: 'login:account-ip', limit: 5, windowMs: 900_000, security: true })
  @RateLimit({ namespace: 'login:ip', limit: 50, windowMs: 900_000, security: true })
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

    // If password change is required, return the token without setting a session
    if (result.mustChangePassword) {
      this.logger.log(`Password change required for user — no session established`)
      return result
    }

    // If OTP is not required, set the session and refresh cookies
    if (!result.requiresOtp) {
      setSessionCookie(res, result.sessionId!, new Date(result.expiresAt!))
      if (result.refreshToken) {
        setRefreshCookie(res, result.refreshToken, new Date(result.expiresAt!))
      }

      // Set CSRF cookie for frontend access
      if (result.csrfToken) {
        setCsrfCookie(res, result.csrfToken)
      }

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
  @SkipCsrf()
  @Post('login/verify')
  @HttpCode(200)
  @RateLimit({ namespace: 'otp:login:verify:ip', limit: 5, windowMs: 60_000, security: true })
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

    // ── Set HttpOnly session and refresh cookies ─────────────────
    setSessionCookie(res, result.sessionId, new Date(result.expiresAt))
    setRefreshCookie(res, result.refreshToken, new Date(result.expiresAt))
    // Set CSRF cookie for frontend access
    if (result.csrfToken) {
      setCsrfCookie(res, result.csrfToken)
    }

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
  @SkipCsrf()
  @Post('login/resend')
  @HttpCode(200)
  @RateLimit({ namespace: 'otp:login:resend:ip', limit: 3, windowMs: 120_000, security: true })
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
   * POST /api/auth/force-change-password
   *
   * Forces a password change after login detected `mustChangePassword`.
   * Requires the short-lived password change token issued during login
   * and the new password satisfying the same strength as registration.
   *
   * No session is established — the user logs in again after the change.
   *
   * Rate limits:
   * - 5 attempts per IP per 300s
   */
  @SkipCsrf()
  @Post('force-change-password')
  @HttpCode(200)
  @RateLimit({ namespace: 'password:change:ip', limit: 5, windowMs: 300_000, security: true })
  @ApiOperation({ summary: 'Force password change after login detection' })
  @ApiResponse({
    status: 200,
    description: 'Password changed successfully.',
  })
  @ApiResponse({ status: 400, description: 'Invalid or expired password change token' })
  @ApiResponse({ status: 422, description: 'Password reused or too weak' })
  @ApiResponse({ status: 429, description: 'Rate limited' })
  async forceChangePassword(
    @Body() rawBody: unknown,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    const parsed = ForceChangePasswordSchema.safeParse(rawBody)

    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      const message = firstIssue?.message ?? ErrorCodes.VALIDATION_INPUT_INVALID.code

      if (message === ErrorCodes.AUTH_REGISTER_WEAK_PASSWORD.code) {
        throw new HttpException(
          { statusCode: 422, error: message },
          422,
        )
      }

      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        HttpStatus.BAD_REQUEST,
      )
    }

    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    return this.authService.forceChangePassword(parsed.data, ip)
  }

  /**
   * POST /api/auth/forgot-password
   *
   * Initiates the forgot-password flow by sending an OTP to the user's
   * registered destination, if the username exists. Response is always
   * generic to prevent user enumeration.
   *
   * Rate limits:
   * - 5 attempts per destination per hour
   * - 5 attempts per IP per hour
   */
  @SkipCsrf()
  @Post('forgot-password')
  @HttpCode(200)
  @RateLimit({ namespace: 'forgot-password:dest', limit: 5, windowMs: 3_600_000, security: true })
  @RateLimit({ namespace: 'forgot-password:ip', limit: 5, windowMs: 3_600_000, security: true })
  @ApiOperation({ summary: 'Initiate forgot-password OTP flow' })
  @ApiResponse({
    status: 200,
    description: 'Always returns generic success.',
    schema: {
      type: 'object',
      properties: {
        sent: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 429, description: 'Rate limited' })
  async forgotPassword(
    @Body() rawBody: unknown,
    @Req() req: Request,
  ): Promise<ForgotPasswordResponse> {
    const parsed = ForgotPasswordSchema.safeParse(rawBody)

    if (!parsed.success) {
      // Always return generic success — never reveal invalid input
      return {
        sent: true,
        message: 'If an account exists, an OTP has been sent.',
      }
    }

    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    return this.authService.forgotPassword(parsed.data, ip)
  }

  /**
   * POST /api/auth/reset-password
   *
   * Verifies the OTP from the forgot-password flow and resets the user's
   * password. On success, all existing sessions and refresh tokens are
   * invalidated — the user must log in again with the new password.
   *
   * The OTP challenge must have a `user_id` set (forgot-password challenges
   * link to the user). Challenges created during registration or login step-up
   * are rejected.
   *
   * Rate limits:
   * - 5 reset attempts per destination per hour
   * - 5 reset attempts per IP per hour
   */
  @SkipCsrf()
  @Post('reset-password')
  @HttpCode(200)
  @RateLimit({ namespace: 'reset-password:dest', limit: 5, windowMs: 3_600_000, security: true })
  @RateLimit({ namespace: 'reset-password:ip', limit: 5, windowMs: 3_600_000, security: true })
  @ApiOperation({ summary: 'Reset password after OTP verification' })
  @ApiResponse({
    status: 200,
    description: 'Password reset successfully.',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Success message for the frontend toast.' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Invalid, expired, or max OTP attempts exceeded' })
  @ApiResponse({ status: 409, description: 'OTP already consumed' })
  @ApiResponse({ status: 422, description: 'Weak password or password reused' })
  @ApiResponse({ status: 429, description: 'Rate limited' })
  async resetPassword(
    @Body() rawBody: unknown,
    @Req() req: Request,
  ): Promise<ResetPasswordResponse> {
    const parsed = ResetPasswordSchema.safeParse(rawBody)

    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      const message = firstIssue?.message ?? ErrorCodes.VALIDATION_INPUT_INVALID.code

      if (message === ErrorCodes.AUTH_REGISTER_WEAK_PASSWORD.code) {
        throw new HttpException(
          { statusCode: 422, error: message },
          422,
        )
      }

      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        HttpStatus.BAD_REQUEST,
      )
    }

    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    return this.authService.resetPassword(parsed.data, ip)
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
  @SkipCsrf()
  @Post('register/verify')
  @HttpCode(200)
  @RateLimit({ namespace: 'otp:verify:ip', limit: 5, windowMs: 60_000, security: true })
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

    // ── Set HttpOnly session and refresh cookies ─────────────────
    setSessionCookie(res, result.sessionId, new Date(result.expiresAt))
    setRefreshCookie(res, result.refreshToken, new Date(result.expiresAt))
    // Set CSRF cookie for frontend access
    if (result.csrfToken) {
      setCsrfCookie(res, result.csrfToken)
    }

    this.logger.log(`Session established for user ${result.userId}`)

    return result
  }

  /**
   * POST /api/auth/logout
   *
   * Logs out the current user by revoking the session and clearing the cookie.
   *
   * Rate limits:
   * - 10 logout attempts per IP per 60s
   */
  @SkipCsrf()
  @Post('logout')
  @HttpCode(200)
  @RateLimit({ namespace: 'auth:logout:ip', limit: 10, windowMs: 60_000, security: true })
  @ApiOperation({ summary: 'Log out the current user' })
  @ApiResponse({
    status: 200,
    description: 'Logged out successfully.',
  })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    const sessionId = req.cookies?.[SESSION_COOKIE_NAME]

    if (sessionId && typeof sessionId === 'string') {
      await this.sessionService.revokeSession(sessionId)
      this.logger.log(`Logout: session ${sessionId} revoked`)
    }

    clearSessionCookie(res)
    clearRefreshCookie(res)
    clearCsrfCookie(res)

    return { message: 'Logged out successfully.' }
  }

  /**
   * POST /api/auth/refresh
   *
   * Refreshes the session using the refresh token stored in the HttpOnly
   * refresh cookie. Implements refresh token rotation: on each use, the
   * current refresh token is consumed and a new one is issued in the same
   * family. If a consumed token is reused, the entire family is revoked
   * (potential token theft detection).
   *
   * On success, issues new session and refresh cookies with rotated tokens.
   *
   * Rate limits:
   * - 10 refresh attempts per IP per 60s
   */
  @SkipCsrf()
  @Post('refresh')
  @HttpCode(200)
  @RateLimit({ namespace: 'auth:refresh:ip', limit: 10, windowMs: 60_000, security: true })
  @ApiOperation({ summary: 'Refresh the session' })
  @ApiResponse({
    status: 200,
    description: 'Session refreshed. New cookies set.',
    schema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        csrfToken: { type: 'string' },
        expiresAt: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  @ApiResponse({ status: 429, description: 'Rate limited' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ sessionId: string; csrfToken: string; expiresAt: string }> {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME]

    if (!refreshToken || typeof refreshToken !== 'string') {
      throw new HttpException(
        { statusCode: 401, error: ErrorCodes.AUTH_UNAUTHENTICATED.code },
        HttpStatus.UNAUTHORIZED,
      )
    }

    // Redeem the refresh token (rotation + family check)
    const { sessionId, refreshToken: newRefreshToken } =
      await this.sessionService.redeemRefreshToken(refreshToken)

    // Look up the session to get its expiry and CSRF token
    const session = await this.sessionService.getSessionById(sessionId)

    if (!session) {
      throw new HttpException(
        { statusCode: 401, error: ErrorCodes.AUTH_TOKEN_INVALID.code },
        HttpStatus.UNAUTHORIZED,
      )
    }

    const expiresAt = new Date(session.expires_at)

    // Set new cookies
    setSessionCookie(res, sessionId, expiresAt)
    setRefreshCookie(res, newRefreshToken, expiresAt)
    // Set CSRF cookie for frontend access
    if (session.csrf_token) {
      setCsrfCookie(res, session.csrf_token)
    }

    this.logger.log(`Session refreshed: ${sessionId} for user ${session.user_id}`)

    return {
      sessionId,
      csrfToken: session.csrf_token ?? '',
      expiresAt: expiresAt.toISOString(),
    }
  }

  /**
   * POST /api/auth/register/resend
   *
   * Resends an OTP for a pending registration challenge.
   *
   * Rate limits:
   * - 3 resend attempts per IP per 120s
   */
  @SkipCsrf()
  @Post('register/resend')
  @HttpCode(200)
  @RateLimit({ namespace: 'otp:resend:ip', limit: 3, windowMs: 120_000, security: true })
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

  /**
   * POST /api/auth/step-up
   *
   * Performs step-up authentication for sensitive actions (T-02.02.04).
   *
   * Requires the authenticated session (session cookie) and the user's
   * current password. On success, updates the session's
   * `step_up_verified_at` timestamp, which the StepUpGuard checks
   * against the configured window (default 15 minutes).
   *
   * The frontend should call this endpoint when the API returns a
   * `requiresStepUp` flag (403 with AUTHZ:STEP_UP_REQUIRED), then
   * retry the original sensitive request.
   *
   * Rate limits:
   * - 5 attempts per IP per 60s
   */
  @UseGuards(SessionAuthGuard)
  @Post('step-up')
  @HttpCode(200)
  @RateLimit({ namespace: 'step-up:ip', limit: 5, windowMs: 60_000, security: true })
  @ApiOperation({ summary: 'Perform step-up authentication for sensitive actions' })
  @ApiResponse({
    status: 200,
    description: 'Step-up verified. The caller can now retry the original request.',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 422, description: 'Invalid password' })
  @ApiResponse({ status: 429, description: 'Rate limited' })
  async stepUp(
    @Body() rawBody: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ message: string; stepUpVerifiedAt: string }> {
    const StepUpSchema = z
      .object({
        /** Current password to verify identity. */
        password: z.string().min(1, ErrorCodes.VALIDATION_INPUT_MISSING.code),
      })
      .strict()

    const parsed = StepUpSchema.safeParse(rawBody)

    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        HttpStatus.BAD_REQUEST,
      )
    }

    const userId = req.session.userId
    const sessionId = req.session.sessionId

    // ── Verify password ────────────────────────────────────────
    const passwordValid = await this.sessionService.verifyUserPassword(
      userId,
      parsed.data.password,
    )

    if (!passwordValid) {
      throw new HttpException(
        { statusCode: 422, error: ErrorCodes.AUTH_LOGIN_INVALID_CREDENTIALS.code },
        422,
      )
    }

    // ── Set step-up timestamp ──────────────────────────────────
    await this.sessionService.setStepUpVerifiedTimestamp(sessionId)

    const now = new Date()
    this.logger.log(
      `Step-up verified for user ${userId}, session ${sessionId} at ${now.toISOString()}`,
    )

    return {
      message: 'Step-up authentication successful.',
      stepUpVerifiedAt: now.toISOString(),
    }
  }
}