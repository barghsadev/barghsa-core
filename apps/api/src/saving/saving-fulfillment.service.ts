import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
import { CreateAdjustmentInvoiceService } from '../invoice/create-adjustment-invoice.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { ValidatedSession } from '../session/session.service.js';
import { savingOrderRevisions } from './saving-order-revisions.js';
import { savingAddressAmendments } from './saving-address-amendments.js';
import { savingHardwareAmendments } from './saving-hardware-amendments.js';
import { savingHardwareUpgrades } from './saving-hardware-upgrades.js';
import { calculateSavingTotals } from './saving-calculation.js';

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
  saving_plan_id: string;
  hardware_product_id: string;
  hardware_title: { fa: string; en: string };
  customer_id: string;
  customer_name: string;
  status: string;
  financial_status: string;
  submitted_at: Date;
  bill_identifier: string;
  address_snapshot: Record<string, unknown>;
  installation_address_id: string;
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
  cancellation_pending: boolean;
}
interface StageRow {
  stage: SavingStage;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
}
const reviewQuery = `SELECT s.id,s.order_id,s.profile_id,s.saving_plan_id,s.hardware_product_id,
  h.title AS hardware_title,p.user_id AS customer_id,
  u.username AS customer_name,s.status,s.financial_status,s.submitted_at,
  s.bill_identifier,s.address_snapshot,s.installation_address_id,s.pricing_snapshot,s.verification_result,
  s.agreement_snapshot,o.gift_code_id,c.id AS contract_id,c.state AS contract_state,
  c.current_version_id AS version_id,i.id AS invoice_id,i.state AS invoice_state,
  i.total_amount::text AS total_amount,i.paid_amount::text AS paid_amount,
  i.refunded_amount::text AS refunded_amount,ar.initial_invoice_id AS activation_invoice_id,
  EXISTS(SELECT 1 FROM contract_cancellation_requests cr
    WHERE cr.contract_id=c.id AND cr.status='Pending') AS cancellation_pending,
  COALESCE((SELECT SUM(r.amount)::text FROM refunds r WHERE r.invoice_id=i.id
    AND r.state NOT IN ('Completed','Rejected','Cancelled')), '0') AS pending_refund_amount
  FROM saving_orders s JOIN orders o ON o.id=s.order_id
  JOIN products h ON h.id=s.hardware_product_id
  JOIN profiles p ON p.id=s.profile_id JOIN users u ON u.user_id=p.user_id
  JOIN contracts c ON c.order_id=o.id AND c.service_type='savings'
  JOIN contract_activation_requirements ar ON ar.version_id=c.current_version_id
  JOIN invoices i ON i.order_id=o.id AND i.type='auto'
    AND i.adjustment_for_invoice_id IS NULL AND i.replaces_invoice_id IS NULL`;

@Injectable()
export class SavingFulfillmentService {
  constructor(
    private readonly invoices: InvoiceStateMachineService,
    private readonly giftCodes: GiftCodeService,
    private readonly invoiceAdjustments: CreateAdjustmentInvoiceService
  ) {}

  async queue(lane: 'all' | 'review' | 'fulfillment' = 'all', after?: string) {
    const cursor = after
      ? (
          await getDbPool().query<{ id: string; submitted_at: Date; status: string }>(
            `SELECT id,submitted_at,status FROM saving_orders
             WHERE id=$1 AND status IN ('awaiting_staff_review','approved','in_progress')`,
            [after]
          )
        ).rows[0]
      : null;
    if (
      after &&
      (!cursor ||
        (lane === 'review' && cursor.status !== 'awaiting_staff_review') ||
        (lane === 'fulfillment' && cursor.status === 'awaiting_staff_review'))
    )
      throw new NotFoundException('Saving order queue cursor not found');
    const rows = (
      await getDbPool().query<ReviewRow>(
        `${reviewQuery} WHERE s.status IN ('awaiting_staff_review','approved','in_progress')
       AND ($1::text='all' OR ($1='review' AND s.status='awaiting_staff_review')
         OR ($1='fulfillment' AND s.status IN ('approved','in_progress')))
       AND ($2::uuid IS NULL OR
         (CASE WHEN s.status='awaiting_staff_review' THEN 0 ELSE 1 END,s.submitted_at,s.id) >
         ($3::integer,$4::timestamptz,$2::uuid))
       ORDER BY CASE WHEN s.status='awaiting_staff_review' THEN 0 ELSE 1 END,
         s.submitted_at ASC,s.id ASC LIMIT 101`,
        [
          lane,
          after ?? null,
          cursor ? (cursor.status === 'awaiting_staff_review' ? 0 : 1) : null,
          cursor?.submitted_at ?? null,
        ]
      )
    ).rows;
    return {
      orders: rows.slice(0, 100).map((row) => this.present(row)),
      nextAfter: rows.length > 100 ? rows[99]!.id : null,
    };
  }

  async detail(id: string, allowHardwarePriceAdjustment = false) {
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
      const revisions = await savingOrderRevisions(client, id);
      const addressAmendments = await savingAddressAmendments(client, id);
      const hardwareAmendments = await savingHardwareAmendments(client, id);
      const hardwareUpgrades = await savingHardwareUpgrades(client, id);
      const pendingHardwareUpgrade = hardwareUpgrades.find(
        (upgrade) => upgrade.status === 'awaiting_payment'
      );
      const addressOptions = (
        await client.query(
          `SELECT id,full_address AS "fullAddress",postal_code AS "postalCode"
             FROM addresses WHERE profile_id=$1 AND deleted_at IS NULL
            ORDER BY main_address DESC,created_at DESC,id`,
          [row.profile_id]
        )
      ).rows;
      const canAmendAddress =
        ['approved', 'in_progress'].includes(row.status) &&
        row.financial_status === 'paid' &&
        row.invoice_state === 'Paid' &&
        BigInt(row.paid_amount) === BigInt(row.total_amount) &&
        BigInt(row.pending_refund_amount) === 0n &&
        ['AwaitingCustomerAcceptance', 'Active'].includes(row.contract_state) &&
        !row.cancellation_pending &&
        addressOptions.some(
          (address: { id: string }) => address.id !== row.installation_address_id
        ) &&
        !stages.some(
          (stage: StageRow) =>
            [
              'installation_and_document_upload',
              'equipment_handover',
              'process_completion',
            ].includes(stage.stage) && stage.status !== 'pending'
        );
      const hardwareOptions = pendingHardwareUpgrade
        ? []
        : await this.hardwareOptions(client, row, allowHardwarePriceAdjustment);
      const canAmendHardware =
        ['approved', 'in_progress'].includes(row.status) &&
        row.financial_status === 'paid' &&
        row.invoice_state === 'Paid' &&
        BigInt(row.paid_amount) === BigInt(row.total_amount) &&
        BigInt(row.pending_refund_amount) === 0n &&
        ['AwaitingCustomerAcceptance', 'Active'].includes(row.contract_state) &&
        !row.cancellation_pending &&
        !pendingHardwareUpgrade &&
        stages.some(
          (stage: StageRow) => stage.stage === 'product_delivery' && stage.status === 'in_progress'
        ) &&
        !stages.some(
          (stage: StageRow) =>
            [
              'installation_and_document_upload',
              'equipment_handover',
              'process_completion',
            ].includes(stage.stage) && stage.status !== 'pending'
        ) &&
        hardwareOptions.length > 0;
      return {
        ...this.present(row),
        stages,
        events,
        revisions,
        addressAmendments,
        hardwareAmendments,
        hardwareUpgrades,
        addressOptions,
        hardwareOptions,
        canAmendAddress,
        canAmendHardware,
      };
    } finally {
      client.release();
    }
  }

  private present(row: ReviewRow) {
    return {
      id: row.id,
      orderId: row.order_id,
      profileId: row.profile_id,
      savingPlanId: row.saving_plan_id,
      hardwareProductId: row.hardware_product_id,
      hardwareTitle: row.hardware_title,
      customerId: row.customer_id,
      customerName: row.customer_name,
      status: row.status,
      financialStatus: row.financial_status,
      submittedAt: row.submitted_at.toISOString(),
      billIdentifier: row.bill_identifier,
      addressSnapshot: row.address_snapshot,
      installationAddressId: row.installation_address_id,
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

  private async hardwarePricing(client: PoolClient, row: ReviewRow) {
    const snapshot = row.pricing_snapshot as {
      plan?: { title?: { fa: string; en: string } };
      lines?: Array<{ type?: string; amountIrR?: string; vatRateBps?: number }>;
      discountIrR?: string;
      totalIrR?: string;
    };
    const plan = snapshot?.lines?.find((entry) => entry.type === 'plan_price');
    const paidHardware = snapshot?.lines?.find((entry) => entry.type === 'hardware_price');
    if (
      !plan ||
      !paidHardware ||
      !snapshot.plan?.title ||
      !/^\d+$/.test(plan.amountIrR ?? '') ||
      !/^\d+$/.test(paidHardware.amountIrR ?? '') ||
      !/^\d+$/.test(snapshot.discountIrR ?? '') ||
      !/^\d+$/.test(snapshot.totalIrR ?? '') ||
      !Number.isInteger(plan.vatRateBps) ||
      !Number.isInteger(paidHardware.vatRateBps)
    )
      return null;
    const latest = (
      await client.query<{
        hardware_id: string;
        hardware_snapshot: { priceIrR?: string; vatRateBps?: number; totalIrR?: string };
      }>(
        `SELECT hardware_id,hardware_snapshot FROM saving_hardware_amendments
          WHERE order_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`,
        [row.id]
      )
    ).rows[0];
    if (latest && latest.hardware_id !== row.hardware_product_id) return null;
    const current = latest?.hardware_snapshot;
    if (current && (!/^\d+$/.test(current.priceIrR ?? '') || !Number.isInteger(current.vatRateBps)))
      return null;
    return {
      plan: {
        type: 'plan_price' as const,
        productId: row.saving_plan_id,
        title: snapshot.plan.title,
        amountIrR: BigInt(plan.amountIrR!),
        vatRateBps: plan.vatRateBps!,
      },
      current: {
        priceIrR: current?.priceIrR ?? paidHardware.amountIrR!,
        vatRateBps: current?.vatRateBps ?? paidHardware.vatRateBps!,
      },
      discountIrR: BigInt(snapshot.discountIrR!),
      currentTotalIrR: BigInt(current?.totalIrR ?? snapshot.totalIrR!),
    };
  }

  private async hardwareOptions(client: PoolClient, row: ReviewRow, allowPriceAdjustment = false) {
    const basis = await this.hardwarePricing(client, row);
    if (!basis) return [];
    const options = (
      await client.query<{
        id: string;
        title: { fa: string; en: string };
        price: string | null;
        vat_rate_bps: number;
        stock_tracking: boolean;
        stock_count: number;
        reserved_count: number;
      }>(
        `SELECT h.id,h.title,h.stock_tracking,h.stock_count,h.reserved_count,
          effective_product_price(h.id)::text AS price,
          COALESCE(
            (SELECT vc.rate FROM product_vat_overrides pvo
              JOIN vat_configurations vc ON vc.id=pvo.vat_config_id
              WHERE pvo.product_id=h.id AND pvo.effective_from<=NOW()
                AND (pvo.effective_until IS NULL OR pvo.effective_until>NOW())
              ORDER BY pvo.effective_from DESC LIMIT 1),
            (SELECT rate FROM vat_configurations WHERE category='hardware'
              AND effective_from<=NOW() AND (effective_until IS NULL OR effective_until>NOW())
              ORDER BY effective_from DESC LIMIT 1),0)::int AS vat_rate_bps
         FROM saving_plan_hardware sph JOIN products h ON h.id=sph.hardware_id
         WHERE sph.plan_id=$1 AND h.status='active' AND h.id<>$2`,
        [row.saving_plan_id, row.hardware_product_id]
      )
    ).rows;
    return options.flatMap((option) => {
      if (
        !option.price ||
        !/^\d+$/.test(option.price) ||
        (option.stock_tracking && option.stock_count <= option.reserved_count)
      )
        return [];
      try {
        const totals = calculateSavingTotals(
          [
            basis.plan,
            {
              type: 'hardware_price',
              productId: option.id,
              title: option.title,
              amountIrR: BigInt(option.price),
              vatRateBps: option.vat_rate_bps,
            },
          ],
          basis.discountIrR
        );
        const delta = totals.totalIrR - basis.currentTotalIrR;
        if (delta !== 0n && !allowPriceAdjustment) return [];
        return [
          {
            id: option.id,
            title: option.title,
            priceIrR: option.price,
            vatRateBps: option.vat_rate_bps,
            totalIrR: totals.totalIrR.toString(),
            priceDeltaIrR: delta.toString(),
          },
        ];
      } catch {
        return [];
      }
    });
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

  async amendAddress(
    id: string,
    input: {
      idempotencyKey: string;
      expectedVersionId: string;
      expectedAddressId: string;
      addressId: string;
      reason: string;
    },
    actor: Actor,
    ip: string
  ) {
    const target = (
      await getDbPool().query<{ profile_id: string }>(
        'SELECT profile_id FROM saving_orders WHERE id=$1',
        [id]
      )
    ).rows[0];
    if (!target) throw new NotFoundException('Saving order not found');
    return staffContractMutation(target.profile_id, actor, (client, archived) =>
      contractIdempotency(
        client,
        'saving_address_amendment',
        { ...input, orderId: id },
        actor,
        async () => {
          if (archived) throw new ConflictException('Profile is archived');
          const row = await this.lockRow(client, id);
          if (
            !['approved', 'in_progress'].includes(row.status) ||
            row.financial_status !== 'paid' ||
            row.invoice_state !== 'Paid' ||
            BigInt(row.paid_amount) !== BigInt(row.total_amount) ||
            BigInt(row.pending_refund_amount) !== 0n ||
            !['AwaitingCustomerAcceptance', 'Active'].includes(row.contract_state) ||
            row.version_id !== input.expectedVersionId ||
            row.installation_address_id !== input.expectedAddressId
          )
            throw new ConflictException('Saving order is not eligible for address amendment');
          if (row.installation_address_id === input.addressId)
            throw new ConflictException('Choose a different installation address');
          const blocked = (
            await client.query<{ blocked: boolean }>(
              `SELECT EXISTS(
                SELECT 1 FROM contract_cancellation_requests r
                 WHERE r.contract_id=$1 AND r.status='Pending'
                UNION ALL
                SELECT 1 FROM saving_fulfillment_stages f
                 WHERE f.order_id=$2 AND f.stage IN
                   ('installation_and_document_upload','equipment_handover','process_completion')
                   AND f.status<>'pending'
              ) AS blocked`,
              [row.contract_id, id]
            )
          ).rows[0]?.blocked;
          if (blocked) throw new ConflictException('Installation or cancellation is in progress');
          const address = (
            await client.query<{
              id: string;
              province_id: string;
              city_id: string;
              full_address: string;
              postal_code: string;
            }>(
              `SELECT id,province_id,city_id,full_address,postal_code FROM addresses
                WHERE id=$1 AND profile_id=$2 AND deleted_at IS NULL FOR SHARE`,
              [input.addressId, row.profile_id]
            )
          ).rows[0];
          if (!address) throw new NotFoundException('Installation address not found');
          const amendmentId = uuidv7();
          await client.query(
            `INSERT INTO saving_address_amendments(
               id,order_id,contract_id,contract_version_id,actor_user_id,
               previous_address_id,address_id,previous_snapshot,address_snapshot,reason)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)`,
            [
              amendmentId,
              id,
              row.contract_id,
              row.version_id,
              actor.userId,
              row.installation_address_id,
              address.id,
              JSON.stringify(row.address_snapshot),
              JSON.stringify(address),
              input.reason,
            ]
          );
          await client.query(
            `UPDATE orders SET snapshot_province_id=$2,snapshot_city_id=$3,
               snapshot_full_address=$4,snapshot_postal_code=$5,updated_at=NOW() WHERE id=$1`,
            [
              row.order_id,
              address.province_id,
              address.city_id,
              address.full_address,
              address.postal_code,
            ]
          );
          await client.query(
            `UPDATE saving_orders SET installation_address_id=$2,address_snapshot=$3::jsonb,
               updated_at=NOW() WHERE id=$1`,
            [id, address.id, JSON.stringify(address)]
          );
          await auditContract(
            client,
            row.contract_id,
            row.version_id,
            'saving.address_amended',
            actor,
            ip,
            {
              savingOrderId: id,
              amendmentId,
              reason: input.reason,
              previousAddress: row.address_snapshot,
              address,
            }
          );
          await this.notify(
            client,
            row,
            'نشانی نصب سفارش صرفه‌جویی شما توسط کارشناس اصلاح شد. جزئیات را بررسی کنید.',
            'Staff updated your power-saving installation address. Review the details.'
          );
          return { amendmentId, savingOrderId: id, address };
        }
      )
    );
  }

  async amendHardware(
    id: string,
    input: {
      idempotencyKey: string;
      expectedVersionId: string;
      expectedHardwareId: string;
      hardwareProductId: string;
      reason: string;
    },
    actor: Actor,
    ip: string,
    allowPriceAdjustment = false
  ) {
    const target = (
      await getDbPool().query<{ profile_id: string }>(
        'SELECT profile_id FROM saving_orders WHERE id=$1',
        [id]
      )
    ).rows[0];
    if (!target) throw new NotFoundException('Saving order not found');
    try {
      return await staffContractMutation(
        target.profile_id,
        actor,
        (client, archived) =>
          contractIdempotency(
            client,
            'saving_hardware_amendment',
            { ...input, orderId: id },
            actor,
            async () => {
              if (archived) throw new ConflictException('Profile is archived');
              const row = await this.lockRow(client, id);
              if (
                !['approved', 'in_progress'].includes(row.status) ||
                row.financial_status !== 'paid' ||
                row.invoice_state !== 'Paid' ||
                BigInt(row.paid_amount) !== BigInt(row.total_amount) ||
                BigInt(row.pending_refund_amount) !== 0n ||
                !['AwaitingCustomerAcceptance', 'Active'].includes(row.contract_state) ||
                row.version_id !== input.expectedVersionId ||
                row.hardware_product_id !== input.expectedHardwareId
              )
                throw new ConflictException('Saving order is not eligible for hardware amendment');
              if (row.hardware_product_id === input.hardwareProductId)
                throw new ConflictException('Choose a different device');
              const blocked = (
                await client.query<{ blocked: boolean }>(
                  `SELECT EXISTS(
                  SELECT 1 FROM contract_cancellation_requests r
                   WHERE r.contract_id=$1 AND r.status='Pending'
                  UNION ALL
                  SELECT 1 FROM saving_fulfillment_stages f
                   WHERE f.order_id=$2 AND f.stage IN
                     ('installation_and_document_upload','equipment_handover','process_completion')
                     AND f.status<>'pending'
                  UNION ALL
                  SELECT 1 FROM saving_hardware_upgrade_requests u
                   WHERE u.order_id=$2 AND u.status='awaiting_payment'
                ) OR NOT EXISTS(
                  SELECT 1 FROM saving_fulfillment_stages f WHERE f.order_id=$2
                    AND f.stage='product_delivery' AND f.status='in_progress'
                ) AS blocked`,
                  [row.contract_id, id]
                )
              ).rows[0]?.blocked;
              if (blocked)
                throw new ConflictException(
                  'Delivery, cancellation or a pending hardware charge prevents a swap'
                );
              await client.query(
                'SELECT id FROM products WHERE id IN ($1,$2) ORDER BY id FOR UPDATE',
                [row.hardware_product_id, input.hardwareProductId]
              );
              const basis = await this.hardwarePricing(client, row);
              const hardware = (await this.hardwareOptions(client, row, true)).find(
                (option) => option.id === input.hardwareProductId
              );
              if (!basis || !hardware)
                throw new ConflictException(
                  'Choose available active hardware assigned to this saving plan'
                );
              const priceDeltaIrR = BigInt(hardware.priceDeltaIrR);
              if (priceDeltaIrR !== 0n && !allowPriceAdjustment)
                throw new ForbiddenException(
                  'Invoice write permission is required for price changes'
                );
              const previousSnapshot = {
                title: row.hardware_title,
                priceIrR: basis.current.priceIrR,
                vatRateBps: basis.current.vatRateBps,
                totalIrR: basis.currentTotalIrR.toString(),
              };
              const hardwareSnapshot = {
                title: hardware.title,
                priceIrR: hardware.priceIrR,
                vatRateBps: hardware.vatRateBps,
                totalIrR: hardware.totalIrR,
              };
              if (priceDeltaIrR > 0n) {
                const targetProduct = (
                  await client.query<{ stock_tracking: boolean }>(
                    'SELECT stock_tracking FROM products WHERE id=$1',
                    [hardware.id]
                  )
                ).rows[0]!;
                const adjustment = await this.invoiceAdjustments.createAdjustmentInvoice(
                  {
                    originalInvoiceId: row.invoice_id,
                    amount: priceDeltaIrR,
                    reason: input.reason,
                    actorUserId: actor.userId,
                    actorSession: actor,
                    idempotencyKey: input.idempotencyKey,
                    ip,
                  },
                  client
                );
                if (targetProduct.stock_tracking) {
                  const reserved = await client.query(
                    `UPDATE products SET reserved_count=reserved_count+1
                     WHERE id=$1 AND stock_count>reserved_count RETURNING id`,
                    [hardware.id]
                  );
                  if (reserved.rowCount !== 1)
                    throw new ConflictException('Selected saving hardware is out of stock');
                }
                const upgradeId = uuidv7();
                await client.query(
                  `INSERT INTO saving_hardware_upgrade_requests(
                    id,order_id,contract_id,contract_version_id,actor_user_id,
                    previous_hardware_id,hardware_id,previous_snapshot,hardware_snapshot,
                    original_invoice_id,adjustment_invoice_id,price_delta_irr,stock_reserved,reason)
                   VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14)`,
                  [
                    upgradeId,
                    id,
                    row.contract_id,
                    row.version_id,
                    actor.userId,
                    row.hardware_product_id,
                    hardware.id,
                    JSON.stringify(previousSnapshot),
                    JSON.stringify(hardwareSnapshot),
                    row.invoice_id,
                    adjustment.adjustmentInvoiceId,
                    hardware.priceDeltaIrR,
                    targetProduct.stock_tracking,
                    input.reason,
                  ]
                );
                await auditContract(
                  client,
                  row.contract_id,
                  row.version_id,
                  'saving.hardware_upgrade_requested',
                  actor,
                  ip,
                  {
                    savingOrderId: id,
                    upgradeId,
                    hardwareProductId: hardware.id,
                    chargeInvoiceId: adjustment.adjustmentInvoiceId,
                    priceDeltaIrR: hardware.priceDeltaIrR,
                  }
                );
                await this.notify(
                  client,
                  row,
                  'تعویض تجهیز سفارش شما در انتظار پرداخت مابه‌التفاوت است. فاکتور جدید را بررسی کنید.',
                  'Your equipment change is waiting for the additional payment. Review the new invoice.'
                );
                return {
                  upgradeId,
                  savingOrderId: id,
                  hardwareProductId: hardware.id,
                  priceDeltaIrR: hardware.priceDeltaIrR,
                  adjustmentInvoiceId: adjustment.adjustmentInvoiceId,
                  status: 'awaiting_payment',
                };
              }
              const amendmentId = uuidv7();
              const adjustment =
                priceDeltaIrR < 0n
                  ? await this.invoiceAdjustments.createAdjustmentInvoice(
                      {
                        originalInvoiceId: row.invoice_id,
                        amount: priceDeltaIrR,
                        reason: input.reason,
                        actorUserId: actor.userId,
                        actorSession: actor,
                        idempotencyKey: input.idempotencyKey,
                        ip,
                      },
                      client
                    )
                  : null;
              await client.query(
                `INSERT INTO saving_hardware_amendments(
                 id,order_id,contract_id,contract_version_id,actor_user_id,
                 previous_hardware_id,hardware_id,previous_snapshot,hardware_snapshot,
                 original_invoice_id,adjustment_invoice_id,price_delta_irr,reason)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13)`,
                [
                  amendmentId,
                  id,
                  row.contract_id,
                  row.version_id,
                  actor.userId,
                  row.hardware_product_id,
                  hardware.id,
                  JSON.stringify(previousSnapshot),
                  JSON.stringify(hardwareSnapshot),
                  row.invoice_id,
                  adjustment?.adjustmentInvoiceId ?? null,
                  hardware.priceDeltaIrR,
                  input.reason,
                ]
              );
              await client.query(
                'UPDATE saving_orders SET hardware_product_id=$2,updated_at=NOW() WHERE id=$1',
                [id, hardware.id]
              );
              await auditContract(
                client,
                row.contract_id,
                row.version_id,
                'saving.hardware_amended',
                actor,
                ip,
                {
                  savingOrderId: id,
                  amendmentId,
                  reason: input.reason,
                  previousHardwareId: row.hardware_product_id,
                  hardwareProductId: hardware.id,
                  priceDeltaIrR: hardware.priceDeltaIrR,
                  adjustmentInvoiceId: adjustment?.adjustmentInvoiceId ?? null,
                }
              );
              await this.notify(
                client,
                row,
                priceDeltaIrR < 0n
                  ? 'تجهیز سفارش صرفه‌جویی شما تعویض شد و بستانکاری مرتبط صادر شد. اصلاحیه را بررسی کنید.'
                  : 'تجهیز سفارش صرفه‌جویی شما بدون تغییر مبلغ توسط کارشناس تعویض شد. اصلاحیه را بررسی کنید.',
                priceDeltaIrR < 0n
                  ? 'Staff changed your power-saving equipment and issued a linked credit note. Review the amendment.'
                  : 'Staff changed your power-saving equipment without changing the amount. Review the amendment.'
              );
              return {
                amendmentId,
                savingOrderId: id,
                hardwareProductId: hardware.id,
                priceDeltaIrR: hardware.priceDeltaIrR,
                adjustmentInvoiceId: adjustment?.adjustmentInvoiceId ?? null,
              };
            }
          ),
        { financialReview: true }
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

  async cancelHardwareUpgrade(
    id: string,
    input: { idempotencyKey: string; upgradeId: string; reason: string },
    actor: Actor,
    ip: string
  ) {
    const target = (
      await getDbPool().query<{ profile_id: string }>(
        'SELECT profile_id FROM saving_orders WHERE id=$1',
        [id]
      )
    ).rows[0];
    if (!target) throw new NotFoundException('Saving order not found');
    return staffContractMutation(
      target.profile_id,
      actor,
      (client, archived) =>
        contractIdempotency(
          client,
          'saving_hardware_upgrade_cancel',
          { ...input, orderId: id },
          actor,
          async () => {
            if (archived) throw new ConflictException('Profile is archived');
            const invoiceId = (
              await client.query<{ adjustment_invoice_id: string }>(
                'SELECT adjustment_invoice_id FROM saving_hardware_upgrade_requests WHERE id=$1 AND order_id=$2',
                [input.upgradeId, id]
              )
            ).rows[0]?.adjustment_invoice_id;
            if (!invoiceId) throw new ConflictException('Hardware upgrade was not found');
            // Payment owns the invoice lock before its settlement trigger locks the request.
            await client.query('SELECT id FROM invoices WHERE id=$1 FOR UPDATE', [invoiceId]);
            const upgrade = (
              await client.query<{
                id: string;
                contract_id: string;
                contract_version_id: string;
                adjustment_invoice_id: string;
                state: string;
                total_amount: string;
                paid_amount: string;
              }>(
                `SELECT u.id,u.contract_id,u.contract_version_id,u.adjustment_invoice_id,
                        i.state,i.total_amount::text,i.paid_amount::text
                   FROM saving_hardware_upgrade_requests u
                   JOIN invoices i ON i.id=u.adjustment_invoice_id
                  WHERE u.id=$1 AND u.order_id=$2 AND u.status='awaiting_payment'
                  FOR UPDATE OF u`,
                [input.upgradeId, id]
              )
            ).rows[0];
            if (
              !upgrade ||
              !['Unpaid', 'Overdue'].includes(upgrade.state) ||
              BigInt(upgrade.paid_amount) !== 0n
            )
              throw new ConflictException('Resolve the charge payment before cancelling');
            await this.invoices.transition(
              upgrade.adjustment_invoice_id,
              upgrade.state as 'Unpaid' | 'Overdue',
              'Cancelled',
              {
                actorUserId: actor.userId,
                reason: input.reason,
                ip,
                client,
                financials: {
                  paidAmount: 0n,
                  refundedAmount: 0n,
                  totalAmount: BigInt(upgrade.total_amount),
                },
              }
            );
            await auditContract(
              client,
              upgrade.contract_id,
              upgrade.contract_version_id,
              'saving.hardware_upgrade_cancelled',
              actor,
              ip,
              { savingOrderId: id, upgradeId: upgrade.id, reason: input.reason }
            );
            return { savingOrderId: id, upgradeId: upgrade.id, status: 'cancelled' };
          }
        ),
      { financialReview: true }
    );
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
            stage === 'product_delivery' &&
            (
              await client.query(
                `SELECT 1 FROM saving_hardware_upgrade_requests
                   WHERE order_id=$1 AND status='awaiting_payment'`,
                [id]
              )
            ).rowCount
          )
            throw new ConflictException('Resolve the pending hardware charge before delivery');
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
