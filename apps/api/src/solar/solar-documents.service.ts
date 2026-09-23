import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { v7 as uuidv7 } from 'uuid';
import type { PoolClient } from 'pg';
import { OrdersService } from '../orders/orders.service.js';
import { requireCurrentSession, requireSessionStepUp } from '../session/session-step-up.js';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { DocumentService } from '../documents/document.service.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';

type Actor = AuthenticatedRequest['session'];
const GUIDANCE_KEY = 'solar.document_guidance';
const defaultGuidance = {
  fa: 'مدارک مرتبط با محل و درخواست خود را بارگذاری کنید.',
  en: 'Upload documents relevant to your site and request.',
  suggestions: [] as Array<{ fa: string; en: string }>,
};
export type SolarGuidance = typeof defaultGuidance;

async function audit(
  client: PoolClient,
  actor: Actor,
  event: string,
  requestId: string | null,
  metadata: Record<string, unknown>,
  ip: string
) {
  await client.query(
    `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
     VALUES($1,$2,$3,$4::jsonb,$5,$6)`,
    [
      uuidv7(),
      actor.userId,
      event,
      JSON.stringify({ ...(requestId ? { requestId } : {}), ...metadata }),
      uuidv7(),
      ip,
    ]
  );
}

@Injectable()
export class SolarDocumentsService {
  constructor(
    private readonly orders: OrdersService,
    private readonly documents: DocumentService
  ) {}

  async guidance(): Promise<SolarGuidance> {
    const row = (
      await getDbPool().query<{ value: SolarGuidance }>(
        'SELECT value FROM app_config WHERE key=$1',
        [GUIDANCE_KEY]
      )
    ).rows[0];
    return row?.value ?? defaultGuidance;
  }

  async setGuidance(actor: Actor, value: SolarGuidance, ip: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'admin:catalogue:edit');
      await requireSessionStepUp(client, actor);
      await client.query(
        `INSERT INTO app_config(key,value,version,updated_at) VALUES($1,$2::jsonb,1,NOW())
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,version=app_config.version+1,updated_at=NOW()`,
        [GUIDANCE_KEY, JSON.stringify(value)]
      );
      await client.query(
        "UPDATE config_version SET version=version+1,updated_at=NOW() WHERE id='global'"
      );
      await audit(
        client,
        actor,
        'solar.document_guidance.updated',
        null,
        { suggestions: value.suggestions.length },
        ip
      );
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async customerState(actor: Actor, requestId: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireCurrentSession(client, actor);
      const request = (
        await client.query<{ profile_id: string; status: string }>(
          'SELECT profile_id,status FROM solar_construction_requests WHERE id=$1',
          [requestId]
        )
      ).rows[0];
      if (
        !request ||
        !(await this.orders.mayManageOrders(client, actor.userId, request.profile_id))
      )
        throw new NotFoundException('Solar request not found');
      const requests = (
        await client.query(
          'SELECT id,description,created_at FROM solar_document_requests WHERE request_id=$1 ORDER BY created_at,id',
          [requestId]
        )
      ).rows;
      const guidance =
        (
          await client.query<{ value: SolarGuidance }>(
            'SELECT value FROM app_config WHERE key=$1',
            [GUIDANCE_KEY]
          )
        ).rows[0]?.value ?? defaultGuidance;
      await client.query('COMMIT');
      return {
        status: request.status,
        requestedDocuments: requests,
        guidance,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(actor: Actor, requestId: string, ip: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireCurrentSession(client, actor);
      const request = (
        await client.query<{ profile_id: string; status: string }>(
          'SELECT profile_id,status FROM solar_construction_requests WHERE id=$1 FOR UPDATE',
          [requestId]
        )
      ).rows[0];
      if (
        !request ||
        !(await this.orders.mayManageOrders(client, actor.userId, request.profile_id))
      )
        throw new NotFoundException('Solar request not found');
      if (
        ![
          'submitted',
          'uploading_documents',
          'changes_requested',
          'documents_under_review',
        ].includes(request.status)
      )
        throw new ConflictException('Solar request is past document review');
      const pending = await client.query<{ id: string }>(
        `SELECT id FROM documents WHERE business_record_type='solar_request' AND business_record_id=$1
         AND state IN ('Uploading','PendingScan')`,
        [requestId]
      );
      if (pending.rowCount) throw new ConflictException('Wait for pending uploads to finish');
      const available = await client.query<{ id: string; revision: number }>(
        `UPDATE documents SET state='SubmittedForReview'
         WHERE business_record_type='solar_request' AND business_record_id=$1 AND state='Available'
         RETURNING id,revision`,
        [requestId]
      );
      for (const document of available.rows)
        await client.query(
          `INSERT INTO document_events(document_id,revision,previous_state,state,actor_id)
           VALUES($1,$2,'Available','SubmittedForReview',$3)`,
          [document.id, document.revision, actor.userId]
        );
      if (request.status !== 'documents_under_review')
        await client.query(
          "UPDATE solar_construction_requests SET status='documents_under_review',updated_at=NOW() WHERE id=$1",
          [requestId]
        );
      await audit(
        client,
        actor,
        'solar.documents.submitted',
        requestId,
        { documents: available.rowCount ?? 0, previousStatus: request.status },
        ip
      );
      await client.query('COMMIT');
      return { status: 'documents_under_review' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async staffQueue(actor: Actor, before?: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'orders:read');
      await requireCurrentSession(client, actor);
      const cursor = before
        ? (
            await client.query<{ id: string; created_at: string }>(
              `SELECT id,created_at::text AS created_at FROM solar_construction_requests
               WHERE id=$1 AND status IN ('submitted','uploading_documents','documents_under_review','changes_requested')`,
              [before]
            )
          ).rows[0]
        : null;
      if (before && !cursor) throw new NotFoundException('Solar request cursor not found');
      const rows = (
        await client.query(
          `SELECT r.id,r.profile_id,r.status,r.building_type,r.created_at,
           COALESCE(NULLIF(lp.legal_name,''),NULLIF(TRIM(CONCAT_WS(' ',p.first_name,p.last_name)),''),u.username) AS profile_name,
           count(sd.id) FILTER (WHERE d.state NOT IN ('Removed','Superseded'))::int AS document_count
         FROM solar_construction_requests r
         JOIN profiles p ON p.id=r.profile_id
         JOIN users u ON u.user_id=p.user_id
         LEFT JOIN legal_profiles lp ON lp.id=p.id
         LEFT JOIN solar_construction_documents sd ON sd.request_id=r.id
         LEFT JOIN documents d ON d.id=sd.document_id
         WHERE r.status IN ('submitted','uploading_documents','documents_under_review','changes_requested')
           AND ($1::timestamptz IS NULL OR (r.created_at,r.id) < ($1::timestamptz,$2::uuid))
         GROUP BY r.id,p.id,u.user_id,lp.id ORDER BY r.created_at DESC,r.id DESC LIMIT 101`,
          [cursor?.created_at ?? null, before ?? null]
        )
      ).rows;
      await client.query('COMMIT');
      return { requests: rows.slice(0, 100), nextBefore: rows.length > 100 ? rows[99]!.id : null };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async staffDocumentQueue(actor: Actor, before?: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'orders:read');
      await requireCurrentSession(client, actor);
      const cursor = before
        ? (
            await client.query<{ id: string; uploaded_at: string }>(
              'SELECT id,uploaded_at::text AS uploaded_at FROM solar_construction_documents WHERE id=$1',
              [before]
            )
          ).rows[0]
        : null;
      if (before && !cursor) throw new NotFoundException('Solar document cursor not found');
      const rows = (
        await client.query(
          `SELECT sd.id,sd.request_id,sd.document_id,sd.file_name,sd.uploaded_by,
                  u.username AS uploaded_by_name,
                  sd.uploaded_at,sd.staff_status,r.status AS request_status
           FROM solar_construction_documents sd
           JOIN solar_construction_requests r ON r.id=sd.request_id
           JOIN documents d ON d.id=sd.document_id
           JOIN users u ON u.user_id=sd.uploaded_by
           WHERE r.status IN ('documents_under_review','changes_requested')
             AND sd.staff_status='pending'
             AND d.state IN ('Available','SubmittedForReview')
             AND ($1::timestamptz IS NULL OR (sd.uploaded_at,sd.id) < ($1::timestamptz,$2::uuid))
           ORDER BY sd.uploaded_at DESC,sd.id DESC LIMIT 101`,
          [cursor?.uploaded_at ?? null, before ?? null]
        )
      ).rows;
      await client.query('COMMIT');
      return { documents: rows.slice(0, 100), nextBefore: rows.length > 100 ? rows[99]!.id : null };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async staffDocuments(actor: Actor, requestId: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'orders:read');
      await requireCurrentSession(client, actor);
      const request = (
        await client.query(
          'SELECT id,profile_id,status FROM solar_construction_requests WHERE id=$1',
          [requestId]
        )
      ).rows[0];
      if (!request) throw new NotFoundException('Solar request not found');
      const documents = (
        await client.query(
          `SELECT sd.id,sd.document_id,sd.file_name,sd.staff_status,sd.staff_reason,
          sd.uploaded_by,sd.uploaded_at,d.state,d.revision,d.supersedes_document_id
         FROM solar_construction_documents sd JOIN documents d ON d.id=sd.document_id
         WHERE sd.request_id=$1 ORDER BY sd.uploaded_at,sd.id`,
          [requestId]
        )
      ).rows;
      const requests = (
        await client.query(
          'SELECT id,description,created_at FROM solar_document_requests WHERE request_id=$1 ORDER BY created_at,id',
          [requestId]
        )
      ).rows;
      await client.query('COMMIT');
      return { request, documents, requestedDocuments: requests };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async decide(
    actor: Actor,
    requestId: string,
    documentId: string,
    decision: 'approve' | 'reject',
    expectedRevision: number,
    reason: string | undefined,
    ip: string
  ) {
    const belongs = (
      await getDbPool().query(
        'SELECT 1 FROM solar_construction_documents WHERE request_id=$1 AND document_id=$2',
        [requestId, documentId]
      )
    ).rowCount;
    if (!belongs) throw new NotFoundException('Solar document not found');
    if (decision === 'reject' && !reason?.trim())
      throw new BadRequestException('Reason is required');
    return this.documents.act(
      documentId,
      decision,
      { expectedRevision, idempotencyKey: uuidv7(), ...(reason ? { reason } : {}) },
      actor,
      true,
      ip
    );
  }

  async requestAdditional(actor: Actor, requestId: string, description: string, ip: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'orders:write');
      await requireSessionStepUp(client, actor);
      const request = (
        await client.query<{ profile_id: string; status: string; user_id: string }>(
          `SELECT r.profile_id,r.status,p.user_id FROM solar_construction_requests r
         JOIN profiles p ON p.id=r.profile_id WHERE r.id=$1 FOR UPDATE OF r`,
          [requestId]
        )
      ).rows[0];
      if (!request) throw new NotFoundException('Solar request not found');
      if (!['documents_under_review', 'changes_requested'].includes(request.status))
        throw new ConflictException('Document review is not active');
      await client.query(
        'INSERT INTO solar_document_requests(request_id,description,requested_by) VALUES($1,$2,$3)',
        [requestId, description, actor.userId]
      );
      await client.query(
        "UPDATE solar_construction_requests SET status='changes_requested',updated_at=NOW() WHERE id=$1",
        [requestId]
      );
      await new NotificationsService().create(
        {
          userId: request.user_id,
          profileId: request.profile_id,
          type: 'general',
          title: 'Additional solar documents requested',
          localizedContent: {
            fa: { title: 'مدارک نیروگاه خورشیدی', body: `مدرک تکمیلی درخواست شد: ${description}` },
            en: { title: 'Solar documents', body: `Additional document requested: ${description}` },
          },
        },
        client
      );
      await audit(
        client,
        actor,
        'solar.documents.additional_requested',
        requestId,
        { description },
        ip
      );
      await client.query('COMMIT');
      return { status: 'changes_requested' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async advanceToPostal(actor: Actor, requestId: string, ip: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'orders:write');
      await requireSessionStepUp(client, actor);
      const request = (
        await client.query<{ profile_id: string; status: string; user_id: string }>(
          `SELECT r.profile_id,r.status,p.user_id FROM solar_construction_requests r
         JOIN profiles p ON p.id=r.profile_id WHERE r.id=$1 FOR UPDATE OF r`,
          [requestId]
        )
      ).rows[0];
      if (!request) throw new NotFoundException('Solar request not found');
      if (!['documents_under_review', 'changes_requested'].includes(request.status))
        throw new ConflictException('Document review is not active');
      await client.query(
        "UPDATE solar_construction_requests SET status='waiting_for_postal_submission',updated_at=NOW() WHERE id=$1",
        [requestId]
      );
      await client.query(
        'INSERT INTO solar_construction_postal(request_id) VALUES($1) ON CONFLICT(request_id) DO NOTHING',
        [requestId]
      );
      await new NotificationsService().create(
        {
          userId: request.user_id,
          profileId: request.profile_id,
          type: 'general',
          title: 'Solar document set approved',
          localizedContent: {
            fa: {
              title: 'درخواست نیروگاه خورشیدی',
              body: 'مدارک بررسی شد. مرحله بعد ارسال پستی مدارک است.',
            },
            en: {
              title: 'Solar request',
              body: 'Documents were reviewed. Postal submission is next.',
            },
          },
        },
        client
      );
      await audit(client, actor, 'solar.documents.approved_for_postal', requestId, {}, ip);
      await client.query('COMMIT');
      return { status: 'waiting_for_postal_submission' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
