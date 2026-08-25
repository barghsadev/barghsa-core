import {
  Injectable,
  Logger,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common'
import { randomBytes, createHash } from 'node:crypto'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'

/** Session idle timeout: 30 minutes */
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000
/** Session absolute timeout: 24 hours */
export const SESSION_ABSOLUTE_TIMEOUT_MS = 24 * 60 * 60 * 1000
/** Refresh token length (bytes before hex encoding) */
const REFRESH_TOKEN_BYTES = 32
/** CSRF token length (bytes before hex encoding) */
const CSRF_TOKEN_BYTES = 32
/** Max sessions per user to prevent resource abuse */
const MAX_SESSIONS_PER_USER = 50

/** Active session data returned from validation. */
export interface ValidatedSession {
  sessionId: string
  userId: string
  csrfToken: string
  isAdmin: boolean
  expiresAt: Date
  idleDeadline: Date
}

/** Device info metadata stored with the session. */
export interface DeviceInfo {
  ip?: string
  userAgent?: string
  fingerprint?: string
}

/** Result of creating a new session. */
export interface CreatedSession {
  sessionId: string
  csrfToken: string
  refreshToken: string
  expiresAt: Date
}

/** Result of rotating a refresh token. */
export interface RefreshResult {
  refreshToken: string
  sessionId: string
}

/**
 * Centralized session service (T-02.02.01).
 *
 * Handles server-side session creation, validation, rotation,
 * refresh token rotation with reuse detection, and revocation.
 *
 * Session lifecycle:
 *   Created (login / register) → Touched (on each request) → Revoked (logout / admin)
 *
 * Refresh token lifecycle:
 *   Issued with session → Redeemed (rotated on use) → Family revoked on reuse
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name)

  /**
   * Create a new session for a user.
   *
   * Generates:
   * - An opaque UUIDv7 session identifier (stored in HttpOnly cookie).
   * - A CSRF token (32 random bytes hex).
   * - A refresh token (32 random bytes hex).
   * - A token family ID (UUIDv7).
   *
   * Enforces a maximum of 50 sessions per user to prevent resource
   * abuse / session hijacking accumulation.
   *
   * Returns the session identifier, CSRF token, refresh token, and
   * expiry timestamp so the controller can set the cookie and return
   * the credentials to the frontend.
   */
  async createSession(
    userId: string,
    isAdmin: boolean,
    deviceInfo?: DeviceInfo,
  ): Promise<CreatedSession> {
    const pool = getDbPool()

    const sessionId = uuidv7()
    const csrfToken = randomBytes(CSRF_TOKEN_BYTES).toString('hex')
    const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('hex')
    const refreshTokenHash = createHash('sha256').update(refreshToken).digest('hex')
    const familyId = uuidv7()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_TIMEOUT_MS)
    const idleDeadline = new Date(now.getTime() + SESSION_IDLE_TIMEOUT_MS)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // 1. Enforce session limit per user
      // Lock all active sessions for this user to prevent concurrent
      // createSession calls from racing past the limit check.
      const lockResult = await client.query(
        `SELECT session_id
         FROM sessions
         WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
         FOR UPDATE`,
        [userId],
      )
      const currentCount = lockResult.rows.length
      if (currentCount >= MAX_SESSIONS_PER_USER) {
        // Revoke the oldest active session to make room
        await client.query(
          `UPDATE sessions
           SET revoked_at = $1, updated_at = $1
           WHERE session_id = (
             SELECT session_id FROM sessions
             WHERE user_id = $2 AND revoked_at IS NULL AND expires_at > NOW()
             ORDER BY created_at ASC
             LIMIT 1
           )`,
          [now, userId],
        )
        this.logger.warn(
          `Session limit (${MAX_SESSIONS_PER_USER}) reached for user ${userId}; ` +
            `revoked oldest session to create new one.`,
        )
      }

      // 2. Insert session
      await client.query(
        `INSERT INTO sessions
         (session_id, user_id, csrf_token, refresh_token_hash, family_id,
          device_info, expires_at, idle_deadline, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $9)`,
        [
          sessionId,
          userId,
          csrfToken,
          refreshTokenHash,
          familyId,
          deviceInfo ? JSON.stringify(deviceInfo) : null,
          expiresAt,
          idleDeadline,
          now,
        ],
      )

      // 3. Insert initial refresh token record
      const tokenId = uuidv7()
      await client.query(
        `INSERT INTO refresh_tokens
         (id, family_id, token_hash, user_id, session_id, version, created_at)
         VALUES ($1, $2, $3, $4, $5, 1, $6)`,
        [tokenId, familyId, refreshTokenHash, userId, sessionId, now],
      )

      await client.query('COMMIT')

      this.logger.log(`Session created: ${sessionId} for user ${userId}`)

      return { sessionId, csrfToken, refreshToken, expiresAt }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      this.logger.error(`Failed to create session for user ${userId}: ${String(err)}`)
      throw new HttpException(
        { statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code },
        500,
      )
    } finally {
      client.release()
    }
  }

  /**
   * Validate a session from its opaque identifier.
   *
   * Checks:
   * 1. Session exists in the database.
   * 2. Session is not revoked (revoked_at is null).
   * 3. Absolute expiry has not passed.
   * 4. Idle deadline has not passed.
   *
   * If the idle deadline has passed but the absolute expiry hasn't,
   * the session is still considered expired (idle timeout has priority).
   * The user must re-authenticate.
   *
   * On success, returns the validated session data and automatically
   * extends the idle deadline (touch) for the next request.
   */
  async validateSession(
    sessionId: string,
    touchOnValidate = true,
  ): Promise<ValidatedSession | null> {
    const pool = getDbPool()
    const now = new Date()

    try {
      const result = await pool.query(
        `SELECT s.session_id, s.user_id, s.csrf_token,
                u.is_admin,
                s.expires_at, s.idle_deadline, s.revoked_at
         FROM sessions s
         JOIN users u ON u.user_id = s.user_id
         WHERE s.session_id = $1
         LIMIT 1`,
        [sessionId],
      )

      if (result.rows.length === 0) {
        return null
      }

      const row = result.rows[0]

      // Check revocation
      if (row.revoked_at) {
        return null
      }

      // Check absolute expiry
      if (new Date(row.expires_at) <= now) {
        return null
      }

      // Check idle timeout
      if (new Date(row.idle_deadline) <= now) {
        return null
      }

      // Touch the session (extend idle deadline) if requested
      if (touchOnValidate) {
        const newIdleDeadline = new Date(now.getTime() + SESSION_IDLE_TIMEOUT_MS)
        await pool.query(
          `UPDATE sessions
           SET idle_deadline = $1, updated_at = $2
           WHERE session_id = $3`,
          [newIdleDeadline, now, sessionId],
        )
      }

      return {
        sessionId: row.session_id,
        userId: row.user_id,
        csrfToken: row.csrf_token,
        isAdmin: row.is_admin ?? false,
        expiresAt: row.expires_at,
        idleDeadline: row.idle_deadline,
      }
    } catch (err) {
      this.logger.error(`Failed to validate session ${sessionId}: ${String(err)}`)
      // On transient DB errors, return null (conservative — force re-auth)
      return null
    }
  }

  /**
   * Rotate a session identifier (session rotation).
   *
   * Called on: login, MFA step-up, password change, privilege change,
   * and account recovery.
   *
   * This creates a new session record with a fresh UUIDv7, copies the
   * CSRF token and refresh token family, then revokes the old session.
   * The old session's CSRF token is also rotated to prevent replay.
   *
   * NOTE: This is not yet wired into all auth events (login, registration,
   * password change) — the initial refactor in T-02.02.01 creates the
   * infrastructure. Full session rotation wiring across all events is
   * completed in T-02.02.02 (Session revocation).
   */
  async rotateSession(
    oldSessionId: string,
    reason: string,
  ): Promise<CreatedSession | null> {
    const pool = getDbPool()
    const now = new Date()

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // 1. Fetch and lock the old session
      const oldResult = await client.query(
        `SELECT session_id, user_id, csrf_token, family_id,
                device_info, expires_at, idle_deadline
         FROM sessions
         WHERE session_id = $1 AND revoked_at IS NULL
         FOR UPDATE`,
        [oldSessionId],
      )

      if (oldResult.rows.length === 0) {
        await client.query('ROLLBACK')
        return null
      }

      const oldRow = oldResult.rows[0]

      // 2. Revoke the old session
      await client.query(
        `UPDATE sessions
         SET revoked_at = $1, updated_at = $1
         WHERE session_id = $2`,
        [now, oldSessionId],
      )

      // 3. Create a new session with fresh identifier and CSRF token
      const newSessionId = uuidv7()
      const newCsrfToken = randomBytes(CSRF_TOKEN_BYTES).toString('hex')
      const newRefreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('hex')
      const newRefreshTokenHash = createHash('sha256').update(newRefreshToken).digest('hex')
      const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_TIMEOUT_MS)
      const idleDeadline = new Date(now.getTime() + SESSION_IDLE_TIMEOUT_MS)
      const familyId = oldRow.family_id ?? uuidv7()

      await client.query(
        `INSERT INTO sessions
         (session_id, user_id, csrf_token, refresh_token_hash, family_id,
          device_info, expires_at, idle_deadline, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $9)`,
        [
          newSessionId,
          oldRow.user_id,
          newCsrfToken,
          newRefreshTokenHash,
          familyId,
          oldRow.device_info,
          expiresAt,
          idleDeadline,
          now,
        ],
      )

      // 4. Insert new refresh token record (next version in the same family)
      const verResult = await client.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next_ver
         FROM refresh_tokens
         WHERE family_id = $1`,
        [familyId],
      )
      const nextVersion = Number(verResult.rows[0]?.next_ver ?? 1)

      const tokenId = uuidv7()
      await client.query(
        `INSERT INTO refresh_tokens
         (id, family_id, token_hash, user_id, session_id, version, consumed_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tokenId, familyId, newRefreshTokenHash, oldRow.user_id, newSessionId, nextVersion, now],
      )

      // 5. Consume all previous refresh tokens in this family (they're now rotated)
      await client.query(
        `UPDATE refresh_tokens
         SET consumed_at = $1
         WHERE family_id = $2 AND consumed_at IS NULL AND id != $3`,
        [now, familyId, tokenId],
      )

      await client.query('COMMIT')

      this.logger.log(
        `Session rotated: ${oldSessionId} → ${newSessionId} (reason: ${reason}) for user ${oldRow.user_id}`,
      )

      return {
        sessionId: newSessionId,
        csrfToken: newCsrfToken,
        refreshToken: newRefreshToken,
        expiresAt,
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      this.logger.error(`Failed to rotate session ${oldSessionId}: ${String(err)}`)
      throw new HttpException(
        { statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code },
        500,
      )
    } finally {
      client.release()
    }
  }

  /**
   * Redeem a refresh token.
   *
   * Implements refresh token rotation:
   * 1. Look up the token by its SHA-256 hash.
   * 2. If the token is already consumed (rotation detected), it means
   *    the previous refresh token in this family was reused — potential
   *    token theft. The entire family is revoked and the user is alerted.
   * 3. If the token is valid: consume it, look up the session, verify
   *    the session is still active, then issue a new refresh token.
   *
   * Returns the new refresh token and session ID.
   * The caller should also update the CSRF token on the session.
   */
  async redeemRefreshToken(token: string): Promise<RefreshResult> {
    const pool = getDbPool()
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const now = new Date()

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // 1. Look up the token, lock for update
      const tokenResult = await client.query(
        `SELECT id, family_id, user_id, session_id, version, consumed_at
         FROM refresh_tokens
         WHERE token_hash = $1
         FOR UPDATE`,
        [tokenHash],
      )

      if (tokenResult.rows.length === 0) {
        await client.query('ROLLBACK')
        throw new UnauthorizedException({
          statusCode: 401,
          error: ErrorCodes.AUTH_TOKEN_INVALID.code,
        })
      }

      const tokenRow = tokenResult.rows[0]

      // 2. Check for token reuse (already consumed)
      if (tokenRow.consumed_at) {
        // Token theft detected — revoke the entire family
        await client.query(
          `UPDATE refresh_tokens
           SET consumed_at = $1
           WHERE family_id = $2 AND consumed_at IS NULL`,
          [now, tokenRow.family_id],
        )

        // Revoke all sessions in this family
        await client.query(
          `UPDATE sessions
           SET revoked_at = $1, updated_at = $1
           WHERE family_id = $2 AND revoked_at IS NULL`,
          [now, tokenRow.family_id],
        )

        await client.query('COMMIT')

        this.logger.warn(
          `Refresh token reuse detected! Token family ${tokenRow.family_id} ` +
            `for user ${tokenRow.user_id} revoked. Potential token theft.`,
        )

        throw new UnauthorizedException({
          statusCode: 401,
          error: ErrorCodes.AUTH_TOKEN_INVALID.code,
        })
      }

      // 3. Check that the associated session is still valid
      const sessionResult = await client.query(
        `SELECT session_id, expires_at, idle_deadline, revoked_at
         FROM sessions
         WHERE session_id = $1
         FOR UPDATE`,
        [tokenRow.session_id],
      )

      if (sessionResult.rows.length === 0) {
        await client.query('ROLLBACK')
        throw new UnauthorizedException({
          statusCode: 401,
          error: ErrorCodes.AUTH_TOKEN_INVALID.code,
        })
      }

      const sessionRow = sessionResult.rows[0]

      if (sessionRow.revoked_at || new Date(sessionRow.expires_at) <= now) {
        await client.query('ROLLBACK')
        throw new UnauthorizedException({
          statusCode: 401,
          error: ErrorCodes.AUTH_TOKEN_EXPIRED.code,
        })
      }

      // 4. Consume the current token
      await client.query(
        `UPDATE refresh_tokens
         SET consumed_at = $1
         WHERE id = $2`,
        [now, tokenRow.id],
      )

      // 5. Generate a new refresh token in the same family
      const newToken = randomBytes(REFRESH_TOKEN_BYTES).toString('hex')
      const newTokenHash = createHash('sha256').update(newToken).digest('hex')
      const newTokenId = uuidv7()

      await client.query(
        `INSERT INTO refresh_tokens
         (id, family_id, token_hash, user_id, session_id, version, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          newTokenId,
          tokenRow.family_id,
          newTokenHash,
          tokenRow.user_id,
          tokenRow.session_id,
          tokenRow.version + 1,
          now,
        ],
      )

      // 6. Update the session's refresh token hash
      await client.query(
        `UPDATE sessions
         SET refresh_token_hash = $1, idle_deadline = $2, updated_at = $3
         WHERE session_id = $4`,
        [
          newTokenHash,
          new Date(now.getTime() + SESSION_IDLE_TIMEOUT_MS),
          now,
          tokenRow.session_id,
        ],
      )

      await client.query('COMMIT')

      return {
        refreshToken: newToken,
        sessionId: tokenRow.session_id,
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      if (err instanceof UnauthorizedException) throw err
      this.logger.error(`Failed to redeem refresh token: ${String(err)}`)
      throw new HttpException(
        { statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code },
        500,
      )
    } finally {
      client.release()
    }
  }

  /**
   * Revoke a single session by ID.
   *
   * Also consumes all active refresh tokens in the session's family.
   */
  async revokeSession(sessionId: string): Promise<void> {
    const pool = getDbPool()
    const now = new Date()

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Fetch family ID before revoking
      const sessionResult = await client.query(
        `SELECT family_id FROM sessions WHERE session_id = $1 FOR UPDATE`,
        [sessionId],
      )

      if (sessionResult.rows.length === 0) {
        await client.query('ROLLBACK')
        return
      }

      const familyId = sessionResult.rows[0].family_id

      // Revoke the session
      await client.query(
        `UPDATE sessions
         SET revoked_at = $1, updated_at = $1
         WHERE session_id = $2`,
        [now, sessionId],
      )

      // Consume all active tokens in this family
      if (familyId) {
        await client.query(
          `UPDATE refresh_tokens
           SET consumed_at = $1
           WHERE family_id = $2 AND consumed_at IS NULL`,
          [now, familyId],
        )
      }

      await client.query('COMMIT')

      this.logger.log(`Session revoked: ${sessionId}`)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      this.logger.error(`Failed to revoke session ${sessionId}: ${String(err)}`)
      throw new HttpException(
        { statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code },
        500,
      )
    } finally {
      client.release()
    }
  }

  /**
   * Revoke all active sessions for a user.
   *
   * Optionally excludes a specific session (e.g. the current one).
   * Also consumes all active refresh tokens for the user.
   */
  async revokeAllUserSessions(
    userId: string,
    excludeSessionId?: string,
  ): Promise<void> {
    const pool = getDbPool()
    const now = new Date()

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Revoke all sessions except the excluded one
      if (excludeSessionId) {
        await client.query(
          `UPDATE sessions
           SET revoked_at = $1, updated_at = $1
           WHERE user_id = $2 AND revoked_at IS NULL
             AND session_id != $3`,
          [now, userId, excludeSessionId],
        )
      } else {
        await client.query(
          `UPDATE sessions
           SET revoked_at = $1, updated_at = $1
           WHERE user_id = $2 AND revoked_at IS NULL`,
          [now, userId],
        )
      }

      // Consume all active refresh tokens for this user
      await client.query(
        `UPDATE refresh_tokens
         SET consumed_at = $1
         WHERE user_id = $2 AND consumed_at IS NULL`,
        [now, userId],
      )

      await client.query('COMMIT')

      this.logger.log(`All sessions revoked for user ${userId}`)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      this.logger.error(
        `Failed to revoke all sessions for user ${userId}: ${String(err)}`,
      )
      throw new HttpException(
        { statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code },
        500,
      )
    } finally {
      client.release()
    }
  }

  /**
   * Revoke all sessions sharing the same refresh token family.
   *
   * Called when token reuse is detected (potential theft).
   */
  async revokeFamily(familyId: string): Promise<void> {
    const pool = getDbPool()
    const now = new Date()

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      await client.query(
        `UPDATE sessions
         SET revoked_at = $1, updated_at = $1
         WHERE family_id = $2 AND revoked_at IS NULL`,
        [now, familyId],
      )

      await client.query(
        `UPDATE refresh_tokens
         SET consumed_at = $1
         WHERE family_id = $2 AND consumed_at IS NULL`,
        [now, familyId],
      )

      await client.query('COMMIT')

      this.logger.warn(`Token family revoked: ${familyId}`)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      this.logger.error(`Failed to revoke token family ${familyId}: ${String(err)}`)
      throw new HttpException(
        { statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code },
        500,
      )
    } finally {
      client.release()
    }
  }

  /**
   * Clean up expired and idle-expired sessions.
   *
   * Removes sessions where the absolute expiry or idle deadline has passed,
   * and where revocation was recorded more than 30 days ago.
   *
   * Also removes orphaned refresh tokens (tokens whose session has been
   * deleted or where the token has been consumed for > 30 days).
   *
   * Designed for periodic cleanup (e.g. every hour via cron).
   */
  async cleanupExpired(): Promise<{ deletedSessions: number; deletedTokens: number }> {
    const pool = getDbPool()
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    try {
      // Delete expired sessions (absolute or idle timeout)
      const sessionResult = await pool.query(
        `DELETE FROM sessions
         WHERE (expires_at <= $1 OR idle_deadline <= $1 OR
                (revoked_at IS NOT NULL AND revoked_at <= $2))
           AND created_at < $1`,
        [now, thirtyDaysAgo],
      )

      // Delete orphaned or consumed refresh tokens
      const tokenResult = await pool.query(
        `DELETE FROM refresh_tokens
         WHERE consumed_at IS NOT NULL AND consumed_at <= $1`,
        [thirtyDaysAgo],
      )

      if (sessionResult.rowCount > 0 || tokenResult.rowCount > 0) {
        this.logger.log(
          `Cleanup: removed ${sessionResult.rowCount} sessions, ${tokenResult.rowCount} refresh tokens`,
        )
      }

      return {
        deletedSessions: sessionResult.rowCount ?? 0,
        deletedTokens: tokenResult.rowCount ?? 0,
      }
    } catch (err) {
      this.logger.error(`Failed to cleanup expired sessions: ${String(err)}`)
      return { deletedSessions: 0, deletedTokens: 0 }
    }
  }

  /**
   * Get a session by its opaque identifier.
   *
   * Unlike validateSession, this method does not check expiry or
   * revocation — it returns the raw session data for administrative
   * purposes (e.g. displaying session list in settings).
   */
  async getSessionById(sessionId: string) {
    const pool = getDbPool()

    try {
      const result = await pool.query(
        `SELECT session_id, user_id, family_id, device_info,
                expires_at, idle_deadline, revoked_at, created_at, updated_at
         FROM sessions
         WHERE session_id = $1
         LIMIT 1`,
        [sessionId],
      )

      return result.rows[0] ?? null
    } catch (err) {
      this.logger.error(`Failed to get session ${sessionId}: ${String(err)}`)
      return null
    }
  }

  /**
   * Get all active sessions for a user.
   *
   * Returns non-revoked, non-expired sessions for display in
   * settings/security pages.
   */
  async getUserSessions(userId: string) {
    const pool = getDbPool()

    try {
      const result = await pool.query(
        `SELECT session_id, device_info, family_id,
                expires_at, idle_deadline, created_at, updated_at
         FROM sessions
         WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
         ORDER BY created_at DESC`,
        [userId],
      )

      return result.rows
    } catch (err) {
      this.logger.error(`Failed to get sessions for user ${userId}: ${String(err)}`)
      return []
    }
  }
}