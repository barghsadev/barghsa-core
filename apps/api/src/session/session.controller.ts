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
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';
import { SessionService } from './session.service.js';
import { SessionAuthGuard } from './session.guard.js';
import type { AuthenticatedRequest } from './session.guard.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { RequiresStepUp, StepUpGuard } from './step-up.guard.js';
import { sessionLocation } from './session-location.js';

// ─── Zod schemas ──────────────────────────────────────────────────────

const RevokeAllSchema = z
  .object({
    /** Current password required to confirm revoke-all. */
    password: z.string().min(1, ErrorCodes.VALIDATION_INPUT_MISSING.code),
  })
  .strict();

// ─── Controller ───────────────────────────────────────────────────────

@ApiTags('Sessions')
@Controller('api/auth/sessions')
@UseGuards(SessionAuthGuard)
export class SessionController {
  private readonly logger = new Logger(SessionController.name);

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
          location: {
            type: 'object',
            nullable: true,
            required: ['countryCode'],
            properties: {
              countryCode: { type: 'string', pattern: '^[A-Z]{2}$' },
            },
            description: 'Approximate IP country; null for unknown or non-public addresses.',
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
    const userId = req.session.userId;
    const currentSessionId = req.session.sessionId;

    const sessions = await this.sessionService.getUserSessions(userId);

    // Map sessions to a clean format for the frontend
    return sessions.map((s: Record<string, unknown>) => ({
      sessionId: s.session_id,
      deviceInfo: s.device_info ?? null,
      location: sessionLocation(s.device_info),
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      expiresAt: s.expires_at,
      idleDeadline: s.idle_deadline,
      isCurrentSession: s.session_id === currentSessionId,
    }));
  }

  /**
   * DELETE /api/auth/sessions/:id
   *
   * Revokes a specific session.
   * Users can only revoke their own sessions (unless admin — future).
   */
  @Delete(':id')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @HttpCode(200)
  @RateLimit({ namespace: 'sessions:revoke:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Revoke a specific session' })
  @ApiResponse({ status: 200, description: 'Session revoked.' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async revokeSession(
    @Param('id') sessionId: string,
    @Req() req: AuthenticatedRequest
  ): Promise<{ message: string }> {
    await this.sessionService.revokeOwnSessions(
      req.session,
      { targetSessionId: sessionId },
      req.ip ?? null
    );

    return { message: 'Session revoked.' };
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
    @Req() req: AuthenticatedRequest
  ): Promise<{ message: string; revokedCount: number }> {
    const parsed = RevokeAllSchema.safeParse(rawBody);

    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        400
      );
    }

    const userId = req.session.userId;
    const revokedCount = await this.sessionService.revokeOwnSessions(
      req.session,
      { password: parsed.data.password },
      req.ip ?? null
    );

    if (revokedCount === 0) {
      return { message: 'No other sessions to revoke.', revokedCount: 0 };
    }

    this.logger.log(`All other sessions (${revokedCount}) revoked for user ${userId}`);

    return {
      message: `All ${revokedCount} other session(s) revoked.`,
      revokedCount,
    };
  }
}
