import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { OrdersService } from '../orders/orders.service.js';
import { requireCurrentSession, requireSessionStepUp } from '../session/session-step-up.js';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ReviewSnapshotService } from '../finance/review-snapshot.service.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { InputFieldException } from '../common/input-field.exception.js';

type Actor = AuthenticatedRequest['session'];
type PostalDecision = 'received' | 'incomplete' | 'not_received';
export type SolarPostalStaffLane = 'all' | 'needs_staff' | 'waiting_customer';
export interface PostalGuidance {
  fa: string;
  en: string;
  destinationAddress: string;
  contactDetails: string;
  originals: Array<{ fa: string; en: string }>;
}
const GUIDANCE_KEY = 'solar.postal_guidance';
const defaultGuidance: PostalGuidance = {
  fa: 'برای نشانی و مدارک اصلی موردنیاز، با پشتیبانی هماهنگ کنید.',
  en: 'Contact support for the destination address and required originals.',
  destinationAddress: '',
  contactDetails: '',
  originals: [],
};

async function audit(
  client: PoolClient,
  actor: Actor,
  event: string,
  metadata: Record<string, unknown>,
  ip: string
) {
  await client.query(
    `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
     VALUES($1,$2,$3,$4::jsonb,$5,$6)`,
    [uuidv7(), actor.userId, event, JSON.stringify(metadata), uuidv7(), ip]
  );
}

@Injectable()
export class SolarPostalService {
  constructor(private readonly orders: OrdersService) {}
  private readonly reviews = new ReviewSnapshotService();

  async guidance(): Promise<PostalGuidance> {
    const row = (
      await getDbPool().query<{ value: PostalGuidance }>(
        'SELECT value FROM app_config WHERE key=$1',
        [GUIDANCE_KEY]
      )
    ).rows[0];
    return row?.value ?? defaultGuidance;
  }

  async setGuidance(actor: Actor, value: PostalGuidance, ip: string) {
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
        'solar.postal_guidance.updated',
        { originals: value.originals.length },
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
      const postal =
        (
          await client.query(
            `SELECT status,courier,tracking_number,(send_date AT TIME ZONE 'UTC')::date::text AS send_date,
                receipt_image_id,staff_notes,staff_confirmed_at,estimated_arrival_date::text,
                tracking_url,tracking_note,tracking_recorded_at FROM solar_construction_postal WHERE request_id=$1`,
            [requestId]
          )
        ).rows[0] ?? null;
      const guidance =
        (
          await client.query<{ value: PostalGuidance }>(
            'SELECT value FROM app_config WHERE key=$1',
            [GUIDANCE_KEY]
          )
        ).rows[0]?.value ?? defaultGuidance;
      await requireCurrentSession(client, actor);
      if (!(await this.orders.mayManageOrders(client, actor.userId, request.profile_id)))
        throw new NotFoundException('Solar request not found');
      await client.query('COMMIT');
      return { requestStatus: request.status, postal, guidance };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async shipment(
    actor: Actor,
    requestId: string,
    input: {
      courier: string;
      trackingNumber: string;
      sendDate: string;
      receiptImageId?: string | undefined;
    },
    ip: string
  ) {
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
      if (request.status !== 'waiting_for_postal_submission')
        throw new ConflictException('Postal submission is not available');
      const postal = (
        await client.query<{ status: string }>(
          'SELECT status FROM solar_construction_postal WHERE request_id=$1 FOR UPDATE',
          [requestId]
        )
      ).rows[0];
      if (
        !postal ||
        !['waiting_for_shipment', 'incomplete', 'not_received'].includes(postal.status)
      )
        throw new ConflictException('Shipment is already under review');
      if (input.sendDate > new Date().toISOString().slice(0, 10))
        throw new InputFieldException(['sendDate']);
      if (input.receiptImageId) {
        const receipt = (
          await client.query(
            `SELECT 1 FROM documents WHERE id=$1 AND profile_id=$2
           AND business_record_type='solar_request' AND business_record_id=$3
           AND category='image' AND state='Available' AND uploaded_by=$4`,
            [input.receiptImageId, request.profile_id, requestId, actor.userId]
          )
        ).rows[0];
        if (!receipt) throw new InputFieldException(['receiptImageId']);
      }
      await client.query(
        `UPDATE solar_construction_postal SET status='shipped',courier=$2,tracking_number=$3,
         send_date=$4::date::timestamptz,receipt_image_id=$5,staff_notes=NULL,
         staff_confirmed_by=NULL,staff_confirmed_at=NULL WHERE request_id=$1`,
        [
          requestId,
          input.courier,
          input.trackingNumber,
          input.sendDate,
          input.receiptImageId ?? null,
        ]
      );
      await audit(
        client,
        actor,
        'solar.postal.shipped',
        {
          requestId,
          courier: input.courier,
          trackingNumber: input.trackingNumber,
          receiptImageId: input.receiptImageId ?? null,
        },
        ip
      );
      await client.query('COMMIT');
      return { status: 'shipped' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async staffQueue(actor: Actor, before?: string, lane: SolarPostalStaffLane = 'all') {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'orders:read');
      await requireCurrentSession(client, actor);
      const cursor = before
        ? (
            await client.query<{ id: string; created_at: string }>(
              `SELECT r.id,r.created_at::text AS created_at FROM solar_construction_requests r
               JOIN solar_construction_postal p ON p.request_id=r.id
               WHERE r.id=$1 AND r.status IN ('waiting_for_postal_submission','postal_documents_received','final_review','approved')
                 AND ($2::text='all'
                   OR ($2='needs_staff' AND (p.status='shipped' OR r.status IN ('postal_documents_received','final_review','approved')))
                   OR ($2='waiting_customer' AND r.status='waiting_for_postal_submission' AND p.status<>'shipped'))`,
              [before, lane]
            )
          ).rows[0]
        : null;
      if (before && !cursor) throw new NotFoundException('Solar postal cursor not found');
      const rows = (
        await client.query(
          `SELECT r.id,r.profile_id,r.status AS request_status,p.status AS postal_status,
          COALESCE(NULLIF(lp.legal_name,''),NULLIF(TRIM(CONCAT_WS(' ',profile.first_name,profile.last_name)),''),u.username) AS profile_name,
            p.courier,p.tracking_number,p.send_date,p.receipt_image_id,p.staff_notes,r.created_at,
            p.estimated_arrival_date::text,p.tracking_url,p.tracking_note,p.tracking_revision,p.tracking_recorded_at
         FROM solar_construction_requests r JOIN solar_construction_postal p ON p.request_id=r.id
         JOIN profiles profile ON profile.id=r.profile_id
         JOIN users u ON u.user_id=profile.user_id
         LEFT JOIN legal_profiles lp ON lp.id=profile.id
         WHERE r.status IN ('waiting_for_postal_submission','postal_documents_received','final_review','approved')
           AND ($1::timestamptz IS NULL OR (r.created_at,r.id) < ($1::timestamptz,$2::uuid))
           AND ($3::text='all'
             OR ($3='needs_staff' AND (p.status='shipped' OR r.status IN ('postal_documents_received','final_review','approved')))
             OR ($3='waiting_customer' AND r.status='waiting_for_postal_submission' AND p.status<>'shipped'))
         ORDER BY r.created_at DESC,r.id DESC LIMIT 101`,
          [cursor?.created_at ?? null, before ?? null, lane]
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

  private async postalDecisionSnapshot(
    client: PoolClient,
    requestId: string,
    decision: PostalDecision,
    reason: string | undefined,
    lock: 'SHARE' | 'UPDATE'
  ) {
    const decisionReason = reason?.trim();
    if (decision !== 'received' && !decisionReason)
      throw new BadRequestException('Reason is required');
    const request = (
      await client.query<{ profile_id: string; status: string; user_id: string }>(
        `SELECT r.profile_id,r.status,p.user_id FROM solar_construction_requests r
         JOIN profiles p ON p.id=r.profile_id WHERE r.id=$1 FOR ${lock} OF r`,
        [requestId]
      )
    ).rows[0];
    if (!request) throw new NotFoundException('Solar request not found');
    if (request.status !== 'waiting_for_postal_submission')
      throw new ConflictException('Postal review is not active');
    const postal = (
      await client.query<{
        status: string;
        courier: string | null;
        tracking_number: string | null;
        send_date: string | null;
        receipt_image_id: string | null;
      }>(
        `SELECT status,courier,tracking_number,send_date::date::text AS send_date,receipt_image_id
         FROM solar_construction_postal WHERE request_id=$1 FOR ${lock}`,
        [requestId]
      )
    ).rows[0];
    if (!postal || postal.status !== 'shipped')
      throw new ConflictException('No shipment awaits review');
    const requestOutcome =
      decision === 'received' ? 'postal_documents_received' : 'waiting_for_postal_submission';
    const review = this.reviews.create(
      { action: `solar.postal.${decision}`, profileId: request.profile_id, resourceId: requestId },
      {
        requestId,
        currentRequestStatus: request.status,
        currentPostalStatus: postal.status,
        courier: postal.courier,
        trackingNumber: postal.tracking_number,
        sendDate: postal.send_date,
        receiptImageId: postal.receipt_image_id,
        decision,
        reason: decision === 'received' ? null : decisionReason,
        postalOutcome: decision,
        requestOutcome,
        createsContract: false,
        createsInvoice: false,
      }
    );
    return { request, review, decisionReason, requestOutcome };
  }

  async reviewDecision(
    actor: Actor,
    requestId: string,
    decision: PostalDecision,
    reason: string | undefined
  ) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'orders:write');
      const { review } = await this.postalDecisionSnapshot(
        client,
        requestId,
        decision,
        reason,
        'SHARE'
      );
      await client.query('COMMIT');
      return review;
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
    decision: PostalDecision,
    reason: string | undefined,
    expectedReviewHash: string,
    ip: string
  ) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'orders:write');
      await requireSessionStepUp(client, actor);
      const { request, review, decisionReason, requestOutcome } = await this.postalDecisionSnapshot(
        client,
        requestId,
        decision,
        reason,
        'UPDATE'
      );
      this.reviews.assertConfirmed(review, expectedReviewHash);
      await client.query(
        `UPDATE solar_construction_postal SET status=$2,staff_notes=$3,
         staff_confirmed_by=$4,staff_confirmed_at=NOW() WHERE request_id=$1`,
        [requestId, decision, decisionReason ?? null, actor.userId]
      );
      if (decision === 'received')
        await client.query(
          "UPDATE solar_construction_requests SET status='postal_documents_received',updated_at=NOW() WHERE id=$1",
          [requestId]
        );
      await new NotificationsService().create(
        {
          userId: request.user_id,
          profileId: request.profile_id,
          operatingContext: 'customer',
          type: 'general',
          title:
            decision === 'received'
              ? 'Postal documents received'
              : 'Postal submission needs attention',
          localizedContent: {
            fa: {
              title: 'مدارک پستی نیروگاه خورشیدی',
              body:
                decision === 'received'
                  ? 'مدارک پستی شما دریافت شد.'
                  : `ارسال پستی نیازمند پیگیری است: ${decisionReason}`,
            },
            en: {
              title: 'Solar postal documents',
              body:
                decision === 'received'
                  ? 'Your postal documents were received.'
                  : `Postal submission needs attention: ${decisionReason}`,
            },
          },
        },
        client
      );
      await audit(
        client,
        actor,
        `solar.postal.${decision}`,
        { requestId, reason: decisionReason ?? null, financialReview: review },
        ip
      );
      await client.query('COMMIT');
      return {
        status: decision,
        requestStatus: requestOutcome,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
