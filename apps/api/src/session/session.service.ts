import { Injectable, Logger, HttpException, UnauthorizedException } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import { defaultInboxContent, defaultInboxLink } from '@barghsa/shared/notifications';
import { resolveStaffPermissions } from './staff-permissions.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';

/** Session idle timeout: 30 minutes */
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
/** Session absolute timeout: 24 hours */
export const SESSION_ABSOLUTE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
/** Refresh token length (bytes before hex encoding) */
const REFRESH_TOKEN_BYTES = 32;
/** CSRF token length (bytes before hex encoding) */
const CSRF_TOKEN_BYTES = 32;
/** Max sessions per user to prevent resource abuse */
const MAX_SESSIONS_PER_USER = 50;

/** Internal signal: password verification must continue through login OTP. */
export class DeviceTrustRequired extends UnauthorizedException {
  constructor(readonly isStaff: boolean) {
    super({ statusCode: 401, error: ErrorCodes.AUTH_TOKEN_INVALID.code });
  }
}

/** Active session data returned from validation. */
export interface ValidatedSession {
  sessionId: string;
  userId: string;
  csrfToken: string;
  isAdmin: boolean;
  permissions?: string[];
  expiresAt: Date;
  idleDeadline: Date;
  stepUpVerifiedAt: Date | null;
}

/** Device info metadata stored with the session. */
export interface DeviceInfo {
  ip?: string;
  userAgent?: string;
  fingerprint?: string;
}

/** Result of creating a new session. */
export interface CreatedSession {
  sessionId: string;
  csrfToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/** Result of rotating a refresh token. */
export interface RefreshResult {
  refreshToken: string;
  sessionId: string;
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
  private readonly logger = new Logger(SessionService.name);

  /**
   * Create a new session for a user.
   * A supplied client belongs to the caller: it must be in a transaction,
   * and the caller must commit or roll back and release it.
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
    expectedAuthVersion?: number,
    transactionClient?: PoolClient,
    requiredTrust?: { fingerprint: string; ip: string }
  ): Promise<CreatedSession> {
    const pool = getDbPool();

    const sessionId = uuidv7();
    const csrfToken = randomBytes(CSRF_TOKEN_BYTES).toString('hex');
    const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const refreshTokenHash = createHash('sha256').update(refreshToken).digest('hex');
    const familyId = uuidv7();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_TIMEOUT_MS);
    const idleDeadline = new Date(now.getTime() + SESSION_IDLE_TIMEOUT_MS);

    const client = transactionClient ?? (await pool.connect());
    try {
      if (!transactionClient) await client.query('BEGIN');
      // Lock the account even when no expected auth version was supplied.
      // Locking existing sessions alone cannot serialize an empty set or
      // prevent another transaction from inserting after the count snapshot.
      const account = await client.query(
        'SELECT auth_version,disabled_at,is_admin,is_staff FROM users WHERE user_id=$1 FOR UPDATE',
        [userId]
      );
      if (
        !account.rows[0] ||
        account.rows[0].disabled_at ||
        (expectedAuthVersion !== undefined &&
          (!Number.isInteger(expectedAuthVersion) ||
            account.rows[0].auth_version !== expectedAuthVersion))
      ) {
        throw new HttpException(
          { statusCode: 401, error: ErrorCodes.AUTH_TOKEN_INVALID.code },
          401
        );
      }

      // 1. Enforce the cap on currently usable sessions for this account.
      const lockResult = await client.query(
        `SELECT session_id
         FROM sessions
         WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW() AND idle_deadline > NOW()
         FOR UPDATE`,
        [userId]
      );
      const currentCount = lockResult.rows.length;

      if (requiredTrust) {
        const isStaff = account.rows[0].is_admin === true || account.rows[0].is_staff === true;
        if (isStaff) throw new DeviceTrustRequired(true);
        // Account -> sessions -> trust is the same lock order as OTP completion.
        // Hold the trust row through commit so deletion cannot invalidate a
        // password-only authorization between this check and session insertion.
        const trust = await client.query(
          `SELECT id FROM device_trusts
           WHERE user_id=$1 AND device_fingerprint=$2 FOR SHARE`,
          [userId, requiredTrust.fingerprint]
        );
        if (!trust.rows[0]) throw new DeviceTrustRequired(false);
        // A separate statement checks the wall clock after any lock wait.
        // Transaction-start NOW() could accept trust that expired while waiting.
        const active = await client.query(
          `SELECT 1 FROM device_trusts
           WHERE id=$1 AND expires_at>clock_timestamp() AND ip_address=$2::inet`,
          [trust.rows[0].id, requiredTrust.ip]
        );
        if (!active.rows.length) throw new DeviceTrustRequired(false);
      }

      if (currentCount >= MAX_SESSIONS_PER_USER) {
        // Also repair any pre-existing over-cap set while making room.
        await client.query(
          `UPDATE sessions
           SET revoked_at = $1, updated_at = $1
           WHERE session_id IN (
             SELECT session_id FROM sessions
             WHERE user_id = $2 AND revoked_at IS NULL AND expires_at > NOW() AND idle_deadline > NOW()
             ORDER BY created_at ASC, session_id ASC
             LIMIT $3
           )`,
          [now, userId, currentCount - MAX_SESSIONS_PER_USER + 1]
        );
        this.logger.warn(
          `Session limit (${MAX_SESSIONS_PER_USER}) reached for user ${userId}; ` +
            `revoked oldest active sessions to create a new one.`
        );
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
        ]
      );

      // 3. Insert initial refresh token record
      const tokenId = uuidv7();
      await client.query(
        `INSERT INTO refresh_tokens
         (id, family_id, token_hash, user_id, session_id, version, created_at)
         VALUES ($1, $2, $3, $4, $5, 1, $6)`,
        [tokenId, familyId, refreshTokenHash, userId, sessionId, now]
      );

      if (!transactionClient) await client.query('COMMIT');

      if (!transactionClient) this.logger.log(`Session created: ${sessionId} for user ${userId}`);

      return { sessionId, csrfToken, refreshToken, expiresAt };
    } catch (err) {
      if (!transactionClient) await client.query('ROLLBACK').catch(() => {});
      if (err instanceof HttpException) throw err;
      this.logger.error(`Failed to create session for user ${userId}: ${String(err)}`);
      throw new HttpException({ statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code }, 500);
    } finally {
      if (!transactionClient) client.release();
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
    touchOnValidate = true
  ): Promise<ValidatedSession | null> {
    const pool = getDbPool();
    let client: PoolClient | undefined;
    try {
      if (touchOnValidate) {
        client = await pool.connect();
        await client.query('BEGIN');
        // Match credential writers: account first, session second. Read the
        // authorization fields in a fresh statement after both lock waits.
        await client.query(
          `SELECT u.user_id FROM users u JOIN sessions s ON s.user_id=u.user_id
           WHERE s.session_id=$1 FOR UPDATE OF u`,
          [sessionId]
        );
        await client.query('SELECT session_id FROM sessions WHERE session_id=$1 FOR UPDATE', [
          sessionId,
        ]);
      }
      const database = client ?? pool;
      const result = await database.query(
        `SELECT s.session_id, s.user_id, s.csrf_token,
                u.is_admin, u.disabled_at,
                ARRAY(SELECT r.permissions FROM user_roles ur
                      JOIN staff_roles r ON r.role_id=ur.role_id
                      WHERE ur.user_id=u.user_id) AS role_permissions,
                s.expires_at, s.idle_deadline, s.revoked_at,
                s.step_up_verified_at
         FROM sessions s
         JOIN users u ON u.user_id = s.user_id
         WHERE s.session_id = $1
         LIMIT 1`,
        [sessionId]
      );
      const row = result.rows[0];
      const now = new Date();
      if (
        !row ||
        row.revoked_at ||
        row.disabled_at ||
        new Date(row.expires_at).getTime() <= now.getTime() ||
        new Date(row.idle_deadline).getTime() <= now.getTime()
      ) {
        if (client) await client.query('ROLLBACK');
        return null;
      }

      let idleDeadline = row.idle_deadline;
      if (client) {
        idleDeadline = new Date(
          Math.min(now.getTime() + SESSION_IDLE_TIMEOUT_MS, new Date(row.expires_at).getTime())
        );
        await client.query(
          `UPDATE sessions SET idle_deadline=$1, updated_at=$2 WHERE session_id=$3`,
          [idleDeadline, now, sessionId]
        );
        if (!(await this.sessionDeadlinesCurrent(client, row.expires_at, row.idle_deadline))) {
          await client.query('ROLLBACK');
          return null;
        }
        await client.query('COMMIT');
      }
      return {
        sessionId: row.session_id,
        userId: row.user_id,
        csrfToken: row.csrf_token,
        isAdmin: row.is_admin ?? false,
        permissions: resolveStaffPermissions(row.role_permissions),
        expiresAt: row.expires_at,
        idleDeadline,
        stepUpVerifiedAt: row.step_up_verified_at ?? null,
      };
    } catch (err) {
      await client?.query('ROLLBACK').catch(() => {});
      this.logger.error(`Failed to validate session ${sessionId}: ${String(err)}`);
      return null;
    } finally {
      client?.release();
    }
  }

  private async sessionDeadlinesCurrent(
    client: PoolClient,
    expiresAt: Date,
    idleDeadline: Date
  ): Promise<boolean> {
    const current = await client.query(
      'SELECT $1::timestamptz>clock_timestamp() AND $2::timestamptz>clock_timestamp() AS valid',
      [expiresAt, idleDeadline]
    );
    return current.rows[0]?.valid === true;
  }

  /**
   * Replace the identifier, CSRF and refresh credentials in the same family.
   * Preserve the original absolute lifetime and revoke the old session.
   * A supplied transaction belongs to the caller, including commit/rollback.
   */
  async rotateSession(
    oldSessionId: string,
    reason: string,
    transactionClient?: PoolClient
  ): Promise<CreatedSession | null> {
    const pool = getDbPool();

    const client = transactionClient ?? (await pool.connect());
    try {
      if (!transactionClient) await client.query('BEGIN');

      // Match creation's account-before-session lock order. The old session
      // is re-read after locking, so a concurrent revocation cannot revive it.
      const account = await client.query(
        `SELECT u.user_id,u.disabled_at FROM users u
        JOIN sessions s ON s.user_id=u.user_id WHERE s.session_id=$1 FOR UPDATE OF u`,
        [oldSessionId]
      );
      if (!account.rows[0] || account.rows[0].disabled_at) {
        if (!transactionClient) await client.query('ROLLBACK');
        return null;
      }

      // 1. Fetch and lock the old session
      const oldResult = await client.query(
        `SELECT session_id, user_id, csrf_token, family_id,
                device_info, expires_at, idle_deadline
         FROM sessions
         WHERE session_id = $1 AND revoked_at IS NULL AND expires_at > clock_timestamp() AND idle_deadline > clock_timestamp()
         FOR UPDATE`,
        [oldSessionId]
      );

      if (oldResult.rows.length === 0) {
        if (!transactionClient) await client.query('ROLLBACK');
        return null;
      }

      const oldRow = oldResult.rows[0];
      const now = new Date();
      if (
        new Date(oldRow.expires_at).getTime() <= now.getTime() ||
        new Date(oldRow.idle_deadline).getTime() <= now.getTime()
      ) {
        if (!transactionClient) await client.query('ROLLBACK');
        return null;
      }

      // 2. Revoke the old session
      await client.query(
        `UPDATE sessions
         SET revoked_at = $1, updated_at = $1
         WHERE session_id = $2`,
        [now, oldSessionId]
      );

      // 3. Create a new session with fresh identifier and CSRF token
      const newSessionId = uuidv7();
      const newCsrfToken = randomBytes(CSRF_TOKEN_BYTES).toString('hex');
      const newRefreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
      const newRefreshTokenHash = createHash('sha256').update(newRefreshToken).digest('hex');
      const expiresAt = new Date(oldRow.expires_at);
      const idleDeadline = new Date(
        Math.min(now.getTime() + SESSION_IDLE_TIMEOUT_MS, expiresAt.getTime())
      );
      const familyId = oldRow.family_id ?? uuidv7();

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
        ]
      );

      // 4. Insert new refresh token record (next version in the same family)
      const verResult = await client.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next_ver
         FROM refresh_tokens
         WHERE family_id = $1`,
        [familyId]
      );
      const nextVersion = Number(verResult.rows[0]?.next_ver ?? 1);

      const tokenId = uuidv7();
      await client.query(
        `INSERT INTO refresh_tokens
         (id, family_id, token_hash, user_id, session_id, version, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tokenId, familyId, newRefreshTokenHash, oldRow.user_id, newSessionId, nextVersion, now]
      );

      // 5. Consume all previous refresh tokens in this family (they're now rotated)
      await client.query(
        `UPDATE refresh_tokens
         SET consumed_at = $1
         WHERE family_id = $2 AND consumed_at IS NULL AND id != $3`,
        [now, familyId, tokenId]
      );

      if (!(await this.sessionDeadlinesCurrent(client, oldRow.expires_at, oldRow.idle_deadline))) {
        if (!transactionClient) await client.query('ROLLBACK');
        return null;
      }
      if (!transactionClient) await client.query('COMMIT');

      if (!transactionClient) {
        this.logger.log(
          `Session rotated: ${oldSessionId} → ${newSessionId} (reason: ${reason}) for user ${oldRow.user_id}`
        );
      }

      return {
        sessionId: newSessionId,
        csrfToken: newCsrfToken,
        refreshToken: newRefreshToken,
        expiresAt,
      };
    } catch (err) {
      if (transactionClient) throw err;
      await client.query('ROLLBACK').catch(() => {});
      this.logger.error(`Failed to rotate session ${oldSessionId}: ${String(err)}`);
      throw new HttpException({ statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code }, 500);
    } finally {
      if (!transactionClient) client.release();
    }
  }

  /** Check the session token without consuming the refresh credential or extending idle time. */
  async validateRefreshCsrf(token: string, csrfToken: string): Promise<boolean> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const result = await getDbPool().query<{ csrf_token: string }>(
      `SELECT s.csrf_token FROM refresh_tokens r
       JOIN sessions s ON s.session_id = r.session_id
       WHERE r.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW() AND s.idle_deadline > NOW()`,
      [tokenHash]
    );
    return result.rows.length === 1 && result.rows[0]!.csrf_token === csrfToken;
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
   * Refresh retains the session and its CSRF token; session rotation replaces both.
   */
  async redeemRefreshToken(token: string): Promise<RefreshResult> {
    const pool = getDbPool();
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Every credential mutation locks the account first, then sessions,
      // then refresh credentials. Re-read credentials after any lock wait.
      const account = await client.query(
        `SELECT u.user_id,u.disabled_at FROM users u
         JOIN refresh_tokens r ON r.user_id=u.user_id WHERE r.token_hash=$1 FOR UPDATE OF u`,
        [tokenHash]
      );
      if (!account.rows[0] || account.rows[0].disabled_at) {
        throw new UnauthorizedException({
          statusCode: 401,
          error: account.rows[0]?.disabled_at
            ? ErrorCodes.AUTH_ACCOUNT_DISABLED.code
            : ErrorCodes.AUTH_TOKEN_INVALID.code,
        });
      }
      await client.query(
        `SELECT s.session_id FROM sessions s JOIN refresh_tokens r ON r.session_id=s.session_id
         WHERE r.token_hash=$1 FOR UPDATE OF s`,
        [tokenHash]
      );

      // 1. Look up the token, lock for update
      const tokenResult = await client.query(
        `SELECT id, family_id, user_id, session_id, version, consumed_at
         FROM refresh_tokens
         WHERE token_hash = $1
         FOR UPDATE`,
        [tokenHash]
      );

      if (tokenResult.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new UnauthorizedException({
          statusCode: 401,
          error: ErrorCodes.AUTH_TOKEN_INVALID.code,
        });
      }

      const tokenRow = tokenResult.rows[0];

      const now = new Date();

      // 2. Check for token reuse (already consumed)
      if (tokenRow.consumed_at) {
        // Token theft detected — revoke the entire family
        await client.query(
          `UPDATE refresh_tokens
           SET consumed_at = $1
           WHERE family_id = $2 AND consumed_at IS NULL`,
          [now, tokenRow.family_id]
        );

        // Revoke all sessions in this family
        await client.query(
          `UPDATE sessions
           SET revoked_at = $1, updated_at = $1
           WHERE family_id = $2 AND revoked_at IS NULL`,
          [now, tokenRow.family_id]
        );

        // Commit a private account notice with the revocation. A family can be
        // replayed through several consumed tokens; it must produce one alert.
        const event = 'auth.refresh_token_reused';
        await client.query(
          `INSERT INTO in_app_notifications
           (id,recipient_user_id,type,title_i18n_key,body_i18n_key,localized_content,link_route,delivery_key)
           VALUES ($1,$2,$3,'notifications.legacy.title','notifications.legacy.body',$4::jsonb,$5,$6)
           ON CONFLICT (delivery_key) DO NOTHING`,
          [
            uuidv7(),
            tokenRow.user_id,
            event,
            JSON.stringify(defaultInboxContent(event)),
            defaultInboxLink(event),
            `session-reuse:${tokenRow.family_id}`,
          ]
        );

        await client.query('COMMIT');

        this.logger.warn(
          `Refresh token reuse detected! Token family ${tokenRow.family_id} ` +
            `for user ${tokenRow.user_id} revoked. Potential token theft.`
        );

        throw new UnauthorizedException({
          statusCode: 401,
          error: ErrorCodes.AUTH_TOKEN_INVALID.code,
        });
      }

      // 3. Check that the associated session is still valid
      const sessionResult = await client.query(
        `SELECT session_id, expires_at, idle_deadline, revoked_at
         FROM sessions
         WHERE session_id = $1
         FOR UPDATE`,
        [tokenRow.session_id]
      );

      if (sessionResult.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new UnauthorizedException({
          statusCode: 401,
          error: ErrorCodes.AUTH_TOKEN_INVALID.code,
        });
      }

      const sessionRow = sessionResult.rows[0];

      if (
        sessionRow.revoked_at ||
        new Date(sessionRow.expires_at).getTime() <= Date.now() ||
        new Date(sessionRow.idle_deadline).getTime() <= Date.now()
      ) {
        await client.query('ROLLBACK');
        throw new UnauthorizedException({
          statusCode: 401,
          error: ErrorCodes.AUTH_TOKEN_EXPIRED.code,
        });
      }

      // 4. Consume the current token
      await client.query(
        `UPDATE refresh_tokens
         SET consumed_at = $1
         WHERE id = $2`,
        [now, tokenRow.id]
      );

      // 5. Generate a new refresh token in the same family
      const newToken = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
      const newTokenHash = createHash('sha256').update(newToken).digest('hex');
      const newTokenId = uuidv7();

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
        ]
      );

      // 6. Update the session's refresh token hash
      await client.query(
        `UPDATE sessions
         SET refresh_token_hash = $1, idle_deadline = $2, updated_at = $3
         WHERE session_id = $4`,
        [
          newTokenHash,
          new Date(
            Math.min(
              now.getTime() + SESSION_IDLE_TIMEOUT_MS,
              new Date(sessionRow.expires_at).getTime()
            )
          ),
          now,
          tokenRow.session_id,
        ]
      );

      if (
        !(await this.sessionDeadlinesCurrent(
          client,
          sessionRow.expires_at,
          sessionRow.idle_deadline
        ))
      ) {
        throw new UnauthorizedException({
          statusCode: 401,
          error: ErrorCodes.AUTH_TOKEN_EXPIRED.code,
        });
      }
      await client.query('COMMIT');

      return {
        refreshToken: newToken,
        sessionId: tokenRow.session_id,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error(`Failed to redeem refresh token: ${String(err)}`);
      throw new HttpException({ statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code }, 500);
    } finally {
      client.release();
    }
  }

  /**
   * Step-up authentication window (default: 15 minutes).
   * Configurable via STEP_UP_WINDOW_MS env var.
   */
  static readonly STEP_UP_WINDOW_MS = (() => {
    const fromEnv = process.env['STEP_UP_WINDOW_MS'];
    if (fromEnv) {
      const parsed = Number(fromEnv);
      if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    }
    return 15 * 60 * 1000; // 15 minutes
  })();

  /** Verify the password, rotate credentials and audit step-up atomically. */
  async verifyStepUp(
    userId: string,
    sessionId: string,
    password: string,
    ip: string | null = null
  ): Promise<CreatedSession & { stepUpVerifiedAt: Date }> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      // Use the same account-before-session order as revocation and refresh.
      const account = await client.query(
        'SELECT password_hash,disabled_at FROM users WHERE user_id=$1 FOR UPDATE',
        [userId]
      );
      if (!account.rows[0] || account.rows[0].disabled_at) {
        throw new UnauthorizedException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code });
      }
      const session = await client.query(
        `SELECT session_id,expires_at,idle_deadline FROM sessions WHERE session_id=$1 AND user_id=$2
         AND revoked_at IS NULL AND expires_at>clock_timestamp() AND idle_deadline>clock_timestamp()
         FOR UPDATE`,
        [sessionId, userId]
      );
      if (!session.rows[0]) {
        throw new UnauthorizedException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code });
      }
      const { verify } = await import('argon2');
      if (!(await verify(account.rows[0].password_hash, password).catch(() => false))) {
        throw new HttpException({ error: ErrorCodes.AUTH_LOGIN_INVALID_CREDENTIALS.code }, 422);
      }
      const rotated = await this.rotateSession(sessionId, 'step_up', client);
      if (!rotated) {
        throw new UnauthorizedException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code });
      }
      // Stamp only the replacement session after password verification.
      // The final check below retains the original idle and absolute limits.
      const updated = await client.query<{ step_up_verified_at: Date }>(
        `UPDATE sessions SET step_up_verified_at=date_trunc('milliseconds',clock_timestamp()),updated_at=clock_timestamp()
         WHERE session_id=$1 AND user_id=$2 AND revoked_at IS NULL
         AND expires_at>clock_timestamp() AND idle_deadline>clock_timestamp()
         RETURNING step_up_verified_at`,
        [rotated.sessionId, userId]
      );
      const verifiedAt = updated.rows[0]?.step_up_verified_at;
      if (!verifiedAt) {
        throw new UnauthorizedException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code });
      }
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at)
         VALUES ($1,$2,'step_up_verified',$3,$4,$5,$6)`,
        [
          uuidv7(),
          userId,
          JSON.stringify({ stepUpVerified: true, verifiedAt: verifiedAt.toISOString() }),
          correlationIdStorage.getStore() ?? uuidv7(),
          ip,
          verifiedAt,
        ]
      );
      if (
        !(await this.sessionDeadlinesCurrent(
          client,
          session.rows[0].expires_at,
          session.rows[0].idle_deadline
        ))
      ) {
        throw new UnauthorizedException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code });
      }
      await client.query('COMMIT');
      return { ...rotated, stepUpVerifiedAt: verifiedAt };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err instanceof HttpException) throw err;
      this.logger.error(`Failed to verify step-up: ${String(err)}`);
      throw new HttpException({ error: ErrorCodes.INTERNAL_SERVER.code }, 500);
    } finally {
      client.release();
    }
  }

  /**
   * Revoke a single session by ID.
   *
   * Also consumes all active refresh tokens in the session's family.
   */
  async revokeSession(sessionId: string): Promise<void> {
    const pool = getDbPool();
    const now = new Date();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT u.user_id FROM users u JOIN sessions s ON s.user_id=u.user_id
         WHERE s.session_id=$1 FOR UPDATE OF u`,
        [sessionId]
      );

      // Fetch family ID before revoking
      const sessionResult = await client.query(
        `SELECT family_id FROM sessions WHERE session_id = $1 FOR UPDATE`,
        [sessionId]
      );

      if (sessionResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return;
      }

      const familyId = sessionResult.rows[0].family_id;

      // Revoke the session
      await client.query(
        `UPDATE sessions
         SET revoked_at = $1, updated_at = $1
         WHERE session_id = $2`,
        [now, sessionId]
      );

      // Consume all active tokens in this family
      if (familyId) {
        await client.query(
          `UPDATE refresh_tokens
           SET consumed_at = $1
           WHERE family_id = $2 AND consumed_at IS NULL`,
          [now, familyId]
        );
      }

      await client.query('COMMIT');

      this.logger.log(`Session revoked: ${sessionId}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      this.logger.error(`Failed to revoke session ${sessionId}: ${String(err)}`);
      throw new HttpException({ statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code }, 500);
    } finally {
      client.release();
    }
  }

  /**
   * Revoke all active sessions for a user.
   *
   * Optionally excludes a specific session (e.g. the current one).
   * Consumes credentials for revoked sessions, preserving an excluded session.
   * A supplied transaction belongs to the caller, including commit/rollback/release.
   */
  async revokeAllUserSessions(
    userId: string,
    excludeSessionId?: string,
    transaction?: PoolClient
  ): Promise<void> {
    const pool = getDbPool();
    const now = new Date();

    const client = transaction ?? (await pool.connect());
    try {
      if (!transaction) await client.query('BEGIN');
      await client.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [userId]);

      // Revoke all sessions except the excluded one
      if (excludeSessionId) {
        await client.query(
          `UPDATE sessions
           SET revoked_at = $1, updated_at = $1
           WHERE user_id = $2 AND revoked_at IS NULL
             AND session_id != $3`,
          [now, userId, excludeSessionId]
        );
      } else {
        await client.query(
          `UPDATE sessions
           SET revoked_at = $1, updated_at = $1
           WHERE user_id = $2 AND revoked_at IS NULL`,
          [now, userId]
        );
      }

      // Consume all active refresh tokens for this user
      await client.query(
        `UPDATE refresh_tokens
         SET consumed_at = $1
         WHERE user_id = $2 AND consumed_at IS NULL
           AND ($3::text IS NULL OR session_id != $3::text)`,
        [now, userId, excludeSessionId ?? null]
      );

      if (!transaction) await client.query('COMMIT');

      if (!transaction) this.logger.log(`All sessions revoked for user ${userId}`);
    } catch (err) {
      if (!transaction) await client.query('ROLLBACK').catch(() => {});
      this.logger.error(`Failed to revoke all sessions for user ${userId}: ${String(err)}`);
      throw new HttpException({ statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code }, 500);
    } finally {
      if (!transaction) client.release();
    }
  }

  /**
   * Revoke all sessions sharing the same refresh token family.
   *
   * Called when token reuse is detected (potential theft).
   */
  async revokeFamily(familyId: string): Promise<void> {
    const pool = getDbPool();
    const now = new Date();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT u.user_id FROM users u WHERE EXISTS (
          SELECT 1 FROM sessions s WHERE s.user_id=u.user_id AND s.family_id=$1
        ) OR EXISTS (
          SELECT 1 FROM refresh_tokens r WHERE r.user_id=u.user_id AND r.family_id=$1
        ) ORDER BY u.user_id FOR UPDATE OF u`,
        [familyId]
      );

      await client.query(
        `UPDATE sessions
         SET revoked_at = $1, updated_at = $1
         WHERE family_id = $2 AND revoked_at IS NULL`,
        [now, familyId]
      );

      await client.query(
        `UPDATE refresh_tokens
         SET consumed_at = $1
         WHERE family_id = $2 AND consumed_at IS NULL`,
        [now, familyId]
      );

      await client.query('COMMIT');

      this.logger.warn(`Token family revoked: ${familyId}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      this.logger.error(`Failed to revoke token family ${familyId}: ${String(err)}`);
      throw new HttpException({ statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code }, 500);
    } finally {
      client.release();
    }
  }

  /**
   * Verify a user's password by checking the Argon2id hash.
   *
   * Used by SessionController for revoke-all password confirmation (T-02.02.02).
   * Returns true if the password matches, false on any error (no timing leakage).
   */
  async verifyUserPassword(userId: string, password: string): Promise<boolean> {
    const pool = getDbPool();

    try {
      const userResult = await pool.query(
        `SELECT password_hash FROM users WHERE user_id = $1 LIMIT 1`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        return false;
      }

      const { verify } = await import('argon2');
      return await verify(userResult.rows[0].password_hash, password).catch(() => false);
    } catch (err) {
      this.logger.error(`Password verification failed for user ${userId}: ${String(err)}`);
      return false;
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
    const pool = getDbPool();
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    try {
      // Delete expired sessions (absolute or idle timeout)
      const sessionResult = await pool.query(
        `DELETE FROM sessions
         WHERE (expires_at <= $1 OR idle_deadline <= $1 OR
                (revoked_at IS NOT NULL AND revoked_at <= $2))
           AND created_at < $1`,
        [now, thirtyDaysAgo]
      );

      // Delete orphaned or consumed refresh tokens
      const tokenResult = await pool.query(
        `DELETE FROM refresh_tokens
         WHERE consumed_at IS NOT NULL AND consumed_at <= $1`,
        [thirtyDaysAgo]
      );

      if ((sessionResult.rowCount ?? 0) > 0 || (tokenResult.rowCount ?? 0) > 0) {
        this.logger.log(
          `Cleanup: removed ${sessionResult.rowCount} sessions, ${tokenResult.rowCount} refresh tokens`
        );
      }

      return {
        deletedSessions: sessionResult.rowCount ?? 0,
        deletedTokens: tokenResult.rowCount ?? 0,
      };
    } catch (err) {
      this.logger.error(`Failed to cleanup expired sessions: ${String(err)}`);
      return { deletedSessions: 0, deletedTokens: 0 };
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
    const pool = getDbPool();

    try {
      const result = await pool.query(
        `SELECT session_id, user_id, family_id, device_info,
                expires_at, idle_deadline, revoked_at, created_at, updated_at
         FROM sessions
         WHERE session_id = $1
         LIMIT 1`,
        [sessionId]
      );

      return result.rows[0] ?? null;
    } catch (err) {
      this.logger.error(`Failed to get session ${sessionId}: ${String(err)}`);
      return null;
    }
  }

  /** Return unexpired trust metadata without disclosing device possession proofs. */
  async getTrustedDevices(userId: string, currentFingerprint: string | null) {
    const result = await getDbPool().query(
      `SELECT id, user_agent_hint AS "userAgent", host(ip_address) AS ip,
              trusted_at AS "trustedAt", expires_at AS "expiresAt",
              COALESCE(device_fingerprint=$2,false) AS "isCurrentDevice"
       FROM device_trusts WHERE user_id=$1 AND expires_at>clock_timestamp()
       ORDER BY trusted_at DESC,id DESC`,
      [userId, currentFingerprint]
    );
    return result.rows;
  }

  async revokeTrustedDevice(
    userId: string,
    sessionId: string,
    deviceId: string,
    ip: string | null
  ) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const account = await client.query(
        'SELECT disabled_at FROM users WHERE user_id=$1 FOR UPDATE',
        [userId]
      );
      if (!account.rows[0] || account.rows[0].disabled_at) {
        throw new UnauthorizedException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code });
      }
      await client.query(
        'SELECT session_id FROM sessions WHERE session_id=$1 AND user_id=$2 FOR UPDATE',
        [sessionId, userId]
      );
      const target = await client.query(
        'SELECT id FROM device_trusts WHERE id=$1 AND user_id=$2 FOR UPDATE',
        [deviceId, userId]
      );
      // Revalidate after every possible lock wait, including the trust row.
      const actor = await client.query(
        `SELECT revoked_at IS NULL AND expires_at>clock_timestamp() AND idle_deadline>clock_timestamp() AS active,
                step_up_verified_at>clock_timestamp()-($3::double precision * INTERVAL '1 millisecond')
                AND step_up_verified_at<=clock_timestamp() AS fresh
         FROM sessions WHERE session_id=$1 AND user_id=$2`,
        [sessionId, userId, SessionService.STEP_UP_WINDOW_MS]
      );
      if (!actor.rows[0]?.active)
        throw new UnauthorizedException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code });
      if (!actor.rows[0].fresh)
        throw new HttpException({ error: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code }, 403);
      if (!target.rows.length)
        throw new HttpException({ error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
      await client.query('DELETE FROM device_trusts WHERE id=$1 AND user_id=$2', [
        deviceId,
        userId,
      ]);
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at)
         VALUES ($1,$2,'device_trust_revoked',$3,$4,$5,clock_timestamp())`,
        [
          uuidv7(),
          userId,
          JSON.stringify({ deviceId }),
          correlationIdStorage.getStore() ?? uuidv7(),
          ip,
        ]
      );
      await client.query('COMMIT');
      return { revoked: true as const };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error instanceof HttpException) throw error;
      this.logger.error(`Device trust revocation failed: ${String(error)}`);
      throw new HttpException({ error: ErrorCodes.INTERNAL_SERVER.code }, 500);
    } finally {
      client.release();
    }
  }

  /** Return non-revoked, unexpired sessions with display-only device metadata. */
  async getUserSessions(userId: string) {
    const pool = getDbPool();

    try {
      const result = await pool.query(
        `SELECT session_id,
                CASE WHEN device_info IS NULL THEN NULL
                     ELSE jsonb_strip_nulls(jsonb_build_object(
                       'ip',device_info->>'ip','userAgent',device_info->>'userAgent',
                       'browser',device_info->>'browser','os',device_info->>'os'))
                END AS device_info, family_id,
                expires_at, idle_deadline, created_at, updated_at
         FROM sessions
         WHERE user_id = $1 AND revoked_at IS NULL
           AND expires_at > clock_timestamp() AND idle_deadline > clock_timestamp()
         ORDER BY created_at DESC`,
        [userId]
      );

      return result.rows;
    } catch (err) {
      this.logger.error(`Failed to get sessions for user ${userId}: ${String(err)}`);
      throw err;
    }
  }
}
