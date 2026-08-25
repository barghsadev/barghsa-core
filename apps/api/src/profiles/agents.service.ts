import { Injectable, Logger, HttpException } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import { v7 as uuidv7 } from 'uuid'

export interface AgentDto {
  id: string
  type: 'agent' | 'invitation'
  userId: string | null
  name: string | null
  username: string | null
  role: string
  status: 'Pending' | 'Active'
  joinedAt: string | null
  createdAt: string
}

export interface AgentListResponseDto {
  profileId: string
  agents: AgentDto[]
}

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name)

  /**
   * Return a list of agents and pending invitations for a legal profile.
   *
   * Combines:
   * 1. Active agents (from profile_agents)
   * 2. Pending invitations (from profile_invitations with status 'Pending')
   *
   * Privacy rule: the API does NOT reveal whether an invited user is already
   * registered — invitation rows never expose the user_id even when the
   * invited username matches a registered account.
   */
  async listAgents(profileId: string): Promise<AgentListResponseDto> {
    const pool = getDbPool()
    const agents: AgentDto[] = []

    // Query active agents (joined users)
    const agentsResult = await pool.query(
      `SELECT pa.id, pa.user_id, pa.role, pa.joined_at, pa.created_at,
              u.first_name, u.last_name, u.username
       FROM profile_agents pa
       LEFT JOIN users u ON u.user_id = pa.user_id
       WHERE pa.profile_id = $1
       ORDER BY pa.joined_at ASC`,
      [profileId],
    )

    for (const row of agentsResult.rows) {
      const firstName = (row.first_name as string) ?? ''
      const lastName = (row.last_name as string) ?? ''
      const displayName = [firstName, lastName].filter(Boolean).join(' ') || null

      agents.push({
        id: row.id as string,
        type: 'agent',
        userId: row.user_id as string,
        name: displayName,
        username: (row.username as string) ?? null,
        role: row.role as string,
        status: 'Active',
        joinedAt: row.joined_at ? new Date(row.joined_at as Date).toISOString() : null,
        createdAt: new Date(row.created_at as Date).toISOString(),
      })
    }

    // Query pending invitations
    // Do NOT join with users table — privacy: must not reveal registration status
    const invitesResult = await pool.query(
      `SELECT id, username, role, created_at
       FROM profile_invitations
       WHERE profile_id = $1 AND status = 'Pending'
       ORDER BY created_at ASC`,
      [profileId],
    )

    for (const row of invitesResult.rows) {
      agents.push({
        id: row.id as string,
        type: 'invitation',
        userId: null,
        name: null,
        username: row.username as string,
        role: row.role as string,
        status: 'Pending',
        joinedAt: null,
        createdAt: new Date(row.created_at as Date).toISOString(),
      })
    }

    return { profileId, agents }
  }

  /**
   * Check whether a user is the owner or a manager of the given profile.
   * Used by the controller to enforce agent-list permissions.
   */
  async isOwnerOrManager(userId: string, profileId: string): Promise<boolean> {
    const pool = getDbPool()

    // Check direct ownership
    const profileResult = await pool.query(
      `SELECT id FROM profiles WHERE id = $1 AND user_id = $2 AND profile_type = 'LEGAL'`,
      [profileId, userId],
    )
    if (profileResult.rows.length > 0) return true

    // Check manager role in profile_agents
    const agentResult = await pool.query(
      `SELECT id FROM profile_agents WHERE profile_id = $1 AND user_id = $2 AND role = 'Manager'`,
      [profileId, userId],
    )
    return agentResult.rows.length > 0
  }

  /**
   * Withdraw (cancel) a pending invitation.
   *
   * Only the profile owner or the user who sent the invitation may
   * withdraw it. The invitation must be in 'Pending' status.
   */
  async withdrawInvitation(
    profileId: string,
    inviteId: string,
    userId: string,
  ): Promise<void> {
    const pool = getDbPool()

    // Verify the invitation exists and belongs to this profile
    const inviteResult = await pool.query(
      `SELECT id, status, invited_by
       FROM profile_invitations
       WHERE id = $1 AND profile_id = $2`,
      [inviteId, profileId],
    )

    if (inviteResult.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Invitation not found' },
        404,
      )
    }

    const invite = inviteResult.rows[0]

    if (invite.status !== 'Pending') {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: `Cannot withdraw invitation in '${invite.status as string}' status`,
        },
        400,
      )
    }

    // Check permission: must be owner OR the original inviter
    const isOwner = await this.isOwnerOrManager(userId, profileId)
    const isInviter = (invite.invited_by as string) === userId

    if (!isOwner && !isInviter) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Not authorized to withdraw this invitation' },
        403,
      )
    }

    await pool.query(
      `UPDATE profile_invitations
       SET status = 'Withdrawn', updated_at = NOW()
       WHERE id = $1`,
      [inviteId],
    )

    // Audit log
    const correlationId = uuidv7()
    await pool.query(
      `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, NOW())`,
      [
        uuidv7(),
        userId,
        'invitation_withdrawn',
        JSON.stringify({ profileId, inviteId }),
        correlationId,
      ],
    )

    this.logger.log(`Invitation ${inviteId} withdrawn from profile ${profileId} by user ${userId}`)
  }
}