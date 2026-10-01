import { HttpException, Injectable } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import { v7 as uuidv7 } from 'uuid';
import type { PoolClient } from 'pg';
import { OtpAttemptRejected, OtpService } from './otp.service.js';
import { SessionService, type ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';

type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
@Injectable()
export class OtpStepUpService {
  constructor(
    private readonly otp: OtpService,
    private readonly sessions: SessionService
  ) {}

  private async account(client: PoolClient, actor: Actor) {
    const result = await client.query<{ auth_version: number; username: string }>(
      `SELECT auth_version,username FROM users WHERE user_id=$1 AND disabled_at IS NULL
       AND activation_token IS NULL FOR UPDATE`,
      [actor.userId]
    );
    if (!result.rows[0])
      throw new HttpException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code }, 401);
    await requireCurrentSession(client, actor);
    return result.rows[0];
  }

  async send(actor: Actor, ip: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const account = await this.account(client, actor);
      const found = await client.query<{ destination: string }>(
        `SELECT destination FROM account_login_identifiers WHERE user_id=$1
         AND (kind='primary' OR verified_at IS NOT NULL)
         ORDER BY (destination=$2) DESC,destination LIMIT 1`,
        [actor.userId, account.username]
      );
      const destination = found.rows[0]?.destination;
      if (!destination) throw new HttpException({ error: ErrorCodes.CONFLICT_STATE.code }, 409);
      const challenge = await this.otp.createChallenge(
        destination,
        ip,
        undefined,
        undefined,
        {
          purpose: 'step_up',
          userId: actor.userId,
          authVersion: account.auth_version,
          sessionId: actor.sessionId,
        },
        client
      );
      await client.query(
        `UPDATE otp_challenges SET consumed_at=clock_timestamp(),attempts_remaining=0,updated_at=clock_timestamp()
         WHERE step_up_session_id=$1 AND purpose='step_up' AND consumed_at IS NULL AND challenge_id<>$2`,
        [actor.sessionId, challenge.challengeId]
      );
      const row = await client.query<{ expires_at: Date }>(
        'SELECT expires_at FROM otp_challenges WHERE challenge_id=$1',
        [challenge.challengeId]
      );
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return {
        challengeId: challenge.challengeId,
        expiresAt: row.rows[0]!.expires_at.toISOString(),
        channel: destination.includes('@') ? 'email' : 'sms',
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error instanceof HttpException) throw error;
      throw new HttpException({ error: ErrorCodes.INTERNAL_SERVER.code }, 500);
    } finally {
      client.release();
    }
  }

  async verify(actor: Actor, challengeId: string, code: string, ip: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.account(client, actor);
      const challenge = await client.query(
        `SELECT challenge_id,destination FROM otp_challenges WHERE challenge_id=$1
         AND user_id=$2 AND step_up_session_id=$3 AND purpose='step_up' FOR UPDATE`,
        [challengeId, actor.userId, actor.sessionId]
      );
      if (!challenge.rows[0])
        throw new HttpException({ error: ErrorCodes.AUTH_OTP_INVALID.code }, 401);
      // A changed login identifier must not receive authorization from its old destination.
      const identifier = await client.query(
        `SELECT destination FROM account_login_identifiers WHERE user_id=$1 AND destination=$2
         AND (kind='primary' OR verified_at IS NOT NULL)`,
        [actor.userId, challenge.rows[0].destination]
      );
      if (!identifier.rows[0])
        throw new HttpException({ error: ErrorCodes.AUTH_TOKEN_INVALID.code }, 401);
      const live = await client.query(
        'SELECT expires_at>clock_timestamp() AS live FROM otp_challenges WHERE challenge_id=$1',
        [challengeId]
      );
      if (!live.rows[0]?.live)
        throw new HttpException({ error: ErrorCodes.AUTH_OTP_EXPIRED.code }, 401);
      await this.otp.verifyChallenge(challengeId, code, ip, client);
      const deadlines = await client.query(
        'SELECT expires_at,idle_deadline FROM sessions WHERE session_id=$1',
        [actor.sessionId]
      );
      const rotated = await this.sessions.rotateSession(actor.sessionId, 'otp_step_up', client);
      if (!rotated) throw new HttpException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code }, 401);
      const stamped = await client.query<{ otp_step_up_verified_at: Date }>(
        `UPDATE sessions SET step_up_verified_at=date_trunc('milliseconds',clock_timestamp()),
         otp_step_up_verified_at=date_trunc('milliseconds',clock_timestamp()),updated_at=clock_timestamp()
         WHERE session_id=$1 RETURNING otp_step_up_verified_at`,
        [rotated.sessionId]
      );
      const at = stamped.rows[0]!.otp_step_up_verified_at;
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
         VALUES($1,$2,'step_up_verified',$3::jsonb,$4,$5)`,
        [
          uuidv7(),
          actor.userId,
          JSON.stringify({ method: 'otp', stepUpVerified: true, verifiedAt: at.toISOString() }),
          correlationIdStorage.getStore() ?? uuidv7(),
          ip,
        ]
      );
      await requireCurrentSession(client, {
        ...actor,
        sessionId: rotated.sessionId,
        csrfToken: rotated.csrfToken,
      });
      const final = await client.query(
        `SELECT $1::timestamptz>clock_timestamp() AND $2::timestamptz>clock_timestamp()
          AND (SELECT expires_at>clock_timestamp() FROM otp_challenges WHERE challenge_id=$3) AS live`,
        [deadlines.rows[0].expires_at, deadlines.rows[0].idle_deadline, challengeId]
      );
      if (!final.rows[0]?.live)
        throw new HttpException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code }, 401);
      await client.query('COMMIT');
      return { ...rotated, stepUpVerifiedAt: at };
    } catch (error) {
      if (error instanceof OtpAttemptRejected) {
        try {
          await requireCurrentSession(client, actor);
          await client.query('COMMIT');
        } catch (changed) {
          await client.query('ROLLBACK').catch(() => {});
          throw changed;
        }
        throw error;
      }
      await client.query('ROLLBACK').catch(() => {});
      if (error instanceof HttpException) throw error;
      throw new HttpException({ error: ErrorCodes.INTERNAL_SERVER.code }, 500);
    } finally {
      client.release();
    }
  }
}
