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
}
