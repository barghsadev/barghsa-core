import {
  Controller,
  Get,
  Delete,
  Post,
  HttpCode,
  HttpException,
  Logger,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { ErrorCodes } from '@barghsa/shared/errors'
import { SessionService } from './session.service.js'
import { SessionAuthGuard } from './session.guard.js'
import type { AuthenticatedRequest } from './session.guard.js'
import { RateLimit } from '../rate-limit/rate-limit.decorator.js'

// ─── Zod schemas ──────────────────────────────────────────────────────

const RevokeAllSchema = z
  .object({
    /** Current password required to confirm revoke-all. */
    password: z.string().min(1, ErrorCodes.VALIDATION_INPUT_MISSING.code),
  })
  .strict()

// ─── Controller ───────────────────────────────────────────────────────

@ApiTags('Sessions')
@Controller('api/auth/sessions')
@UseGuards(SessionAuthGuard)
export class SessionController {
  private readonly logger = new Logger(SessionController.name)

  constructor(private readonly sessionService: SessionService) {}

  /**
   * GET /api/auth/sessions
   *
   * Lists all active sessions for the authenticated user.
   * Returns device info, IP location (approximate), last active time,
   * and creation time for each session.
   */
  @Get()
  @HttpCode(200)
  @RateLimit({ namespace: 'sessions:list:user', limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: 'List active sessions for current user' })
  @ApiResponse({
    status: 200,
    description: 'List of active sessions.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          deviceInfo: {
            type: 'object',
            properties: {
              ip: { type: 'string' },
              userAgent: { type: 'string' },
            },
          },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          expiresAt: { type: 'string', format: 'date-time' },
          idleDeadline: { type: 'string', format: 'date-time' },
          isCurrentSession: { type: 'boolean' },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async listSessions(@Req() req: AuthenticatedRequest) {
    const userId = req.session.userId
    const currentSessionId = req.session.sessionId

    const sessions = await this.sessionService.getUserSessions(userId)

    // Map sessions to a clean format for the frontend
    return sessions.map((s: Record<string, unknown>) => ({
      sessionId: s.session_id,
      deviceInfo: s.device_info ?? null,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      expiresAt: s.expires_at,
      idleDeadline: s.idle_deadline,
      isCurrentSession: s.session_id === currentSessionId,
    }))
  }

  /**
   * DELETE /api/auth/sessions/:id
   *
   * Revokes a specific session.
   * Users can only revoke their own sessions (unless admin — future).
   */
  @Delete(':id')
  @HttpCode(200)
  @RateLimit({ namespace: 'sessions:revoke:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Revoke a specific session' })
  @ApiResponse({ status: 200, description: 'Session revoked.' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async revokeSession(
    @Param('id') sessionId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ message: string }> {
    const userId = req.session.userId

    // Verify the session belongs to this user before revoking
    const session = await this.sessionService.getSessionById(sessionId)

    if (!session || session.user_id !== userId) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
        404,
      )
    }

    await this.sessionService.revokeSession(sessionId)

    this.logger.log(
      `Session ${sessionId} revoked by user ${userId} (session owner)`,
    )

    return { message: 'Session revoked.' }
  }

  /**
   * POST /api/auth/sessions/revoke-all
   *
   * Revokes all sessions except the current one.
   * Requires the current password for confirmation.
   */
  @Post('revoke-all')
  @HttpCode(200)
  @RateLimit({ namespace: 'sessions:revoke-all:user', limit: 5, windowMs: 300_000 })
  @ApiOperation({ summary: 'Revoke all sessions except current' })
  @ApiResponse({ status: 200, description: 'All other sessions revoked.' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 422, description: 'Invalid password' })
  async revokeAllSessions(
    @Body() rawBody: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ message: string; revokedCount: number }> {
    const parsed = RevokeAllSchema.safeParse(rawBody)

    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        400,
      )
    }

    const userId = req.session.userId
    const currentSessionId = req.session.sessionId

    // ── Verify password via SessionService ─────────────────
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

    // ── Count sessions before revoking ───────────────────────
    const activeSessions = await this.sessionService.getUserSessions(userId)
    const otherSessions = activeSessions.filter(
      (s: Record<string, unknown>) => s.session_id !== currentSessionId,
    )
    const revokedCount = otherSessions.length

    if (revokedCount === 0) {
      return { message: 'No other sessions to revoke.', revokedCount: 0 }
    }

    // ── Revoke all other sessions ────────────────────────────
    await this.sessionService.revokeAllUserSessions(userId, currentSessionId)

    this.logger.log(
      `All other sessions (${revokedCount}) revoked for user ${userId}`,
    )

    return {
      message: `All ${revokedCount} other session(s) revoked.`,
      revokedCount,
    }
  }
}
