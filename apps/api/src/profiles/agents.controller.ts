import { z } from 'zod';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AgentsService } from './agents.service.js';
import { SessionAuthGuard } from '../session/session.guard.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import { InputFieldException } from '../common/input-field.exception.js';

@ApiTags('Agents')
@Controller('api/profiles/:profileId')
@UseGuards(SessionAuthGuard)
export class AgentsController {
  private readonly logger = new Logger(AgentsController.name);

  constructor(private readonly agentsService: AgentsService) {}

  @Get('agents/:userId/activity')
  @HttpCode(200)
  @RateLimit({ namespace: 'agents:activity:profile', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Public activity summaries for a current member of a legal profile' })
  @ApiResponse({
    status: 200,
    description:
      'Profile and member scoped activity, newest first, up to 50 entries with an opaque nextCursor. No raw audit metadata.',
  })
  @ApiResponse({ status: 400, description: 'Invalid or wrong-scope cursor or identifier.' })
  @ApiResponse({ status: 403, description: 'Current owner or manager required.' })
  @ApiResponse({ status: 404, description: 'Member no longer belongs to this profile.' })
  async activity(
    @Param('profileId') profileId: string,
    @Param('userId') userId: string,
    @Query('cursor') cursor: string | undefined,
    @Req() req: AuthenticatedRequest
  ) {
    if (cursor !== undefined && typeof cursor !== 'string')
      throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
    return this.agentsService.listAgentActivity(profileId, userId, req.session.userId, cursor);
  }

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
  async listAgents(@Param('profileId') profileId: string, @Req() req: AuthenticatedRequest) {
    const userId = req.session.userId;

    // Permission check: owner or manager
    const permitted = await this.agentsService.isOwnerOrManager(userId, profileId);
    if (!permitted) {
      throw new HttpException(
        {
          statusCode: 403,
          error: ErrorCodes.AUTHZ_FORBIDDEN.code,
          message: 'Only owner or manager can view agents',
        },
        403
      );
    }

    const result = await this.agentsService.listAgents(profileId);
    this.logger.debug(
      `User ${userId} listed agents for profile ${profileId}: ${result.agents.length} entries`
    );
    const roles = await this.agentsService.getAgentRoles(profileId, userId);
    return { ...result, canTransferOwnership: roles.includes('Owner') };
  }

  /**
   * POST /api/profiles/:profileId/invitations
   *
   * Creates a new agent invitation for a legal profile.
   * Only the profile owner or a manager can send invitations.
   *
   * Body: { username: string, role: 'Manager' | 'Finance' | 'Legal' }
   *
   * Rate-limited to 10 invitations per hour per profile.
   */
  @Post('invitations')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create an agent invitation for a legal profile' })
  @ApiResponse({ status: 201, description: 'Invitation created.' })
  @ApiResponse({
    status: 400,
    description: 'Invalid input (role, username, or non-legal profile).',
  })
  @ApiResponse({ status: 403, description: 'Not authorized — owner or manager role required.' })
  @ApiResponse({ status: 404, description: 'Profile not found.' })
  @ApiResponse({ status: 409, description: 'User already an agent or has a pending invitation.' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded.' })
  async createInvitation(
    @Param('profileId') profileId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const parsed = z
      .object({
        username: z.string().min(1).max(254),
        role: z.enum(['Manager', 'Finance', 'Legal']),
        message: z
          .string()
          .max(1000)
          .refine((value) => !value.includes('\0'))
          .optional(),
      })
      .safeParse(body);
    if (!parsed.success)
      throw new InputFieldException(
        parsed.error.issues.flatMap((issue) =>
          typeof issue.path[0] === 'string' &&
          ['username', 'role', 'message'].includes(issue.path[0])
            ? [issue.path[0]]
            : []
        )
      );
    if (!z.uuid().safeParse(profileId).success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
    const userId = req.session.userId;
    const result = await this.agentsService.createInvitation(
      profileId,
      parsed.data.username,
      parsed.data.role,
      req.session,
      parsed.data.message
    );
    this.logger.log(`Invitation ${result.id} created for profile ${profileId} by user ${userId}`);
    return result;
  }

  /**
   * DELETE /api/profiles/:profileId/invitations/:inviteId
   *
   * Withdraws a pending invitation. Only a current profile owner/manager may withdraw.
   */
  @Delete('invitations/:inviteId')
  @HttpCode(200)
  @RateLimit({ namespace: 'agents:withdraw:invite', limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: 'Withdraw a pending invitation' })
  @ApiResponse({ status: 200, description: 'Invitation withdrawn.' })
  @ApiResponse({ status: 400, description: 'Invalid profile or invitation ID.' })
  @ApiResponse({ status: 409, description: 'Invitation changed or expired.' })
  @ApiResponse({ status: 403, description: 'Not authorized to withdraw this invitation.' })
  @ApiResponse({ status: 404, description: 'Invitation not found.' })
  async withdrawInvitation(
    @Param('profileId') profileId: string,
    @Param('inviteId') inviteId: string,
    @Req() req: AuthenticatedRequest
  ) {
    const userId = req.session.userId;

    if (!z.uuid().safeParse(profileId).success || !z.uuid().safeParse(inviteId).success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
    await this.agentsService.withdrawInvitation(profileId, inviteId, req.session);

    this.logger.log(`Invitation ${inviteId} withdrawn from profile ${profileId} by user ${userId}`);
    return { id: inviteId, status: 'Withdrawn', message: 'Invitation withdrawn successfully.' };
  }

  @Put('agents/:userId/roles')
  @HttpCode(200)
  @RequiresStepUp()
  @UseGuards(StepUpGuard)
  async setAgentRoles(
    @Param('profileId') profileId: string,
    @Param('userId') targetUserId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const parsed = z
      .object({
        roles: z
          .array(z.enum(['Manager', 'Finance', 'Legal']))
          .min(1)
          .max(3),
      })
      .safeParse(body);
    if (!parsed.success)
      throw new InputFieldException(
        parsed.error.issues.flatMap((issue) => (issue.path[0] === 'roles' ? ['roles'] : []))
      );
    if (!z.uuid().safeParse(profileId).success)
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        400
      );
    const result = await this.agentsService.setAgentRoles(
      profileId,
      targetUserId,
      parsed.data.roles,
      req.session
    );
    return { roles: parsed.data.roles, ...result };
  }

  @Delete('agents/:userId')
  @HttpCode(200)
  @RequiresStepUp()
  @UseGuards(StepUpGuard)
  async removeAgent(
    @Param('profileId') profileId: string,
    @Param('userId') targetUserId: string,
    @Req() req: AuthenticatedRequest
  ) {
    if (!z.uuid().safeParse(profileId).success)
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        400
      );
    const result = await this.agentsService.setAgentRoles(profileId, targetUserId, [], req.session);
    return { removed: true, ...result };
  }
}
