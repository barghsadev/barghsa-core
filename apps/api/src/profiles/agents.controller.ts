import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Logger,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { AgentsService } from './agents.service.js'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { RateLimit } from '../rate-limit/rate-limit.decorator.js'
import { ErrorCodes } from '@barghsa/shared/errors'

@ApiTags('Agents')
@Controller('api/profiles/:profileId')
@UseGuards(SessionAuthGuard)
export class AgentsController {
  private readonly logger = new Logger(AgentsController.name)

  constructor(private readonly agentsService: AgentsService) {}

  /**
   * GET /api/profiles/:profileId/agents
   *
   * Returns agents (joined) and pending invitations for a legal profile.
   * Requires owner or manager role on the legal profile.
   *
   * Privacy: invited user registration status is never revealed.
   */
  @Get('agents')
  @HttpCode(200)
  @RateLimit({ namespace: 'agents:list:profile', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'List agents and pending invitations for a legal profile' })
  @ApiResponse({ status: 200, description: 'Agent list.' })
  @ApiResponse({ status: 403, description: 'Not authorized — owner or manager role required.' })
  @ApiResponse({ status: 404, description: 'Profile not found or not a legal profile.' })
  async listAgents(
    @Param('profileId') profileId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.session.userId

    // Permission check: owner or manager
    const permitted = await this.agentsService.isOwnerOrManager(userId, profileId)
    if (!permitted) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Only owner or manager can view agents' },
        403,
      )
    }

    const result = await this.agentsService.listAgents(profileId)
    this.logger.debug(`User ${userId} listed agents for profile ${profileId}: ${result.agents.length} entries`)
    return result
  }

  /**
   * DELETE /api/profiles/:profileId/invitations/:inviteId
   *
   * Withdraws a pending invitation. Only the profile owner/manager
   * or the original inviter may withdraw a pending invite.
   */
  @Delete('invitations/:inviteId')
  @HttpCode(200)
  @RateLimit({ namespace: 'agents:withdraw:invite', limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: 'Withdraw a pending invitation' })
  @ApiResponse({ status: 200, description: 'Invitation withdrawn.' })
  @ApiResponse({ status: 400, description: 'Invitation is not in Pending status.' })
  @ApiResponse({ status: 403, description: 'Not authorized to withdraw this invitation.' })
  @ApiResponse({ status: 404, description: 'Invitation not found.' })
  async withdrawInvitation(
    @Param('profileId') profileId: string,
    @Param('inviteId') inviteId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.session.userId

    await this.agentsService.withdrawInvitation(profileId, inviteId, userId)

    this.logger.log(`Invitation ${inviteId} withdrawn from profile ${profileId} by user ${userId}`)
    return { message: 'Invitation withdrawn successfully.' }
  }
}