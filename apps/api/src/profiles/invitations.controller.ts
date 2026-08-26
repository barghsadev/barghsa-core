import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { AgentsService } from './agents.service.js'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { RateLimit } from '../rate-limit/rate-limit.decorator.js'

@ApiTags('Invitations')
@Controller('api/invitations')
@UseGuards(SessionAuthGuard)
export class InvitationsController {
  private readonly logger = new Logger(InvitationsController.name)

  constructor(private readonly agentsService: AgentsService) {}

  /**
   * GET /api/invitations/pending
   *
   * Returns pending invitations for the currently authenticated user.
   * Invitations are matched by username against the current user's username.
   */
  @Get('pending')
  @HttpCode(200)
  @RateLimit({ namespace: 'invitations:pending', limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: 'List pending invitations for the current user' })
  @ApiResponse({ status: 200, description: 'Pending invitations list.' })
  async listPendingInvitations(@Req() req: AuthenticatedRequest) {
    const userId = req.session.userId
    const result = await this.agentsService.listPendingInvitations(userId)
    this.logger.debug(`User ${userId} has ${result.invitations.length} pending invitations`)
    return result
  }

  /**
   * POST /api/invitations/:inviteId/accept
   *
   * Accepts a pending invitation. The invitation must belong to the
   * current user (by username match) and be in 'Pending' status.
   * On success, creates a profile_agents record and marks the invitation
   * as Accepted.
   */
  @Post(':inviteId/accept')
  @HttpCode(200)
  @RateLimit({ namespace: 'invitations:accept', limit: 10, windowMs: 60_000 })
  @ApiOperation({ summary: 'Accept a pending invitation' })
  @ApiResponse({ status: 200, description: 'Invitation accepted.' })
  @ApiResponse({ status: 400, description: 'Invitation not in Pending status or expired.' })
  @ApiResponse({ status: 404, description: 'Invitation not found.' })
  @ApiResponse({ status: 409, description: 'Already an agent of this profile.' })
  async acceptInvitation(
    @Param('inviteId') inviteId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.session.userId
    await this.agentsService.acceptInvitation(inviteId, userId)
    this.logger.log(`Invitation ${inviteId} accepted by user ${userId}`)
    return { message: 'Invitation accepted successfully.' }
  }

  /**
   * POST /api/invitations/:inviteId/decline
   *
   * Declines a pending invitation. The invitation must belong to the
   * current user (by username match) and be in 'Pending' status.
   */
  @Post(':inviteId/decline')
  @HttpCode(200)
  @RateLimit({ namespace: 'invitations:decline', limit: 10, windowMs: 60_000 })
  @ApiOperation({ summary: 'Decline a pending invitation' })
  @ApiResponse({ status: 200, description: 'Invitation declined.' })
  @ApiResponse({ status: 400, description: 'Invitation not in Pending status.' })
  @ApiResponse({ status: 404, description: 'Invitation not found.' })
  async declineInvitation(
    @Param('inviteId') inviteId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.session.userId
    await this.agentsService.declineInvitation(inviteId, userId)
    this.logger.log(`Invitation ${inviteId} declined by user ${userId}`)
    return { message: 'Invitation declined successfully.' }
  }
}