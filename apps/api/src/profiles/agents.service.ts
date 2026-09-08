import { Injectable, Logger, HttpException, Inject } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import { rateLimitKey } from '@barghsa/shared/rate-limit';
import { normalizeUsername } from '@barghsa/shared/validation';
import type { AgentRole } from '@barghsa/shared/agent-permissions';
import { v7 as uuidv7 } from 'uuid';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import {
  SessionService,
  type CreatedSession,
  type ValidatedSession,
} from '../session/session.service.js';
import { requireCurrentSession, requireSessionStepUp } from '../session/session-step-up.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import { notifyAgentInvitation } from './invitation-notifications.js';

export interface AgentDto {
  id: string;
  type: 'agent' | 'invitation';
  userId: string | null;
  name: string | null;
  username: string | null;
  role: string;
  status: 'Pending' | 'Active';
  joinedAt: string | null;
  createdAt: string;
}

export interface AgentListResponseDto {
  profileId: string;
  agents: AgentDto[];
  profileName?: string;
}

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    @Inject(RateLimitService)
    private readonly rateLimitService: RateLimitService,
    @Inject(SessionService)
    private readonly sessions: SessionService
  ) {}

  /** Valid agent roles for invitations. */
  private static readonly VALID_INVITE_ROLES = new Set(['Manager', 'Finance', 'Legal']);

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
    const pool = getDbPool();
    const agents: AgentDto[] = [];

    // Query active agents (joined users)
    const agentsResult = await pool.query(
      `SELECT pa.id, pa.user_id, pa.role, pa.joined_at, pa.created_at,
              NULL::text AS first_name, NULL::text AS last_name, u.username
       FROM profile_agents pa
       LEFT JOIN users u ON u.user_id = pa.user_id
       WHERE pa.profile_id = $1
       ORDER BY pa.joined_at ASC`,
      [profileId]
    );

    for (const row of agentsResult.rows) {
      const firstName = (row.first_name as string) ?? '';
      const lastName = (row.last_name as string) ?? '';
      const displayName = [firstName, lastName].filter(Boolean).join(' ') || null;

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
      });
    }

    // Query pending invitations
    // Do NOT join with users table — privacy: must not reveal registration status
    const invitesResult = await pool.query(
      `SELECT id, username, role, created_at
       FROM profile_invitations
       WHERE profile_id = $1 AND status = 'Pending' AND (expires_at IS NULL OR expires_at > clock_timestamp())
       ORDER BY created_at ASC`,
      [profileId]
    );

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
      });
    }

    const profile = await pool.query(
      "SELECT COALESCE(lp.legal_name,NULLIF(p.title,''),'') AS name FROM profiles p LEFT JOIN legal_profiles lp ON lp.id=p.id WHERE p.id=$1",
      [profileId]
    );
    return { profileId, agents, profileName: profile.rows[0]?.name ?? '' };
  }

  /**
   * Check whether a user is the owner or a manager of the given profile.
   * Used by the controller to enforce agent-list permissions.
   */
  async isOwnerOrManager(userId: string, profileId: string): Promise<boolean> {
    const pool = getDbPool();

    // Check direct ownership
    const profileResult = await pool.query(
      `SELECT id FROM profiles WHERE id = $1 AND user_id = $2 AND profile_type = 'LEGAL' AND NOT archived`,
      [profileId, userId]
    );
    if (profileResult.rows.length > 0) return true;

    // Check manager role in profile_agents
    const agentResult = await pool.query(
      `SELECT pa.id FROM profile_agents pa JOIN profiles p ON p.id=pa.profile_id WHERE pa.profile_id=$1 AND pa.user_id=$2 AND pa.role='Manager' AND p.profile_type='LEGAL' AND NOT p.archived`,
      [profileId, userId]
    );
    return agentResult.rows.length > 0;
  }

  /**
   * Withdraw (cancel) a pending invitation.
   *
   * Only a current profile owner or manager may withdraw it. The invitation must be in 'Pending' status.
   */
  async withdrawInvitation(
    profileId: string,
    inviteId: string,
    actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>
  ): Promise<void> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.lockInvitationActor(client, profileId, actor);
      const changed = await client.query(
        `UPDATE profile_invitations
         SET status='Withdrawn',updated_at=clock_timestamp()
         WHERE id=$1 AND profile_id=$2 AND status='Pending'
           AND (expires_at IS NULL OR expires_at>clock_timestamp()) RETURNING id`,
        [inviteId, profileId]
      );
      if (changed.rowCount !== 1) {
        const existing = await client.query(
          'SELECT id FROM profile_invitations WHERE id=$1 AND profile_id=$2',
          [inviteId, profileId]
        );
        throw new HttpException(
          {
            error: existing.rows.length
              ? ErrorCodes.CONFLICT_STATE.code
              : ErrorCodes.NOT_FOUND_RESOURCE.code,
          },
          existing.rows.length ? 409 : 404
        );
      }
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at)
         VALUES ($1,$2,'invitation_withdrawn',$3::jsonb,$4,clock_timestamp())`,
        [
          uuidv7(),
          actor.userId,
          JSON.stringify({ profileId, inviteId }),
          correlationIdStorage.getStore() ?? uuidv7(),
        ]
      );
      // A row-lock or audit wait must not extend the invitation's decision deadline.
      const live = await client.query(
        'SELECT id FROM profile_invitations WHERE id=$1 AND (expires_at IS NULL OR expires_at>clock_timestamp())',
        [inviteId]
      );
      if (!live.rows.length)
        throw new HttpException({ error: ErrorCodes.CONFLICT_STATE.code }, 409);
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /** Profile-first locking matches acceptance, ownership and membership mutations. */
  private async lockInvitationActor(
    client: {
      query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    },
    profileId: string,
    actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>,
    inviteeUsername?: string
  ): Promise<string | undefined> {
    const profile = (
      await client.query(
        "SELECT user_id FROM profiles WHERE id=$1 AND profile_type='LEGAL' AND NOT archived FOR UPDATE",
        [profileId]
      )
    ).rows[0];
    if (!profile) throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
    // Lock known recipient and actor in one stable order before the notice's FK
    // touches either account. Opposite invitations cannot reverse this order.
    const hint = inviteeUsername
      ? (await client.query('SELECT user_id FROM users WHERE username=$1', [inviteeUsername]))
          .rows[0]
      : undefined;
    const users = inviteeUsername
      ? (
          await client.query(
            'SELECT user_id,username,disabled_at,activation_token IS NOT NULL AS activation_pending FROM users WHERE user_id=ANY($1::text[]) ORDER BY user_id FOR UPDATE',
            [[...new Set([actor.userId, ...(hint ? [hint.user_id] : [])])]]
          )
        ).rows
      : (
          await client.query(
            'SELECT user_id,disabled_at,activation_token IS NOT NULL AS activation_pending FROM users WHERE user_id=$1 FOR UPDATE',
            [actor.userId]
          )
        ).rows;
    const user = users.find((row) => row.user_id === actor.userId);
    const recipient = inviteeUsername
      ? users.find((row) => row.username === inviteeUsername)
      : undefined;
    if (!user || user.disabled_at || user.activation_pending)
      throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
    await requireCurrentSession(client, actor);
    if (profile.user_id === actor.userId) return recipient?.user_id as string | undefined;
    const manager = await client.query(
      "SELECT id FROM profile_agents WHERE profile_id=$1 AND user_id=$2 AND role='Manager' FOR SHARE",
      [profileId, actor.userId]
    );
    if (!manager.rows.length)
      throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
    return recipient?.user_id as string | undefined;
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
    actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>
  ): Promise<{ id: string }> {
    const pool = getDbPool();
    const userId = actor.userId;

    // ── Permission check first: owner or manager ────────────
    // Run before any input validation or profile lookup so that
    // unauthorized callers always receive 403 and cannot distinguish
    // between invalid input, missing profile, or forbidden access.
    const permitted = await this.isOwnerOrManager(userId, profileId);
    if (!permitted) {
      throw new HttpException(
        {
          statusCode: 403,
          error: ErrorCodes.AUTHZ_FORBIDDEN.code,
          message: 'Only owner or manager can send invitations',
        },
        403
      );
    }

    // ── Validate role ──────────────────────────────────────
    if (!AgentsService.VALID_INVITE_ROLES.has(role)) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: `Invalid role '${role}'. Must be one of: ${[...AgentsService.VALID_INVITE_ROLES].join(', ')}`,
        },
        400
      );
    }

    // ── Normalise and validate username ────────────────────
    const normalised = normalizeUsername(username);
    if (!normalised) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'Invalid username. Provide a valid email or Iranian mobile number.',
        },
        400
      );
    }

    // ── Verify the profile exists and is a LEGAL profile ────
    // (isOwnerOrManager already confirmed it's a LEGAL profile,
    //  but we verify it explicitly for clarity and safety.)
    const profileResult = await pool.query(`SELECT id, profile_type FROM profiles WHERE id = $1`, [
      profileId,
    ]);
    if (profileResult.rows.length === 0) {
      throw new HttpException(
        {
          statusCode: 404,
          error: ErrorCodes.NOT_FOUND_RESOURCE.code,
          message: 'Profile not found',
        },
        404
      );
    }
    const profile = profileResult.rows[0];
    if (profile.profile_type !== 'LEGAL') {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'Invitations are only supported for legal profiles',
        },
        400
      );
    }

    // ── Rate limit: 10 invitations/hour per profile ─────────
    const rlKey = rateLimitKey('agents:invite:profile', profileId);
    const rlResult = await this.rateLimitService.checkRateLimit(rlKey, 10, 3_600_000);
    if (!rlResult.allowed) {
      const retryAfterSeconds = Math.ceil(rlResult.resetMs / 1000);
      throw new HttpException(
        {
          statusCode: 429,
          error: ErrorCodes.RATE_LIMIT_EXCEEDED.code,
          message:
            retryAfterSeconds > 0
              ? `Too many invitations. Try again in ${retryAfterSeconds} seconds.`
              : 'Too many invitations. Try again later.',
          retryAfterMs: rlResult.resetMs,
        },
        429
      );
    }

    // ── Wrap creation and audit log in a transaction ────────
    const invitationId = uuidv7();
    const correlationId = correlationIdStorage.getStore() ?? uuidv7();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const recipientUserId = await this.lockInvitationActor(client, profileId, actor, normalised);

      // ── Check: invitee must not already be a pending invite ──
      // Check runs for both registered and unregistered users
      const pendingInvite = await client.query(
        `SELECT id FROM profile_invitations
       WHERE profile_id = $1 AND username = $2 AND status = 'Pending'`,
        [profileId, normalised]
      );
      if (pendingInvite.rows.length > 0) {
        throw new HttpException(
          {
            statusCode: 409,
            error: ErrorCodes.CONFLICT_STATE.code,
            message: 'A pending invitation already exists for this user',
          },
          409
        );
      }

      // ── Check: invitee must not already be an agent (only if registered) ──
      if (recipientUserId) {
        const inviteeUserId = recipientUserId;

        const existingAgent = await client.query(
          `SELECT id FROM profile_agents WHERE profile_id = $1 AND user_id = $2`,
          [profileId, inviteeUserId]
        );
        if (existingAgent.rows.length > 0) {
          throw new HttpException(
            {
              statusCode: 409,
              error: ErrorCodes.CONFLICT_STATE.code,
              message: 'This user is already an agent of this profile',
            },
            409
          );
        }
      }

      await client.query(
        `INSERT INTO profile_invitations (id, profile_id, username, role, invited_by, status, expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'Pending', NOW() + INTERVAL '7 days', NOW(), NOW())`,
        [invitationId, profileId, normalised, role, userId]
      );

      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, NOW())`,
        [
          uuidv7(),
          userId,
          'invitation_created',
          JSON.stringify({ profileId, invitationId, role, username: normalised }),
          correlationId,
        ]
      );

      if (recipientUserId)
        await notifyAgentInvitation(client, { recipientUserId, profileId, role });
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    this.logger.log(
      `Invitation ${invitationId} created for ${normalised} as ${role} in profile ${profileId} by user ${userId}`
    );

    return { id: invitationId };
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
      id: string;
      profileId: string;
      profileName: string;
      role: string;
      invitedBy: string;
      inviterName: string | null;
      createdAt: string;
      expiresAt: string | null;
      entity: { nationalIdentifier: string | null; registrationNumber: string | null };
    }>;
  }> {
    const pool = getDbPool();

    // Look up the user's username
    const userResult = await pool.query(`SELECT username FROM users WHERE user_id = $1`, [userId]);
    if (userResult.rows.length === 0) {
      return { invitations: [] };
    }
    const username = userResult.rows[0].username as string;

    // Query pending invitations matching this username, joined with profile and inviter info
    const result = await pool.query(
      `SELECT pi.id, pi.profile_id,
              COALESCE(lp.legal_name, NULLIF(concat_ws(' ', p.first_name, p.last_name), ''), p.id::text) AS profile_name,
              pi.role, pi.invited_by,
              u.username AS inviter_name,
              pi.created_at, pi.expires_at, lp.national_identifier, lp.registration_number
       FROM profile_invitations pi
       JOIN profiles p ON p.id = pi.profile_id
       LEFT JOIN legal_profiles lp ON lp.id = p.id
       LEFT JOIN users u ON u.user_id = pi.invited_by
       WHERE pi.username = $1 AND pi.status = 'Pending' AND (pi.expires_at IS NULL OR pi.expires_at > NOW()) AND NOT p.archived
       ORDER BY pi.created_at DESC`,
      [username]
    );

    const invitations = result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      profileId: row.profile_id as string,
      profileName: row.profile_name as string,
      role: row.role as string,
      invitedBy: row.invited_by as string,
      inviterName: (row.inviter_name as string) ?? null,
      createdAt: new Date(row.created_at as Date).toISOString(),
      expiresAt: row.expires_at ? new Date(row.expires_at as Date).toISOString() : null,
      entity: {
        nationalIdentifier: (row.national_identifier as string) ?? null,
        registrationNumber: (row.registration_number as string) ?? null,
      },
    }));

    return { invitations };
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
  async acceptInvitation(
    inviteId: string,
    actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>
  ): Promise<CreatedSession> {
    const pool = getDbPool();
    // This unlocked lookup selects only the lock scope. Recheck the full invitation below.
    const hint = await pool.query('SELECT profile_id FROM profile_invitations WHERE id=$1', [
      inviteId,
    ]);
    if (!hint.rows[0])
      throw new HttpException({ statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
    const profileId = hint.rows[0].profile_id as string;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Match ownership and role changes: profile, account, then session/membership rows.
      const profile = (
        await client.query(
          'SELECT user_id,profile_type,archived FROM profiles WHERE id=$1 FOR UPDATE',
          [profileId]
        )
      ).rows[0];
      const user = (
        await client.query('SELECT username,disabled_at FROM users WHERE user_id=$1 FOR UPDATE', [
          actor.userId,
        ])
      ).rows[0];
      const session = (
        await client.query(
          'SELECT csrf_token,revoked_at,expires_at,idle_deadline FROM sessions WHERE session_id=$1 AND user_id=$2 FOR UPDATE',
          [actor.sessionId, actor.userId]
        )
      ).rows[0];
      if (!user || user.disabled_at || !session || session.revoked_at)
        throw new HttpException(
          { statusCode: 401, error: ErrorCodes.AUTH_UNAUTHENTICATED.code },
          401
        );
      if (session.csrf_token !== actor.csrfToken)
        throw new HttpException(
          { statusCode: 403, error: ErrorCodes.AUTHZ_CSRF_INVALID.code },
          403
        );
      const invite = (
        await client.query(
          'SELECT profile_id,username,role,status,expires_at FROM profile_invitations WHERE id=$1 FOR UPDATE',
          [inviteId]
        )
      ).rows[0];
      if (!invite || invite.profile_id !== profileId || invite.username !== user.username)
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
          404
        );
      if (
        !profile ||
        profile.archived ||
        profile.profile_type !== 'LEGAL' ||
        profile.user_id === actor.userId
      )
        throw new HttpException({ statusCode: 409, error: ErrorCodes.CONFLICT_STATE.code }, 409);
      if (invite.status !== 'Pending' || !AgentsService.VALID_INVITE_ROLES.has(invite.role))
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
          400
        );
      const checkDeadlines = async () => {
        const deadlines = (
          await client.query(
            `SELECT $1::timestamptz>clock_timestamp() AND $2::timestamptz>clock_timestamp() AS active,
                  ($3::timestamptz IS NULL OR $3::timestamptz>clock_timestamp()) AS invited`,
            [session.expires_at, session.idle_deadline, invite.expires_at]
          )
        ).rows[0];
        if (!deadlines?.active)
          throw new HttpException(
            { statusCode: 401, error: ErrorCodes.AUTH_UNAUTHENTICATED.code },
            401
          );
        if (!deadlines.invited)
          throw new HttpException(
            { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
            400
          );
      };
      await checkDeadlines();
      const existing = await client.query(
        'SELECT id FROM profile_agents WHERE profile_id=$1 AND user_id=$2 FOR UPDATE',
        [profileId, actor.userId]
      );
      if (existing.rows.length)
        throw new HttpException({ statusCode: 409, error: ErrorCodes.CONFLICT_STATE.code }, 409);
      await client.query(
        "UPDATE profile_invitations SET status='Accepted',updated_at=clock_timestamp() WHERE id=$1",
        [inviteId]
      );
      await client.query(
        `INSERT INTO profile_agents(id,profile_id,user_id,role,joined_at,created_at,updated_at)
         VALUES ($1,$2,$3,$4,clock_timestamp(),clock_timestamp(),clock_timestamp())`,
        [uuidv7(), profileId, actor.userId, invite.role]
      );
      const rotated = await this.sessions.rotateSession(
        actor.sessionId,
        'profile_privilege_change',
        client
      );
      if (!rotated)
        throw new HttpException(
          { statusCode: 401, error: ErrorCodes.AUTH_UNAUTHENTICATED.code },
          401
        );
      await this.sessions.revokeAllUserSessions(actor.userId, rotated.sessionId, client);
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at)
         VALUES ($1,$2,'invitation_accepted',$3::jsonb,$4,clock_timestamp())`,
        [
          uuidv7(),
          actor.userId,
          JSON.stringify({ profileId, inviteId, role: invite.role }),
          correlationIdStorage.getStore() ?? uuidv7(),
        ]
      );
      // Keep original deadlines: intentional rotation must not extend acceptance authority.
      await checkDeadlines();
      await client.query('COMMIT');
      return rotated;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error instanceof HttpException) throw error;
      this.logger.error(`Invitation acceptance failed: ${String(error)}`);
      throw new HttpException({ statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code }, 500);
    } finally {
      client.release();
    }
  }

  /**
   * Decline a pending invitation.
   *
   * The invitation must:
   * - Be in 'Pending' status
   * - Belong to the current user (by username match)
   * - Not be expired
   */
  async declineInvitation(
    inviteId: string,
    actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>
  ): Promise<void> {
    const pool = getDbPool();
    // Locate only the lock scope; ownership and state are checked under locks below.
    const scope = (
      await pool.query('SELECT profile_id FROM profile_invitations WHERE id=$1', [inviteId])
    ).rows[0];
    if (!scope) throw new HttpException({ error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
    const profileId = scope.profile_id as string;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const profile = (
        await client.query(
          'SELECT user_id,profile_type,archived FROM profiles WHERE id=$1 FOR UPDATE',
          [profileId]
        )
      ).rows[0];
      const user = (
        await client.query(
          'SELECT username,disabled_at,activation_token IS NOT NULL AS activation_pending FROM users WHERE user_id=$1 FOR UPDATE',
          [actor.userId]
        )
      ).rows[0];
      if (!user || user.disabled_at || user.activation_pending)
        throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
      await requireCurrentSession(client, actor);
      const invitation = (
        await client.query(
          'SELECT username FROM profile_invitations WHERE id=$1 AND profile_id=$2 FOR UPDATE',
          [inviteId, profileId]
        )
      ).rows[0];
      if (!invitation || invitation.username !== user.username)
        throw new HttpException({ error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
      if (!profile || profile.profile_type !== 'LEGAL' || profile.archived)
        throw new HttpException({ error: ErrorCodes.CONFLICT_STATE.code }, 409);
      const changed = await client.query(
        `UPDATE profile_invitations SET status='Declined',updated_at=clock_timestamp()
         WHERE id=$1 AND profile_id=$2 AND username=$3 AND status='Pending'
           AND (expires_at IS NULL OR expires_at>clock_timestamp()) RETURNING id`,
        [inviteId, profileId, user.username]
      );
      if (changed.rowCount !== 1)
        throw new HttpException({ error: ErrorCodes.CONFLICT_STATE.code }, 409);
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at)
         VALUES ($1,$2,'invitation_declined',$3::jsonb,$4,clock_timestamp())`,
        [
          uuidv7(),
          actor.userId,
          JSON.stringify({ profileId, inviteId }),
          correlationIdStorage.getStore() ?? uuidv7(),
        ]
      );
      const live = await client.query(
        'SELECT id FROM profile_invitations WHERE id=$1 AND (expires_at IS NULL OR expires_at>clock_timestamp())',
        [inviteId]
      );
      if (!live.rows.length)
        throw new HttpException({ error: ErrorCodes.CONFLICT_STATE.code }, 409);
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Return the agent roles (from profile_agents) for a given user in a
   * given profile. Returns an empty array when the user is not an agent.
   * Used by the AgentRoleGuard to enforce role-based permissions.
   */
  async getAgentRoles(profileId: string, userId: string): Promise<AgentRole[]> {
    const pool = getDbPool();
    const result = await pool.query(
      `SELECT 'Owner' AS role FROM profiles WHERE id=$1 AND user_id=$2 AND NOT archived
       UNION ALL SELECT pa.role FROM profile_agents pa JOIN profiles p ON p.id=pa.profile_id
       WHERE pa.profile_id=$1 AND pa.user_id=$2 AND NOT p.archived AND p.profile_type='LEGAL'
         AND pa.role IN ('Manager','Finance','Legal')`,
      [profileId, userId]
    );
    return result.rows.map((row) => row.role as AgentRole);
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
    actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>
  ): Promise<{ id: string }> {
    const pool = getDbPool();
    const userId = actor.userId;

    // ── Verify the profile exists ───────────────────────────────
    const profileResult = await pool.query(
      `SELECT id, user_id, profile_type FROM profiles WHERE id = $1`,
      [profileId]
    );
    if (profileResult.rows.length === 0) {
      throw new HttpException(
        {
          statusCode: 404,
          error: ErrorCodes.NOT_FOUND_RESOURCE.code,
          message: 'Profile not found',
        },
        404
      );
    }
    const profile = profileResult.rows[0];

    // ── Verify the caller is the profile owner (before type check — 403 blanket) ──
    if (profile.user_id !== userId) {
      throw new HttpException(
        {
          statusCode: 403,
          error: ErrorCodes.AUTHZ_FORBIDDEN.code,
          message: 'Only the profile owner can initiate an ownership transfer',
        },
        403
      );
    }

    // ── Verify the profile is a LEGAL profile ───────────────────
    if (profile.profile_type !== 'LEGAL') {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'Ownership transfer is only supported for legal profiles',
        },
        400
      );
    }

    // ── Guard: self-transfer ────────────────────────────────────
    if (newOwnerUserId === userId) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'Cannot transfer ownership to yourself',
        },
        400
      );
    }

    // ── Verify the target user is an existing agent of the profile ──
    const agentResult = await pool.query(
      `SELECT id, role FROM profile_agents WHERE profile_id = $1 AND user_id = $2 AND role IN ('Manager','Finance','Legal')`,
      [profileId, newOwnerUserId]
    );
    if (agentResult.rows.length === 0) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'The new owner must be an existing agent of this profile',
        },
        400
      );
    }

    // ── Check: no pending transfer already exists ────────────────
    const pendingResult = await pool.query(
      `SELECT id FROM profile_ownership_transfers
       WHERE profile_id = $1 AND status = 'Pending' AND expires_at > NOW()`,
      [profileId]
    );
    if (pendingResult.rows.length > 0) {
      throw new HttpException(
        {
          statusCode: 409,
          error: ErrorCodes.CONFLICT_STATE.code,
          message: 'A pending ownership transfer already exists for this profile',
        },
        409
      );
    }

    // ── Wrap creation and audit log in a transaction ──────────────
    const transferId = uuidv7();
    const correlationId = correlationIdStorage.getStore() ?? uuidv7();
    const client = await pool.connect();
    let transactionStarted = false;
    try {
      await client.query('BEGIN');
      transactionStarted = true;

      // Recheck authority while holding the profile lock through the write.
      const lockedProfile = await client.query(
        `SELECT user_id FROM profiles WHERE id=$1 AND profile_type='LEGAL' AND NOT archived FOR UPDATE`,
        [profileId]
      );
      if (lockedProfile.rows[0]?.user_id !== userId) {
        throw new HttpException({ statusCode: 409, error: ErrorCodes.CONFLICT_STATE.code }, 409);
      }
      const stepUpVerifiedAt = await this.requireOwnershipStepUp(client, actor, [newOwnerUserId]);
      const target = await client.query(
        `SELECT pa.id FROM profile_agents pa JOIN users u ON u.user_id=pa.user_id
         WHERE pa.profile_id=$1 AND pa.user_id=$2 AND pa.role IN ('Manager','Finance','Legal') AND u.disabled_at IS NULL AND u.activation_token IS NULL FOR SHARE OF pa,u`,
        [profileId, newOwnerUserId]
      );
      if (!target.rows.length)
        throw new HttpException({ statusCode: 409, error: ErrorCodes.CONFLICT_STATE.code }, 409);
      await client.query(
        `WITH expired AS (
           UPDATE profile_ownership_transfers SET status='Expired',updated_at=NOW()
           WHERE profile_id=$1 AND status='Pending' AND expires_at<=clock_timestamp() RETURNING id
         ) INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at)
           SELECT uuid_generate_v7(),$2,'ownership_transfer_expired',jsonb_build_object('transferId',id,'profileId',$1::text,'stepUpVerified',true,'stepUpVerifiedAt',$4::text),$3::uuid,clock_timestamp() FROM expired`,
        [profileId, userId, correlationId, stepUpVerifiedAt.toISOString()]
      );

      await client.query(
        `INSERT INTO profile_ownership_transfers (id, profile_id, from_user_id, to_user_id, status, expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'Pending', NOW() + INTERVAL '7 days', NOW(), NOW())`,
        [transferId, profileId, userId, newOwnerUserId]
      );

      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, NOW())`,
        [
          uuidv7(),
          userId,
          'ownership_transfer_initiated',
          JSON.stringify({
            profileId,
            transferId,
            toUserId: newOwnerUserId,
            stepUpVerified: true,
            stepUpVerifiedAt: stepUpVerifiedAt.toISOString(),
          }),
          correlationId,
        ]
      );

      await requireSessionStepUp(client, actor);
      await client.query('COMMIT');
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* ignore rollback failure */
        }
      }
      // A concurrent double-submit may pass the pre-check and hit the partial
      // unique index here. Convert the PG unique_violation to a proper 409
      // instead of surfacing a raw 500.
      const pgError = error as { code?: string };
      if (pgError.code === '23505') {
        throw new HttpException(
          {
            statusCode: 409,
            error: ErrorCodes.CONFLICT_STATE.code,
            message: 'A pending ownership transfer already exists for this profile',
          },
          409
        );
      }
      throw error;
    } finally {
      client.release();
    }

    this.logger.log(
      `Ownership transfer ${transferId} initiated for profile ${profileId} from user ${userId} to ${newOwnerUserId}`
    );

    return { id: transferId };
  }

  async listOwnershipTransfers(userId: string) {
    const result = await getDbPool().query(
      `SELECT t.id,t.profile_id,t.from_user_id,t.to_user_id,t.expires_at,
              COALESCE(l.legal_name,p.id::text) AS profile_name
       FROM profile_ownership_transfers t JOIN profiles p ON p.id=t.profile_id
       LEFT JOIN legal_profiles l ON l.id=p.id
       WHERE t.status='Pending' AND t.expires_at>NOW() AND NOT p.archived
         AND (t.from_user_id=$1 OR t.to_user_id=$1) ORDER BY t.created_at DESC`,
      [userId]
    );
    return {
      transfers: result.rows.map((r) => ({
        id: r.id,
        profileId: r.profile_id,
        fromUserId: r.from_user_id,
        toUserId: r.to_user_id,
        expiresAt: r.expires_at,
        profileName: r.profile_name,
        direction: r.to_user_id === userId ? 'incoming' : 'outgoing',
      })),
    };
  }

  private async requireOwnershipStepUp(
    client: {
      query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    },
    actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>,
    parties: string[]
  ): Promise<Date> {
    const users = await client.query(
      `SELECT user_id,disabled_at,activation_token IS NOT NULL AS activation_pending
       FROM users WHERE user_id=ANY($1::text[]) ORDER BY user_id FOR UPDATE`,
      [[...new Set([actor.userId, ...parties])]]
    );
    const current = users.rows.find((row) => row.user_id === actor.userId);
    if (!current || current.disabled_at || current.activation_pending)
      throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
    return requireSessionStepUp(client, actor);
  }

  async resolveOwnershipTransfer(
    profileId: string,
    transferId: string,
    actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>,
    decision: 'accept' | 'decline' | 'cancel'
  ): Promise<{ status: string }> {
    const userId = actor.userId;
    const correlationId = correlationIdStorage.getStore() ?? uuidv7();
    const client = await getDbPool().connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      // Every transfer decision locks the profile before the transfer itself.
      const profile = (
        await client.query(
          `SELECT user_id,profile_type,archived FROM profiles WHERE id=$1 FOR UPDATE`,
          [profileId]
        )
      ).rows[0];
      const transfer = (
        await client.query(
          `SELECT * FROM profile_ownership_transfers WHERE id=$1 AND profile_id=$2 FOR UPDATE`,
          [transferId, profileId]
        )
      ).rows[0];
      if (
        !profile ||
        !transfer ||
        (decision === 'cancel' ? transfer.from_user_id : transfer.to_user_id) !== userId
      ) {
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
          404
        );
      }
      if (
        transfer.status !== 'Pending' ||
        profile.user_id !== transfer.from_user_id ||
        profile.profile_type !== 'LEGAL' ||
        profile.archived
      ) {
        throw new HttpException({ statusCode: 409, error: ErrorCodes.CONFLICT_STATE.code }, 409);
      }
      const stepUpVerifiedAt = await this.requireOwnershipStepUp(client, actor, [
        transfer.from_user_id,
        transfer.to_user_id,
      ]);
      let targetExists = true;
      if (decision === 'accept') {
        const target = await client.query(
          `SELECT pa.id FROM profile_agents pa JOIN users u ON u.user_id=pa.user_id
           WHERE pa.profile_id=$1 AND pa.user_id=$2 AND pa.role IN ('Manager','Finance','Legal') AND u.disabled_at IS NULL AND u.activation_token IS NULL FOR UPDATE OF pa FOR SHARE OF u`,
          [profileId, transfer.to_user_id]
        );
        targetExists = target.rows.length > 0;
      }
      // Check time after every possible lock wait, before applying ownership.
      let expired = (
        await client.query('SELECT $1::timestamptz<=clock_timestamp() AS expired', [
          transfer.expires_at,
        ])
      ).rows[0].expired;
      let status = expired
        ? 'Expired'
        : decision === 'accept'
          ? 'Completed'
          : decision === 'decline'
            ? 'Declined'
            : 'Cancelled';
      await client.query('SAVEPOINT ownership_decision');
      let revokedAt: Date | undefined;
      if (status === 'Completed') {
        if (!targetExists)
          throw new HttpException({ statusCode: 409, error: ErrorCodes.CONFLICT_STATE.code }, 409);
        revokedAt = new Date();
        // The profile changes owner, never acquires a second one. Both users
        // choose their context again after applicable sessions are revoked.
        await client.query(
          'UPDATE profiles SET user_id=$2,is_default=false,updated_at=NOW() WHERE id=$1',
          [profileId, transfer.to_user_id]
        );
        await client.query("DELETE FROM profile_agents WHERE profile_id=$1 AND role='Owner'", [
          profileId,
        ]);
        await client.query(
          `UPDATE sessions SET revoked_at=$2,updated_at=$2
          WHERE user_id=ANY($1::text[]) AND revoked_at IS NULL`,
          [[transfer.from_user_id, transfer.to_user_id], revokedAt]
        );
        await client.query(
          `UPDATE refresh_tokens SET consumed_at=$2
          WHERE user_id=ANY($1::text[]) AND consumed_at IS NULL`,
          [[transfer.from_user_id, transfer.to_user_id], revokedAt]
        );
      }
      const recordDecision = async () => {
        await client.query(
          `UPDATE profile_ownership_transfers SET status=$2,updated_at=NOW(),
        completed_at=CASE WHEN $2='Completed' THEN NOW() ELSE completed_at END,
        declined_at=CASE WHEN $2='Declined' THEN NOW() ELSE declined_at END,
        cancelled_at=CASE WHEN $2='Cancelled' THEN NOW() ELSE cancelled_at END WHERE id=$1`,
          [transferId, status]
        );
        await client.query(
          `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at)
        VALUES ($1,$2,$3,$4::jsonb,$5,NOW())`,
          [
            uuidv7(),
            userId,
            `ownership_transfer_${status.toLowerCase()}`,
            JSON.stringify({
              profileId,
              transferId,
              fromUserId: transfer.from_user_id,
              toUserId: transfer.to_user_id,
              stepUpVerified: true,
              stepUpVerifiedAt: stepUpVerifiedAt.toISOString(),
            }),
            correlationId,
          ]
        );
      };
      await recordDecision();
      // Discard a decision that expires during writes, while retaining the locks
      // acquired before this savepoint and recording only the expired outcome.
      if (
        !expired &&
        (
          await client.query('SELECT $1::timestamptz<=clock_timestamp() AS expired', [
            transfer.expires_at,
          ])
        ).rows[0].expired
      ) {
        await client.query('ROLLBACK TO SAVEPOINT ownership_decision');
        expired = true;
        status = 'Expired';
        revokedAt = undefined;
        await recordDecision();
      }
      await requireSessionStepUp(client, actor, revokedAt);
      await client.query('COMMIT');
      committed = true;
      if (expired)
        throw new HttpException(
          {
            statusCode: 409,
            error: ErrorCodes.CONFLICT_STATE.code,
            message: 'Ownership transfer expired',
          },
          409
        );
      return { status };
    } catch (error) {
      if (!committed) await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /** Replace only non-owner memberships; preserve unchanged association IDs. */
  async setAgentRoles(
    profileId: string,
    targetUserId: string,
    roles: string[],
    actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>
  ): Promise<{ sessionRevoked: boolean }> {
    if (
      roles.some((role) => !AgentsService.VALID_INVITE_ROLES.has(role)) ||
      new Set(roles).size !== roles.length
    ) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
        400
      );
    }
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const profile = (
        await client.query(
          `SELECT user_id FROM profiles WHERE id=$1 AND profile_type='LEGAL' AND NOT archived FOR UPDATE`,
          [profileId]
        )
      ).rows[0];
      if (!profile)
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
          404
        );
      // Match invitation/ownership locking: profile, sorted accounts, then session/memberships.
      const users = await client.query(
        `SELECT user_id,disabled_at,activation_token IS NOT NULL AS activation_pending
         FROM users WHERE user_id=ANY($1::text[]) ORDER BY user_id FOR UPDATE`,
        [[...new Set([actor.userId, targetUserId])]]
      );
      const currentActor = users.rows.find((row) => row.user_id === actor.userId);
      if (!currentActor || currentActor.disabled_at || currentActor.activation_pending)
        throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
      const stepUpVerifiedAt = await requireSessionStepUp(client, actor);
      if (profile.user_id !== actor.userId) {
        const manager = await client.query(
          `SELECT id FROM profile_agents WHERE profile_id=$1 AND user_id=$2 AND role='Manager' FOR SHARE`,
          [profileId, actor.userId]
        );
        if (!manager.rows.length)
          throw new HttpException({ statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
      }
      if (profile.user_id === targetUserId) {
        throw new HttpException(
          {
            statusCode: 409,
            error: ErrorCodes.CONFLICT_STATE.code,
            message: 'The current owner cannot be removed or reassigned as an agent',
          },
          409
        );
      }
      const existing = await client.query(
        'SELECT id,role FROM profile_agents WHERE profile_id=$1 AND user_id=$2 FOR UPDATE',
        [profileId, targetUserId]
      );
      if (!existing.rows.length)
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
          404
        );
      const previousRoles = existing.rows.map((row) => row.role as string);
      if (
        previousRoles.length === roles.length &&
        previousRoles.every((role) => roles.includes(role))
      ) {
        await requireSessionStepUp(client, actor);
        await client.query('COMMIT');
        return { sessionRevoked: false };
      }
      await client.query(
        'DELETE FROM profile_agents WHERE profile_id=$1 AND user_id=$2 AND NOT (role=ANY($3::text[]))',
        [profileId, targetUserId, roles]
      );
      const revokedAt = new Date();
      await client.query(
        'UPDATE sessions SET revoked_at=$2,updated_at=$2 WHERE user_id=$1 AND revoked_at IS NULL',
        [targetUserId, revokedAt]
      );
      await client.query(
        'UPDATE refresh_tokens SET consumed_at=$2 WHERE user_id=$1 AND consumed_at IS NULL',
        [targetUserId, revokedAt]
      );
      await client.query(
        `INSERT INTO profile_agents(id,profile_id,user_id,role,joined_at,created_at,updated_at)
        SELECT uuid_generate_v7(),$1,$2,role,NOW(),NOW(),NOW() FROM unnest($3::text[]) AS role
        ON CONFLICT (profile_id,user_id,role) DO NOTHING`,
        [profileId, targetUserId, roles]
      );
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at)
        VALUES (uuid_generate_v7(),$1,$2,$3::jsonb,$4,clock_timestamp())`,
        [
          actor.userId,
          roles.length ? 'agent_roles_changed' : 'agent_removed',
          JSON.stringify({
            profileId,
            targetUserId,
            before: existing.rows.map((r) => r.role),
            after: roles,
            stepUpVerified: true,
            stepUpVerifiedAt: stepUpVerifiedAt.toISOString(),
          }),
          correlationIdStorage.getStore() ?? uuidv7(),
        ]
      );
      const sessionRevoked = actor.userId === targetUserId;
      await requireSessionStepUp(client, actor, sessionRevoked ? revokedAt : undefined);
      await client.query('COMMIT');
      return { sessionRevoked };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
