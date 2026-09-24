import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { requireSessionStepUp } from '../session/session-step-up.js';
import type { ValidatedSession } from '../session/session.service.js';

type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
export type RetentionKind =
  | 'contract'
  | 'invoice'
  | 'payment'
  | 'refund'
  | 'signed_document'
  | 'order'
  | 'solar_request'
  | 'standalone';
export type NewPolicy = { retentionYears: number; legalHold: boolean; approvalNote: string };
export type NewHold = {
  documentId?: string | undefined;
  profileId?: string | undefined;
  reason: string;
  expiresAt?: string | null | undefined;
};

type PolicyRow = {
  id: string;
  business_record_type: RetentionKind;
  retention_years: number;
  legal_hold: boolean;
  approval_note: string;
  effective_date: Date;
  created_by: string | null;
};
type HoldRow = {
  id: string;
  document_id: string | null;
  profile_id: string | null;
  reason: string;
  initiated_by: string;
  initiated_at: Date;
  expires_at: Date | null;
  released_by: string | null;
  released_at: Date | null;
};

function policyDto(row: PolicyRow) {
  return {
    id: row.id,
    businessRecordType: row.business_record_type,
    retentionYears: row.retention_years,
    legalHold: row.legal_hold,
    approvalNote: row.approval_note,
    effectiveDate: row.effective_date,
    createdBy: row.created_by,
  };
}
function holdDto(row: HoldRow) {
  return {
    id: row.id,
    documentId: row.document_id,
    profileId: row.profile_id,
    reason: row.reason,
    initiatedBy: row.initiated_by,
    initiatedAt: row.initiated_at,
    expiresAt: row.expires_at,
    releasedBy: row.released_by,
    releasedAt: row.released_at,
    active: row.released_at === null && (row.expires_at === null || row.expires_at > new Date()),
  };
}

@Injectable()
export class DocumentRetentionService {
  private async write<T>(actor: Actor, callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'admin:documents:edit');
      await requireStaffMutationPermission(client, actor.userId, 'legal:write');
      await requireSessionStepUp(client, actor);
      const result = await callback(client);
      await requireSessionStepUp(client, actor);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async audit(
    client: PoolClient,
    actor: Actor,
    ip: string,
    event: string,
    details: object
  ) {
    await client.query(
      'INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip) VALUES($1,$2,$3,$4::jsonb,$5,$6)',
      [uuidv7(), actor.userId, event, JSON.stringify(details), uuidv7(), ip]
    );
  }

  async listPolicies() {
    const rows = await getDbPool().query<PolicyRow>(
      `SELECT DISTINCT ON (business_record_type) id,business_record_type,retention_years,
        legal_hold,approval_note,effective_date,created_by
       FROM document_retention_policies WHERE effective_date<=NOW()
       ORDER BY business_record_type,effective_date DESC,id DESC`
    );
    return rows.rows.map(policyDto);
  }

  async replacePolicy(kind: RetentionKind, input: NewPolicy, actor: Actor, ip: string) {
    return this.write(actor, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('document_retention_policy:' || $1))",
        [kind]
      );
      const destroying = await client.query(
        `SELECT 1 FROM document_destruction_items i JOIN documents d ON d.id=i.document_id
         WHERE d.business_record_type::text=$1 AND i.status='destroying' LIMIT 1`,
        [kind]
      );
      if (destroying.rowCount)
        throw new ConflictException('Destruction is already in progress for this record type');
      const result = await client.query<PolicyRow>(
        `INSERT INTO document_retention_policies
          (business_record_type,retention_years,legal_hold,approval_note,created_by)
         VALUES($1,$2,$3,$4,$5)
         RETURNING id,business_record_type,retention_years,legal_hold,approval_note,effective_date,created_by`,
        [kind, input.retentionYears, input.legalHold, input.approvalNote, actor.userId]
      );
      const policy = result.rows[0]!;
      await this.audit(client, actor, ip, 'document_retention_policy_changed', {
        policyId: policy.id,
        businessRecordType: kind,
        retentionYears: input.retentionYears,
        legalHold: input.legalHold,
        approvalNote: input.approvalNote,
      });
      return policyDto(policy);
    });
  }

  async listHolds(documentId: string) {
    const document = await getDbPool().query<{ profile_id: string; held: boolean }>(
      'SELECT profile_id,document_is_held(id) AS held FROM documents WHERE id=$1',
      [documentId]
    );
    if (!document.rows[0]) throw new NotFoundException('Document not found');
    const rows = await getDbPool().query<HoldRow>(
      `SELECT id,document_id,profile_id,reason,initiated_by,initiated_at,expires_at,
        released_by,released_at FROM document_legal_holds
       WHERE document_id=$1 OR profile_id=$2
       ORDER BY initiated_at DESC,id DESC LIMIT 100`,
      [documentId, document.rows[0].profile_id]
    );
    return { held: document.rows[0].held, holds: rows.rows.map(holdDto) };
  }

  async createHold(input: NewHold, actor: Actor, ip: string) {
    return this.write(actor, async (client) => {
      const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
      if (expiresAt && expiresAt <= new Date())
        throw new BadRequestException('Legal hold expiry must be in the future');
      const target = input.documentId
        ? await client.query('SELECT id FROM documents WHERE id=$1 FOR UPDATE', [input.documentId])
        : await client.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [input.profileId]);
      if (!target.rows[0]) throw new NotFoundException('Legal hold target not found');
      const started = input.documentId
        ? await client.query(
            `SELECT 1 FROM document_destruction_items
             WHERE document_id=$1 AND status IN ('destroying','destroyed') LIMIT 1`,
            [input.documentId]
          )
        : await client.query(
            `SELECT 1 FROM document_destruction_items
             WHERE profile_id=$1 AND status='destroying' LIMIT 1`,
            [input.profileId]
          );
      if (started.rowCount) throw new ConflictException('Document destruction has already started');
      const result = await client.query<HoldRow>(
        `INSERT INTO document_legal_holds
          (document_id,profile_id,reason,initiated_by,expires_at)
         VALUES($1,$2,$3,$4,$5)
         RETURNING id,document_id,profile_id,reason,initiated_by,initiated_at,expires_at,
           released_by,released_at`,
        [input.documentId ?? null, input.profileId ?? null, input.reason, actor.userId, expiresAt]
      );
      const hold = result.rows[0]!;
      await this.audit(client, actor, ip, 'document_legal_hold_created', {
        holdId: hold.id,
        documentId: hold.document_id,
        profileId: hold.profile_id,
        reason: hold.reason,
        expiresAt: hold.expires_at,
      });
      return holdDto(hold);
    });
  }

  async releaseHold(id: string, note: string, actor: Actor, ip: string) {
    return this.write(actor, async (client) => {
      const existing = await client.query<HoldRow>(
        `SELECT id,document_id,profile_id,reason,initiated_by,initiated_at,expires_at,
          released_by,released_at FROM document_legal_holds WHERE id=$1 FOR UPDATE`,
        [id]
      );
      if (!existing.rows[0]) throw new NotFoundException('Legal hold not found');
      if (existing.rows[0].released_at) throw new ConflictException('Legal hold already released');
      const result = await client.query<HoldRow>(
        `UPDATE document_legal_holds SET released_by=$2,released_at=NOW()
         WHERE id=$1 RETURNING id,document_id,profile_id,reason,initiated_by,initiated_at,
           expires_at,released_by,released_at`,
        [id, actor.userId]
      );
      await this.audit(client, actor, ip, 'document_legal_hold_released', {
        holdId: id,
        note,
      });
      return holdDto(result.rows[0]!);
    });
  }

  async listDestruction() {
    const rows = await getDbPool().query(
      `SELECT i.id,i.document_id AS "documentId",i.profile_id AS "profileId",
        d.business_record_type AS "businessRecordType",i.retention_deadline AS "retentionDeadline",
        i.status,i.planned_at AS "plannedAt",i.approved_at AS "approvedAt",
        i.destroyed_at AS "destroyedAt",i.attempts,i.last_error AS "lastError"
       FROM document_destruction_items i JOIN documents d ON d.id=i.document_id
       ORDER BY i.planned_at DESC,i.id DESC LIMIT 100`
    );
    const counts = await getDbPool().query<{ status: string; count: number }>(
      `SELECT status,count(*)::int AS count FROM document_destruction_items GROUP BY status`
    );
    return { items: rows.rows, counts: counts.rows };
  }

  async approveDestruction(id: string, note: string, actor: Actor, ip: string) {
    return this.write(actor, async (client) => {
      const target = await client.query<{ document_id: string; profile_id: string }>(
        'SELECT document_id,profile_id FROM document_destruction_items WHERE id=$1',
        [id]
      );
      if (!target.rows[0]) throw new NotFoundException('Destruction manifest not found');
      await client.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [
        target.rows[0].profile_id,
      ]);
      const document = await client.query<{
        id: string;
        storage_key: string | null;
        upload_key: string;
        state: string;
      }>('SELECT id,storage_key,upload_key,state FROM documents WHERE id=$1 FOR UPDATE', [
        target.rows[0].document_id,
      ]);
      const item = await client.query<{
        id: string;
        policy_id: string;
        storage_key: string;
        upload_key: string;
        retention_deadline: Date;
        status: string;
      }>(
        `SELECT id,policy_id,storage_key,upload_key,retention_deadline,status
         FROM document_destruction_items WHERE id=$1 FOR UPDATE`,
        [id]
      );
      const current = item.rows[0];
      if (!current || current.status !== 'pending_approval')
        throw new ConflictException('Destruction manifest is no longer pending');
      const eligibility = await client.query<{ policy_id: string; retention_deadline: Date }>(
        'SELECT policy_id,retention_deadline FROM document_retention_eligibility($1)',
        [target.rows[0].document_id]
      );
      const held = await client.query<{ held: boolean }>('SELECT document_is_held($1) AS held', [
        target.rows[0].document_id,
      ]);
      if (
        document.rows[0]?.state !== 'Removed' ||
        document.rows[0].storage_key !== current.storage_key ||
        document.rows[0].upload_key !== current.upload_key ||
        eligibility.rows[0]?.policy_id !== current.policy_id ||
        eligibility.rows[0]?.retention_deadline?.getTime() !==
          current.retention_deadline.getTime() ||
        !eligibility.rows[0]?.retention_deadline ||
        eligibility.rows[0].retention_deadline > new Date() ||
        held.rows[0]?.held
      )
        throw new ConflictException('Document is no longer eligible for destruction');
      const approved = await client.query(
        `UPDATE document_destruction_items SET status='approved',approved_by=$2,
          approved_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING id,document_id,status,approved_at`,
        [id, actor.userId]
      );
      await this.audit(client, actor, ip, 'document_destruction_approved', {
        itemId: id,
        documentId: target.rows[0].document_id,
        note,
      });
      return approved.rows[0];
    });
  }
}
