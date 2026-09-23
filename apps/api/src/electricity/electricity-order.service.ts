import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { normalizeGiftCode } from '@barghsa/shared/promotions';
import { v7 as uuidv7 } from 'uuid';
import type { PoolClient } from 'pg';
import type { StorageProvider } from '@barghsa/shared/storage';
import type { ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession, requireSessionStepUp } from '../session/session-step-up.js';
import { idempotentMutation } from '../database/idempotency.js';
import { requireAddressGeography } from '../profiles/address-geography.js';
import { OrdersService } from '../orders/orders.service.js';
import { GiftCodeService } from '../admin/gift-code.service.js';
import { DueAtCalculationService } from '../invoice/due-at.service.js';
import { InvoiceStateMachineService } from '../invoice/invoice-state-machine.service.js';
import { ElectricityCalculationService } from './electricity-calculation.service.js';
import type { ElectricitySystemKey } from './electricity-calculation.js';
import {
  calculateElectricityTotals,
  type ElectricityGiftDiscount,
} from './electricity-calculation.js';
import { persistElectricitySubmissionSnapshot } from './electricity-submission-snapshot.js';
import { createElectricityRefundObligation } from './electricity-refund-obligation.js';
import { STORAGE_PROVIDER } from '../storage/index.js';
import { electricityContractTemplateSnapshot } from './electricity-contract-template.js';
import {
  electricityFinancialStatus,
  electricityNextAction,
  type ElectricityCommercialStatus,
} from './electricity-order-status.js';
import {
  getCurrentJalaliMonthRange,
  getNextJalaliMonthRange,
  getCurrentWeekRange,
  getNextWeekRange,
  getWeekAfterNextRange,
  validateAdvancedPeriod,
  type ElectricityPeriod,
} from './electricity-periods.js';

type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
export type SimplePeriod =
  'current_month' | 'next_month' | 'current_week' | 'next_week' | 'week_after_next';
export interface SimpleOrderInput {
  profileId: string;
  period: SimplePeriod;
  totalKwh: string;
  giftCode?: string | undefined;
}
export interface SimpleSubmissionInput extends SimpleOrderInput {
  idempotencyKey: string;
  expectedQuoteDigest: string;
  address: { provinceId: string; cityId: string; fullAddress: string; postalCode: string };
}
export interface AdvancedOrderInput {
  profileId: string;
  startAt: string;
  endAt: string;
  quantities: Partial<Record<ElectricitySystemKey, string | undefined>>;
  giftCode?: string | undefined;
}
export interface AdvancedSubmissionInput extends AdvancedOrderInput {
  idempotencyKey: string;
  expectedQuoteDigest: string;
  address: SimpleSubmissionInput['address'];
}
type OrderInput = SimpleOrderInput | AdvancedOrderInput;
type SubmissionInput = SimpleSubmissionInput | AdvancedSubmissionInput;
export interface ElectricityAddressCorrection {
  idempotencyKey: string;
  expectedVersionId: string;
  fullAddress: string;
  postalCode: string;
  responseNote: string;
}

export function selectedPeriod(selection: SimplePeriod, now: Date): ElectricityPeriod {
  switch (selection) {
    case 'current_month':
      return getCurrentJalaliMonthRange(now);
    case 'next_month':
      return getNextJalaliMonthRange(now);
    case 'current_week':
      return getCurrentWeekRange(now);
    case 'next_week':
      return getNextWeekRange(now);
    case 'week_after_next':
      return getWeekAfterNextRange(now);
  }
}

export function simplePeriodOptions(now: Date) {
  return (
    ['current_month', 'next_month', 'current_week', 'next_week', 'week_after_next'] as const
  ).map((key) => {
    const period = selectedPeriod(key, now);
    return { key, start: period.start.toISOString(), end: period.end.toISOString() };
  });
}

function hashRequest(input: SubmissionInput): string {
  const request =
    'startAt' in input
      ? {
          profileId: input.profileId,
          mode: 'advanced',
          startAt: input.startAt,
          endAt: input.endAt,
          quantities: input.quantities,
          giftCode: input.giftCode ? normalizeGiftCode(input.giftCode) : null,
          address: input.address,
          expectedQuoteDigest: input.expectedQuoteDigest,
        }
      : {
          profileId: input.profileId,
          period: input.period,
          totalKwh: input.totalKwh,
          giftCode: input.giftCode ? normalizeGiftCode(input.giftCode) : null,
          address: input.address,
          expectedQuoteDigest: input.expectedQuoteDigest,
        };
  return createHash('sha256').update(JSON.stringify(request)).digest('hex');
}

/** All business writes share the caller's transaction; no external side effect can split the order. */
@Injectable()
export class ElectricityOrderService {
  constructor(
    private readonly orders: OrdersService,
    private readonly calculator: ElectricityCalculationService,
    private readonly giftCodes: GiftCodeService,
    private readonly dueDates: DueAtCalculationService,
    private readonly invoiceStates: InvoiceStateMachineService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider | null
  ) {}

  async advancedOptions(actor: Actor) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.orders.lockOrderActor(client, actor);
      const { config, limits } = await this.orders.loadElectricitySettings(client);
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return {
        limits: {
          leadTimeDays: limits.leadTimeDays,
          maxContractDuration: limits.maxContractDuration,
        },
        mandatoryGreenEnabled: config.advancedOrder.mandatoryGreenEnabled,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async list(actor: Actor, profileId: string, before?: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.orders.lockOrderActor(client, actor);
      if (!(await this.orders.mayManageOrders(client, actor.userId, profileId)))
        throw new NotFoundException('Profile not found');
      const cursor = before
        ? (
            await client.query<{ submitted_at: Date; id: string }>(
              'SELECT submitted_at,id FROM electricity_orders WHERE id=$1 AND profile_id=$2',
              [before, profileId]
            )
          ).rows[0]
        : undefined;
      if (before && !cursor) throw new NotFoundException('Order cursor not found');
      const rows = (
        await client.query<{
          id: string;
          mode: string;
          status: ElectricityCommercialStatus;
          submitted_at: Date;
          period_start: Date;
          period_end: Date;
          total_kwh: string;
          contract_state: string;
          invoice_state: string;
          total_amount: string;
          paid_amount: string;
          refunded_amount: string;
          pending_refund_amount: string;
        }>(
          `SELECT e.id,e.mode,e.status,e.submitted_at,e.period_start,e.period_end,
            e.total_kwh,c.state AS contract_state,i.state AS invoice_state,
            i.total_amount,i.paid_amount,i.refunded_amount,
            COALESCE((SELECT SUM(r.amount)::text FROM refunds r WHERE r.invoice_id=i.id
              AND r.state NOT IN ('Completed','Rejected','Cancelled')),'0') AS pending_refund_amount
           FROM electricity_orders e
           JOIN electricity_contracts ec ON ec.order_id=e.id
           JOIN contracts c ON c.id=ec.contract_id
           JOIN contract_activation_requirements ar ON ar.version_id=c.current_version_id
           JOIN invoices i ON i.id=ar.initial_invoice_id
           WHERE e.profile_id=$1 AND e.submitted_at IS NOT NULL
             AND ($2::timestamptz IS NULL OR (e.submitted_at,e.id)<($2::timestamptz,$3::uuid))
           ORDER BY e.submitted_at DESC,e.id DESC LIMIT 51`,
          [profileId, cursor?.submitted_at ?? null, cursor?.id ?? null]
        )
      ).rows;
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return {
        orders: rows.slice(0, 50).map((row) => {
          const financialStatus = electricityFinancialStatus({
            invoiceState: row.invoice_state,
            totalAmount: row.total_amount,
            paidAmount: row.paid_amount,
            refundedAmount: row.refunded_amount,
            pendingRefundAmount: row.pending_refund_amount,
          });
          return {
            orderId: row.id,
            mode: row.mode,
            electricityStatus: row.status,
            financialStatus,
            nextAction: electricityNextAction(
              row.status,
              financialStatus,
              'customer',
              row.contract_state
            ),
            submittedAt: row.submitted_at.toISOString(),
            periodStart: row.period_start.toISOString(),
            periodEnd: row.period_end.toISOString(),
            totalKwh: row.total_kwh,
            totalIrR: row.total_amount,
          };
        }),
        nextBefore: rows.length > 50 ? rows[49]!.id : null,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async detail(actor: Actor, orderId: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.orders.lockOrderActor(client, actor);
      const order = (
        await client.query<{ profile_id: string }>(
          'SELECT profile_id FROM orders WHERE id=$1 FOR SHARE',
          [orderId]
        )
      ).rows[0];
      if (!order || !(await this.orders.mayManageOrders(client, actor.userId, order.profile_id))) {
        throw new NotFoundException('Order not found');
      }
      const detail = (
        await client.query<{
          id: string;
          profile_id: string;
          commercial_status: string;
          electricity_status: string;
          mode: string;
          period_start: Date;
          period_end: Date;
          total_kwh: string;
          effective_total_kwh: string;
          pricing_snapshot: Record<string, unknown>;
          settings_snapshot: Record<string, unknown>;
          green_rule_applied: boolean;
          submitted_at: Date;
          gift_code_id: string | null;
          gift_code: string | null;
          gift_discount_amount: string | null;
          full_address: string;
          postal_code: string;
          contract_id: string;
          contract_state: string;
          version_id: string;
          invoice_id: string;
          invoice_state: string;
          total_amount: string;
          paid_amount: string;
          refunded_amount: string;
          pending_refund_amount: string;
          refund_status: string | null;
          refund_reason: string | null;
          refund_id: string | null;
        }>(
          `SELECT o.id,o.profile_id,o.status AS commercial_status,
           e.status AS electricity_status,e.mode,e.period_start,e.period_end,
           e.total_kwh,COALESCE(ir.requested_kwh,e.total_kwh)::text AS effective_total_kwh,
           e.pricing_snapshot,e.settings_snapshot,e.green_rule_applied,
           e.submitted_at,o.gift_code_id,gc.code AS gift_code,o.gift_discount_amount,
           o.snapshot_full_address AS full_address,
           o.snapshot_postal_code AS postal_code,
           ec.contract_id,c.state AS contract_state,c.current_version_id AS version_id,
           i.id AS invoice_id,
           i.state AS invoice_state,i.total_amount,i.paid_amount,i.refunded_amount,
           COALESCE((SELECT SUM(r.amount)::text FROM refunds r WHERE r.invoice_id=i.id
             AND r.state NOT IN ('Completed','Rejected','Cancelled')), '0') AS pending_refund_amount,
           ro.status AS refund_status,ro.reason AS refund_reason,ro.refund_id
         FROM orders o JOIN electricity_orders e ON e.id=o.id
         JOIN electricity_contracts ec ON ec.order_id=o.id
         JOIN contracts c ON c.id=ec.contract_id
         JOIN contract_activation_requirements ar ON ar.version_id=c.current_version_id
         LEFT JOIN electricity_quantity_increase_requests ir
           ON ir.contract_id=c.id AND ir.status='effective'
         JOIN invoices i ON i.id=ar.initial_invoice_id
         LEFT JOIN gift_codes gc ON gc.id=o.gift_code_id
         LEFT JOIN refund_obligations ro ON ro.order_id=o.id
         WHERE o.id=$1 ORDER BY i.created_at DESC LIMIT 1`,
          [orderId]
        )
      ).rows[0];
      if (!detail) throw new NotFoundException('Electricity order not found');
      const lines = (
        await client.query<{
          product_id: string;
          system_key: string | null;
          title: Record<string, string> | null;
          quantity_kwh: string;
          unit_price: string;
          line_total: string;
        }>(
          `SELECT l.product_id,p.system_key,p.title,l.quantity_kwh,l.unit_price,l.line_total
           FROM electricity_order_lines l JOIN products p ON p.id=l.product_id
           WHERE l.order_id=$1 ORDER BY p.system_key,l.id`,
          [orderId]
        )
      ).rows;
      const activity = (
        await client.query<{
          id: string;
          event: string;
          user_id: string | null;
          created_at: Date;
          metadata: Record<string, unknown>;
        }>(
          `SELECT id,event,user_id,created_at,metadata::jsonb AS metadata FROM audit_log
           WHERE (metadata::jsonb->>'orderId'=$1 AND event LIKE 'electricity.%')
              OR ($2::uuid IS NOT NULL AND metadata::jsonb->>'refundId'=$2::text
                AND event IN ('refund.processing','refund.completed','refund.failed','refund.retry_exhausted'))
              OR (metadata::jsonb->>'contractId'=$3::text AND event='contract.cancelled')
           ORDER BY created_at ASC,id ASC LIMIT 100`,
          [orderId, detail.refund_id, detail.contract_id]
        )
      ).rows;
      const lifecycle = (
        await client.query<{ version_id: string; event: string; at: Date }>(
          `SELECT version_id,'contract.activated' AS event,activated_at AS at
           FROM contract_activations WHERE contract_id=$1
           UNION ALL
           SELECT version_id,'contract.completed' AS event,completed_at AS at
           FROM contract_completions WHERE contract_id=$1`,
          [detail.contract_id]
        )
      ).rows;
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      const financialStatus = electricityFinancialStatus({
        invoiceState: detail.invoice_state,
        totalAmount: detail.total_amount,
        paidAmount: detail.paid_amount,
        refundedAmount: detail.refunded_amount,
        pendingRefundAmount: detail.pending_refund_amount,
      });
      return {
        orderId: detail.id,
        profileId: detail.profile_id,
        commercialStatus: detail.commercial_status,
        electricityStatus: detail.electricity_status,
        financialStatus,
        nextAction: electricityNextAction(
          detail.electricity_status as ElectricityCommercialStatus,
          financialStatus,
          'customer',
          detail.contract_state
        ),
        mode: detail.mode,
        periodStart: detail.period_start.toISOString(),
        periodEnd: detail.period_end.toISOString(),
        totalKwh: detail.total_kwh,
        effectiveTotalKwh: detail.effective_total_kwh,
        pricingSnapshot: detail.pricing_snapshot,
        settingsSnapshot: detail.settings_snapshot,
        greenRuleApplied: detail.green_rule_applied,
        submittedAt: detail.submitted_at.toISOString(),
        giftCodeId: detail.gift_code_id,
        giftCode: detail.gift_code,
        giftDiscountIrR: detail.gift_discount_amount ?? '0',
        lines: lines.map((line) => ({
          productId: line.product_id,
          systemKey: line.system_key,
          title: line.title,
          quantityKwh: line.quantity_kwh,
          unitPriceIrR: line.unit_price,
          lineTotalIrR: line.line_total,
        })),
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
        fullAddress: detail.full_address,
        postalCode: detail.postal_code,
        contractId: detail.contract_id,
        contractState: detail.contract_state,
        versionId: detail.version_id,
        invoiceId: detail.invoice_id,
        invoiceState: detail.invoice_state,
        totalIrR: detail.total_amount,
        paidIrR: detail.paid_amount,
        refundedIrR: detail.refunded_amount,
        refundStatus: detail.refund_status,
        refundReason: detail.refund_reason,
        financiallyClosed: ['rejected', 'cancelled'].includes(detail.electricity_status)
          ? BigInt(detail.paid_amount) === BigInt(detail.refunded_amount) &&
            detail.pending_refund_amount === '0' &&
            (detail.refund_status === null || detail.refund_status === 'completed')
          : false,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async cancel(
    actor: Actor,
    orderId: string,
    input: { idempotencyKey: string; expectedVersionId: string; reason: string },
    ip: string
  ) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.orders.lockOrderActor(client, actor);
      const result = await idempotentMutation(
        client,
        'electricity_order_cancel',
        { ...input, orderId },
        actor,
        async () => {
          const row = (
            await client.query<{
              profile_id: string;
              status: ElectricityCommercialStatus;
              contract_id: string;
              contract_state: string;
              version_id: string;
              invoice_id: string;
              invoice_state: string;
              paid_amount: string;
              refunded_amount: string;
              total_amount: string;
              gift_code_id: string | null;
            }>(
              `SELECT o.profile_id,e.status,ec.contract_id,c.state AS contract_state,
                c.current_version_id AS version_id,i.id AS invoice_id,
                i.state AS invoice_state,i.paid_amount,i.refunded_amount,
                i.total_amount,o.gift_code_id
               FROM orders o JOIN electricity_orders e ON e.id=o.id
               JOIN electricity_contracts ec ON ec.order_id=o.id
               JOIN contracts c ON c.id=ec.contract_id
               JOIN contract_activation_requirements ar ON ar.version_id=c.current_version_id
               JOIN invoices i ON i.id=ar.initial_invoice_id
               WHERE o.id=$1 FOR UPDATE OF o,e,c,i`,
              [orderId]
            )
          ).rows[0];
          if (!row) throw new NotFoundException('Order not found');
          await this.authorize(client, actor, row.profile_id, true);
          if (
            row.version_id !== input.expectedVersionId ||
            !['awaiting_staff_review', 'changes_requested'].includes(row.status) ||
            !['AwaitingStaffReview', 'ChangesRequested'].includes(row.contract_state)
          )
            throw new ConflictException('Order changed; reload before cancelling');
          if (row.invoice_state === 'PaymentUnderReview')
            throw new ConflictException('Resolve pending payment review before cancellation');
          const pendingPayment = (
            await client.query<{ pending: boolean }>(
              'SELECT contract_has_pending_payments($1) AS pending',
              [row.contract_id]
            )
          ).rows[0]?.pending;
          if (pendingPayment)
            throw new ConflictException('Resolve pending payment before cancellation');
          const reason = input.reason.trim();
          if (BigInt(row.paid_amount) > BigInt(row.refunded_amount))
            await requireSessionStepUp(client, actor);
          const refundId = await createElectricityRefundObligation(client, {
            orderId,
            contractId: row.contract_id,
            invoiceId: row.invoice_id,
            profileId: row.profile_id,
            paidAmount: row.paid_amount,
            refundedAmount: row.refunded_amount,
            authorizedBy: actor.userId,
            reason,
          });
          if (!refundId && ['Draft', 'Unpaid', 'Overdue'].includes(row.invoice_state)) {
            await this.invoiceStates.transition(
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
            [orderId]
          );
          await client.query("UPDATE orders SET status='CANCELLED',updated_at=NOW() WHERE id=$1", [
            orderId,
          ]);
          await client.query(
            "UPDATE electricity_orders SET status='cancelled',updated_at=NOW() WHERE id=$1",
            [orderId]
          );
          if (BigInt(row.paid_amount) === 0n && row.gift_code_id)
            await this.giftCodes.releaseByOrder(orderId, client, { actorUserId: actor.userId, ip });
          await client.query(
            `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
             VALUES(uuid_generate_v7(),$1,'electricity.order_cancelled',$2::jsonb,uuid_generate_v7(),$3)`,
            [
              actor.userId,
              JSON.stringify({
                orderId,
                contractId: row.contract_id,
                invoiceId: row.invoice_id,
                versionId: row.version_id,
                reason,
                refundId,
              }),
              ip,
            ]
          );
          return { orderId, status: 'cancelled', refundId };
        }
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

  async resubmitAddressCorrection(
    actor: Actor,
    orderId: string,
    input: ElectricityAddressCorrection,
    ip: string
  ) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.orders.lockOrderActor(client, actor);
      const result = await idempotentMutation(
        client,
        'electricity_order_address_correction',
        { ...input, orderId },
        actor,
        async () => {
          const row = (
            await client.query<{
              profile_id: string;
              status: string;
              contract_id: string;
              contract_state: string;
              version_id: string;
              version_number: number;
              content: Record<string, unknown>;
              invoice_id: string;
              invoice_state: string;
              paid_amount: string;
              period_start: Date;
              period_end: Date;
            }>(
              `SELECT o.profile_id,e.status,ec.contract_id,c.state AS contract_state,
                 c.current_version_id AS version_id,v.version_number,v.content,
                 i.id AS invoice_id,i.state AS invoice_state,i.paid_amount,
                 e.period_start,e.period_end
               FROM orders o JOIN electricity_orders e ON e.id=o.id
               JOIN electricity_contracts ec ON ec.order_id=o.id
               JOIN contracts c ON c.id=ec.contract_id
               JOIN contract_versions v ON v.id=c.current_version_id
               JOIN contract_activation_requirements ar ON ar.version_id=c.current_version_id
               JOIN invoices i ON i.id=ar.initial_invoice_id
               WHERE o.id=$1 FOR UPDATE OF o,e,c,i`,
              [orderId]
            )
          ).rows[0];
          if (!row) throw new NotFoundException('Order not found');
          await this.authorize(client, actor, row.profile_id, true);
          if (
            row.status !== 'changes_requested' ||
            row.contract_state !== 'ChangesRequested' ||
            row.version_id !== input.expectedVersionId
          )
            throw new ConflictException('Order has changed; reload before resubmitting');
          if (BigInt(row.paid_amount) > 0n || row.invoice_state === 'PaymentUnderReview')
            throw new ConflictException('Resolve payment activity before amending the order');
          const versionId = uuidv7();
          await client.query(
            `UPDATE orders SET snapshot_full_address=$2,snapshot_postal_code=$3,updated_at=NOW()
             WHERE id=$1`,
            [orderId, input.fullAddress.trim(), input.postalCode.trim()]
          );
          await client.query(
            `INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by)
             VALUES($1,$2,$3,$4::jsonb,$5,$6)`,
            [
              versionId,
              row.contract_id,
              row.version_number + 1,
              JSON.stringify({
                ...row.content,
                delivery: {
                  fullAddress: input.fullAddress.trim(),
                  postalCode: input.postalCode.trim(),
                },
                customerResponse: input.responseNote.trim(),
              }),
              'Customer corrected delivery address and resubmitted',
              actor.userId,
            ]
          );
          await client.query(
            "UPDATE contracts SET current_version_id=$2,state='AwaitingStaffReview',submitted_at=NOW() WHERE id=$1",
            [row.contract_id, versionId]
          );
          const requirements = await client.query(
            `UPDATE contract_activation_requirements
             SET initial_invoice_id=$2,service_starts_at=$3,service_ends_at=$4
             WHERE version_id=$1 AND contract_id=$5`,
            [versionId, row.invoice_id, row.period_start, row.period_end, row.contract_id]
          );
          if (requirements.rowCount !== 1)
            throw new ConflictException('Contract activation requirements are unavailable');
          await client.query(
            "UPDATE electricity_orders SET status='submitted',updated_at=NOW() WHERE id=$1",
            [orderId]
          );
          await client.query(
            "UPDATE electricity_orders SET status='awaiting_staff_review',updated_at=NOW() WHERE id=$1",
            [orderId]
          );
          await client.query(
            `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
             VALUES(uuid_generate_v7(),$1,'electricity.order_resubmitted',$2::jsonb,uuid_generate_v7(),$3)`,
            [
              actor.userId,
              JSON.stringify({
                orderId,
                contractId: row.contract_id,
                versionId,
                responseNote: input.responseNote.trim(),
              }),
              ip,
            ]
          );
          return {
            orderId,
            contractId: row.contract_id,
            versionId,
            status: 'awaiting_staff_review',
          };
        }
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

  private async authorize(
    client: PoolClient,
    actor: Actor,
    profileId: string,
    actorLocked = false
  ): Promise<void> {
    if (!actorLocked) await this.orders.lockOrderActor(client, actor);
    if (!(await this.orders.mayManageOrders(client, actor.userId, profileId, true))) {
      throw new NotFoundException('Profile not found');
    }
    const profile = (
      await client.query<{ profile_type: string }>(
        'SELECT profile_type FROM profiles WHERE id=$1 AND NOT archived',
        [profileId]
      )
    ).rows[0];
    if (profile?.profile_type !== 'LEGAL') {
      throw new BadRequestException('Electricity ordering requires a legal profile');
    }
  }

  private async giftTerms(
    client: PoolClient,
    input: Pick<OrderInput, 'profileId' | 'giftCode'>,
    subtotal: bigint,
    now: Date
  ): Promise<{
    gift: ElectricityGiftDiscount;
    id: string;
  } | null> {
    if (!input.giftCode) return null;
    const code = normalizeGiftCode(input.giftCode);
    const row = (
      await client.query<{
        id: string;
        discount_type: string;
        discount_value: string;
        max_cap_irr: string | null;
        status: string;
        eligibility: string;
        valid_from: Date;
        valid_until: Date | null;
        min_order_amount: string;
        categories: string[];
        total_limit: number | null;
        per_profile_limit: number | null;
      }>(
        `SELECT id,discount_type,discount_value,max_cap_irr,status,eligibility,valid_from,
                 valid_until,min_order_amount,categories,total_limit,per_profile_limit
            FROM gift_codes WHERE code=$1 FOR UPDATE`,
        [code]
      )
    ).rows[0];
    if (
      !row ||
      row.status !== 'active' ||
      row.valid_from > now ||
      (row.valid_until !== null && row.valid_until <= now) ||
      subtotal < BigInt(row.min_order_amount) ||
      (row.categories.length > 0 && !row.categories.includes('electricity'))
    ) {
      throw new BadRequestException('Gift code is unavailable for this order');
    }
    if (row.eligibility === 'profile') {
      const eligible = await client.query(
        'SELECT 1 FROM gift_code_profiles WHERE gift_code_id=$1 AND profile_id=$2',
        [row.id, input.profileId]
      );
      if (eligible.rows.length === 0)
        throw new BadRequestException('Gift code is unavailable for this profile');
    }
    const usage = (
      await client.query<{ total: number; profile: number }>(
        `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE profile_id=$2)::int AS profile
         FROM gift_code_redemptions WHERE gift_code_id=$1 AND status='consumed'`,
        [row.id, input.profileId]
      )
    ).rows[0]!;
    if (
      (row.total_limit !== null && usage.total >= row.total_limit) ||
      (row.per_profile_limit !== null && usage.profile >= row.per_profile_limit)
    ) {
      throw new BadRequestException('Gift code usage limit reached');
    }
    const gift: ElectricityGiftDiscount =
      row.discount_type === 'fixed_irr'
        ? { type: 'fixed_irr', value: BigInt(row.discount_value) }
        : {
            type: 'percentage',
            basisPoints: Number(row.discount_value),
            maxCapIrR: BigInt(row.max_cap_irr!),
          };
    return { gift, id: row.id };
  }

  private async quote(client: PoolClient, input: OrderInput, now: Date) {
    const advanced = 'startAt' in input;
    if (!advanced && (!/^\d+$/.test(input.totalKwh) || BigInt(input.totalKwh) <= 0n)) {
      throw new BadRequestException('Total kWh must be a positive integer');
    }
    const {
      config,
      limits,
      snapshot: settings,
    } = await this.orders.loadElectricitySettings(client);
    let period: ElectricityPeriod;
    try {
      period = advanced
        ? validateAdvancedPeriod(new Date(input.startAt), new Date(input.endAt), now, limits)
        : selectedPeriod(input.period, now);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid delivery period'
      );
    }
    const quantities: Partial<Record<ElectricitySystemKey, bigint>> | undefined = advanced
      ? Object.fromEntries(
          Object.entries(input.quantities)
            .filter((entry): entry is [string, string] => entry[1] !== undefined)
            .map(([key, value]) => [key, BigInt(value)])
        )
      : undefined;
    const initial = await this.calculator.calculate(
      client,
      {
        mode: advanced ? 'advanced' : 'simple',
        period,
        ...(!advanced ? { totalKwh: BigInt(input.totalKwh) } : { quantities: quantities! }),
      },
      config,
      undefined,
      now
    );
    if (!initial.ok)
      throw new BadRequestException({
        error: 'ELECTRICITY_QUOTE_INVALID',
        details: initial.errors,
      });
    if (!advanced && !initial.composition.lines.some((line) => line.systemKey === 'thermal')) {
      throw new BadRequestException('Simple ordering requires a positive thermal quantity');
    }
    const terms = await this.giftTerms(client, input, initial.totals.subtotalIrR, now);
    const totals = terms
      ? calculateElectricityTotals(initial.composition.lines, terms.gift)
      : initial.totals;
    if (totals.lines.some((line) => line.quantityKwh > 2_147_483_647n)) {
      throw new BadRequestException('Invoice line quantity exceeds the supported range');
    }
    const wallet = advanced
      ? (
          await client.query<{ available_balance: string }>(
            'SELECT (posted_balance-reserved_balance)::text AS available_balance FROM wallets WHERE profile_id=$1',
            [input.profileId]
          )
        ).rows[0]
      : undefined;
    return {
      mode: advanced ? ('advanced' as const) : ('simple' as const),
      period,
      composition: initial.composition,
      totals,
      settings,
      terms,
      ...(advanced
        ? {
            walletBalanceIrR: wallet?.available_balance ?? '0',
            mandatoryGreenEnabled: config.advancedOrder.mandatoryGreenEnabled,
            limits: {
              maxContractDuration: limits.maxContractDuration,
              leadTimeDays: limits.leadTimeDays,
            },
          }
        : {}),
    };
  }

  async preview(actor: Actor, input: OrderInput) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.authorize(client, actor, input.profileId);
      const quoted = await this.quote(client, input, new Date());
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return this.presentQuote(quoted);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  private presentQuote(quoted: Awaited<ReturnType<ElectricityOrderService['quote']>>) {
    const view = {
      periodStart: quoted.period.start.toISOString(),
      periodEnd: quoted.period.end.toISOString(),
      durationHours: quoted.composition.durationHours,
      totalKwh: quoted.composition.totalKwh.toString(),
      averagePowerKw: quoted.composition.averagePowerKw,
      greenRuleApplies: quoted.composition.greenRuleApplies,
      lines: quoted.totals.lines.map((line) => ({
        productId: line.productId,
        systemKey: line.systemKey,
        quantityKwh: line.quantityKwh.toString(),
        unitPriceIrR: line.unitPriceIrR.toString(),
        subtotalIrR: line.subtotalIrR.toString(),
        discountIrR: line.discountIrR.toString(),
        vatRateBasisPoints: line.vatRateBasisPoints,
        vatIrR: line.vatIrR.toString(),
      })),
      subtotalIrR: quoted.totals.subtotalIrR.toString(),
      discountIrR: quoted.totals.discountIrR.toString(),
      vatIrR: quoted.totals.vatIrR.toString(),
      totalIrR: quoted.totals.totalIrR.toString(),
    };
    const reviewPayload = {
      ...(quoted.mode === 'advanced'
        ? { periodStart: view.periodStart, durationHours: view.durationHours }
        : {}),
      periodEnd: view.periodEnd,
      greenRuleApplies: view.greenRuleApplies,
      lines: view.lines,
      subtotalIrR: view.subtotalIrR,
      discountIrR: view.discountIrR,
      vatIrR: view.vatIrR,
      totalIrR: view.totalIrR,
    };
    return {
      ...view,
      ...('walletBalanceIrR' in quoted
        ? {
            walletBalanceIrR: quoted.walletBalanceIrR,
            mandatoryGreenEnabled: quoted.mandatoryGreenEnabled,
            limits: quoted.limits,
          }
        : {}),
      reviewDigest: createHash('sha256').update(JSON.stringify(reviewPayload)).digest('hex'),
    };
  }

  async submit(actor: Actor, input: SubmissionInput, ip = 'unknown') {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      // The user row serializes same-user retries before the result row exists.
      await this.orders.lockOrderActor(client, actor);
      const requestHash = hashRequest(input);
      const previous = (
        await client.query<{ request_hash: string; response: unknown }>(
          'SELECT request_hash,response FROM electricity_order_submissions WHERE user_id=$1 AND idempotency_key=$2',
          [actor.userId, input.idempotencyKey]
        )
      ).rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash)
          throw new ConflictException('Idempotency key was used for different order data');
        await requireCurrentSession(client, actor);
        await client.query('COMMIT');
        return previous.response;
      }
      await this.authorize(client, actor, input.profileId, true);
      await this.orders.lockProfileSubmissions(client, input.profileId);
      await this.orders.enforceProfileSubmissionLimit(client, input.profileId);
      await requireAddressGeography(client, input.address.provinceId, input.address.cityId);
      const now = new Date();
      const quoted = await this.quote(client, input, now);
      if (this.presentQuote(quoted).reviewDigest !== input.expectedQuoteDigest) {
        throw new ConflictException(
          'Electricity quote changed; review the current price before submitting'
        );
      }
      const primary =
        quoted.composition.lines.find((line) => line.systemKey === 'thermal') ??
        quoted.composition.lines[0];
      if (!primary) throw new BadRequestException('At least one electricity line is required');
      const orderId = uuidv7();
      await client.query(
        `INSERT INTO orders(id,user_id,profile_id,product_id,order_type,status,
                            snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code)
         VALUES($1,$2,$3,$4,'electricity','PENDING',$5,$6,$7,$8)`,
        [
          orderId,
          actor.userId,
          input.profileId,
          primary.productId,
          input.address.provinceId,
          input.address.cityId,
          input.address.fullAddress,
          input.address.postalCode,
        ]
      );
      await client.query(
        `INSERT INTO electricity_orders(id,profile_id,mode,status,settings_snapshot)
         VALUES($1,$2,$3,'draft',$4::jsonb)`,
        [
          orderId,
          input.profileId,
          'startAt' in input ? 'advanced' : 'simple',
          JSON.stringify(quoted.settings),
        ]
      );
      let giftId: string | null = null;
      if (input.giftCode && quoted.terms) {
        const redemption = await this.giftCodes.redeem(
          {
            giftCode: input.giftCode,
            profileId: input.profileId,
            orderId,
            orderAmount: quoted.totals.subtotalIrR.toString(),
            category: 'electricity',
            actorUserId: actor.userId,
            ip,
          },
          client
        );
        if (
          BigInt(redemption.discountAmount) !== quoted.totals.discountIrR ||
          redemption.giftCodeId !== quoted.terms.id
        ) {
          throw new ConflictException('Gift code changed during submission');
        }
        giftId = redemption.giftCodeId;
        await client.query(
          'UPDATE orders SET gift_code_id=$2,gift_discount_amount=$3 WHERE id=$1',
          [orderId, giftId, redemption.discountAmount]
        );
      }
      const snapshot = await persistElectricitySubmissionSnapshot(
        client,
        orderId,
        quoted.period,
        quoted.composition,
        quoted.totals,
        quoted.terms?.gift,
        actor.userId,
        now
      );
      for (const line of quoted.totals.lines) {
        await client.query(
          `INSERT INTO electricity_order_lines(id,order_id,product_id,quantity_kwh,unit_price,line_total)
           VALUES($1,$2,$3,$4,$5,$6)`,
          [
            uuidv7(),
            orderId,
            line.productId,
            line.quantityKwh.toString(),
            line.unitPriceIrR.toString(),
            line.subtotalIrR.toString(),
          ]
        );
      }
      const contractId = uuidv7(),
        versionId = uuidv7();
      const template = await electricityContractTemplateSnapshot(
        client,
        this.storage,
        input.profileId,
        quoted.totals.totalIrR,
        now
      );
      await client.query(
        `INSERT INTO contracts(id,profile_id,order_id,service_type,state,current_version_id)
         VALUES($1,$2,$3,'electricity','Draft',$4)`,
        [contractId, input.profileId, orderId, versionId]
      );
      await client.query(
        `INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by)
         VALUES($1,$2,1,$3::jsonb,'Initial electricity order',$4)`,
        [
          versionId,
          contractId,
          JSON.stringify({
            orderId,
            pricing: snapshot,
            settings: quoted.settings,
            ...(template ? { template } : {}),
          }),
          actor.userId,
        ]
      );
      await client.query(
        "UPDATE contracts SET state='AwaitingStaffReview',submitted_at=$2 WHERE id=$1",
        [contractId, now]
      );
      await client.query(
        `INSERT INTO electricity_contracts(id,order_id,contract_id,status) VALUES($1,$2,$3,'draft')`,
        [uuidv7(), orderId, contractId]
      );
      const invoiceId = await this.writeInvoice(client, {
        orderId,
        contractId,
        profileId: input.profileId,
        actorUserId: actor.userId,
        now,
        ip,
        snapshot,
        lines: quoted.totals.lines,
        totalIrR: quoted.totals.totalIrR,
      });
      const requirements = await client.query(
        `UPDATE contract_activation_requirements
         SET initial_invoice_id=$2,service_starts_at=$3,service_ends_at=$4
         WHERE version_id=$1 AND contract_id=$5`,
        [versionId, invoiceId, quoted.period.start, quoted.period.end, contractId]
      );
      if (requirements.rowCount !== 1)
        throw new ConflictException('Contract activation requirements are unavailable');
      await client.query(
        "UPDATE electricity_orders SET status='awaiting_staff_review' WHERE id=$1",
        [orderId]
      );
      const response = { orderId, contractId, invoiceId, ...this.presentQuote(quoted) };
      await client.query(
        `INSERT INTO electricity_order_submissions(user_id,idempotency_key,request_hash,order_id,contract_id,invoice_id,response)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [
          actor.userId,
          input.idempotencyKey,
          requestHash,
          orderId,
          contractId,
          invoiceId,
          JSON.stringify(response),
        ]
      );
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
         VALUES(uuid_generate_v7(),$1,'order_created',$2::jsonb,uuid_generate_v7(),$3)`,
        [
          actor.userId,
          JSON.stringify({ orderId, profileId: input.profileId, status: 'PENDING' }),
          ip,
        ]
      );
      await client.query(
        'DELETE FROM electricity_customer_drafts WHERE user_id=$1 AND profile_id=$2 AND mode=$3',
        [actor.userId, input.profileId, 'startAt' in input ? 'advanced' : 'simple']
      );
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  private async writeInvoice(
    client: PoolClient,
    input: {
      orderId: string;
      contractId: string;
      profileId: string;
      actorUserId: string;
      now: Date;
      ip: string;
      snapshot: Record<string, unknown>;
      lines: ReturnType<typeof calculateElectricityTotals>['lines'];
      totalIrR: bigint;
    }
  ): Promise<string> {
    const due = await this.dueDates.resolve(client, {
      serviceType: 'electricity',
      issuedAt: input.now,
    });
    const invoiceId = uuidv7();
    await client.query(
      `INSERT INTO invoices(id,profile_id,order_id,contract_id,type,state,total_amount,due_at,
                            metadata,invoice_calculation_snapshot)
       VALUES($1,$2,$3,$4,'auto','Draft',$5,$6,$7::jsonb,$8::jsonb)`,
      [
        invoiceId,
        input.profileId,
        input.orderId,
        input.contractId,
        input.totalIrR.toString(),
        due.dueAt,
        JSON.stringify({ source: 'electricity_order', due }),
        JSON.stringify(input.snapshot),
      ]
    );
    for (const [index, line] of input.lines.entries()) {
      const product = (
        await client.query<{ title: unknown }>('SELECT title FROM products WHERE id=$1', [
          line.productId,
        ])
      ).rows[0];
      if (!product) throw new ConflictException('Product disappeared during invoice creation');
      await client.query(
        `INSERT INTO invoice_lines(id,invoice_id,description,quantity,unit_price,line_total,
                                   vat_rate,vat_amount,is_taxable,position)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          uuidv7(),
          invoiceId,
          line.systemKey,
          Number(line.quantityKwh),
          line.unitPriceIrR.toString(),
          line.netIrR.toString(),
          line.vatRateBasisPoints,
          line.vatIrR.toString(),
          line.vatRateBasisPoints > 0,
          index,
        ]
      );
      await client.query(
        `INSERT INTO invoice_items(id,invoice_id,product_id,product_title,quantity,unit_price,vat_rate)
         VALUES($1,$2,$3,$4::jsonb,$5,$6,$7)`,
        [
          uuidv7(),
          invoiceId,
          line.productId,
          JSON.stringify(product.title),
          Number(line.quantityKwh),
          line.unitPriceIrR.toString(),
          line.vatRateBasisPoints,
        ]
      );
    }
    await this.invoiceStates.transition(invoiceId, 'Draft', 'Unpaid', {
      actorUserId: input.actorUserId,
      now: input.now,
      ip: input.ip,
      client,
    });
    return invoiceId;
  }
}
