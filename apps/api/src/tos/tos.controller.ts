import { Controller, Get, Post, HttpCode, HttpException, Query, Body, Req, Logger, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiResponse, ApiTags, ApiBody } from '@nestjs/swagger'
import type { Request } from 'express'
import { z } from 'zod'
import { ErrorCodes } from '@barghsa/shared/errors'
import { TosService, type CurrentTosResponse } from './tos.service.js'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'

/** Zod schema for TOS acceptance request body. */
const AcceptTosSchema = z.object({
  versionId: z.string().min(1),
})

@ApiTags('Terms of Service')
@Controller('api/tos')
export class TosController {
  private readonly logger = new Logger(TosController.name)

  constructor(private readonly tosService: TosService) {}

  /**
   * GET /api/tos/current
   *
   * Returns the current active Terms of Service version.
   * Public endpoint — no authentication required.
   * Supports Persian and English content via the `locale` query parameter.
   */
  @Get('current')
  @ApiOperation({ summary: 'Get current active TOS version' })
  @ApiQuery({
    name: 'locale',
    required: false,
    enum: ['fa', 'en'],
    description: 'Content locale (default: fa)',
  })
  @ApiResponse({
    status: 200,
    description: 'Current TOS version',
    schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'TOS content in the requested locale' },
        versionId: { type: 'string', description: 'Version identifier, e.g. "v1"' },
        updatedAt: { type: 'string', format: 'date-time' },
        publishedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'No active TOS version found' })
  async getCurrent(
    @Query('locale') locale?: string,
  ): Promise<CurrentTosResponse> {
    const normalizedLocale = locale === 'en' ? 'en' : 'fa'
    return this.tosService.getCurrent(normalizedLocale)
  }

  /**
   * POST /api/tos/accept
   *
   * Records a TOS acceptance for the authenticated user.
   * Requires a valid session cookie.
   *
   * The user must accept the CURRENT active version of the TOS.
   * On success, the acceptance is recorded immutably and the user's
   * `last_accepted_tos_version` is updated.
   *
   * Rate limits:
   * - 10 acceptance attempts per IP per 60s
   */
  @UseGuards(SessionAuthGuard)
  @Post('accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept the current Terms of Service' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        versionId: { type: 'string', description: 'The UUID of the TOS version being accepted' },
      },
      required: ['versionId'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'TOS acceptance recorded.',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid version ID' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  async accept(
    @Body() rawBody: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ message: string }> {
    const parsed = AcceptTosSchema.safeParse(rawBody)

    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        400,
      )
    }

    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    const userAgent = req.headers['user-agent']

    await this.tosService.recordAcceptance(
      req.session.userId,
      parsed.data.versionId,
      ip,
      userAgent,
    )

    this.logger.log(`TOS accepted by user ${req.session.userId}`)

    return { message: 'Terms of Service accepted successfully.' }
  }
}