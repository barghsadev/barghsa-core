import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import type { ValidatedSession } from '../session/session.service.js';
import {
  staffContractMutation,
  contractIdempotency,
  auditContract,
} from '../contract/contract-transactions.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { InvoiceStateMachineService } from '../invoice/invoice-state-machine.service.js';
import { GiftCodeService } from '../admin/gift-code.service.js';
import { createElectricityRefundObligation } from './electricity-refund-obligation.js';
import {
  canTransitionElectricityOrder,
  electricityFinancialStatus,
  electricityNextAction,
  type ElectricityCommercialStatus,
} from './electricity-order-status.js';

type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
export type StaffReviewAction = 'approve' | 'request-changes' | 'reject';
export interface StaffReviewInput {
  idempotencyKey: string;
  expectedVersionId: string;
  reason?: string | undefined;
}

interface ReviewRow {
  id: string;
  profile_id: string;
  customer_id: string;
  customer_name: string;
  commercial_status: ElectricityCommercialStatus;
  submitted_at: Date;
  period_start: Date;
  period_end: Date;
  total_kwh: string;
  pricing_snapshot: Record<string, unknown>;
  settings_snapshot: Record<string, unknown>;
  full_address: string;
  postal_code: string;
  gift_code_id: string | null;
  contract_id: string;
  contract_state: string;
  version_id: string;
  version_number: number;
  contract_snapshot: Record<string, unknown>;
  invoice_id: string;
  activation_invoice_id: string | null;
  invoice_state: string;
  total_amount: string;
  paid_amount: string;
  refunded_amount: string;
  pending_refund_amount: string;
}

const reviewQuery = `SELECT o.id,o.profile_id,p.user_id AS customer_id,
  u.username AS customer_name,e.status AS commercial_status,e.submitted_at,
  e.period_start,e.period_end,e.total_kwh,e.pricing_snapshot,e.settings_snapshot,
  o.snapshot_full_address AS full_address,o.snapshot_postal_code AS postal_code,
  o.gift_code_id,ec.contract_id,c.state AS contract_state,
  c.current_version_id AS version_id,v.version_number,v.content AS contract_snapshot,
  i.id AS invoice_id,ar.initial_invoice_id AS activation_invoice_id,
  i.state AS invoice_state,i.total_amount,i.paid_amount,i.refunded_amount,
  COALESCE((SELECT SUM(r.amount)::text FROM refunds r WHERE r.invoice_id=i.id
    AND r.state NOT IN ('Completed','Rejected','Cancelled')), '0') AS pending_refund_amount
  FROM orders o JOIN electricity_orders e ON e.id=o.id
  JOIN profiles p ON p.id=o.profile_id JOIN users u ON u.user_id=p.user_id
  JOIN electricity_contracts ec ON ec.order_id=o.id
  JOIN contracts c ON c.id=ec.contract_id
  JOIN contract_versions v ON v.id=c.current_version_id
  JOIN contract_activation_requirements ar ON ar.version_id=v.id
  JOIN invoices i ON i.id=ar.initial_invoice_id
  `;

function present(row: ReviewRow) {
  const financialStatus = electricityFinancialStatus({
    invoiceState: row.invoice_state,
    totalAmount: row.total_amount,
    paidAmount: row.paid_amount,
    refundedAmount: row.refunded_amount,
    pendingRefundAmount: row.pending_refund_amount,
  });
  return {
    orderId: row.id,
    profileId: row.profile_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    commercialStatus: row.commercial_status,
    financialStatus,
    nextAction: electricityNextAction(
      row.commercial_status,
      financialStatus,
      'staff',
      row.contract_state
    ),
    submittedAt: row.submitted_at.toISOString(),
    periodStart: row.period_start.toISOString(),
    periodEnd: row.period_end.toISOString(),
    totalKwh: row.total_kwh,
    pricingSnapshot: row.pricing_snapshot,
    settingsSnapshot:
      row.contract_snapshot.settings &&
      typeof row.contract_snapshot.settings === 'object' &&
      !Array.isArray(row.contract_snapshot.settings)
        ? row.contract_snapshot.settings
        : row.settings_snapshot,
    fullAddress: row.full_address,
    postalCode: row.postal_code,
    contractId: row.contract_id,
    contractState: row.contract_state,
    versionId: row.version_id,
    contractSnapshot: row.contract_snapshot,
    invoiceId: row.invoice_id,
    invoiceState: row.invoice_state,
    totalIrR: row.total_amount,
    paidIrR: row.paid_amount,
    refundedIrR: row.refunded_amount,
  };
}

const customerMessages = {
  approve: {
    fa: 'سفارش برق شما تأیید شد. قرارداد و فاکتور را بررسی کنید.',
    en: 'Your electricity order was approved. Review the contract and invoice.',
  },
  'request-changes': {
    fa: 'برای سفارش برق شما اصلاحاتی درخواست شده است.',
    en: 'Changes were requested for your electricity order.',
  },
  reject: {
    fa: 'سفارش برق شما رد شد. وضعیت بازپرداخت احتمالی را در فاکتور پیگیری کنید.',
    en: 'Your electricity order was rejected. Check the invoice for any refund progress.',
  },
};

@Injectable()
export class ElectricityStaffReviewService {
  constructor(
    private readonly invoices: InvoiceStateMachineService,
    private readonly giftCodes: GiftCodeService
  ) {}

  async queue(after?: string) {
    const cursor = after
      ? (
          await getDbPool().query<{ submitted_at: string; id: string }>(
            'SELECT submitted_at::text AS submitted_at,id FROM electricity_orders WHERE id=$1 AND submitted_at IS NOT NULL',
            [after]
          )
        ).rows[0]
      : undefined;
    if (after && !cursor) throw new NotFoundException('Order cursor not found');
    const rows = (
      await getDbPool().query<ReviewRow>(
        `${reviewQuery} WHERE e.status='awaiting_staff_review'
         AND ($1::timestamptz IS NULL OR (e.submitted_at,o.id)>($1::timestamptz,$2::uuid))
         ORDER BY e.submitted_at ASC,o.id ASC LIMIT 51`,
        [cursor?.submitted_at ?? null, cursor?.id ?? null]
      )
    ).rows;
    const now = Date.now();
    return {
      orders: rows.slice(0, 50).map((row) => ({
        ...present(row),
        ageHours: Math.max(0, Math.floor((now - row.submitted_at.getTime()) / 3_600_000)),
        priority:
          now - row.submitted_at.getTime() >= 72 * 3_600_000
            ? 'urgent'
            : now - row.submitted_at.getTime() >= 24 * 3_600_000
              ? 'high'
              : 'normal',
      })),
      nextAfter: rows.length > 50 ? rows[49]!.id : null,
    };
  }

  /** Keep replied-to orders reachable after they leave the review queue. */
  async conversations(after?: string) {
    const cursor = after
      ? (
          await getDbPool().query<{ created_at: string; id: string }>(
            `SELECT created_at::text AS created_at,id FROM electricity_order_comments WHERE id=$1`,
            [after]
          )
        ).rows[0]
      : undefined;
    if (after && !cursor) throw new NotFoundException('Comment cursor not found');
    const recent = (
      await getDbPool().query<{ order_id: string; id: string; created_at: Date }>(
        `SELECT order_id,id,created_at FROM (
           SELECT DISTINCT ON (order_id) order_id,id,created_at
           FROM electricity_order_comments ORDER BY order_id,created_at DESC,id DESC
         ) latest
         WHERE ($1::timestamptz IS NULL OR (created_at,id)<($1::timestamptz,$2::uuid))
         ORDER BY created_at DESC,id DESC LIMIT 51`,
        [cursor?.created_at ?? null, cursor?.id ?? null]
      )
    ).rows;
    const page = recent.slice(0, 50);
    if (!page.length) return { orders: [], nextAfter: null };
    const rows = (
      await getDbPool().query<ReviewRow>(`${reviewQuery} WHERE o.id=ANY($1::uuid[])`, [
        page.map((row) => row.order_id),
      ])
    ).rows;
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      orders: page.flatMap((comment) => {
        const row = byId.get(comment.order_id);
        return row ? [{ ...present(row), latestCommentAt: comment.created_at.toISOString() }] : [];
      }),
      nextAfter: recent.length > 50 ? page[49]!.id : null,
    };
  }

  async detail(id: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const row = (await client.query<ReviewRow>(`${reviewQuery} WHERE o.id=$1`, [id])).rows[0];
      if (!row) throw new NotFoundException('Electricity order not found');
      const previous =
        row.version_number > 1
          ? (
              await client.query<{
                id: string;
                content: Record<string, unknown>;
                invoice_id: string | null;
              }>(
                `SELECT v.id,v.content,ar.initial_invoice_id AS invoice_id
             FROM contract_versions v
             LEFT JOIN contract_activation_requirements ar ON ar.version_id=v.id
             WHERE v.contract_id=$1 AND v.version_number=$2`,
                [row.contract_id, row.version_number - 1]
              )
            ).rows[0]
          : undefined;
      const reason = previous
        ? ((
            await client.query<{ reason: string | null }>(
              `SELECT metadata::jsonb->>'reason' AS reason FROM audit_log
             WHERE event='electricity.order_review.request-changes'
               AND metadata::jsonb->>'orderId'=$1
               AND metadata::jsonb->>'versionId'=$2
             ORDER BY created_at DESC,id DESC LIMIT 1`,
              [id, previous.id]
            )
          ).rows[0]?.reason ?? null)
        : null;
      const activity = (
        await client.query<{
          id: string;
          event: string;
          user_id: string | null;
          created_at: Date;
          metadata: Record<string, unknown>;
        }>(
          `SELECT id,event,user_id,created_at,metadata::jsonb AS metadata FROM audit_log
             WHERE (metadata::jsonb->>'orderId'=$1
                    AND (event LIKE 'electricity.%' OR event='order_created'))
                OR (metadata::jsonb->>'contractId'=$2 AND event='contract.cancelled')
             ORDER BY created_at DESC,id DESC LIMIT 100`,
          [id, row.contract_id]
        )
      ).rows;
      const lifecycle = (
        await client.query<{ version_id: string; event: string; at: Date }>(
          `SELECT version_id,'contract.activated' AS event,activated_at AS at
             FROM contract_activations WHERE contract_id=$1
             UNION ALL
             SELECT version_id,'contract.completed' AS event,completed_at AS at
             FROM contract_completions WHERE contract_id=$1`,
          [row.contract_id]
        )
      ).rows;
      await client.query('COMMIT');
      const content = row.contract_snapshot;
      const beforePricing = previous?.content.pricing;
      const afterPricing = content.pricing;
      const summary = (value: unknown) => {
        const facts =
          value && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {};
        const get = (key: string) =>
          typeof facts[key] === 'string' ? (facts[key] as string) : null;
        const lines = Array.isArray(facts.lines)
          ? facts.lines.flatMap((value: unknown) => {
              if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
              const line = value as Record<string, unknown>;
              return typeof line.systemKey === 'string' && typeof line.quantityKwh === 'string'
                ? [{ systemKey: line.systemKey, quantityKwh: line.quantityKwh }]
                : [];
            })
          : [];
        return {
          periodStart: get('periodStart'),
          periodEnd: get('periodEnd'),
          totalKwh: get('totalKwh'),
          totalIrR: get('totalIrR'),
          lines,
        };
      };
      const delivery = (value: unknown) => {
        const facts =
          value && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {};
        return typeof facts.fullAddress === 'string' ? facts.fullAddress : null;
      };
      return {
        ...present(row),
        timeline: [
          ...activity.map((item) => ({
            id: item.id,
            event: item.event,
            at: item.created_at.toISOString(),
            actor: item.user_id,
            reason: typeof item.metadata.reason === 'string' ? item.metadata.reason : null,
            comment:
              typeof item.metadata.responseNote === 'string' ? item.metadata.responseNote : null,
          })),
          ...lifecycle.map((item) => ({
            id: `${item.version_id}:${item.event}`,
            event: item.event,
            at: item.at.toISOString(),
            actor: null,
            reason: null,
            comment: null,
          })),
        ].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)),
        revisionReview: previous
          ? {
              versionNumber: row.version_number,
              staffReason: reason,
              customerResponse:
                typeof content.customerResponse === 'string' ? content.customerResponse : null,
              before: {
                ...summary(beforePricing),
                fullAddress:
                  delivery(content.previousDelivery) ?? delivery(previous.content.delivery),
                invoiceId: previous.invoice_id,
              },
              after: {
                ...summary(afterPricing),
                fullAddress: row.full_address,
                invoiceId: row.invoice_id,
              },
            }
          : null,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async decide(
    id: string,
    action: StaffReviewAction,
    input: StaffReviewInput,
    actor: Actor,
    ip: string
  ) {
    const profile = (
      await getDbPool().query<{ profile_id: string }>(
        'SELECT profile_id FROM electricity_orders WHERE id=$1',
        [id]
      )
    ).rows[0];
    if (!profile) throw new NotFoundException('Electricity order not found');
    return staffContractMutation(profile.profile_id, actor, (client, archived) =>
      contractIdempotency(
        client,
        'electricity_staff_review',
        { ...input, orderId: id, action },
        actor,
        async () => {
          if (archived) throw new ConflictException('Profile is archived');
          const row = await this.lockReviewRow(client, id);
          if (
            row.version_id !== input.expectedVersionId ||
            row.contract_state !== 'AwaitingStaffReview' ||
            row.activation_invoice_id !== row.invoice_id ||
            !canTransitionElectricityOrder(
              row.commercial_status,
              action === 'approve'
                ? 'approved'
                : action === 'request-changes'
                  ? 'changes_requested'
                  : 'rejected'
            ) ||
            row.commercial_status !== 'awaiting_staff_review'
          )
            throw new ConflictException('Order review changed; reload before deciding');
          if (action !== 'approve' && row.invoice_state === 'PaymentUnderReview')
            throw new ConflictException('Resolve pending payment review before changing order');
          if (action === 'request-changes' && BigInt(row.paid_amount) > 0n)
            throw new ConflictException(
              'Paid orders require a financial correction before changes'
            );
          const reason = input.reason?.trim() ?? '';
          if (action !== 'approve' && !reason) throw new ConflictException('A reason is required');
          const status =
            action === 'approve'
              ? 'approved'
              : action === 'request-changes'
                ? 'changes_requested'
                : 'rejected';
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
          } else if (action === 'request-changes') {
            await client.query("UPDATE contracts SET state='ChangesRequested' WHERE id=$1", [
              row.contract_id,
            ]);
          } else {
            const paid = BigInt(row.paid_amount),
              refunded = BigInt(row.refunded_amount);
            if (paid > refunded) {
              refundId = await createElectricityRefundObligation(client, {
                orderId: id,
                contractId: row.contract_id,
                invoiceId: row.invoice_id,
                profileId: row.profile_id,
                paidAmount: row.paid_amount,
                refundedAmount: row.refunded_amount,
                authorizedBy: actor.userId,
                reason,
              });
            } else if (BigInt(row.pending_refund_amount) > 0n) {
              throw new ConflictException('Resolve existing refund before rejection');
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
              "UPDATE electricity_contracts SET status='cancelled',updated_at=NOW() WHERE order_id=$1",
              [id]
            );
            await client.query(
              "UPDATE orders SET status='CANCELLED',updated_at=NOW() WHERE id=$1",
              [id]
            );
            if (paid === 0n && row.gift_code_id)
              await this.giftCodes.releaseByOrder(id, client, { actorUserId: actor.userId, ip });
          }
          await client.query(
            'UPDATE electricity_orders SET status=$2,updated_at=NOW() WHERE id=$1',
            [id, status]
          );
          await auditContract(
            client,
            row.contract_id,
            row.version_id,
            `electricity.order_review.${action}`,
            actor,
            ip,
            {
              orderId: id,
              from: 'awaiting_staff_review',
              to: status,
              reason,
              invoiceId: row.invoice_id,
              refundId,
            }
          );
          await this.notifyCustomer(client, row, action, reason);
          return {
            orderId: id,
            status,
            contractId: row.contract_id,
            invoiceId: row.invoice_id,
            refundId,
          };
        }
      )
    );
  }

  private async lockReviewRow(client: PoolClient, id: string) {
    const row = (
      await client.query<ReviewRow>(`${reviewQuery} WHERE o.id=$1 FOR UPDATE OF o,e,c,i`, [id])
    ).rows[0];
    if (!row) throw new NotFoundException('Electricity order not found');
    return row;
  }

  private async notifyCustomer(
    client: PoolClient,
    row: ReviewRow,
    action: StaffReviewAction,
    reason: string
  ) {
    const message = customerMessages[action];
    await new NotificationsService().create(
      {
        userId: row.customer_id,
        profileId: row.profile_id,
        type: 'general',
        title: message.en,
        link: `/electricity/orders/${row.id}`,
        localizedContent: {
          fa: { title: 'سفارش برق', body: message.fa + (reason ? ` دلیل: ${reason}` : '') },
          en: {
            title: 'Electricity order',
            body: message.en + (reason ? ` Reason: ${reason}` : ''),
          },
        },
      },
      client
    );
  }
}
