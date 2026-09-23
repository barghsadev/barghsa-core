import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { v7 as uuidv7 } from 'uuid';
import type { PoolClient } from 'pg';
import type { ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { OrdersService } from '../orders/orders.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { tConsultation } from '@barghsa/i18n/consultation';
import { canTransitionConsultation, type ConsultationStatus } from './consultation-state.js';

type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
type StaffAction = 'review' | 'request-info' | 'reject' | 'cancel';
interface RequestRow {
  id: string;
  profile_id: string;
  status: ConsultationStatus;
  staff_owner_id: string | null;
  staff_team: string | null;
  submitted_by: string;
  profile_user_id: string;
  invoice_id: string | null;
}

@Injectable()
export class ConsultationWorkflowService {
  constructor(private readonly orders: OrdersService) {}

  async teams(actor: Actor) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireCurrentSession(client, actor);
      await requireStaffMutationPermission(client, actor.userId, 'orders:read');
      const teams = (
        await client.query<{ name: string }>(
          'SELECT name FROM staff_teams WHERE is_active ORDER BY name'
        )
      ).rows;
      await client.query('COMMIT');
      return { teams };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async queue(
    actor: Actor,
    status?: ConsultationStatus,
    assignment: 'all' | 'mine' | 'unassigned' = 'all',
    priority: 'all' | 'high' | 'normal' = 'all',
    minAgeDays = 0
  ) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireCurrentSession(client, actor);
      await requireStaffMutationPermission(client, actor.userId, 'orders:read');
      const requests = (
        await client.query(
          `SELECT r.id,r.profile_id,r.status,r.product_snapshot,r.staff_owner_id,r.staff_team,
          r.submitted_at,r.expected_next_step,
          CASE WHEN r.submitted_at<NOW()-INTERVAL '2 days' THEN 'high' ELSE 'normal' END AS priority,
          COALESCE(NULLIF(lp.legal_name,''),NULLIF(TRIM(CONCAT_WS(' ',p.first_name,p.last_name)),''),p.id::text) AS profile_name
         FROM consultation_requests r JOIN profiles p ON p.id=r.profile_id
         LEFT JOIN legal_profiles lp ON lp.id=p.id
         WHERE (($1::text IS NULL AND r.status NOT IN ('offer_declined','completed','rejected','cancelled'))
                OR r.status=$1)
           AND ($2::text='all' OR ($2='mine' AND r.staff_owner_id=$3)
                OR ($2='unassigned' AND r.staff_owner_id IS NULL AND r.staff_team IS NULL))
           AND ($4::text='all' OR ($4='high' AND r.submitted_at<NOW()-INTERVAL '2 days')
                OR ($4='normal' AND r.submitted_at>=NOW()-INTERVAL '2 days'))
           AND ($5::int=0 OR r.submitted_at<=NOW()-($5::int * INTERVAL '1 day'))
         ORDER BY CASE r.status WHEN 'submitted' THEN 0 WHEN 'awaiting_customer_info' THEN 2 ELSE 1 END,
           r.submitted_at,r.id LIMIT 100`,
          [status ?? null, assignment, actor.userId, priority, minAgeDays]
        )
      ).rows;
      await client.query('COMMIT');
      return { requests };
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
      await requireStaffMutationPermission(client, actor.userId, 'orders:read');
      const request = (
        await client.query(
          `SELECT r.*,p.profile_type,p.user_id AS profile_user_id,
          COALESCE(NULLIF(lp.legal_name,''),NULLIF(TRIM(CONCAT_WS(' ',p.first_name,p.last_name)),''),p.id::text) AS profile_name
         FROM consultation_requests r JOIN profiles p ON p.id=r.profile_id
         LEFT JOIN legal_profiles lp ON lp.id=p.id WHERE r.id=$1`,
          [id]
        )
      ).rows[0];
      if (!request) throw new NotFoundException('Consultation request not found');
      const history = (
        await client.query(
          `SELECT e.status,e.actor_user_id,
          CASE WHEN u.is_staff THEN 'staff' ELSE 'customer' END AS actor_type,
          e.reason,e.created_at
         FROM consultation_request_events e JOIN users u ON u.user_id=e.actor_user_id
         WHERE e.request_id=$1 ORDER BY e.created_at,e.id`,
          [id]
        )
      ).rows;
      await client.query('COMMIT');
      return { request, history };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async assign(
    actor: Actor,
    id: string,
    input: { assignTo: 'self' | 'team'; team?: string },
    ip: string
  ) {
    return this.staffMutation(actor, id, ip, 'assigned', async (client, request) => {
      if (['completed', 'rejected', 'cancelled', 'offer_declined'].includes(request.status))
        throw new ConflictException('Consultation request is closed');
      let team: string | null = null;
      if (input.assignTo === 'team') {
        const found = (
          await client.query<{ name: string }>(
            'SELECT name FROM staff_teams WHERE name=$1 AND is_active FOR SHARE',
            [input.team]
          )
        ).rows[0];
        if (!found) throw new BadRequestException('Choose an active staff team');
        team = found.name;
      }
      const owner = input.assignTo === 'self' ? actor.userId : null;
      const nextStatus = request.status === 'submitted' && owner ? 'under_review' : request.status;
      await client.query(
        `UPDATE consultation_requests SET staff_owner_id=$2,staff_team=$3,status=$4,updated_at=NOW()
         WHERE id=$1`,
        [id, owner, team, nextStatus]
      );
      await this.event(
        client,
        id,
        nextStatus,
        actor.userId,
        input.assignTo === 'team' ? `Assigned to team ${team}` : 'Assigned to staff'
      );
      if (nextStatus !== request.status) await this.notify(client, request, nextStatus);
      return { requestId: id, status: nextStatus, staffOwnerId: owner, staffTeam: team };
    });
  }

  async staffAction(
    actor: Actor,
    id: string,
    action: StaffAction,
    reason: string | undefined,
    ip: string
  ) {
    return this.staffMutation(actor, id, ip, action, async (client, request) => {
      const next: ConsultationStatus =
        action === 'review'
          ? 'under_review'
          : action === 'request-info'
            ? 'awaiting_customer_info'
            : action === 'reject'
              ? 'rejected'
              : 'cancelled';
      if (!canTransitionConsultation(request.status, next, 'staff'))
        throw new ConflictException('Consultation status changed; refresh before acting');
      if (request.invoice_id) throw new ConflictException('Resolve the consultation invoice first');
      await client.query(
        `UPDATE consultation_requests SET status=$2,expected_next_step=$3,updated_at=NOW() WHERE id=$1`,
        [id, next, next === 'awaiting_customer_info' ? reason : null]
      );
      await this.event(client, id, next, actor.userId, reason ?? null);
      await this.notify(client, request, next);
      return { requestId: id, status: next };
    });
  }

  async provideInfo(actor: Actor, id: string, message: string, ip: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.orders.lockOrderActor(client, actor);
      const request = await this.lockRequest(client, id);
      if (!(await this.orders.mayManageOrders(client, actor.userId, request.profile_id, true)))
        throw new NotFoundException('Consultation request not found');
      if (!canTransitionConsultation(request.status, 'under_review', 'customer'))
        throw new ConflictException('Consultation is not waiting for customer information');
      await client.query(
        "UPDATE consultation_requests SET status='under_review',expected_next_step=NULL,updated_at=NOW() WHERE id=$1",
        [id]
      );
      await this.event(client, id, 'under_review', actor.userId, message);
      await this.notify(client, request, 'under_review');
      if (request.staff_owner_id) {
        await new NotificationsService().create(
          {
            userId: request.staff_owner_id,
            profileId: request.profile_id,
            type: 'general',
            title: 'Consultation information received',
            localizedContent: {
              fa: { title: 'اطلاعات مشاوره دریافت شد', body: 'مشتری اطلاعات تکمیلی را ارسال کرد.' },
              en: {
                title: 'Consultation information received',
                body: 'The customer provided additional information.',
              },
            },
            link: `/admin/consultations`,
          },
          client
        );
      }
      await this.audit(
        client,
        actor.userId,
        id,
        {
          action: 'provided_info',
          fromStatus: request.status,
          toStatus: 'under_review',
        },
        ip
      );
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return { requestId: id, status: 'under_review' as const };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  private async staffMutation<T>(
    actor: Actor,
    id: string,
    ip: string,
    action: string,
    change: (client: PoolClient, request: RequestRow) => Promise<T>
  ): Promise<T> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireCurrentSession(client, actor);
      await requireStaffMutationPermission(client, actor.userId, 'orders:write');
      const request = await this.lockRequest(client, id);
      const result = await change(client, request);
      const current = (
        await client.query<{
          status: string;
          staff_owner_id: string | null;
          staff_team: string | null;
        }>('SELECT status,staff_owner_id,staff_team FROM consultation_requests WHERE id=$1', [id])
      ).rows[0]!;
      await this.audit(
        client,
        actor.userId,
        id,
        {
          action,
          fromStatus: request.status,
          toStatus: current.status,
          staffOwnerId: current.staff_owner_id,
          staffTeam: current.staff_team,
        },
        ip
      );
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockRequest(client: PoolClient, id: string): Promise<RequestRow> {
    const request = (
      await client.query<RequestRow>(
        `SELECT r.id,r.profile_id,r.status,r.staff_owner_id,r.staff_team,r.submitted_by,
         r.invoice_id,p.user_id AS profile_user_id
       FROM consultation_requests r JOIN profiles p ON p.id=r.profile_id
       WHERE r.id=$1 FOR UPDATE OF r`,
        [id]
      )
    ).rows[0];
    if (!request) throw new NotFoundException('Consultation request not found');
    return request;
  }

  private async event(
    client: PoolClient,
    id: string,
    status: ConsultationStatus,
    actorId: string,
    reason: string | null
  ) {
    await client.query(
      `INSERT INTO consultation_request_events(id,request_id,status,actor_user_id,reason)
       VALUES($1,$2,$3,$4,$5)`,
      [uuidv7(), id, status, actorId, reason]
    );
  }

  private async notify(client: PoolClient, request: RequestRow, status: ConsultationStatus) {
    for (const userId of new Set([request.profile_user_id, request.submitted_by])) {
      await new NotificationsService().create(
        {
          userId,
          profileId: request.profile_id,
          type: 'general',
          title: 'Consultation status changed',
          localizedContent: {
            fa: {
              title: 'وضعیت مشاوره تغییر کرد',
              body: `وضعیت درخواست مشاوره: ${tConsultation(`status_${status}`, 'fa')}`,
            },
            en: {
              title: 'Consultation status changed',
              body: `Consultation request status: ${tConsultation(`status_${status}`, 'en')}`,
            },
          },
          link: `/consultations/${request.id}`,
        },
        client
      );
    }
  }

  private async audit(
    client: PoolClient,
    userId: string,
    requestId: string,
    metadata: Record<string, unknown>,
    ip: string
  ) {
    await client.query(
      `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
       VALUES($1,$2,'consultation.request.changed',$3::jsonb,$4,$5)`,
      [uuidv7(), userId, JSON.stringify({ requestId, ...metadata }), uuidv7(), ip]
    );
  }
}
