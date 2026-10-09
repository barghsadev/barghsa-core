import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { getDbPool, type AccountRecoveryCase } from '@barghsa/db';
import { normalizeUsername } from '@barghsa/shared/validation';
import { v7 as uuidv7 } from 'uuid';
import type { PoolClient } from 'pg';
import { OtpService, OtpAttemptRejected } from '../auth/otp.service.js';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { requireCurrentSession, requireSessionStepUp } from '../session/session-step-up.js';
import type { ValidatedSession } from '../session/session.service.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import { VerificationEvidenceService } from './verification-evidence.service.js';

type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
type SnakeCase<S extends string> = S extends `${infer First}${infer Rest}`
  ? `${First extends Lowercase<First> ? First : `_${Lowercase<First>}`}${SnakeCase<Rest>}`
  : S;
type Row = { [K in keyof AccountRecoveryCase as SnakeCase<K>]: AccountRecoveryCase[K] };
@Injectable()
export class AccountRecoveryService {
  constructor(
    private readonly evidence: VerificationEvidenceService,
    private readonly otp: OtpService
  ) {}
  private async audit(
    client: PoolClient,
    actor: string,
    event: string,
    caseId: string,
    metadata: Record<string, unknown>,
    ip: string
  ) {
    await client.query(
      `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip) VALUES($1,$2,$3,$4::jsonb,$5,$6)`,
      [
        uuidv7(),
        actor,
        event,
        JSON.stringify({ caseId, ...metadata }),
        correlationIdStorage.getStore() ?? uuidv7(),
        ip,
      ]
    );
  }
  private async staffCase(
    client: PoolClient,
    actor: Actor,
    id: string,
    permission: string,
    mutation = true
  ): Promise<Row> {
    const hint = (
      await client.query('SELECT target_user_id FROM account_recovery_cases WHERE id=$1', [id])
    ).rows[0];
    if (!hint) throw new NotFoundException();
    await requireStaffMutationPermission(client, actor.userId, permission, hint.target_user_id);
    if (mutation) await requireSessionStepUp(client, actor);
    else await requireCurrentSession(client, actor);
    const row = (
      await client.query('SELECT * FROM account_recovery_cases WHERE id=$1 FOR UPDATE', [id])
    ).rows[0];
    if (!row || row.target_user_id !== hint.target_user_id) throw new ConflictException();
    return row;
  }
  private async currentTarget(client: PoolClient, row: Row, actor?: Actor) {
    const user = (
      await client.query(
        'SELECT user_id,username,auth_version,disabled_at,activation_token,is_admin,is_staff,email,mobile FROM users WHERE user_id=$1 FOR UPDATE',
        [row.target_user_id]
      )
    ).rows[0];
    const profile = (
      await client.query(
        'SELECT user_id,archived,profile_type FROM profiles WHERE id=$1 FOR UPDATE',
        [row.profile_id]
      )
    ).rows[0];
    if (
      !user ||
      user.disabled_at ||
      user.activation_token ||
      !profile ||
      profile.archived ||
      profile.user_id !== row.target_user_id ||
      user.auth_version !== row.auth_version ||
      user.username !== row.old_login
    )
      throw new ConflictException('Recovery target changed; recreate and review the case');
    if (actor && (user.is_admin || user.is_staff)) {
      const staff = (
        await client.query('SELECT is_admin FROM users WHERE user_id=$1', [actor.userId])
      ).rows[0];
      if (!staff?.is_admin || actor.userId === row.target_user_id)
        throw new ForbiddenException(
          'Privileged account recovery requires independent administrators'
        );
    }
    return user;
  }
  async create(
    actor: Actor,
    input: {
      profileId: string;
      newLogin: string;
      supportReference: string;
      reason: string;
      evidenceKeys: string[];
    },
    ip: string
  ) {
    const newLogin = normalizeUsername(input.newLogin);
    if (!newLogin) throw new BadRequestException('Invalid new contact');
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const hint = (
        await client.query('SELECT user_id FROM profiles WHERE id=$1', [input.profileId])
      ).rows[0];
      if (!hint) throw new NotFoundException();
      await requireStaffMutationPermission(client, actor.userId, 'crm:edit-identity', hint.user_id);
      await requireSessionStepUp(client, actor);
      const user = (
        await client.query('SELECT username,auth_version FROM users WHERE user_id=$1', [
          hint.user_id,
        ])
      ).rows[0];
      const row = {
        profile_id: input.profileId,
        target_user_id: hint.user_id,
        old_login: user.username,
        new_login: newLogin,
        auth_version: user.auth_version,
      } as Row;
      await this.currentTarget(client, row, actor);
      if (user.username === newLogin) throw new BadRequestException('New contact must differ');
      const evidence = await this.evidence.seal(
        client,
        input.evidenceKeys,
        actor.userId,
        input.profileId
      );
      const id = uuidv7();
      await client.query(
        `INSERT INTO account_recovery_cases(id,profile_id,target_user_id,auth_version,old_login,new_login,support_reference,reason,evidence_keys,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
        [
          id,
          input.profileId,
          hint.user_id,
          user.auth_version,
          user.username,
          newLogin,
          input.supportReference,
          input.reason,
          JSON.stringify(evidence),
          actor.userId,
        ]
      );
      await this.audit(
        client,
        actor.userId,
        'account_recovery_created',
        id,
        {
          profileId: input.profileId,
          targetUserId: hint.user_id,
          supportReference: input.supportReference,
        },
        ip
      );
      await requireSessionStepUp(client, actor);
      await client.query('COMMIT');
      return { id, state: 'open' };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (typeof e === 'object' && e !== null && 'code' in e && e.code === '23505')
        throw new ConflictException('An unresolved recovery or assigned contact already exists');
      throw e;
    } finally {
      client.release();
    }
  }
  async get(actor: Actor, id: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const row = await this.staffCase(client, actor, id, 'verification:read', false);
      const evidenceDownloadUrls = await this.evidence.downloadUrls(row.evidence_keys);
      const history = (
        await client.query(
          "SELECT event,user_id,metadata,correlation_id,created_at FROM audit_log WHERE event LIKE 'account_recovery_%' AND (CASE WHEN metadata IS JSON OBJECT THEN metadata::jsonb ELSE '{}'::jsonb END)->>'caseId'=$1 ORDER BY created_at,id",
          [id]
        )
      ).rows;
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return {
        id: row.id,
        profileId: row.profile_id,
        targetUserId: row.target_user_id,
        oldLogin: row.old_login,
        newLogin: row.new_login,
        state: row.state,
        createdBy: row.created_by,
        reviewedBy: row.reviewed_by,
        reviewerNotes: row.reviewer_notes,
        challengeId: row.challenge_id,
        contactVerified: !!row.contact_verified_at,
        supportReference: row.support_reference,
        reason: row.reason,
        evidenceDownloadUrls,
        history,
      };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (typeof e === 'object' && e !== null && 'code' in e && e.code === '23505')
        throw new ConflictException('An unresolved recovery or assigned contact already exists');
      throw e;
    } finally {
      client.release();
    }
  }
  async review(
    actor: Actor,
    id: string,
    decision: 'approved' | 'rejected',
    notes: string,
    ip: string
  ) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const row = await this.staffCase(client, actor, id, 'crm:verify');
      if (row.created_by === actor.userId)
        throw new ForbiddenException('A different reviewer is required');
      if (decision === 'rejected' && ['open', 'approved'].includes(row.state)) {
        await client.query(
          "UPDATE account_recovery_cases SET state='rejected',updated_at=NOW() WHERE id=$1",
          [id]
        );
        if (row.challenge_id)
          await client.query(
            'UPDATE otp_challenges SET consumed_at=COALESCE(consumed_at,NOW()),attempts_remaining=0 WHERE challenge_id=$1',
            [row.challenge_id]
          );
        await this.audit(
          client,
          actor.userId,
          'account_recovery_reviewed',
          id,
          { decision, notes },
          ip
        );
        await requireSessionStepUp(client, actor);
        await client.query('COMMIT');
        return { id, state: decision };
      }
      if (row.state !== 'open') throw new ConflictException('Recovery case already reviewed');
      await this.currentTarget(client, row, actor);
      await this.evidence.validate(client, row.evidence_keys, row.profile_id);
      await client.query(
        `UPDATE account_recovery_cases SET state=$2,reviewed_by=$3,reviewer_notes=$4,reviewed_at=NOW(),approval_expires_at=NOW()+INTERVAL '1 day',updated_at=NOW() WHERE id=$1`,
        [id, decision, actor.userId, notes]
      );
      await this.audit(
        client,
        actor.userId,
        'account_recovery_reviewed',
        id,
        { decision, notes },
        ip
      );
      await requireSessionStepUp(client, actor);
      await client.query('COMMIT');
      return { id, state: decision };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (typeof e === 'object' && e !== null && 'code' in e && e.code === '23505')
        throw new ConflictException('An unresolved recovery or assigned contact already exists');
      throw e;
    } finally {
      client.release();
    }
  }
  async sendCode(actor: Actor, id: string, ip: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const row = await this.staffCase(client, actor, id, 'crm:verify');
      if (row.state !== 'approved' || (row.approval_expires_at?.getTime() ?? 0) <= Date.now())
        throw new ConflictException('Approval unavailable or expired');
      await this.currentTarget(client, row, actor);
      if (row.challenge_id)
        await client.query(
          'UPDATE otp_challenges SET consumed_at=COALESCE(consumed_at,NOW()),attempts_remaining=0 WHERE challenge_id=$1',
          [row.challenge_id]
        );
      const challenge = await this.otp.createChallenge(
        row.new_login,
        ip,
        undefined,
        undefined,
        { purpose: 'account_recovery', userId: row.target_user_id, authVersion: row.auth_version },
        client
      );
      await client.query(
        'UPDATE account_recovery_cases SET challenge_id=$2,contact_verified_at=NULL,updated_at=NOW() WHERE id=$1',
        [id, challenge.challengeId]
      );
      await this.audit(
        client,
        actor.userId,
        'account_recovery_code_sent',
        id,
        { challengeId: challenge.challengeId },
        ip
      );
      await requireSessionStepUp(client, actor);
      await client.query('COMMIT');
      return { id, challengeId: challenge.challengeId };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (typeof e === 'object' && e !== null && 'code' in e && e.code === '23505')
        throw new ConflictException('An unresolved recovery or assigned contact already exists');
      throw e;
    } finally {
      client.release();
    }
  }
  async verifyContact(id: string, challengeId: string, code: string, ip: string) {
    const client = await getDbPool().connect();
    let targetUserId: string | null = null;
    try {
      await client.query('BEGIN');
      const hint = (
        await client.query('SELECT target_user_id FROM account_recovery_cases WHERE id=$1', [id])
      ).rows[0];
      if (!hint) throw new NotFoundException();
      await client.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [
        hint.target_user_id,
      ]);
      const row = (
        await client.query('SELECT * FROM account_recovery_cases WHERE id=$1 FOR UPDATE', [id])
      ).rows[0];
      if (
        !row ||
        row.state !== 'approved' ||
        row.challenge_id !== challengeId ||
        row.contact_verified_at ||
        (row.approval_expires_at?.getTime() ?? 0) <= Date.now()
      )
        throw new ConflictException('Recovery proof unavailable');
      await this.currentTarget(client, row);
      const challenge = (
        await client.query(
          'SELECT purpose,user_id,destination,auth_version FROM otp_challenges WHERE challenge_id=$1 FOR UPDATE',
          [challengeId]
        )
      ).rows[0];
      if (
        challenge?.purpose !== 'account_recovery' ||
        challenge.user_id !== row.target_user_id ||
        challenge.destination !== row.new_login ||
        challenge.auth_version !== row.auth_version
      )
        throw new ConflictException('Recovery proof invalid');
      targetUserId = row.target_user_id;
      await this.otp.verifyChallenge(challengeId, code, ip, client);
      await client.query(
        'UPDATE account_recovery_cases SET contact_verified_at=NOW(),updated_at=NOW() WHERE id=$1',
        [id]
      );
      await this.audit(
        client,
        row.target_user_id,
        'account_recovery_contact_verified',
        id,
        { source: 'claimant_new_contact_otp' },
        ip
      );
      await client.query('COMMIT');
      return { verified: true };
    } catch (e) {
      try {
        if (e instanceof OtpAttemptRejected && targetUserId) {
          await this.audit(
            client,
            targetUserId,
            'account_recovery_contact_rejected',
            id,
            { source: 'unverified_claimant_attempt' },
            ip
          );
          await client.query('COMMIT');
        } else await client.query('ROLLBACK');
      } catch (auditError) {
        await client.query('ROLLBACK').catch(() => {});
        throw auditError;
      }
      throw e;
    } finally {
      client.release();
    }
  }
  async apply(actor: Actor, id: string, ip: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const row = await this.staffCase(client, actor, id, 'crm:verify');
      if (row.created_by === actor.userId)
        throw new ForbiddenException('A different reviewer must execute recovery');
      if (row.state === 'applied' || row.state === 'completed') {
        await requireSessionStepUp(client, actor);
        await client.query('COMMIT');
        return { id, state: row.state };
      }
      if (
        row.state !== 'approved' ||
        !row.contact_verified_at ||
        (row.approval_expires_at?.getTime() ?? 0) <= Date.now()
      )
        throw new ConflictException('Verified current approval required');
      const oldContact = await this.currentTarget(client, row, actor);
      await this.evidence.validate(client, row.evidence_keys, row.profile_id);
      if (
        !(
          await client.query(
            "SELECT 1 FROM otp_challenges WHERE challenge_id=$1 AND purpose='account_recovery' AND consumed_at IS NOT NULL AND expires_at>clock_timestamp()",
            [row.challenge_id]
          )
        ).rows.length
      )
        throw new ConflictException('Contact proof expired; send a fresh code');
      if (
        (
          await client.query(
            'SELECT 1 FROM account_login_identifiers WHERE destination=$1 AND user_id<>$2',
            [row.new_login, row.target_user_id]
          )
        ).rows.length
      )
        throw new ConflictException('New contact is already assigned');
      await client.query(
        `UPDATE users SET username=$2,email=CASE WHEN $3 THEN $2 ELSE NULL END,mobile=CASE WHEN $3 THEN NULL ELSE $2 END,password_change_token=NULL,password_change_token_expires_at=NULL,must_change_password=true,updated_at=NOW() WHERE user_id=$1`,
        [row.target_user_id, row.new_login, row.new_login.includes('@')]
      );
      await client.query(
        'UPDATE sessions SET revoked_at=NOW(),updated_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL',
        [row.target_user_id]
      );
      await client.query(
        'UPDATE refresh_tokens SET consumed_at=NOW() WHERE user_id=$1 AND consumed_at IS NULL',
        [row.target_user_id]
      );
      await client.query(
        'UPDATE device_trusts SET expires_at=LEAST(expires_at,NOW()),updated_at=NOW() WHERE user_id=$1',
        [row.target_user_id]
      );
      await client.query(
        'UPDATE otp_challenges SET consumed_at=COALESCE(consumed_at,NOW()),reset_consumed_at=CASE WHEN reset_token_hash IS NOT NULL THEN COALESCE(reset_consumed_at,NOW()) ELSE reset_consumed_at END,attempts_remaining=0,updated_at=NOW() WHERE user_id=$1',
        [row.target_user_id]
      );
      await client.query(
        "UPDATE account_recovery_cases SET state='applied',applied_at=NOW(),updated_at=NOW() WHERE id=$1",
        [id]
      );
      await this.audit(
        client,
        actor.userId,
        'account_recovery_applied',
        id,
        {
          targetUserId: row.target_user_id,
          profileId: row.profile_id,
          oldLogin: row.old_login,
          newLogin: row.new_login,
          oldContacts: {
            username: oldContact.username,
            email: oldContact.email,
            mobile: oldContact.mobile,
          },
          newContacts: {
            username: row.new_login,
            email: row.new_login.includes('@') ? row.new_login : null,
            mobile: row.new_login.includes('@') ? null : row.new_login,
          },
          reviewedBy: row.reviewed_by,
        },
        ip
      );
      if (
        !(
          await client.query(
            "SELECT 1 FROM account_recovery_cases c JOIN otp_challenges o ON o.challenge_id=c.challenge_id WHERE c.id=$1 AND c.approval_expires_at>clock_timestamp() AND o.expires_at>clock_timestamp() AND o.purpose='account_recovery' AND o.user_id=c.target_user_id AND o.destination=c.new_login AND o.consumed_at IS NOT NULL",
            [id]
          )
        ).rows.length
      )
        throw new ConflictException('Recovery proof expired before commit');
      await requireSessionStepUp(client, actor);
      await client.query('COMMIT');
      return { id, state: 'applied' };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (typeof e === 'object' && e !== null && 'code' in e && e.code === '23505')
        throw new ConflictException('An unresolved recovery or assigned contact already exists');
      throw e;
    } finally {
      client.release();
    }
  }
  async complete(
    actor: Actor,
    id: string,
    notices: { oldContact: string; newContact: string },
    ip: string
  ) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const row = await this.staffCase(client, actor, id, 'crm:verify');
      if (row.state !== 'applied' || !row.applied_at)
        throw new ConflictException('Applied recovery required');
      const user = (
        await client.query(
          'SELECT username,must_change_password,last_login_at FROM users WHERE user_id=$1',
          [row.target_user_id]
        )
      ).rows[0];
      const login = (
        await client.query(
          'SELECT 1 FROM sessions WHERE user_id=$1 AND created_at>$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() AND idle_deadline>clock_timestamp() LIMIT 1',
          [row.target_user_id, row.applied_at]
        )
      ).rows[0];
      if (
        user?.username !== row.new_login ||
        user.must_change_password ||
        !user.last_login_at ||
        user.last_login_at <= row.applied_at ||
        !login
      )
        throw new ConflictException('A committed new-contact login is required');
      await client.query(
        "UPDATE account_recovery_cases SET state='completed',notice_references=$2::jsonb,completed_at=NOW(),updated_at=NOW() WHERE id=$1",
        [id, JSON.stringify(notices)]
      );
      await this.audit(
        client,
        actor.userId,
        'account_recovery_completed',
        id,
        { noticeReferences: notices },
        ip
      );
      await requireSessionStepUp(client, actor);
      await client.query('COMMIT');
      return { id, state: 'completed' };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (typeof e === 'object' && e !== null && 'code' in e && e.code === '23505')
        throw new ConflictException('An unresolved recovery or assigned contact already exists');
      throw e;
    } finally {
      client.release();
    }
  }
}
