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
import { requireCurrentSession, requireSessionStepUp } from '../session/session-step-up.js';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { OrdersService } from '../orders/orders.service.js';
import { ManualInvoiceService } from '../invoice/manual-invoice.service.js';
import { CancelAndReplaceInvoiceService } from '../invoice/cancel-and-replace-invoice.service.js';
import { CreateAdjustmentInvoiceService } from '../invoice/create-adjustment-invoice.service.js';
import { InvoiceStateMachineService } from '../invoice/invoice-state-machine.service.js';
import { RefundService } from '../refund/refund.service.js';
import { lockDualApprovalThreshold } from '../admin/dual-approval-threshold-lock.js';
import type { InvoiceState } from '../invoice/invoice-state.model.js';
import { settlePaidConsultation } from './consultation-payment.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { tConsultation } from '@barghsa/i18n/consultation';
import { canTransitionConsultation, type ConsultationStatus } from './consultation-state.js';

type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
type StaffAction = 'review' | 'request-info' | 'reject' | 'cancel' | 'complete';
interface RequestRow {
  id: string;
  profile_id: string;
  status: ConsultationStatus;
  staff_owner_id: string | null;
  staff_team: string | null;
  submitted_by: string;
  profile_user_id: string;
  invoice_id: string | null;
  fee: string | null;
  accepted_at: Date | null;
  accepted_by: string | null;
  offer_valid_until: Date | null;
}

@Injectable()
export class ConsultationWorkflowService {
  constructor(
    private readonly orders: OrdersService,
    private readonly manualInvoices: ManualInvoiceService,
    private readonly replacementInvoices: CancelAndReplaceInvoiceService,
    private readonly invoiceStates: InvoiceStateMachineService,
    private readonly adjustments: CreateAdjustmentInvoiceService,
    private readonly refunds: RefundService
  ) {}

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
      request.has_paid_invoice =
        (
          await client.query<{ paid: boolean }>(
            'SELECT EXISTS(SELECT 1 FROM invoices WHERE consultation_id=$1 AND paid_amount>0) AS paid',
            [id]
          )
        ).rows[0]?.paid ?? false;
      request.uncovered_credit = (await this.uncoveredCredit(client, id)).toString();
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
              : action === 'cancel'
                ? 'cancelled'
                : 'completed';
      if (!canTransitionConsultation(request.status, next, 'staff'))
        throw new ConflictException('Consultation status changed; refresh before acting');
      if (action === 'complete' && !request.invoice_id)
        throw new ConflictException('Consultation offer has no invoice');
      if (request.invoice_id) {
        if (action === 'complete') {
          const funding = (
            await client.query<{ available: string }>(
              `SELECT (COALESCE(SUM(i.paid_amount-i.refunded_amount),0) -
                COALESCE((SELECT SUM(r.amount) FROM refunds r JOIN invoices ri ON ri.id=r.invoice_id
                  WHERE ri.consultation_id=$1 AND r.state NOT IN ('Completed','Rejected','Cancelled')),0))::text AS available
               FROM invoices i WHERE i.consultation_id=$1 AND i.adjustment_kind IS DISTINCT FROM 'credit'`,
              [id]
            )
          ).rows[0];
          if (!request.fee || BigInt(funding?.available ?? '0') < BigInt(request.fee))
            throw new ConflictException('Consultation fee is not fully funded');
        } else {
          if (action !== 'reject' && action !== 'cancel')
            throw new ConflictException('Resolve the consultation invoice first');
          if (!reason?.trim()) throw new BadRequestException('A reason is required');
          await requireStaffMutationPermission(client, actor.userId, 'invoices:write');
          await requireSessionStepUp(client, actor);
          const invoice = (
            await client.query<{
              state: InvoiceState;
              paid_amount: string;
              consultation_id: string | null;
              profile_id: string;
            }>('SELECT state,paid_amount,consultation_id,profile_id FROM invoices WHERE id=$1', [
              request.invoice_id,
            ])
          ).rows[0];
          if (
            !invoice ||
            invoice.consultation_id !== id ||
            invoice.profile_id !== request.profile_id
          )
            throw new ConflictException('Consultation invoice linkage is invalid');
          const paidHistory = (
            await client.query<{ paid: boolean }>(
              'SELECT EXISTS(SELECT 1 FROM invoices WHERE consultation_id=$1 AND paid_amount>0) AS paid',
              [id]
            )
          ).rows[0]?.paid;
          if (paidHistory)
            throw new ConflictException('Paid consultation requires a refund review');
          if (
            BigInt(invoice.paid_amount) > 0n ||
            !['Draft', 'Unpaid', 'Overdue'].includes(invoice.state)
          )
            throw new ConflictException('Paid consultation invoice requires adjustment or refund');
          await this.invoiceStates.transition(request.invoice_id, invoice.state, 'Cancelled', {
            actorUserId: actor.userId,
            reason,
            ip,
            client,
          });
        }
      }
      await client.query(
        `UPDATE consultation_requests SET status=$2,expected_next_step=$3,updated_at=NOW() WHERE id=$1`,
        [id, next, next === 'awaiting_customer_info' ? reason : null]
      );
      await this.event(client, id, next, actor.userId, reason ?? null);
      await this.notify(client, request, next);
      return { requestId: id, status: next };
    });
  }

  async setFee(
    actor: Actor,
    id: string,
    input: {
      idempotencyKey: string;
      fee: string;
      scope: string;
      deliverables: string;
      validUntil: string;
      reason?: string | undefined;
    },
    ip: string
  ) {
    const fee = BigInt(input.fee);
    if (fee <= 0n || fee > 9_223_372_036_854_775_807n)
      throw new BadRequestException('Consultation fee is outside the supported IRR range');
    const validUntil = new Date(input.validUntil);
    if (!Number.isFinite(validUntil.getTime()) || validUntil <= new Date())
      throw new BadRequestException('Offer validity must be in the future');
    return this.staffMutation(actor, id, ip, 'fee_set', async (client, request) => {
      const paidHistory = (
        await client.query<{ paid: boolean }>(
          'SELECT EXISTS(SELECT 1 FROM invoices WHERE consultation_id=$1 AND paid_amount>0) AS paid',
          [id]
        )
      ).rows[0]?.paid;
      if (paidHistory)
        throw new ConflictException('Paid consultation fees require the paid adjustment workflow');
      const previousKey = (
        await client.query<{ id: string }>(
          `SELECT id FROM invoices WHERE consultation_id=$1
           AND (metadata->>'idempotencyKey'=$2 OR metadata#>>'{correctionRequest,key}'=$2)
           LIMIT 1`,
          [id, input.idempotencyKey]
        )
      ).rows[0];
      if (previousKey) {
        const current = (
          await client.query<{
            fee: string | null;
            scope: string | null;
            deliverables: string | null;
            offer_valid_until: Date | null;
          }>(
            'SELECT fee,scope,deliverables,offer_valid_until FROM consultation_requests WHERE id=$1',
            [id]
          )
        ).rows[0]!;
        if (
          previousKey.id !== request.invoice_id ||
          request.status !== 'offer_pending' ||
          current.fee !== input.fee ||
          current.scope !== input.scope ||
          current.deliverables !== input.deliverables ||
          current.offer_valid_until?.getTime() !== validUntil.getTime()
        )
          throw new ConflictException('Fee offer request key was already used');
        return { requestId: id, status: 'offer_pending' as const, invoiceId: previousKey.id };
      }
      if (request.status !== 'under_review' && request.status !== 'offer_pending')
        throw new ConflictException('Consultation is not ready for a fee offer');
      if (request.status === 'offer_pending' && !request.invoice_id)
        throw new ConflictException('Existing consultation offer has no invoice');
      const line = {
        description: 'Consultation fee / هزینه مشاوره',
        quantity: 1,
        unitPrice: fee,
        vatRate: 0,
        isTaxable: false,
      };
      let invoiceId: string;
      if (request.invoice_id) {
        if (!input.reason?.trim())
          throw new BadRequestException('A reason is required to replace a consultation offer');
        const previous = (
          await client.query<{ consultation_id: string | null; profile_id: string }>(
            'SELECT consultation_id,profile_id FROM invoices WHERE id=$1',
            [request.invoice_id]
          )
        ).rows[0];
        if (previous?.consultation_id !== id || previous.profile_id !== request.profile_id)
          throw new ConflictException('Consultation invoice linkage is invalid');
        if (request.status === 'offer_pending') {
          await this.event(client, id, 'under_review', actor.userId, input.reason);
        }
        const replacement = await this.replacementInvoices.cancelAndReplaceInvoice({
          transactionClient: client,
          invoiceId: request.invoice_id,
          reason: input.reason,
          newLines: [line],
          actorUserId: actor.userId,
          actorSession: actor,
          idempotencyKey: input.idempotencyKey,
          dueAt: validUntil,
          ip,
        });
        invoiceId = replacement.replacementInvoiceId;
      } else {
        const created = await this.manualInvoices.createManualInvoice({
          transactionClient: client,
          profileId: request.profile_id,
          lines: [line],
          actorUserId: actor.userId,
          actorSession: actor,
          idempotencyKey: input.idempotencyKey,
          dueAt: validUntil,
          ip,
          reason: 'Consultation fee offer',
        });
        invoiceId = created.invoiceId;
        await client.query('UPDATE invoices SET consultation_id=$2 WHERE id=$1', [invoiceId, id]);
      }
      await client.query(
        `UPDATE consultation_requests SET status='offer_pending',fee=$2,scope=$3,
         deliverables=$4,offer_valid_until=$5,invoice_id=$6,accepted_at=NULL,accepted_by=NULL,
         expected_next_step=NULL,updated_at=NOW()
         WHERE id=$1`,
        [id, input.fee, input.scope, input.deliverables, validUntil, invoiceId]
      );
      await this.event(client, id, 'offer_pending', actor.userId, input.reason ?? null);
      await this.notify(client, request, 'offer_pending');
      return { requestId: id, status: 'offer_pending' as const, invoiceId };
    });
  }

  async adjustPaidFee(
    actor: Actor,
    id: string,
    input: { idempotencyKey: string; fee: string; reason: string; validUntil: string },
    ip: string
  ) {
    const nextFee = BigInt(input.fee);
    if (nextFee <= 0n || nextFee > 9_223_372_036_854_775_807n)
      throw new BadRequestException('Consultation fee is outside the supported IRR range');
    const validUntil = new Date(input.validUntil);
    if (!Number.isFinite(validUntil.getTime()) || validUntil <= new Date())
      throw new BadRequestException('Offer validity must be in the future');
    return this.staffMutation(
      actor,
      id,
      ip,
      'paid_fee_adjusted',
      async (client, request) => {
        const prior = (
          await client.query<{
            metadata: { fee: string; reason: string; validUntil: string; result: unknown };
          }>(
            `SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='consultation.fee.adjusted'
           AND metadata::jsonb->>'requestId'=$1 AND metadata::jsonb->>'idempotencyKey'=$2 LIMIT 1`,
            [id, input.idempotencyKey]
          )
        ).rows[0];
        if (prior) {
          if (
            prior.metadata.fee !== input.fee ||
            prior.metadata.reason !== input.reason ||
            prior.metadata.validUntil !== validUntil.toISOString()
          )
            throw new ConflictException('Paid fee adjustment key was already used');
          return prior.metadata.result;
        }
        if (request.status !== 'offer_accepted' || !request.invoice_id || !request.fee)
          throw new ConflictException('Only an accepted paid consultation can be adjusted');
        await this.assertCreditsCovered(client, id);
        const current = (
          await client.query<{
            state: string;
            paid_amount: string;
            consultation_id: string | null;
          }>('SELECT state,paid_amount,consultation_id FROM invoices WHERE id=$1', [
            request.invoice_id,
          ])
        ).rows[0];
        if (
          !current ||
          !['Paid', 'PartiallyRefunded'].includes(current.state) ||
          current.consultation_id !== id ||
          BigInt(current.paid_amount) <= 0n
        )
          throw new ConflictException('Consultation invoice is not paid');
        const difference = nextFee - BigInt(request.fee);
        if (difference === 0n) throw new BadRequestException('The revised fee must differ');
        const adjustment = await this.adjustments.createAdjustmentInvoice(
          {
            originalInvoiceId: request.invoice_id,
            amount: difference,
            reason: input.reason,
            actorUserId: actor.userId,
            actorSession: actor,
            idempotencyKey: input.idempotencyKey,
            dueAt: validUntil,
            ip,
          },
          client
        );
        const refundIds: string[] = [];
        let nextStatus: ConsultationStatus = 'offer_pending';
        if (difference < 0n) {
          let remaining = -difference;
          const paidInvoices = (
            await client.query<{ id: string; available: string }>(
              `SELECT i.id,(i.paid_amount-i.refunded_amount-
              COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.invoice_id=i.id
                AND r.state NOT IN ('Completed','Rejected','Cancelled')),0))::text AS available
             FROM invoices i WHERE i.consultation_id=$1 AND i.paid_amount>0
               AND i.adjustment_kind IS DISTINCT FROM 'credit'
               AND i.state IN ('Paid','PartiallyRefunded')
             ORDER BY i.created_at DESC,i.id DESC`,
              [id]
            )
          ).rows;
          const total = paidInvoices.reduce((sum, invoice) => sum + BigInt(invoice.available), 0n);
          if (total < remaining)
            throw new ConflictException('Refund exceeds available consultation payments');
          for (const invoice of paidInvoices) {
            if (remaining === 0n) break;
            const available = BigInt(invoice.available);
            if (available <= 0n) continue;
            const amount = remaining < available ? remaining : available;
            const refund = await this.refunds.request(
              {
                invoiceId: invoice.id,
                amount: amount.toString(),
                idempotencyKey: `${input.idempotencyKey}:${invoice.id}`,
                reason: input.reason,
              },
              actor,
              ip,
              'wallet',
              client
            );
            refundIds.push(refund.id);
            remaining -= amount;
          }
          nextStatus = 'offer_accepted';
          await client.query(
            'UPDATE consultation_requests SET fee=$2,updated_at=NOW() WHERE id=$1',
            [id, input.fee]
          );
        } else {
          await client.query(
            `UPDATE consultation_requests SET status='offer_pending',fee=$2,invoice_id=$3,
           offer_valid_until=$4,accepted_at=NULL,accepted_by=NULL,updated_at=NOW()
           WHERE id=$1`,
            [id, input.fee, adjustment.adjustmentInvoiceId, validUntil]
          );
        }
        const result = {
          requestId: id,
          status: nextStatus,
          invoiceId: difference > 0n ? adjustment.adjustmentInvoiceId : request.invoice_id,
          adjustmentInvoiceId: adjustment.adjustmentInvoiceId,
          refundIds,
        };
        await client.query(
          `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
         VALUES($1,$2,'consultation.fee.adjusted',$3::jsonb,$4,$5)`,
          [
            uuidv7(),
            actor.userId,
            JSON.stringify({
              requestId: id,
              idempotencyKey: input.idempotencyKey,
              fee: input.fee,
              reason: input.reason,
              validUntil: validUntil.toISOString(),
              result,
            }),
            uuidv7(),
            ip,
          ]
        );
        await this.event(client, id, nextStatus, actor.userId, input.reason);
        await this.notify(client, request, nextStatus);
        return result;
      },
      true
    );
  }

  async closePaid(
    actor: Actor,
    id: string,
    action: 'cancel' | 'reject',
    input: { idempotencyKey: string; reason: string },
    ip: string
  ) {
    return this.staffMutation(
      actor,
      id,
      ip,
      `paid_${action}`,
      async (client, request) => {
        const prior = (
          await client.query<{ metadata: { action: string; reason: string; result: unknown } }>(
            `SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='consultation.paid.closed'
             AND metadata::jsonb->>'requestId'=$1 AND metadata::jsonb->>'idempotencyKey'=$2 LIMIT 1`,
            [id, input.idempotencyKey]
          )
        ).rows[0];
        if (prior) {
          if (prior.metadata.action !== action || prior.metadata.reason !== input.reason)
            throw new ConflictException('Paid closure key was already used');
          return prior.metadata.result;
        }
        const status: ConsultationStatus = action === 'cancel' ? 'cancelled' : 'rejected';
        if (!canTransitionConsultation(request.status, status, 'staff'))
          throw new ConflictException('Consultation status changed; refresh before acting');
        await this.assertCreditsCovered(client, id);
        const paidInvoices = (
          await client.query<{
            id: string;
            state: string;
            available: string;
          }>(
            `SELECT i.id,i.state,(i.paid_amount-i.refunded_amount-
              COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.invoice_id=i.id
                AND r.state NOT IN ('Completed','Rejected','Cancelled')),0))::text AS available
             FROM invoices i WHERE i.consultation_id=$1 AND i.paid_amount>0
               AND i.adjustment_kind IS DISTINCT FROM 'credit'
             ORDER BY i.created_at DESC,i.id DESC`,
            [id]
          )
        ).rows;
        if (paidInvoices.length === 0)
          throw new ConflictException('Consultation has no paid invoice');
        if (
          paidInvoices.some(
            (invoice) =>
              BigInt(invoice.available) > 0n &&
              !['Paid', 'PartiallyRefunded'].includes(invoice.state)
          )
        )
          throw new ConflictException('A partially paid consultation needs finance review');
        let cancelledInvoiceId: string | null = null;
        if (request.invoice_id) {
          const current = (
            await client.query<{
              state: InvoiceState;
              paid_amount: string;
              adjustment_kind: string | null;
            }>('SELECT state,paid_amount,adjustment_kind FROM invoices WHERE id=$1', [
              request.invoice_id,
            ])
          ).rows[0];
          if (
            current &&
            BigInt(current.paid_amount) === 0n &&
            current.adjustment_kind !== 'credit'
          ) {
            if (!['Draft', 'Unpaid', 'Overdue'].includes(current.state))
              throw new ConflictException('Unpaid consultation charge cannot be cancelled');
            await this.invoiceStates.transition(request.invoice_id, current.state, 'Cancelled', {
              actorUserId: actor.userId,
              reason: input.reason,
              ip,
              client,
            });
            cancelledInvoiceId = request.invoice_id;
          }
        }
        const creditInvoiceIds: string[] = [];
        const refundIds: string[] = [];
        for (const invoice of paidInvoices) {
          const amount = BigInt(invoice.available);
          if (amount <= 0n) continue;
          const credit = await this.adjustments.createAdjustmentInvoice(
            {
              originalInvoiceId: invoice.id,
              amount: -amount,
              reason: input.reason,
              actorUserId: actor.userId,
              actorSession: actor,
              idempotencyKey: `${input.idempotencyKey}:${invoice.id}`,
              ip,
            },
            client
          );
          const refund = await this.refunds.request(
            {
              invoiceId: invoice.id,
              amount: amount.toString(),
              idempotencyKey: `${input.idempotencyKey}:${invoice.id}`,
              reason: input.reason,
            },
            actor,
            ip,
            'wallet',
            client
          );
          creditInvoiceIds.push(credit.adjustmentInvoiceId);
          refundIds.push(refund.id);
        }
        await client.query(
          'UPDATE consultation_requests SET status=$2,expected_next_step=NULL,updated_at=NOW() WHERE id=$1',
          [id, status]
        );
        const result = { requestId: id, status, cancelledInvoiceId, creditInvoiceIds, refundIds };
        await client.query(
          `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
           VALUES($1,$2,'consultation.paid.closed',$3::jsonb,$4,$5)`,
          [
            uuidv7(),
            actor.userId,
            JSON.stringify({
              requestId: id,
              idempotencyKey: input.idempotencyKey,
              action,
              reason: input.reason,
              result,
            }),
            uuidv7(),
            ip,
          ]
        );
        await this.event(client, id, status, actor.userId, input.reason);
        await this.notify(client, request, status);
        return result;
      },
      true
    );
  }

  async recoverRefund(
    actor: Actor,
    id: string,
    input: { idempotencyKey: string; reason: string },
    ip: string
  ) {
    return this.staffMutation(
      actor,
      id,
      ip,
      'refund_recovered',
      async (client, request) => {
        const prior = (
          await client.query<{ metadata: { reason: string; result: unknown } }>(
            `SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='consultation.refund.recovered'
             AND metadata::jsonb->>'requestId'=$1 AND metadata::jsonb->>'idempotencyKey'=$2 LIMIT 1`,
            [id, input.idempotencyKey]
          )
        ).rows[0];
        if (prior) {
          if (prior.metadata.reason !== input.reason)
            throw new ConflictException('Refund recovery key was already used');
          return prior.metadata.result;
        }
        let remaining = await this.uncoveredCredit(client, id);
        if (remaining <= 0n) throw new ConflictException('No consultation credit needs a refund');
        const paidInvoices = (
          await client.query<{ id: string; state: string; available: string }>(
            `SELECT i.id,i.state,(i.paid_amount-i.refunded_amount-
              COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.invoice_id=i.id
                AND r.state NOT IN ('Completed','Rejected','Cancelled')),0))::text AS available
             FROM invoices i WHERE i.consultation_id=$1 AND i.paid_amount>0
               AND i.adjustment_kind IS DISTINCT FROM 'credit'
             ORDER BY i.created_at DESC,i.id DESC`,
            [id]
          )
        ).rows;
        const available = paidInvoices.reduce(
          (sum, invoice) =>
            sum +
            (['Paid', 'PartiallyRefunded'].includes(invoice.state) && BigInt(invoice.available) > 0n
              ? BigInt(invoice.available)
              : 0n),
          0n
        );
        if (available < remaining)
          throw new ConflictException('Refund recovery exceeds available paid balance');
        const refundIds: string[] = [];
        for (const invoice of paidInvoices) {
          if (remaining === 0n) break;
          if (!['Paid', 'PartiallyRefunded'].includes(invoice.state)) continue;
          const balance = BigInt(invoice.available);
          if (balance <= 0n) continue;
          const amount = remaining < balance ? remaining : balance;
          const refund = await this.refunds.request(
            {
              invoiceId: invoice.id,
              amount: amount.toString(),
              idempotencyKey: `${input.idempotencyKey}:${invoice.id}`,
              reason: input.reason,
            },
            actor,
            ip,
            'wallet',
            client
          );
          refundIds.push(refund.id);
          remaining -= amount;
        }
        const result = { requestId: id, status: request.status, refundIds };
        await client.query(
          `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
           VALUES($1,$2,'consultation.refund.recovered',$3::jsonb,$4,$5)`,
          [
            uuidv7(),
            actor.userId,
            JSON.stringify({
              requestId: id,
              idempotencyKey: input.idempotencyKey,
              reason: input.reason,
              result,
            }),
            uuidv7(),
            ip,
          ]
        );
        await this.event(client, id, request.status, actor.userId, input.reason);
        await this.notify(client, request, request.status);
        return result;
      },
      true
    );
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

  async customerDecision(
    actor: Actor,
    id: string,
    decision: 'accept' | 'decline',
    reason: string | undefined,
    ip: string
  ) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireCurrentSession(client, actor);
      const preview = (
        await client.query<{ profile_id: string; invoice_id: string | null }>(
          'SELECT profile_id,invoice_id FROM consultation_requests WHERE id=$1',
          [id]
        )
      ).rows[0];
      if (
        !preview ||
        !(await this.orders.mayManageOrders(client, actor.userId, preview.profile_id, true))
      )
        throw new NotFoundException('Consultation request not found');
      if (!preview.invoice_id) throw new ConflictException('Consultation offer has no invoice');
      const invoice = (
        await client.query<{
          id: string;
          state: InvoiceState;
          paid_amount: string;
          profile_id: string;
          consultation_id: string | null;
        }>(
          'SELECT id,state,paid_amount,profile_id,consultation_id FROM invoices WHERE id=$1 FOR UPDATE',
          [preview.invoice_id]
        )
      ).rows[0];
      const request = await this.lockRequest(client, id);
      if (
        request.invoice_id !== preview.invoice_id ||
        request.profile_id !== preview.profile_id ||
        invoice?.consultation_id !== id ||
        invoice.profile_id !== request.profile_id
      )
        throw new ConflictException('Consultation offer changed; refresh before acting');
      if (request.status !== 'offer_pending')
        throw new ConflictException('Consultation offer is no longer pending');
      if (decision === 'decline') {
        const paidHistory = (
          await client.query<{ paid: boolean }>(
            'SELECT EXISTS(SELECT 1 FROM invoices WHERE consultation_id=$1 AND paid_amount>0) AS paid',
            [id]
          )
        ).rows[0]?.paid;
        if (paidHistory)
          throw new ConflictException('Paid consultation requires a staff refund review');
        if (
          BigInt(invoice.paid_amount) > 0n ||
          !['Draft', 'Unpaid', 'Overdue'].includes(invoice.state)
        )
          throw new ConflictException('Paid or pending payment requires a refund review');
        await this.invoiceStates.transition(invoice.id, invoice.state, 'Cancelled', {
          actorUserId: actor.userId,
          reason: reason?.trim() || 'Customer declined consultation offer',
          ip,
          client,
        });
        await client.query(
          "UPDATE consultation_requests SET status='offer_declined',expected_next_step=NULL,updated_at=NOW() WHERE id=$1",
          [id]
        );
        await this.event(client, id, 'offer_declined', actor.userId, reason?.trim() || null);
        await this.notify(client, request, 'offer_declined');
        await this.audit(
          client,
          actor.userId,
          id,
          { action: 'offer_declined', invoiceId: invoice.id },
          ip
        );
        await requireCurrentSession(client, actor);
        await client.query('COMMIT');
        return { requestId: id, status: 'offer_declined' as const };
      }
      if (
        !request.accepted_at &&
        request.offer_valid_until &&
        request.offer_valid_until <= new Date() &&
        invoice.state !== 'Paid'
      )
        throw new ConflictException('Consultation offer has expired');
      if (!request.accepted_at) {
        await client.query(
          'UPDATE consultation_requests SET accepted_at=NOW(),accepted_by=$2,updated_at=NOW() WHERE id=$1',
          [id, actor.userId]
        );
        await this.event(
          client,
          id,
          'offer_pending',
          actor.userId,
          'Offer accepted; payment pending'
        );
        await this.audit(
          client,
          actor.userId,
          id,
          { action: 'offer_accepted_pending_payment', invoiceId: invoice.id },
          ip
        );
      }
      const paid = invoice.state === 'Paid';
      if (paid) await settlePaidConsultation(client, id, invoice.id, actor.userId);
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return {
        requestId: id,
        invoiceId: invoice.id,
        status: paid ? ('offer_accepted' as const) : ('offer_pending' as const),
        paymentRequired: !paid,
      };
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
    change: (client: PoolClient, request: RequestRow) => Promise<T>,
    financial = false
  ): Promise<T> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const preview = (
        await client.query<{ profile_id: string; invoice_id: string | null }>(
          'SELECT profile_id,invoice_id FROM consultation_requests WHERE id=$1',
          [id]
        )
      ).rows[0];
      if (!preview) throw new NotFoundException('Consultation request not found');
      await client.query('SELECT id FROM profiles WHERE id=$1 FOR SHARE', [preview.profile_id]);
      if (financial) await lockDualApprovalThreshold(client, 'read');
      await requireStaffMutationPermission(client, actor.userId, 'orders:write');
      if (financial) {
        await requireStaffMutationPermission(client, actor.userId, 'admin:financial:edit');
        await requireSessionStepUp(client, actor);
      } else {
        await requireCurrentSession(client, actor);
      }
      if (financial) {
        const invoices = (
          await client.query<{ id: string }>(
            'SELECT id FROM invoices WHERE consultation_id=$1 ORDER BY id',
            [id]
          )
        ).rows;
        for (const invoice of invoices)
          await client.query('SELECT id FROM invoices WHERE id=$1 FOR UPDATE', [invoice.id]);
      } else if (preview.invoice_id) {
        await client.query('SELECT id FROM invoices WHERE id=$1 FOR UPDATE', [preview.invoice_id]);
      }
      const request = await this.lockRequest(client, id);
      if (request.invoice_id !== preview.invoice_id || request.profile_id !== preview.profile_id)
        throw new ConflictException('Consultation changed; refresh before acting');
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
      if (financial) await requireSessionStepUp(client, actor);
      else await requireCurrentSession(client, actor);
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
         r.invoice_id,r.fee,r.accepted_at,r.accepted_by,r.offer_valid_until,p.user_id AS profile_user_id
       FROM consultation_requests r JOIN profiles p ON p.id=r.profile_id
       WHERE r.id=$1 FOR UPDATE OF r`,
        [id]
      )
    ).rows[0];
    if (!request) throw new NotFoundException('Consultation request not found');
    return request;
  }

  private async assertCreditsCovered(client: PoolClient, id: string) {
    if ((await this.uncoveredCredit(client, id)) > 0n)
      throw new ConflictException(
        'Resolve the uncovered consultation credit before another financial change'
      );
  }

  private async uncoveredCredit(client: PoolClient, id: string): Promise<bigint> {
    const row = (
      await client.query<{ credited: string; obligated: string }>(
        `WITH actions AS (
           SELECT event,metadata::jsonb AS data FROM audit_log
           WHERE event IN ('consultation.fee.adjusted','consultation.paid.closed',
             'consultation.refund.recovered')
             AND metadata::jsonb->>'requestId'=$1
         ), credit_ids AS (
           SELECT data #>> '{result,adjustmentInvoiceId}' AS id FROM actions
             WHERE event='consultation.fee.adjusted'
           UNION
           SELECT jsonb_array_elements_text(COALESCE(data #> '{result,creditInvoiceIds}','[]'::jsonb))
             FROM actions WHERE event='consultation.paid.closed'
         ), refund_ids AS (
           SELECT DISTINCT id FROM (
             SELECT jsonb_array_elements_text(COALESCE(data #> '{result,refundIds}','[]'::jsonb)) AS id
             FROM actions
           ) listed
         )
         SELECT
           COALESCE((SELECT SUM(i.total_amount) FROM invoices i JOIN credit_ids c ON c.id=i.id::text
             WHERE i.adjustment_kind='credit'),0)::text AS credited,
           COALESCE((SELECT SUM(r.amount) FROM refunds r JOIN refund_ids linked ON linked.id=r.id::text
             WHERE r.state NOT IN ('Rejected','Cancelled')),0)::text AS obligated`,
        [id]
      )
    ).rows[0]!;
    const missing = BigInt(row.credited) - BigInt(row.obligated);
    return missing > 0n ? missing : 0n;
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
