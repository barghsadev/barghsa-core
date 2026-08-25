import { Injectable, Logger, HttpException, Inject } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import { rateLimitKey } from '@barghsa/shared/rate-limit'
import { v7 as uuidv7 } from 'uuid'
import { RateLimitService } from '../rate-limit/rate-limit.service.js'

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

  constructor(
    @Inject(RateLimitService)
    private readonly rateLimitService: RateLimitService,
  ) {}

  /** Valid agent roles for invitations. */
  private static readonly VALID_INVITE_ROLES = new Set(['Manager', 'Finance', 'Legal'])

  /** Regex for Iranian mobile number 0912xxxxxxx (11 digits starting with 09). */
  private static readonly IRANIAN_MOBILE_RE = /^09\d{9}$/

  /** Regex for basic email validation. */
  private static readonly EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

    // Wrap state change and audit log in a transaction for atomicity
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      await client.query(
        `UPDATE profile_invitations
         SET status = 'Withdrawn', updated_at = NOW()
         WHERE id = $1`,
        [inviteId],
      )

      const correlationId = uuidv7()
      await client.query(
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

      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }

    this.logger.log(`Invitation ${inviteId} withdrawn from profile ${profileId} by user ${userId}`)
  }

  /**
   * Create a new agent invitation for a legal profile.
   *
   * The caller must be the profile owner or a manager. Invitations are
   * rate-limited to 10 per hour per profile.
   *
   * @throws {HttpException} 400 — invalid input (role, username)
   * @throws {HttpException} 403 — not owner/manager
   * @throws {HttpException} 404 — profile not found or not legal
   * @throws {HttpException} 409 — user already an agent or has a pending invitation
   * @throws {HttpException} 429 — rate limit exceeded
   */
  async createInvitation(
    profileId: string,
    username: string,
    role: string,
    userId: string,
  ): Promise<{ id: string }> {
    const pool = getDbPool()

    // ── Validate role ──────────────────────────────────────
    if (!AgentsService.VALID_INVITE_ROLES.has(role)) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: `Invalid role '${role}'. Must be one of: ${[...AgentsService.VALID_INVITE_ROLES].join(', ')}`,
        },
        400,
      )
    }

    // ── Normalise and validate username ────────────────────
    const normalised = this.normaliseUsername(username.trim())
    if (!normalised) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'Invalid username. Provide a valid email or Iranian mobile number.',
        },
        400,
      )
    }

    // ── Verify the profile exists and is a LEGAL profile ────
    const profileResult = await pool.query(
      `SELECT id, user_id, profile_type FROM profiles WHERE id = $1`,
      [profileId],
    )
    if (profileResult.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Profile not found' },
        404,
      )
    }
    const profile = profileResult.rows[0]
    if (profile.profile_type !== 'LEGAL') {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Invitations are only supported for legal profiles' },
        400,
      )
    }

    // ── Permission check: owner or manager ──────────────────
    const permitted = await this.isOwnerOrManager(userId, profileId)
    if (!permitted) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Only owner or manager can send invitations' },
        403,
      )
    }

    // ── Rate limit: 10 invitations/hour per profile ─────────
    const rlKey = rateLimitKey('agents:invite:profile', profileId)
    const rlResult = await this.rateLimitService.checkRateLimit(rlKey, 10, 3_600_000)
    if (!rlResult.allowed) {
      const retryAfterSeconds = Math.ceil(rlResult.resetMs / 1000)
      throw new HttpException(
        {
          statusCode: 429,
          error: ErrorCodes.RATE_LIMIT_EXCEEDED.code,
          message: retryAfterSeconds > 0
            ? `Too many invitations. Try again in ${retryAfterSeconds} seconds.`
            : 'Too many invitations. Try again later.',
          retryAfterMs: rlResult.resetMs,
        },
        429,
      )
    }

    // ── Check: invitee must not already be a pending invite ──
    // Check runs for both registered and unregistered users
    const pendingInvite = await pool.query(
      `SELECT id FROM profile_invitations
       WHERE profile_id = $1 AND username = $2 AND status = 'Pending'`,
      [profileId, normalised],
    )
    if (pendingInvite.rows.length > 0) {
      throw new HttpException(
        { statusCode: 409, error: ErrorCodes.CONFLICT_STATE.code, message: 'A pending invitation already exists for this user' },
        409,
      )
    }

    // ── Check: invitee must not already be an agent (only if registered) ──
    const userResult = await pool.query(
      `SELECT user_id FROM users WHERE username = $1`,
      [normalised],
    )
    if (userResult.rows.length > 0) {
      const inviteeUserId = userResult.rows[0].user_id as string

      const existingAgent = await pool.query(
        `SELECT id FROM profile_agents WHERE profile_id = $1 AND user_id = $2`,
        [profileId, inviteeUserId],
      )
      if (existingAgent.rows.length > 0) {
        throw new HttpException(
          { statusCode: 409, error: ErrorCodes.CONFLICT_STATE.code, message: 'This user is already an agent of this profile' },
          409,
        )
      }
    }

    // ── Wrap creation and audit log in a transaction ────────
    const invitationId = uuidv7()
    const correlationId = uuidv7()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      await client.query(
        `INSERT INTO profile_invitations (id, profile_id, username, role, invited_by, status, expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'Pending', NOW() + INTERVAL '7 days', NOW(), NOW())`,
        [invitationId, profileId, normalised, role, userId],
      )

      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, NOW())`,
        [
          uuidv7(),
          userId,
          'invitation_created',
          JSON.stringify({ profileId, invitationId, role, username: normalised }),
          correlationId,
        ],
      )

      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }

    this.logger.log(
      `Invitation ${invitationId} created for ${normalised} as ${role} in profile ${profileId} by user ${userId}`,
    )

    return { id: invitationId }
  }

  /**
   * Normalise a username string.
   *
   * - Iranian mobile in `09xxxxxxxxx` format → E.164 (`+989xxxxxxxxx`)
   * - Email → lowercased, trimmed
   * - Returns `null` when the input is not a recognisable format.
   */
  private normaliseUsername(raw: string): string | null {
    const mobileMatch = raw.match(AgentsService.IRANIAN_MOBILE_RE)
    if (mobileMatch) {
      const digits = raw.slice(1)
      return `+98${digits}`
    }

    if (raw.startsWith('+')) {
      if (/^\+\d{7,15}$/.test(raw)) return raw
      return null
    }

    if (AgentsService.EMAIL_RE.test(raw)) {
      return raw.toLowerCase().trim()
    }

    return null
  }
}