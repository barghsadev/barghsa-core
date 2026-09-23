import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { v7 as uuidv7 } from 'uuid';
import type { ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { OrdersService } from '../orders/orders.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
interface ProductRow {
  id: string;
  system_key: string | null;
  title: { fa: string; en: string };
  description: { fa?: string; en?: string } | null;
  legal_only: boolean;
}

export interface ConsultationSubmission {
  profileId: string;
  productId: string;
  submissionKey: string;
}

@Injectable()
export class ConsultationRequestService {
  constructor(private readonly orders: OrdersService) {}

  private readonly productSql = `SELECT p.id,p.system_key,p.title,p.description,
    (p.system_key='electricity_saving_certificate' OR EXISTS(
      SELECT 1 FROM product_categories pc WHERE pc.product_id=p.id
        AND pc.category='electricity_saving_certificate_consultation'
    )) AS legal_only
    FROM products p WHERE p.type='consultation' AND p.status='active'`;

  async products(actor: Actor, profileId: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireCurrentSession(client, actor);
      if (!(await this.orders.mayManageOrders(client, actor.userId, profileId)))
        throw new NotFoundException('Profile not found');
      const profile = (
        await client.query<{ profile_type: string }>(
          'SELECT profile_type FROM profiles WHERE id=$1',
          [profileId]
        )
      ).rows[0]!;
      const rows = (await client.query<ProductRow>(`${this.productSql} ORDER BY p.created_at,p.id`))
        .rows;
      await client.query('COMMIT');
      return {
        products: rows
          .filter((row) => !row.legal_only || profile.profile_type === 'LEGAL')
          .map((row) => ({
            id: row.id,
            systemKey: row.system_key,
            title: row.title,
            description: row.description,
            legalOnly: row.legal_only,
          })),
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async submit(actor: Actor, input: ConsultationSubmission, ip: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.orders.lockOrderActor(client, actor);
      if (!(await this.orders.mayManageOrders(client, actor.userId, input.profileId, true)))
        throw new NotFoundException('Profile not found');
      await this.orders.lockProfileSubmissions(client, input.profileId);
      const previous = (
        await client.query<{ id: string; profile_id: string; product_id: string }>(
          'SELECT id,profile_id,product_id FROM consultation_requests WHERE submitted_by=$1 AND submission_key=$2',
          [actor.userId, input.submissionKey]
        )
      ).rows[0];
      if (previous) {
        if (previous.profile_id !== input.profileId || previous.product_id !== input.productId)
          throw new BadRequestException('Submission key belongs to another request');
        await client.query('COMMIT');
        return { requestId: previous.id, status: 'submitted' as const };
      }
      await this.orders.enforceProfileSubmissionLimit(client, input.profileId);
      const profile = (
        await client.query<{ profile_type: string; user_id: string }>(
          'SELECT profile_type,user_id FROM profiles WHERE id=$1',
          [input.profileId]
        )
      ).rows[0]!;
      const product = (
        await client.query<ProductRow>(`${this.productSql} AND p.id=$1 FOR SHARE OF p`, [
          input.productId,
        ])
      ).rows[0];
      if (!product) throw new BadRequestException('Choose an active consultation product');
      if (product.legal_only && profile.profile_type !== 'LEGAL')
        throw new BadRequestException('This consultation requires a legal-entity profile');
      const requestId = uuidv7();
      await client.query(
        `INSERT INTO consultation_requests(id,profile_id,product_id,product_snapshot,
          submitted_by,submission_key,status)
         VALUES($1,$2,$3,$4::jsonb,$5,$6,'submitted')`,
        [
          requestId,
          input.profileId,
          product.id,
          JSON.stringify({
            systemKey: product.system_key,
            title: product.title,
            description: product.description,
          }),
          actor.userId,
          input.submissionKey,
        ]
      );
      await client.query(
        `INSERT INTO consultation_request_events(id,request_id,status,actor_user_id)
         VALUES($1,$2,'submitted',$3)`,
        [uuidv7(), requestId, actor.userId]
      );
      for (const userId of new Set([profile.user_id, actor.userId])) {
        await new NotificationsService().create(
          {
            userId,
            profileId: input.profileId,
            type: 'general',
            title: 'Consultation request submitted',
            localizedContent: {
              fa: {
                title: 'درخواست مشاوره ثبت شد',
                body: 'درخواست مشاوره برای بررسی کارشناسان ثبت شد.',
              },
              en: {
                title: 'Consultation request submitted',
                body: 'Your consultation request has been sent for staff review.',
              },
            },
            link: `/consultations/${requestId}`,
          },
          client
        );
      }
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
         VALUES($1,$2,'consultation.request.submitted',$3::jsonb,$4,$5)`,
        [
          uuidv7(),
          actor.userId,
          JSON.stringify({ requestId, profileId: input.profileId, productId: product.id }),
          uuidv7(),
          ip,
        ]
      );
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return { requestId, status: 'submitted' as const };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async list(actor: Actor, profileId: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireCurrentSession(client, actor);
      if (!(await this.orders.mayManageOrders(client, actor.userId, profileId)))
        throw new NotFoundException('Profile not found');
      const rows = (
        await client.query(
          `SELECT id,status,product_snapshot,submitted_at,staff_owner_id,expected_next_step
         FROM consultation_requests WHERE profile_id=$1
         ORDER BY submitted_at DESC,id DESC LIMIT 100`,
          [profileId]
        )
      ).rows;
      await client.query('COMMIT');
      return { requests: rows };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async detail(actor: Actor, id: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireCurrentSession(client, actor);
      const request = (
        await client.query<Record<string, unknown>>(
          `SELECT r.id,r.profile_id,r.product_id,r.product_snapshot,r.status,r.staff_owner_id,r.staff_team,
          r.fee::text AS fee,r.scope,r.deliverables,r.expected_next_step,r.offer_valid_until,r.invoice_id,
          r.accepted_at,i.state AS invoice_state,r.submitted_at,r.updated_at,
          EXISTS(SELECT 1 FROM invoices paid WHERE paid.consultation_id=r.id::text AND paid.paid_amount>0) AS has_paid_invoice
          FROM consultation_requests r LEFT JOIN invoices i ON i.id=r.invoice_id WHERE r.id=$1`,
          [id]
        )
      ).rows[0];
      if (
        !request ||
        !(await this.orders.mayManageOrders(client, actor.userId, request.profile_id as string))
      )
        throw new NotFoundException('Consultation request not found');
      const history = (
        await client.query(
          `SELECT e.status,
             CASE WHEN u.is_staff THEN 'staff' ELSE 'customer' END AS actor_type,
             e.reason,e.created_at
           FROM consultation_request_events e JOIN users u ON u.user_id=e.actor_user_id
           WHERE e.request_id=$1 ORDER BY e.created_at,e.id`,
          [id]
        )
      ).rows;
      const adjustments = (
        await client.query(
          `SELECT id,adjustment_kind,total_amount::text AS amount,state
           FROM invoices WHERE consultation_id=$1 AND adjustment_for_invoice_id IS NOT NULL
           ORDER BY created_at,id`,
          [id]
        )
      ).rows;
      const refunds = (
        await client.query(
          `SELECT r.id,r.amount::text AS amount,r.state,r.destination
           FROM refunds r JOIN invoices i ON i.id=r.invoice_id
           WHERE i.consultation_id=$1 ORDER BY r.created_at,r.id`,
          [id]
        )
      ).rows;
      await client.query('COMMIT');
      return { request, history, adjustments, refunds };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
