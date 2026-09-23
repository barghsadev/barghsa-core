import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { normalizeGiftCode } from '@barghsa/shared/promotions';
import { v7 as uuidv7 } from 'uuid';
import type { PoolClient } from 'pg';
import type { ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { idempotentMutation } from '../database/idempotency.js';
import { requireAddressGeography } from '../profiles/address-geography.js';
import { OrdersService } from '../orders/orders.service.js';
import { GiftCodeService } from '../admin/gift-code.service.js';
import { DueAtCalculationService } from '../invoice/due-at.service.js';
import { InvoiceStateMachineService } from '../invoice/invoice-state-machine.service.js';
import { ElectricityCalculationService } from './electricity-calculation.service.js';
import {
  calculateElectricityTotals,
  type ElectricityGiftDiscount,
} from './electricity-calculation.js';
import { persistElectricitySubmissionSnapshot } from './electricity-submission-snapshot.js';
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

function hashRequest(input: SimpleSubmissionInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        profileId: input.profileId,
        period: input.period,
        totalKwh: input.totalKwh,
        giftCode: input.giftCode ? normalizeGiftCode(input.giftCode) : null,
        address: input.address,
        expectedQuoteDigest: input.expectedQuoteDigest,
      })
    )
    .digest('hex');
}

/** All business writes share the caller's transaction; no external side effect can split the order. */
@Injectable()
export class ElectricityOrderService {
  constructor(
    private readonly orders: OrdersService,
    private readonly calculator: ElectricityCalculationService,
    private readonly giftCodes: GiftCodeService,
    private readonly dueDates: DueAtCalculationService,
    private readonly invoiceStates: InvoiceStateMachineService
  ) {}

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
          pricing_snapshot: Record<string, unknown>;
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
        }>(
          `SELECT o.id,o.profile_id,o.status AS commercial_status,
           e.status AS electricity_status,e.mode,e.period_start,e.period_end,
           e.total_kwh,e.pricing_snapshot,o.snapshot_full_address AS full_address,
           o.snapshot_postal_code AS postal_code,
           ec.contract_id,c.state AS contract_state,c.current_version_id AS version_id,
           i.id AS invoice_id,
           i.state AS invoice_state,i.total_amount,i.paid_amount,i.refunded_amount,
           COALESCE((SELECT SUM(r.amount)::text FROM refunds r WHERE r.invoice_id=i.id
             AND r.state NOT IN ('Completed','Rejected','Cancelled')), '0') AS pending_refund_amount
         FROM orders o JOIN electricity_orders e ON e.id=o.id
         JOIN electricity_contracts ec ON ec.order_id=o.id
         JOIN contracts c ON c.id=ec.contract_id
         JOIN invoices i ON i.order_id=o.id
         WHERE o.id=$1 ORDER BY i.created_at DESC LIMIT 1`,
          [orderId]
        )
      ).rows[0];
      if (!detail) throw new NotFoundException('Electricity order not found');
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
          'customer'
        ),
        mode: detail.mode,
        periodStart: detail.period_start.toISOString(),
        periodEnd: detail.period_end.toISOString(),
        totalKwh: detail.total_kwh,
        pricingSnapshot: detail.pricing_snapshot,
        fullAddress: detail.full_address,
        postalCode: detail.postal_code,
        contractId: detail.contract_id,
        contractState: detail.contract_state,
        versionId: detail.version_id,
        invoiceId: detail.invoice_id,
        invoiceState: detail.invoice_state,
        totalIrR: detail.total_amount,
      };
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
            }>(
              `SELECT o.profile_id,e.status,ec.contract_id,c.state AS contract_state,
                 c.current_version_id AS version_id,v.version_number,v.content
               FROM orders o JOIN electricity_orders e ON e.id=o.id
               JOIN electricity_contracts ec ON ec.order_id=o.id
               JOIN contracts c ON c.id=ec.contract_id
               JOIN contract_versions v ON v.id=c.current_version_id
               WHERE o.id=$1 FOR UPDATE OF o,e,c`,
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
    input: SimpleOrderInput,
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

  private async quote(client: PoolClient, input: SimpleOrderInput, now: Date) {
    if (!/^\d+$/.test(input.totalKwh) || BigInt(input.totalKwh) <= 0n) {
      throw new BadRequestException('Total kWh must be a positive integer');
    }
    const period = selectedPeriod(input.period, now);
    const { config, snapshot: settings } = await this.orders.loadElectricitySettings(client);
    const initial = await this.calculator.calculate(
      client,
      {
        mode: 'simple',
        period,
        totalKwh: BigInt(input.totalKwh),
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
    if (!initial.composition.lines.some((line) => line.systemKey === 'thermal')) {
      throw new BadRequestException('Simple ordering requires a positive thermal quantity');
    }
    const terms = await this.giftTerms(client, input, initial.totals.subtotalIrR, now);
    const totals = terms
      ? calculateElectricityTotals(initial.composition.lines, terms.gift)
      : initial.totals;
    if (totals.lines.some((line) => line.quantityKwh > 2_147_483_647n)) {
      throw new BadRequestException('Invoice line quantity exceeds the supported range');
    }
    return { period, composition: initial.composition, totals, settings, terms };
  }

  async preview(actor: Actor, input: SimpleOrderInput) {
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
      reviewDigest: createHash('sha256').update(JSON.stringify(reviewPayload)).digest('hex'),
    };
  }

  async submit(actor: Actor, input: SimpleSubmissionInput, ip = 'unknown') {
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
      await requireAddressGeography(client, input.address.provinceId, input.address.cityId);
      const now = new Date();
      const quoted = await this.quote(client, input, now);
      if (this.presentQuote(quoted).reviewDigest !== input.expectedQuoteDigest) {
        throw new ConflictException(
          'Electricity quote changed; review the current price before submitting'
        );
      }
      const primary = quoted.composition.lines.find((line) => line.systemKey === 'thermal');
      if (!primary) throw new BadRequestException('Thermal electricity line is required');
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
         VALUES($1,$2,'simple','draft',$3::jsonb)`,
        [orderId, input.profileId, JSON.stringify(quoted.settings)]
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
          JSON.stringify({ orderId, pricing: snapshot, settings: quoted.settings }),
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
        "DELETE FROM electricity_customer_drafts WHERE user_id=$1 AND profile_id=$2 AND mode='simple'",
        [actor.userId, input.profileId]
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
