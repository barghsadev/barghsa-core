import { Injectable, Logger, HttpException, Inject } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import { rateLimitKey } from '@barghsa/shared/rate-limit'
import { normalizeUsername } from '@barghsa/shared/validation'
import type { AgentRole } from '@barghsa/shared/agent-permissions'
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

    // ── Permission check first: owner or manager ────────────
    // Run before any input validation or profile lookup so that
    // unauthorized callers always receive 403 and cannot distinguish
    // between invalid input, missing profile, or forbidden access.
    const permitted = await this.isOwnerOrManager(userId, profileId)
    if (!permitted) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Only owner or manager can send invitations' },
        403,
      )
    }

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
    const normalised = normalizeUsername(username)
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
    // (isOwnerOrManager already confirmed it's a LEGAL profile,
    //  but we verify it explicitly for clarity and safety.)
    const profileResult = await pool.query(
      `SELECT id, profile_type FROM profiles WHERE id = $1`,
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
   * Return pending invitations for the currently authenticated user.
   *
   * Finds the user's username, then returns all pending invitations
   * matching that username, joined with profile info (legal entity name)
   * and inviter info.
   */
  async listPendingInvitations(userId: string): Promise<{
    invitations: Array<{
      id: string
      profileId: string
      profileName: string
      role: string
      invitedBy: string
      inviterName: string | null
      createdAt: string
      expiresAt: string | null
    }>
  }> {
    const pool = getDbPool()

    // Look up the user's username
    const userResult = await pool.query(
      `SELECT username FROM users WHERE user_id = $1`,
      [userId],
    )
    if (userResult.rows.length === 0) {
      return { invitations: [] }
    }
    const username = userResult.rows[0].username as string

    // Query pending invitations matching this username, joined with profile and inviter info
    const result = await pool.query(
      `SELECT pi.id, pi.profile_id,
              COALESCE(p.first_name || ' ' || p.last_name, p.id) AS profile_name,
              pi.role, pi.invited_by,
              COALESCE(u.first_name || ' ' || u.last_name, u.username) AS inviter_name,
              pi.created_at, pi.expires_at
       FROM profile_invitations pi
       JOIN profiles p ON p.id = pi.profile_id
       LEFT JOIN users u ON u.user_id = pi.invited_by
       WHERE pi.username = $1 AND pi.status = 'Pending' AND pi.expires_at > NOW()
       ORDER BY pi.created_at DESC`,
      [username],
    )

    const invitations = result.rows.map((row: any) => ({
      id: row.id as string,
      profileId: row.profile_id as string,
      profileName: row.profile_name as string,
      role: row.role as string,
      invitedBy: row.invited_by as string,
      inviterName: (row.inviter_name as string) ?? null,
      createdAt: new Date(row.created_at as Date).toISOString(),
      expiresAt: row.expires_at ? new Date(row.expires_at as Date).toISOString() : null,
    }))

    return { invitations }
  }

  /**
   * Accept a pending invitation.
   *
   * The invitation must:
   * - Be in 'Pending' status
   * - Belong to the current user (by username match)
   * - Not be expired
   *
   * On success: creates a profile_agents record and marks the invitation as Accepted.
   */
  async acceptInvitation(inviteId: string, userId: string): Promise<void> {
    const pool = getDbPool()

    // Look up the user's username
    const userResult = await pool.query(
      `SELECT username FROM users WHERE user_id = $1`,
      [userId],
    )
    if (userResult.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'User not found' },
        404,
      )
    }
    const username = userResult.rows[0].username as string

    // Verify the invitation exists, is Pending, belongs to this user, and is not expired
    const inviteResult = await pool.query(
      `SELECT id, profile_id, username, role, status, expires_at
       FROM profile_invitations
       WHERE id = $1`,
      [inviteId],
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
          message: `Cannot accept invitation in '${invite.status as string}' status`,
        },
        400,
      )
    }

    // Check the invitation belongs to this user (by username match)
    if ((invite.username as string) !== username) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Invitation not found' },
        404,
      )
    }

    // Check expiry
    if (invite.expires_at && new Date(invite.expires_at as Date) < new Date()) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'This invitation has expired',
        },
        400,
      )
    }

    const profileId = invite.profile_id as string
    const role = invite.role as string

    // Wrap state change, profile_agents insert, and audit log in a transaction
    const client = await pool.connect()
    let transactionStarted = false
    try {
      await client.query('BEGIN')
      transactionStarted = true

      // Check the user isn't already an agent of this profile (inside transaction to prevent TOCTOU race)
      const existingAgent = await client.query(
        `SELECT id FROM profile_agents WHERE profile_id = $1 AND user_id = $2 FOR UPDATE`,
        [profileId, userId],
      )
      if (existingAgent.rows.length > 0) {
        await client.query('ROLLBACK')
        transactionStarted = false
        throw new HttpException(
          { statusCode: 409, error: ErrorCodes.CONFLICT_STATE.code, message: 'You are already an agent of this profile' },
          409,
        )
      }

      // Insert into profile_agents
      await client.query(
        `INSERT INTO profile_agents (id, profile_id, user_id, role, joined_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW(), NOW())`,
        [uuidv7(), profileId, userId, role],
      )

      // Update invitation status
      await client.query(
        `UPDATE profile_invitations
         SET status = 'Accepted', updated_at = NOW()
         WHERE id = $1`,
        [inviteId],
      )

      // Audit log
      const correlationId = uuidv7()
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, NOW())`,
        [
          uuidv7(),
          userId,
          'invitation_accepted',
          JSON.stringify({ profileId, inviteId, role }),
          correlationId,
        ],
      )

      await client.query('COMMIT')
      transactionStarted = false
    } catch (error) {
      if (transactionStarted) {
        try { await client.query('ROLLBACK') } catch { /* ignore rollback failure */ }
      }
      throw error
    } finally {
      client.release()
    }

    this.logger.log(`Invitation ${inviteId} accepted by user ${userId} for profile ${profileId} as ${role}`)
  }

  /**
   * Decline a pending invitation.
   *
   * The invitation must:
   * - Be in 'Pending' status
   * - Belong to the current user (by username match)
   * - Not be expired
   */
  async declineInvitation(inviteId: string, userId: string): Promise<void> {
    const pool = getDbPool()

    // Look up the user's username
    const userResult = await pool.query(
      `SELECT username FROM users WHERE user_id = $1`,
      [userId],
    )
    if (userResult.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'User not found' },
        404,
      )
    }
    const username = userResult.rows[0].username as string

    // Verify the invitation exists, is Pending, and belongs to this user
    const inviteResult = await pool.query(
      `SELECT id, username, status, expires_at
       FROM profile_invitations
       WHERE id = $1`,
      [inviteId],
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
          message: `Cannot decline invitation in '${invite.status as string}' status`,
        },
        400,
      )
    }

    // Check the invitation belongs to this user (by username match)
    if ((invite.username as string) !== username) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Invitation not found' },
        404,
      )
    }

    // Wrap state change and audit log in a transaction
    const client = await pool.connect()
    let transactionStarted = false
    try {
      await client.query('BEGIN')
      transactionStarted = true

      await client.query(
        `UPDATE profile_invitations
         SET status = 'Declined', updated_at = NOW()
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
          'invitation_declined',
          JSON.stringify({ inviteId }),
          correlationId,
        ],
      )

      await client.query('COMMIT')
      transactionStarted = false
    } catch (error) {
      if (transactionStarted) {
        try { await client.query('ROLLBACK') } catch { /* ignore rollback failure */ }
      }
      throw error
    } finally {
      client.release()
    }

    this.logger.log(`Invitation ${inviteId} declined by user ${userId}`)
  }

  /**
   * Return the agent roles (from profile_agents) for a given user in a
   * given profile. Returns an empty array when the user is not an agent.
   * Used by the AgentRoleGuard to enforce role-based permissions.
   */
  async getAgentRoles(profileId: string, userId: string): Promise<AgentRole[]> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT role FROM profile_agents WHERE profile_id = $1 AND user_id = $2`,
      [profileId, userId],
    )
    return result.rows.map((row) => row.role as AgentRole)
  }

  /**
   * Initiate an ownership transfer for a legal profile.
   *
   * The caller must be the current profile owner (profiles.user_id). The
   * target user must be an existing agent (profile_agents) of the profile.
   * Only one pending transfer per profile is allowed at a time.
   *
   * Creates a pending ownership_transfer record and an audit event.
   * The transfer expires after 7 days if not accepted.
   *
   * @throws {HttpException} 400 — target is not an agent of the profile
   * @throws {HttpException} 400 — caller is not the profile owner
   * @throws {HttpException} 400 — profile is not a LEGAL profile
   * @throws {HttpException} 400 — cannot transfer ownership to yourself
   * @throws {HttpException} 404 — profile not found
   * @throws {HttpException} 409 — a pending transfer already exists
   */
  async initiateOwnershipTransfer(
    profileId: string,
    newOwnerUserId: string,
    userId: string,
  ): Promise<{ id: string }> {
    const pool = getDbPool()

    // ── Verify the profile exists ───────────────────────────────
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

    // ── Verify the caller is the profile owner (before type check — 403 blanket) ──
    if (profile.user_id !== userId) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Only the profile owner can initiate an ownership transfer' },
        403,
      )
    }

    // ── Verify the profile is a LEGAL profile ───────────────────
    if (profile.profile_type !== 'LEGAL') {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Ownership transfer is only supported for legal profiles' },
        400,
      )
    }

    // ── Guard: self-transfer ────────────────────────────────────
    if (newOwnerUserId === userId) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Cannot transfer ownership to yourself' },
        400,
      )
    }

    // ── Verify the target user is an existing agent of the profile ──
    const agentResult = await pool.query(
      `SELECT id, role FROM profile_agents WHERE profile_id = $1 AND user_id = $2`,
      [profileId, newOwnerUserId],
    )
    if (agentResult.rows.length === 0) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'The new owner must be an existing agent of this profile' },
        400,
      )
    }

    // ── Check: no pending transfer already exists ────────────────
    const pendingResult = await pool.query(
      `SELECT id FROM profile_ownership_transfers
       WHERE profile_id = $1 AND status = 'Pending'`,
      [profileId],
    )
    if (pendingResult.rows.length > 0) {
      throw new HttpException(
        { statusCode: 409, error: ErrorCodes.CONFLICT_STATE.code, message: 'A pending ownership transfer already exists for this profile' },
        409,
      )
    }

    // ── Wrap creation and audit log in a transaction ──────────────
    const transferId = uuidv7()
    const correlationId = uuidv7()
    const client = await pool.connect()
    let transactionStarted = false
    try {
      await client.query('BEGIN')
      transactionStarted = true

      await client.query(
        `INSERT INTO profile_ownership_transfers (id, profile_id, from_user_id, to_user_id, status, expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'Pending', NOW() + INTERVAL '7 days', NOW(), NOW())`,
        [transferId, profileId, userId, newOwnerUserId],
      )

      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, NOW())`,
        [
          uuidv7(),
          userId,
          'ownership_transfer_initiated',
          JSON.stringify({ profileId, transferId, toUserId: newOwnerUserId }),
          correlationId,
        ],
      )

      await client.query('COMMIT')
      transactionStarted = false
    } catch (error) {
      if (transactionStarted) {
        try { await client.query('ROLLBACK') } catch { /* ignore rollback failure */ }
      }
      // A concurrent double-submit may pass the pre-check and hit the partial
      // unique index here. Convert the PG unique_violation to a proper 409
      // instead of surfacing a raw 500.
      const pgError = error as { code?: string }
      if (pgError.code === '23505') {
        throw new HttpException(
          { statusCode: 409, error: ErrorCodes.CONFLICT_STATE.code, message: 'A pending ownership transfer already exists for this profile' },
          409,
        )
      }
      throw error
    } finally {
      client.release()
    }

    this.logger.log(
      `Ownership transfer ${transferId} initiated for profile ${profileId} from user ${userId} to ${newOwnerUserId}`,
    )

    return { id: transferId }
  }
}