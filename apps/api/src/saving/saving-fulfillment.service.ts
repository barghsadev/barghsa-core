import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { GiftCodeService } from '../admin/gift-code.service.js';
import {
  auditContract,
  contractIdempotency,
  staffContractMutation,
} from '../contract/contract-transactions.js';
import { InvoiceStateMachineService } from '../invoice/invoice-state-machine.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { ValidatedSession } from '../session/session.service.js';

type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
export const SAVING_STAGES = [
  'request_confirmation',
  'product_delivery',
  'installation_and_document_upload',
  'equipment_handover',
  'process_completion',
] as const;
export type SavingStage = (typeof SAVING_STAGES)[number];
export type StageAction = 'complete' | 'skip';
type ReviewAction = 'approve' | 'reject';
interface ReviewRow {
  id: string;
  order_id: string;
  profile_id: string;
  customer_id: string;
  customer_name: string;
  status: string;
  financial_status: string;
  submitted_at: Date;
  bill_identifier: string;
  address_snapshot: Record<string, unknown>;
  pricing_snapshot: Record<string, unknown>;
  verification_result: Record<string, unknown>;
  agreement_snapshot: string;
  gift_code_id: string | null;
  contract_id: string;
  contract_state: string;
  version_id: string;
  invoice_id: string;
  invoice_state: string;
  total_amount: string;
  paid_amount: string;
  refunded_amount: string;
  pending_refund_amount: string;
  activation_invoice_id: string | null;
}
interface StageRow {
  stage: SavingStage;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
}
const reviewQuery = `SELECT s.id,s.order_id,s.profile_id,p.user_id AS customer_id,
  u.username AS customer_name,s.status,s.financial_status,s.submitted_at,
  s.bill_identifier,s.address_snapshot,s.pricing_snapshot,s.verification_result,
  s.agreement_snapshot,o.gift_code_id,c.id AS contract_id,c.state AS contract_state,
  c.current_version_id AS version_id,i.id AS invoice_id,i.state AS invoice_state,
  i.total_amount::text AS total_amount,i.paid_amount::text AS paid_amount,
  i.refunded_amount::text AS refunded_amount,ar.initial_invoice_id AS activation_invoice_id,
  COALESCE((SELECT SUM(r.amount)::text FROM refunds r WHERE r.invoice_id=i.id
    AND r.state NOT IN ('Completed','Rejected','Cancelled')), '0') AS pending_refund_amount
  FROM saving_orders s JOIN orders o ON o.id=s.order_id
  JOIN profiles p ON p.id=s.profile_id JOIN users u ON u.user_id=p.user_id
  JOIN contracts c ON c.order_id=o.id AND c.service_type='savings'
  JOIN contract_activation_requirements ar ON ar.version_id=c.current_version_id
  JOIN invoices i ON i.order_id=o.id AND i.type='auto'
    AND i.adjustment_for_invoice_id IS NULL AND i.replaces_invoice_id IS NULL`;

@Injectable()
export class SavingFulfillmentService {
  constructor(
    private readonly invoices: InvoiceStateMachineService,
    private readonly giftCodes: GiftCodeService
  ) {}

  async queue() {
    const rows = (
      await getDbPool().query<ReviewRow>(
        `${reviewQuery} WHERE s.status IN ('awaiting_staff_review','approved','in_progress')
       ORDER BY CASE WHEN s.status='awaiting_staff_review' THEN 0 ELSE 1 END,
         s.submitted_at ASC,s.id ASC LIMIT 100`
      )
    ).rows;
    return { orders: rows.map((row) => this.present(row)) };
  }

  async detail(id: string) {
    const client = await getDbPool().connect();
    try {
      const row = (await client.query<ReviewRow>(`${reviewQuery} WHERE s.id=$1`, [id])).rows[0];
      if (!row) throw new NotFoundException('Saving order not found');
      const stages = (
        await client.query(
          `SELECT stage,status,started_at,completed_at,completed_by,explanation,handover_description
         FROM saving_fulfillment_stages WHERE order_id=$1
         ORDER BY CASE stage WHEN 'request_confirmation' THEN 1 WHEN 'product_delivery' THEN 2
           WHEN 'installation_and_document_upload' THEN 3 WHEN 'equipment_handover' THEN 4 ELSE 5 END`,
          [id]
        )
      ).rows;
      const events = (
        await client.query(
          `SELECT id,stage,from_status,to_status,actor_user_id,explanation,handover_description,created_at
         FROM saving_fulfillment_events WHERE order_id=$1 ORDER BY created_at,id`,
          [id]
        )
      ).rows;
      return { ...this.present(row), stages, events };
    } finally {
      client.release();
    }
  }

  private present(row: ReviewRow) {
    return {
      id: row.id,
      orderId: row.order_id,
      profileId: row.profile_id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      status: row.status,
      financialStatus: row.financial_status,
      submittedAt: row.submitted_at.toISOString(),
      billIdentifier: row.bill_identifier,
      addressSnapshot: row.address_snapshot,
      pricingSnapshot: row.pricing_snapshot,
      verificationResult: row.verification_result,
      agreementSnapshot: row.agreement_snapshot,
      contractId: row.contract_id,
      contractState: row.contract_state,
      versionId: row.version_id,
      invoiceId: row.invoice_id,
      invoiceState: row.invoice_state,
      totalIrR: row.total_amount,
      paidIrR: row.paid_amount,
      refundedIrR: row.refunded_amount,
      pendingRefundIrR: row.pending_refund_amount,
    };
  }

  private async lockRow(client: PoolClient, id: string): Promise<ReviewRow> {
    const row = (
      await client.query<ReviewRow>(`${reviewQuery} WHERE s.id=$1 FOR UPDATE OF s,o,c,i`, [id])
    ).rows[0];
    if (!row) throw new NotFoundException('Saving order not found');
    return row;
  }

  private async notify(client: PoolClient, row: ReviewRow, fa: string, en: string) {
    await new NotificationsService().create(
      {
        userId: row.customer_id,
        profileId: row.profile_id,
        type: 'general',
        title: 'Saving order',
        link: `/savings/orders/${row.id}`,
        localizedContent: {
          fa: { title: 'سفارش صرفه‌جویی برق', body: fa },
          en: { title: 'Power-saving order', body: en },
        },
      },
      client
    );
  }

  private async event(
    client: PoolClient,
    row: ReviewRow,
    stage: SavingStage,
    from: StageRow['status'],
    to: StageRow['status'],
    actor: Actor,
    explanation: string,
    handoverDescription?: string
  ) {
    await client.query(
      `INSERT INTO saving_fulfillment_events(id,order_id,stage,from_status,to_status,
         actor_user_id,explanation,handover_description) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [uuidv7(), row.id, stage, from, to, actor.userId, explanation, handoverDescription ?? null]
    );
  }

  private async createRefund(client: PoolClient, row: ReviewRow, actor: Actor, reason: string) {
    const paid = BigInt(row.paid_amount),
      refunded = BigInt(row.refunded_amount);
    if (paid < refunded || BigInt(row.pending_refund_amount) > 0n)
      throw new ConflictException('Resolve existing refund before rejecting the order');
    if (paid === refunded) return null;
    const refundId = uuidv7(),
      amount = (paid - refunded).toString();
    const key = `saving-reject:${row.order_id}`;
    await client.query(
      `INSERT INTO refunds(id,invoice_id,profile_id,amount,destination,idempotency_key)
       VALUES($1,$2,$3,$4,'wallet',$5)`,
      [refundId, row.invoice_id, row.profile_id, amount, `${key}:${row.invoice_id}`]
    );
    await client.query(
      `INSERT INTO refund_obligations(id,order_id,contract_id,invoice_id,profile_id,
        refund_id,total_paid_amount,completed_refund_amount,idempotency_key,authorized_by,reason)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        uuidv7(),
        row.order_id,
        row.contract_id,
        row.invoice_id,
        row.profile_id,
        refundId,
        paid.toString(),
        refunded.toString(),
        key,
        actor.userId,
        reason,
      ]
    );
    await client.query("UPDATE refunds SET state='Approved' WHERE id=$1", [refundId]);
    await client.query("UPDATE refunds SET state='Processing' WHERE id=$1", [refundId]);
    await client.query('INSERT INTO refund_retry_jobs(refund_id,executor_user_id) VALUES($1,$2)', [
      refundId,
      actor.userId,
    ]);
    return refundId;
  }

  async decide(
    id: string,
    action: ReviewAction,
    input: {
      idempotencyKey: string;
      expectedVersionId: string;
      reason?: string | undefined;
    },
    actor: Actor,
    ip: string
  ) {
    const profile = (
      await getDbPool().query<{ profile_id: string }>(
        'SELECT profile_id FROM saving_orders WHERE id=$1',
        [id]
      )
    ).rows[0];
    if (!profile) throw new NotFoundException('Saving order not found');
    try {
      return await staffContractMutation(profile.profile_id, actor, (client, archived) =>
        contractIdempotency(
          client,
          'saving_staff_review',
          { ...input, orderId: id, action },
          actor,
          async () => {
            if (archived) throw new ConflictException('Profile is archived');
            const row = await this.lockRow(client, id);
            if (
              row.status !== 'awaiting_staff_review' ||
              row.version_id !== input.expectedVersionId ||
              row.contract_state !== 'AwaitingStaffReview' ||
              row.activation_invoice_id !== row.invoice_id
            )
              throw new ConflictException('Saving order review changed; reload before deciding');
            const reason = input.reason?.trim() ?? '';
            if (action === 'reject' && !reason)
              throw new ConflictException('Rejection requires a reason');
            if (action === 'reject' && row.invoice_state === 'PaymentUnderReview')
              throw new ConflictException('Resolve pending payment review before rejection');
            let refundId: string | null = null;
            if (action === 'approve') {
              await client.query(
                'INSERT INTO contract_publications(contract_id,version_id,published_by) VALUES($1,$2,$3)',
                [row.contract_id, row.version_id, actor.userId]
              );
              await client.query(
                "UPDATE contracts SET state='AwaitingCustomerAcceptance' WHERE id=$1",
                [row.contract_id]
              );
              await client.query(
                "UPDATE orders SET status='CONFIRMED',updated_at=NOW() WHERE id=$1",
                [row.order_id]
              );
              await client.query(
                "UPDATE saving_orders SET status='approved',updated_at=NOW() WHERE id=$1",
                [id]
              );
              await client.query(
                `UPDATE saving_fulfillment_stages SET status='completed',started_at=NOW(),
                completed_at=NOW(),completed_by=$2,explanation='Staff approved request',updated_at=NOW()
                WHERE order_id=$1 AND stage='request_confirmation' AND status='pending'`,
                [id, actor.userId]
              );
              await this.event(
                client,
                row,
                'request_confirmation',
                'pending',
                'completed',
                actor,
                'Staff approved request'
              );
              await client.query(
                `UPDATE saving_fulfillment_stages SET status='in_progress',started_at=NOW(),updated_at=NOW()
                WHERE order_id=$1 AND stage='product_delivery' AND status='pending'`,
                [id]
              );
              await this.event(
                client,
                row,
                'product_delivery',
                'pending',
                'in_progress',
                actor,
                'Request approved'
              );
              await this.notify(
                client,
                row,
                'سفارش صرفه‌جویی شما تأیید شد. قرارداد و فاکتور را بررسی کنید.',
                'Your power-saving order was approved. Review the contract and invoice.'
              );
            } else {
              refundId = await this.createRefund(client, row, actor, reason);
              if (refundId) {
                await client.query(
                  "UPDATE saving_orders SET financial_status='refund_pending' WHERE id=$1",
                  [id]
                );
              } else if (['Draft', 'Unpaid', 'Overdue'].includes(row.invoice_state)) {
                await this.invoices.transition(
                  row.invoice_id,
                  row.invoice_state as 'Draft' | 'Unpaid' | 'Overdue',
                  'Cancelled',
                  {
                    actorUserId: actor.userId,
                    reason,
                    ip,
                    client,
                    financials: {
                      paidAmount: 0n,
                      refundedAmount: 0n,
                      totalAmount: BigInt(row.total_amount),
                    },
                  }
                );
              }
              await client.query("UPDATE contracts SET state='Rejected' WHERE id=$1", [
                row.contract_id,
              ]);
              await client.query(
                "UPDATE orders SET status='CANCELLED',updated_at=NOW() WHERE id=$1",
                [row.order_id]
              );
              await client.query(
                "UPDATE saving_orders SET status='rejected',updated_at=NOW() WHERE id=$1",
                [id]
              );
              if (BigInt(row.paid_amount) === 0n && row.gift_code_id)
                await this.giftCodes.releaseByOrder(row.order_id, client, {
                  actorUserId: actor.userId,
                  ip,
                });
              await this.notify(
                client,
                row,
                `سفارش صرفه‌جویی شما رد شد. دلیل: ${reason}`,
                `Your power-saving order was rejected. Reason: ${reason}`
              );
            }
            await auditContract(
              client,
              row.contract_id,
              row.version_id,
              `saving.order_review.${action}`,
              actor,
              ip,
              { savingOrderId: id, reason, refundId }
            );
            return {
              savingOrderId: id,
              status: action === 'approve' ? 'approved' : 'rejected',
              refundId,
            };
          }
        )
      );
    } catch (error) {
      if (
        (error as { code?: string; message?: string }).code === '23514' &&
        (error as Error).message.includes('Saving hardware is out of stock')
      )
        throw new ConflictException('Selected saving hardware is out of stock');
      throw error;
    }
  }

  async advance(
    id: string,
    stage: SavingStage,
    action: StageAction,
    input: {
      idempotencyKey: string;
      expectedStatus: 'in_progress';
      explanation: string;
      handoverDescription?: string | undefined;
    },
    actor: Actor,
    ip: string
  ) {
    const profile = (
      await getDbPool().query<{ profile_id: string }>(
        'SELECT profile_id FROM saving_orders WHERE id=$1',
        [id]
      )
    ).rows[0];
    if (!profile) throw new NotFoundException('Saving order not found');
    return staffContractMutation(profile.profile_id, actor, (client, archived) =>
      contractIdempotency(
        client,
        'saving_stage_advance',
        { ...input, savingOrderId: id, stage, action },
        actor,
        async () => {
          if (archived) throw new ConflictException('Profile is archived');
          const row = await this.lockRow(client, id);
          if (!['approved', 'in_progress'].includes(row.status))
            throw new ConflictException('Order is not in fulfillment');
          if (
            stage === 'request_confirmation' ||
            (action === 'skip' && stage !== 'equipment_handover')
          )
            throw new ConflictException('Invalid fulfillment stage action');
          if (stage === 'product_delivery' && row.invoice_state !== 'Paid')
            throw new ConflictException('Payment is required before delivering equipment');
          if (
            stage === 'process_completion' &&
            (row.invoice_state !== 'Paid' || !['Active', 'Completed'].includes(row.contract_state))
          )
            throw new ConflictException('Payment and an active contract are required to complete');
          const index = SAVING_STAGES.indexOf(stage);
          const stages = (
            await client.query<StageRow>(
              'SELECT stage,status FROM saving_fulfillment_stages WHERE order_id=$1 FOR UPDATE',
              [id]
            )
          ).rows;
          const current = stages.find((item) => item.stage === stage);
          if (
            current?.status !== input.expectedStatus ||
            SAVING_STAGES.slice(0, index).some(
              (key) =>
                !['completed', 'skipped'].includes(
                  stages.find((item) => item.stage === key)?.status ?? 'pending'
                )
            )
          )
            throw new ConflictException('Fulfillment stage changed; reload before advancing');
          const explanation = input.explanation.trim();
          const handover = input.handoverDescription?.trim();
          if (
            !explanation ||
            (stage === 'equipment_handover' && action === 'complete' && !handover)
          )
            throw new ConflictException('Explanation and handover details are required');
          const nextStatus = action === 'skip' ? 'skipped' : 'completed';
          await client.query(
            `UPDATE saving_fulfillment_stages SET status=$3,completed_at=NOW(),completed_by=$4,
              explanation=$5,handover_description=$6,updated_at=NOW()
              WHERE order_id=$1 AND stage=$2`,
            [id, stage, nextStatus, actor.userId, explanation, handover ?? null]
          );
          await this.event(
            client,
            row,
            stage,
            'in_progress',
            nextStatus,
            actor,
            explanation,
            handover
          );
          const next = SAVING_STAGES[index + 1];
          if (next) {
            await client.query(
              `UPDATE saving_fulfillment_stages SET status='in_progress',started_at=NOW(),updated_at=NOW()
                WHERE order_id=$1 AND stage=$2 AND status='pending'`,
              [id, next]
            );
            await this.event(
              client,
              row,
              next,
              'pending',
              'in_progress',
              actor,
              'Previous stage finished'
            );
          }
          const commercial = next ? 'in_progress' : 'completed';
          await client.query('UPDATE saving_orders SET status=$2,updated_at=NOW() WHERE id=$1', [
            id,
            commercial,
          ]);
          await auditContract(
            client,
            row.contract_id,
            row.version_id,
            `saving.fulfillment.${action}`,
            actor,
            ip,
            {
              savingOrderId: id,
              stage,
              from: 'in_progress',
              to: nextStatus,
              explanation,
              handoverDescription: handover ?? null,
            }
          );
          await this.notify(
            client,
            row,
            next
              ? 'مرحله‌ای از سفارش صرفه‌جویی شما تکمیل شد.'
              : 'اجرای سفارش صرفه‌جویی شما تکمیل شد.',
            next
              ? 'A stage of your power-saving order was completed.'
              : 'Your power-saving order is complete.'
          );
          return {
            savingOrderId: id,
            status: commercial,
            stage,
            stageStatus: nextStatus,
            nextStage: next ?? null,
          };
        }
      )
    );
  }
}
