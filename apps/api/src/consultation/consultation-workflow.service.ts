import { STAFF_ASSIGNMENT_RULES_CONFIG_KEY } from '@barghsa/shared/admin';
import { activityNames } from '../common/activity-identity.js';
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
import {
  parseConsultationFeeReview,
  type ConsultationFeeReview,
  parseConsultationPaidFeeReview,
  type ConsultationPaidFeeReview,
  parseConsultationPaidResolutionReview,
  type ConsultationPaidResolutionReview,
  parseConsultationOfferReview,
  type ConsultationOfferReview,
} from '@barghsa/shared/finance';
import { ReviewSnapshotService } from '../finance/review-snapshot.service.js';
import { InputFieldException } from '../common/input-field.exception.js';
import { consultationOfferDeadline } from './consultation-fee-input-fields.js';
import {
  consultationFeeCommand,
  replayConsultationFee,
  replayConsultationPaidFee,
} from './consultation-fee-replay.js';

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
  scope: string | null;
  deliverables: string | null;
  product_snapshot: { title?: { fa?: string; en?: string } };
  accepted_at: Date | null;
  accepted_by: string | null;
  offer_valid_until: Date | null;
}

interface OfferInvoiceRow {
  id: string;
  state: InvoiceState;
  paid_amount: string;
  total_amount: string;
  adjustment_kind: 'charge' | 'credit' | null;
  profile_id: string;
  consultation_id: string | null;
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
      await requireStaffMutationPermission(client, actor.userId, 'orders:read');
      await requireCurrentSession(client, actor);
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
    minAgeDays = 0,
    after?: string
  ) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'orders:read');
      await requireCurrentSession(client, actor);
      const cursor = after
        ? (
            await client.query<{ submitted_at: string; status: ConsultationStatus }>(
              'SELECT submitted_at::text AS submitted_at,status FROM consultation_requests WHERE id=$1',
              [after]
            )
          ).rows[0]
        : null;
      if (after && !cursor) throw new NotFoundException('Consultation queue cursor not found');
      const cursorRank = cursor
        ? cursor.status === 'submitted'
          ? 0
          : cursor.status === 'awaiting_customer_info'
            ? 2
            : 1
        : null;
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
             AND ($6::uuid IS NULL OR
               (CASE r.status WHEN 'submitted' THEN 0 WHEN 'awaiting_customer_info' THEN 2 ELSE 1 END,
                r.submitted_at,r.id) > ($7::int,$8::timestamptz,$6::uuid))
           ORDER BY CASE r.status WHEN 'submitted' THEN 0 WHEN 'awaiting_customer_info' THEN 2 ELSE 1 END,
             r.submitted_at,r.id LIMIT 101`,
          [
            status ?? null,
            assignment,
            actor.userId,
            priority,
            minAgeDays,
            after ?? null,
            cursorRank,
            cursor?.submitted_at ?? null,
          ]
        )
      ).rows;
      const page = requests.slice(0, 100);
      const names = await activityNames(
        client,
        page.map((request) => request.staff_owner_id as string | null)
      );
      await client.query('COMMIT');
      return {
        requests: page.map((request) => ({
          ...request,
          staff_owner_name: names.get(request.staff_owner_id as string) ?? null,
        })),
        nextAfter: requests.length > 100 ? requests[99]!.id : null,
      };
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
      await requireStaffMutationPermission(client, actor.userId, 'orders:read');
      await requireCurrentSession(client, actor);
      const request = (
        await client.query(
          `SELECT r.*,i.state AS invoice_state,p.profile_type,p.user_id AS profile_user_id,
            COALESCE(NULLIF(lp.legal_name,''),NULLIF(TRIM(CONCAT_WS(' ',p.first_name,p.last_name)),''),p.id::text) AS profile_name
           FROM consultation_requests r JOIN profiles p ON p.id=r.profile_id
           LEFT JOIN legal_profiles lp ON lp.id=p.id
           LEFT JOIN invoices i ON i.id=r.invoice_id WHERE r.id=$1`,
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
          COALESCE(e.actor_context,'unknown') AS actor_type,
          e.reason,e.created_at
         FROM consultation_request_events e
         WHERE e.request_id=$1 ORDER BY e.created_at,e.id`,
          [id]
        )
      ).rows;
      const names = await activityNames(client, [
        request.staff_owner_id as string | null,
        ...history.map((event) => event.actor_user_id as string),
      ]);
      await client.query('COMMIT');
      return {
        request: {
          ...request,
          staff_owner_name: names.get(request.staff_owner_id as string) ?? null,
        },
        history: history.map((event) => ({
          ...event,
          actor_name: names.get(event.actor_user_id as string) ?? null,
        })),
      };
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
    return this.staffMutation(
      actor,
      id,
      ip,
      'assigned',
      async (client, request) => {
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
        const nextStatus =
          request.status === 'submitted' && owner ? 'under_review' : request.status;
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
      },
      false,
      input.assignTo === 'team' ? input.team : undefined
    );
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

  async assertCanEditFee(actor: Actor, id: string, paid: boolean, write: boolean): Promise<void> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const source = (
        await client.query<{ profile_id: string; invoice_id: string | null }>(
          'SELECT profile_id,invoice_id FROM consultation_requests WHERE id=$1',
          [id]
        )
      ).rows[0];
      if (!source) throw new NotFoundException('Consultation request not found');
      await client.query('SELECT id FROM profiles WHERE id=$1 FOR SHARE', [source.profile_id]);
      if (paid) await lockDualApprovalThreshold(client, 'read');
      await requireStaffMutationPermission(client, actor.userId, 'orders:write');
      if (paid) await requireStaffMutationPermission(client, actor.userId, 'admin:financial:edit');
      await requireStaffMutationPermission(client, actor.userId, 'invoices:write');
      const checkSession = write ? requireSessionStepUp : requireCurrentSession;
      await checkSession(client, actor);
      const invoices = paid
        ? (
            await client.query<{ id: string }>(
              'SELECT id FROM invoices WHERE consultation_id=$1 ORDER BY id',
              [id]
            )
          ).rows
        : source.invoice_id
          ? [{ id: source.invoice_id }]
          : [];
      for (const invoice of invoices)
        await client.query('SELECT id FROM invoices WHERE id=$1 FOR UPDATE', [invoice.id]);
      const request = await this.lockRequest(client, id);
      if (request.profile_id !== source.profile_id || request.invoice_id !== source.invoice_id)
        throw new ConflictException('Consultation changed; refresh before acting');
      await checkSession(client, actor);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
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
      expectedReviewHash: string;
    },
    ip: string
  ) {
    return this.staffMutation(actor, id, ip, 'fee_set', async (client, request) => {
      // Preserve invoice-service authority even when its original result is replayed.
      await requireStaffMutationPermission(client, actor.userId, 'invoices:write');
      await requireSessionStepUp(client, actor);
      const priorInvoices = (
        await client.query<{ id: string }>(
          `SELECT id FROM invoices WHERE consultation_id=$1
         AND (metadata->>'idempotencyKey'=$2 OR metadata#>>'{correctionRequest,key}'=$2) LIMIT 2`,
          [id, input.idempotencyKey]
        )
      ).rows;
      if (priorInvoices.length > 1)
        throw new ConflictException('Fee offer request key is ambiguous');
      const previousKey = priorInvoices[0];
      if (previousKey) {
        const savedRows = (
          await client.query<{ user_id: string; metadata: unknown }>(
            `SELECT user_id,metadata::jsonb AS metadata FROM audit_log
           WHERE event='consultation.request.changed'
             AND metadata::jsonb->>'requestId'=$1
             AND metadata::jsonb->>'action'='fee_offer_review'
             AND metadata::jsonb->>'idempotencyKey'=$2 LIMIT 2`,
            [id, input.idempotencyKey]
          )
        ).rows;
        const saved = savedRows[0];
        if (savedRows.length !== 1 || !saved || saved.user_id !== actor.userId)
          throw new ConflictException('Fee offer request key was already used');
        const result = replayConsultationFee(
          saved.metadata,
          previousKey.id,
          request.profile_id,
          id,
          input
        );
        await requireSessionStepUp(client, actor);
        return result;
      }
      const fee = BigInt(input.fee);
      if (fee <= 0n || fee > 9_223_372_036_854_775_807n) throw new InputFieldException(['fee']);
      const validUntil = consultationOfferDeadline(input.validUntil);
      const paidHistory = (
        await client.query<{ paid: boolean }>(
          'SELECT EXISTS(SELECT 1 FROM invoices WHERE consultation_id=$1 AND paid_amount>0) AS paid',
          [id]
        )
      ).rows[0]?.paid;
      if (paidHistory)
        throw new ConflictException('Paid consultation fees require the paid adjustment workflow');
      if (request.status !== 'under_review' && request.status !== 'offer_pending')
        throw new ConflictException('Consultation is not ready for a fee offer');
      if (request.status === 'offer_pending' && !request.invoice_id)
        throw new ConflictException('Existing consultation offer has no invoice');
      const financialReview = await this.feeReviewForLocked(client, request, input);
      new ReviewSnapshotService().assertConfirmed(financialReview, input.expectedReviewHash);
      const line = {
        description: 'Consultation fee / هزینه مشاوره',
        quantity: 1,
        unitPrice: fee,
        vatRate: 0,
        isTaxable: false,
      };
      let invoiceId: string;
      if (request.invoice_id) {
        if (!input.reason?.trim()) throw new InputFieldException(['reason']);
        const previous = (
          await client.query<{ consultation_id: string | null; profile_id: string }>(
            'SELECT consultation_id,profile_id FROM invoices WHERE id=$1',
            [request.invoice_id]
          )
        ).rows[0];
        if (previous?.consultation_id !== id || previous.profile_id !== request.profile_id)
          throw new ConflictException('Consultation invoice linkage is invalid');
        if (request.status === 'offer_pending') {
          await client.query(
            "UPDATE consultation_requests SET status='under_review',updated_at=NOW() WHERE id=$1",
            [id]
          );
          await this.event(client, id, 'under_review', actor.userId, input.reason);
          await this.notify(client, request, 'under_review');
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
      await this.audit(
        client,
        actor.userId,
        id,
        {
          action: 'fee_offer_review',
          idempotencyKey: input.idempotencyKey,
          financialReview,
          command: consultationFeeCommand(input),
          result: { requestId: id, status: 'offer_pending', invoiceId, financialReview },
        },
        ip
      );
      return { requestId: id, status: 'offer_pending' as const, invoiceId, financialReview };
    });
  }

  private async feeReviewForLocked(
    client: PoolClient,
    request: RequestRow,
    input: {
      fee: string;
      scope: string;
      deliverables: string;
      validUntil: string;
      reason?: string | undefined;
    }
  ): Promise<ConsultationFeeReview> {
    const fee = BigInt(input.fee);
    if (fee <= 0n || fee > 9_223_372_036_854_775_807n) throw new InputFieldException(['fee']);
    const validUntil = consultationOfferDeadline(input.validUntil);
    if (request.status !== 'under_review' && request.status !== 'offer_pending')
      throw new ConflictException('Consultation is not ready for a fee offer');
    if (request.status === 'offer_pending' && !request.invoice_id)
      throw new ConflictException('Existing consultation offer has no invoice');
    const paidHistory = (
      await client.query<{ paid: boolean }>(
        'SELECT EXISTS(SELECT 1 FROM invoices WHERE consultation_id=$1 AND paid_amount>0) AS paid',
        [request.id]
      )
    ).rows[0]?.paid;
    if (paidHistory)
      throw new ConflictException('Paid consultation fees require the paid adjustment workflow');
    let previousInvoice: { id: string; state: string; totalAmount: string } | null = null;
    if (request.invoice_id) {
      if (!input.reason?.trim()) throw new InputFieldException(['reason']);
      const previous = (
        await client.query<{
          id: string;
          state: string;
          total_amount: string;
          paid_amount: string;
          consultation_id: string | null;
          profile_id: string;
        }>(
          `SELECT id,state,total_amount,paid_amount,consultation_id,profile_id
           FROM invoices WHERE id=$1`,
          [request.invoice_id]
        )
      ).rows[0];
      if (
        !previous ||
        previous.consultation_id !== request.id ||
        previous.profile_id !== request.profile_id ||
        BigInt(previous.paid_amount) > 0n ||
        !['Draft', 'Unpaid', 'Overdue'].includes(previous.state)
      )
        throw new ConflictException('Consultation invoice cannot be replaced');
      previousInvoice = {
        id: previous.id,
        state: previous.state,
        totalAmount: previous.total_amount,
      };
    }
    const title = request.product_snapshot?.title;
    if (!title?.fa || !title.en)
      throw new ConflictException('Consultation service title is unavailable');
    const profileName = (
      await client.query<{ name: string }>(
        `SELECT COALESCE(NULLIF(lp.legal_name,''),
          NULLIF(TRIM(CONCAT_WS(' ',p.first_name,p.last_name)),''),p.id::text) AS name
         FROM profiles p LEFT JOIN legal_profiles lp ON lp.id=p.id WHERE p.id=$1`,
        [request.profile_id]
      )
    ).rows[0]?.name;
    if (!profileName) throw new ConflictException('Consultation profile is unavailable');
    const snapshot = new ReviewSnapshotService().create(
      { action: 'consultation.fee-offer', profileId: request.profile_id, resourceId: request.id },
      {
        serviceTitle: { fa: title.fa, en: title.en },
        profileName,
        scope: input.scope,
        deliverables: input.deliverables,
        fee: input.fee,
        validUntil: validUntil.toISOString(),
        reason: previousInvoice ? input.reason!.trim() : null,
        previousInvoice,
        outcome: previousInvoice ? 'replace_unpaid_invoice' : 'issue_invoice',
      }
    );
    const review = parseConsultationFeeReview(snapshot);
    if (!review) throw new ConflictException('Consultation fee review requires reconciliation');
    return review;
  }

  async feeReview(
    actor: Actor,
    id: string,
    input: {
      fee: string;
      scope: string;
      deliverables: string;
      validUntil: string;
      reason?: string | undefined;
    }
  ) {
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
      await requireStaffMutationPermission(client, actor.userId, 'orders:write');
      await requireStaffMutationPermission(client, actor.userId, 'invoices:write');
      await requireCurrentSession(client, actor);
      if (preview.invoice_id)
        await client.query('SELECT id FROM invoices WHERE id=$1 FOR UPDATE', [preview.invoice_id]);
      const request = await this.lockRequest(client, id);
      if (request.profile_id !== preview.profile_id || request.invoice_id !== preview.invoice_id)
        throw new ConflictException('Consultation changed; refresh before acting');
      const review = await this.feeReviewForLocked(client, request, input);
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return review;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  private async paidFeeReviewForLocked(
    client: PoolClient,
    request: RequestRow,
    input: { fee: string; reason: string; validUntil: string }
  ): Promise<ConsultationPaidFeeReview> {
    const nextFee = BigInt(input.fee);
    if (nextFee <= 0n || nextFee > 9_223_372_036_854_775_807n)
      throw new InputFieldException(['fee']);
    const validUntil = consultationOfferDeadline(input.validUntil);
    if (request.status !== 'offer_accepted' || !request.invoice_id || !request.fee)
      throw new ConflictException('Only an accepted paid consultation can be adjusted');
    await this.assertCreditsCovered(client, request.id);
    const invoice = (
      await client.query<{
        id: string;
        state: string;
        total_amount: string;
        paid_amount: string;
        consultation_id: string | null;
        profile_id: string;
      }>(
        `SELECT id,state,total_amount,paid_amount,consultation_id,profile_id
         FROM invoices WHERE id=$1`,
        [request.invoice_id]
      )
    ).rows[0];
    if (
      !invoice ||
      !['Paid', 'PartiallyRefunded'].includes(invoice.state) ||
      invoice.consultation_id !== request.id ||
      invoice.profile_id !== request.profile_id ||
      BigInt(invoice.paid_amount) <= 0n
    )
      throw new ConflictException('Consultation invoice is not paid');
    const difference = nextFee - BigInt(request.fee);
    if (difference === 0n) throw new InputFieldException(['fee']);
    const title = request.product_snapshot?.title;
    if (!title?.fa || !title.en || !request.scope || !request.deliverables)
      throw new ConflictException('Consultation terms are unavailable');
    const profileName = (
      await client.query<{ name: string }>(
        `SELECT COALESCE(NULLIF(lp.legal_name,''),
          NULLIF(TRIM(CONCAT_WS(' ',p.first_name,p.last_name)),''),p.id::text) AS name
         FROM profiles p LEFT JOIN legal_profiles lp ON lp.id=p.id WHERE p.id=$1`,
        [request.profile_id]
      )
    ).rows[0]?.name;
    if (!profileName) throw new ConflictException('Consultation profile is unavailable');
    const refundPlan: Array<{ invoiceId: string; amount: string; availableBefore: string }> = [];
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
          [request.id]
        )
      ).rows;
      for (const paid of paidInvoices) {
        if (remaining === 0n) break;
        const available = BigInt(paid.available);
        if (available <= 0n) continue;
        const amount = remaining < available ? remaining : available;
        refundPlan.push({
          invoiceId: paid.id,
          amount: amount.toString(),
          availableBefore: available.toString(),
        });
        remaining -= amount;
      }
      if (remaining > 0n)
        throw new ConflictException('Refund exceeds available consultation payments');
    }
    const snapshot = new ReviewSnapshotService().create(
      {
        action: 'consultation.paid-fee-adjustment',
        profileId: request.profile_id,
        resourceId: request.id,
      },
      {
        serviceTitle: { fa: title.fa, en: title.en },
        profileName,
        scope: request.scope,
        deliverables: request.deliverables,
        previousFee: request.fee,
        revisedFee: input.fee,
        difference: difference.toString(),
        adjustmentAmount: (difference < 0n ? -difference : difference).toString(),
        reason: input.reason,
        validUntil: validUntil.toISOString(),
        paidInvoice: {
          id: invoice.id,
          state: invoice.state,
          totalAmount: invoice.total_amount,
          paidAmount: invoice.paid_amount,
        },
        refundPlan,
        outcome: difference > 0n ? 'charge_invoice' : 'credit_and_wallet_refund',
      }
    );
    const review = parseConsultationPaidFeeReview(snapshot);
    if (!review)
      throw new ConflictException('Paid consultation fee review requires reconciliation');
    return review;
  }

  async paidFeeReview(
    actor: Actor,
    id: string,
    input: { fee: string; reason: string; validUntil: string }
  ) {
    return this.staffFinancialPreview(actor, id, (client, request) =>
      this.paidFeeReviewForLocked(client, request, input)
    );
  }

  private async staffFinancialPreview<T>(
    actor: Actor,
    id: string,
    read: (client: PoolClient, request: RequestRow) => Promise<T>,
    needsInvoiceWrite = true
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
      await lockDualApprovalThreshold(client, 'read');
      await requireStaffMutationPermission(client, actor.userId, 'orders:write');
      await requireStaffMutationPermission(client, actor.userId, 'admin:financial:edit');
      if (needsInvoiceWrite)
        await requireStaffMutationPermission(client, actor.userId, 'invoices:write');
      await requireCurrentSession(client, actor);
      const invoices = (
        await client.query<{ id: string }>(
          'SELECT id FROM invoices WHERE consultation_id=$1 ORDER BY id',
          [id]
        )
      ).rows;
      for (const invoice of invoices)
        await client.query('SELECT id FROM invoices WHERE id=$1 FOR UPDATE', [invoice.id]);
      const request = await this.lockRequest(client, id);
      if (request.profile_id !== preview.profile_id || request.invoice_id !== preview.invoice_id)
        throw new ConflictException('Consultation changed; refresh before acting');
      const review = await read(client, request);
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return review;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async adjustPaidFee(
    actor: Actor,
    id: string,
    input: {
      idempotencyKey: string;
      fee: string;
      reason: string;
      validUntil: string;
      expectedReviewHash: string;
    },
    ip: string
  ) {
    return this.staffMutation(
      actor,
      id,
      ip,
      'paid_fee_adjusted',
      async (client, request) => {
        await requireStaffMutationPermission(client, actor.userId, 'invoices:write');
        const priorRows = (
          await client.query<{ user_id: string; metadata: unknown }>(
            `SELECT user_id,metadata::jsonb AS metadata FROM audit_log WHERE event='consultation.fee.adjusted'
           AND metadata::jsonb->>'requestId'=$1 AND metadata::jsonb->>'idempotencyKey'=$2 LIMIT 2`,
            [id, input.idempotencyKey]
          )
        ).rows;
        if (priorRows.length > 1)
          throw new ConflictException('Paid fee adjustment key is ambiguous');
        const prior = priorRows[0];
        if (prior) {
          if (prior.user_id !== actor.userId)
            throw new ConflictException('Paid fee adjustment key was already used');
          const result = replayConsultationPaidFee(prior.metadata, request.profile_id, id, input);
          await requireSessionStepUp(client, actor);
          return result;
        }
        const validUntil = new Date(input.validUntil);
        const financialReview = await this.paidFeeReviewForLocked(client, request, input);
        new ReviewSnapshotService().assertConfirmed(financialReview, input.expectedReviewHash);
        const difference = BigInt(financialReview.data.difference);
        const adjustment = await this.adjustments.createAdjustmentInvoice(
          {
            originalInvoiceId: financialReview.data.paidInvoice.id,
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
          for (const invoice of financialReview.data.refundPlan) {
            const refund = await this.refunds.request(
              {
                invoiceId: invoice.invoiceId,
                amount: invoice.amount,
                idempotencyKey: `${input.idempotencyKey}:${invoice.invoiceId}`,
                reason: input.reason,
              },
              actor,
              ip,
              'wallet',
              client
            );
            refundIds.push(refund.id);
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
          invoiceId:
            difference > 0n ? adjustment.adjustmentInvoiceId : financialReview.data.paidInvoice.id,
          adjustmentInvoiceId: adjustment.adjustmentInvoiceId,
          refundIds,
          financialReview,
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
              financialReview,
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

  private async paidResolutionReviewForLocked(
    client: PoolClient,
    request: RequestRow,
    action: 'cancel' | 'reject' | 'recover_refund',
    reason: string
  ): Promise<ConsultationPaidResolutionReview> {
    const uncoveredCredit = await this.uncoveredCredit(client, request.id);
    const recovery = action === 'recover_refund';
    const resultingStatus: ConsultationStatus = recovery
      ? request.status
      : action === 'cancel'
        ? 'cancelled'
        : 'rejected';
    if (recovery) {
      if (uncoveredCredit <= 0n)
        throw new ConflictException('No consultation credit needs a refund');
    } else {
      if (!canTransitionConsultation(request.status, resultingStatus, 'staff'))
        throw new ConflictException('Consultation status changed; refresh before acting');
      if (uncoveredCredit > 0n)
        throw new ConflictException(
          'Resolve the uncovered consultation credit before another financial change'
        );
    }
    const paidInvoices = (
      await client.query<{ id: string; state: string; available: string }>(
        `SELECT i.id,i.state,(i.paid_amount-i.refunded_amount-
          COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.invoice_id=i.id
            AND r.state NOT IN ('Completed','Rejected','Cancelled')),0))::text AS available
         FROM invoices i WHERE i.consultation_id=$1 AND i.paid_amount>0
           AND i.adjustment_kind IS DISTINCT FROM 'credit'
         ORDER BY i.created_at DESC,i.id DESC`,
        [request.id]
      )
    ).rows;
    if (!recovery && paidInvoices.length === 0)
      throw new ConflictException('Consultation has no paid invoice');
    if (
      !recovery &&
      paidInvoices.some(
        (invoice) =>
          BigInt(invoice.available) > 0n && !['Paid', 'PartiallyRefunded'].includes(invoice.state)
      )
    )
      throw new ConflictException('A partially paid consultation needs finance review');
    let currentInvoice: {
      id: string;
      state: string;
      paidAmount: string;
      adjustmentKind: string | null;
    } | null = null;
    let cancelInvoiceId: string | null = null;
    if (request.invoice_id) {
      const current = (
        await client.query<{
          id: string;
          state: string;
          paid_amount: string;
          adjustment_kind: string | null;
          profile_id: string;
          consultation_id: string | null;
        }>(
          `SELECT id,state,paid_amount,adjustment_kind,profile_id,consultation_id
           FROM invoices WHERE id=$1`,
          [request.invoice_id]
        )
      ).rows[0];
      if (
        !current ||
        current.profile_id !== request.profile_id ||
        current.consultation_id !== request.id
      )
        throw new ConflictException('Consultation invoice linkage is invalid');
      currentInvoice = {
        id: current.id,
        state: current.state,
        paidAmount: current.paid_amount,
        adjustmentKind: current.adjustment_kind,
      };
      if (!recovery && BigInt(current.paid_amount) === 0n && current.adjustment_kind !== 'credit') {
        if (!['Draft', 'Unpaid', 'Overdue'].includes(current.state))
          throw new ConflictException('Unpaid consultation charge cannot be cancelled');
        cancelInvoiceId = current.id;
      }
    }
    const refundAllocations: Array<{
      invoiceId: string;
      state: string;
      amount: string;
      availableBefore: string;
    }> = [];
    let remaining = recovery ? uncoveredCredit : 0n;
    for (const invoice of paidInvoices) {
      if (recovery && remaining === 0n) break;
      if (!['Paid', 'PartiallyRefunded'].includes(invoice.state)) continue;
      const available = BigInt(invoice.available);
      if (available <= 0n) continue;
      const amount = recovery && remaining < available ? remaining : available;
      refundAllocations.push({
        invoiceId: invoice.id,
        state: invoice.state,
        amount: amount.toString(),
        availableBefore: available.toString(),
      });
      if (recovery) remaining -= amount;
    }
    if (recovery && remaining > 0n)
      throw new ConflictException('Refund recovery exceeds available paid balance');
    const totalRefund = refundAllocations.reduce((sum, item) => sum + BigInt(item.amount), 0n);
    const title = request.product_snapshot?.title;
    if (!title?.fa || !title.en)
      throw new ConflictException('Consultation service title is unavailable');
    const profileName = (
      await client.query<{ name: string }>(
        `SELECT COALESCE(NULLIF(lp.legal_name,''),
          NULLIF(TRIM(CONCAT_WS(' ',p.first_name,p.last_name)),''),p.id::text) AS name
         FROM profiles p LEFT JOIN legal_profiles lp ON lp.id=p.id WHERE p.id=$1`,
        [request.profile_id]
      )
    ).rows[0]?.name;
    if (!profileName) throw new ConflictException('Consultation profile is unavailable');
    const snapshot = new ReviewSnapshotService().create(
      {
        action: 'consultation.paid-resolution',
        profileId: request.profile_id,
        resourceId: request.id,
      },
      {
        action,
        serviceTitle: { fa: title.fa, en: title.en },
        profileName,
        currentStatus: request.status,
        resultingStatus,
        reason,
        currentInvoice,
        cancelInvoiceId,
        uncoveredCreditBefore: uncoveredCredit.toString(),
        refundAllocations,
        totalCredit: recovery ? '0' : totalRefund.toString(),
        totalRefund: totalRefund.toString(),
      }
    );
    const review = parseConsultationPaidResolutionReview(snapshot);
    if (!review)
      throw new ConflictException('Paid consultation resolution requires reconciliation');
    return review;
  }

  async assertCanEditPaidResolution(
    actor: Actor,
    id: string,
    recovery: boolean,
    write: boolean
  ): Promise<void> {
    if (!write) {
      await this.staffFinancialPreview(actor, id, async () => undefined, !recovery);
      return;
    }
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const source = (
        await client.query<{ profile_id: string; invoice_id: string | null }>(
          'SELECT profile_id,invoice_id FROM consultation_requests WHERE id=$1',
          [id]
        )
      ).rows[0];
      if (!source) throw new NotFoundException('Consultation request not found');
      await client.query('SELECT id FROM profiles WHERE id=$1 FOR SHARE', [source.profile_id]);
      await lockDualApprovalThreshold(client, 'read');
      await requireStaffMutationPermission(client, actor.userId, 'orders:write');
      await requireStaffMutationPermission(client, actor.userId, 'admin:financial:edit');
      await requireSessionStepUp(client, actor);
      const invoices = (
        await client.query<{ id: string }>(
          'SELECT id FROM invoices WHERE consultation_id=$1 ORDER BY id',
          [id]
        )
      ).rows;
      for (const invoice of invoices)
        await client.query('SELECT id FROM invoices WHERE id=$1 FOR UPDATE', [invoice.id]);
      const request = await this.lockRequest(client, id);
      if (request.profile_id !== source.profile_id || request.invoice_id !== source.invoice_id)
        throw new ConflictException('Consultation changed; refresh before acting');
      if (!recovery) await requireStaffMutationPermission(client, actor.userId, 'invoices:write');
      await requireSessionStepUp(client, actor);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async paidResolutionReview(
    actor: Actor,
    id: string,
    input: { action: 'cancel' | 'reject' | 'recover_refund'; reason: string }
  ) {
    return this.staffFinancialPreview(
      actor,
      id,
      (client, request) =>
        this.paidResolutionReviewForLocked(client, request, input.action, input.reason),
      input.action !== 'recover_refund'
    );
  }

  async closePaid(
    actor: Actor,
    id: string,
    action: 'cancel' | 'reject',
    input: { idempotencyKey: string; reason: string; expectedReviewHash: string },
    ip: string
  ) {
    return this.staffMutation(
      actor,
      id,
      ip,
      `paid_${action}`,
      async (client, request) => {
        const prior = (
          await client.query<{
            metadata: {
              action: string;
              reason: string;
              result: unknown;
              financialReview?: ConsultationPaidResolutionReview;
            };
          }>(
            `SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='consultation.paid.closed'
             AND metadata::jsonb->>'requestId'=$1 AND metadata::jsonb->>'idempotencyKey'=$2 LIMIT 1`,
            [id, input.idempotencyKey]
          )
        ).rows[0];
        if (prior) {
          if (prior.metadata.action !== action || prior.metadata.reason !== input.reason)
            throw new ConflictException('Paid closure key was already used');
          new ReviewSnapshotService().assertStored(
            { financialReview: prior.metadata.financialReview },
            input.expectedReviewHash,
            {
              action: 'consultation.paid-resolution',
              profileId: request.profile_id,
              resourceId: id,
            }
          );
          return prior.metadata.result;
        }
        const financialReview = await this.paidResolutionReviewForLocked(
          client,
          request,
          action,
          input.reason
        );
        new ReviewSnapshotService().assertConfirmed(financialReview, input.expectedReviewHash);
        const status: ConsultationStatus = action === 'cancel' ? 'cancelled' : 'rejected';
        const cancelledInvoiceId = financialReview.data.cancelInvoiceId;
        if (cancelledInvoiceId) {
          await this.invoiceStates.transition(
            cancelledInvoiceId,
            financialReview.data.currentInvoice!.state as InvoiceState,
            'Cancelled',
            { actorUserId: actor.userId, reason: input.reason, ip, client }
          );
        }
        const creditInvoiceIds: string[] = [];
        const refundIds: string[] = [];
        for (const invoice of financialReview.data.refundAllocations) {
          const credit = await this.adjustments.createAdjustmentInvoice(
            {
              originalInvoiceId: invoice.invoiceId,
              amount: -BigInt(invoice.amount),
              reason: input.reason,
              actorUserId: actor.userId,
              actorSession: actor,
              idempotencyKey: `${input.idempotencyKey}:${invoice.invoiceId}`,
              ip,
            },
            client
          );
          const refund = await this.refunds.request(
            {
              invoiceId: invoice.invoiceId,
              amount: invoice.amount,
              idempotencyKey: `${input.idempotencyKey}:${invoice.invoiceId}`,
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
        const result = {
          requestId: id,
          status,
          cancelledInvoiceId,
          creditInvoiceIds,
          refundIds,
          financialReview,
        };
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
              financialReview,
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
    input: { idempotencyKey: string; reason: string; expectedReviewHash: string },
    ip: string
  ) {
    return this.staffMutation(
      actor,
      id,
      ip,
      'refund_recovered',
      async (client, request) => {
        const prior = (
          await client.query<{
            metadata: {
              reason: string;
              result: unknown;
              financialReview?: ConsultationPaidResolutionReview;
            };
          }>(
            `SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='consultation.refund.recovered'
             AND metadata::jsonb->>'requestId'=$1 AND metadata::jsonb->>'idempotencyKey'=$2 LIMIT 1`,
            [id, input.idempotencyKey]
          )
        ).rows[0];
        if (prior) {
          if (prior.metadata.reason !== input.reason)
            throw new ConflictException('Refund recovery key was already used');
          new ReviewSnapshotService().assertStored(
            { financialReview: prior.metadata.financialReview },
            input.expectedReviewHash,
            {
              action: 'consultation.paid-resolution',
              profileId: request.profile_id,
              resourceId: id,
            }
          );
          return prior.metadata.result;
        }
        const financialReview = await this.paidResolutionReviewForLocked(
          client,
          request,
          'recover_refund',
          input.reason
        );
        new ReviewSnapshotService().assertConfirmed(financialReview, input.expectedReviewHash);
        const refundIds: string[] = [];
        for (const invoice of financialReview.data.refundAllocations) {
          const refund = await this.refunds.request(
            {
              invoiceId: invoice.invoiceId,
              amount: invoice.amount,
              idempotencyKey: `${input.idempotencyKey}:${invoice.invoiceId}`,
              reason: input.reason,
            },
            actor,
            ip,
            'wallet',
            client
          );
          refundIds.push(refund.id);
        }
        const result = { requestId: id, status: request.status, refundIds, financialReview };
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
              financialReview,
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
            operatingContext: 'staff',
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

  private async lockedCustomerOffer(
    client: PoolClient,
    actor: Actor,
    id: string,
    decision: 'accept' | 'decline'
  ): Promise<{ request: RequestRow; invoice: OfferInvoiceRow; review: ConsultationOfferReview }> {
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
      await client.query<OfferInvoiceRow>(
        `SELECT id,state,paid_amount,total_amount,adjustment_kind,profile_id,consultation_id
         FROM invoices WHERE id=$1 FOR UPDATE`,
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
    } else if (
      !request.accepted_at &&
      request.offer_valid_until &&
      request.offer_valid_until <= new Date() &&
      invoice.state !== 'Paid'
    ) {
      throw new ConflictException('Consultation offer has expired');
    }
    const title = request.product_snapshot?.title;
    if (
      !title?.fa ||
      !title.en ||
      !request.scope ||
      !request.deliverables ||
      !request.fee ||
      !request.offer_valid_until ||
      BigInt(request.fee) < BigInt(invoice.total_amount) ||
      (invoice.adjustment_kind !== null && invoice.adjustment_kind !== 'charge')
    )
      throw new ConflictException('Consultation offer requires reconciliation');
    const snapshot = new ReviewSnapshotService().create(
      {
        action: `consultation.offer-${decision}`,
        profileId: request.profile_id,
        resourceId: id,
      },
      {
        decision,
        serviceTitle: { fa: title.fa, en: title.en },
        scope: request.scope,
        deliverables: request.deliverables,
        fee: request.fee,
        previousFee: (BigInt(request.fee) - BigInt(invoice.total_amount)).toString(),
        validUntil: request.offer_valid_until.toISOString(),
        acceptedAt: request.accepted_at?.toISOString() ?? null,
        invoice: {
          id: invoice.id,
          state: invoice.state,
          totalAmount: invoice.total_amount,
          paidAmount: invoice.paid_amount,
          adjustmentKind: invoice.adjustment_kind,
        },
        outcome:
          decision === 'decline'
            ? 'cancel_unpaid_invoice'
            : invoice.state === 'Paid'
              ? 'accepted_paid'
              : 'payment_required',
      }
    );
    const review = parseConsultationOfferReview(snapshot);
    if (!review) throw new ConflictException('Consultation offer requires reconciliation');
    return { request, invoice, review };
  }

  async customerDecisionReview(actor: Actor, id: string, decision: 'accept' | 'decline') {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const { review } = await this.lockedCustomerOffer(client, actor, id, decision);
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return review;
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
    ip: string,
    expectedReviewHash: string
  ) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const { request, invoice, review } = await this.lockedCustomerOffer(
        client,
        actor,
        id,
        decision
      );
      new ReviewSnapshotService().assertConfirmed(review, expectedReviewHash);
      if (decision === 'decline') {
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
          { action: 'offer_declined', invoiceId: invoice.id, financialReview: review },
          ip
        );
        await requireCurrentSession(client, actor);
        await client.query('COMMIT');
        return { requestId: id, status: 'offer_declined' as const, financialReview: review };
      }
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
      }
      const paid = invoice.state === 'Paid';
      if (paid) await settlePaidConsultation(client, id, invoice.id, actor.userId);
      if (!request.accepted_at || paid)
        await this.audit(
          client,
          actor.userId,
          id,
          {
            action: paid ? 'offer_accepted_paid' : 'offer_accepted_pending_payment',
            invoiceId: invoice.id,
            financialReview: review,
          },
          ip
        );
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return {
        requestId: id,
        invoiceId: invoice.id,
        status: paid ? ('offer_accepted' as const) : ('offer_pending' as const),
        paymentRequired: !paid,
        financialReview: review,
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
    financial = false,
    assignmentTeam?: string
  ): Promise<T> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      if (assignmentTeam)
        await client.query('SELECT pg_advisory_xact_lock_shared(hashtext($1))', [
          STAFF_ASSIGNMENT_RULES_CONFIG_KEY,
        ]);
      const preview = (
        await client.query<{ profile_id: string; invoice_id: string | null }>(
          'SELECT profile_id,invoice_id FROM consultation_requests WHERE id=$1',
          [id]
        )
      ).rows[0];
      if (!preview) throw new NotFoundException('Consultation request not found');
      await client.query('SELECT id FROM profiles WHERE id=$1 FOR SHARE', [preview.profile_id]);
      if (financial) await lockDualApprovalThreshold(client, 'read');
      // Routing locks teams before candidate accounts. Manual assignment must
      // use the same order when its actor is also an automatic-routing candidate.
      if (assignmentTeam)
        await client.query('SELECT id FROM staff_teams WHERE name=$1 AND is_active FOR SHARE', [
          assignmentTeam,
        ]);
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
         r.invoice_id,r.fee,r.scope,r.deliverables,r.product_snapshot,
         r.accepted_at,r.accepted_by,r.offer_valid_until,p.user_id AS profile_user_id
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
          operatingContext: 'customer',
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
