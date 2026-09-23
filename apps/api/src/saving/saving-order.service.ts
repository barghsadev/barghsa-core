import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { computeGiftDiscount, normalizeGiftCode } from '@barghsa/shared/promotions';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { GiftCodeService } from '../admin/gift-code.service.js';
import { DueAtCalculationService } from '../invoice/due-at.service.js';
import { InvoiceStateMachineService } from '../invoice/invoice-state-machine.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import type { ValidatedSession } from '../session/session.service.js';
import { calculateSavingTotals, type SavingPriceLine } from './saving-calculation.js';
import { BillVerificationProvider } from './bill-verification.provider.js';

type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
export interface SavingOrderInput {
  profileId: string;
  savingPlanId: string;
  hardwareProductId: string;
  billIdentifier: string;
  installationAddressId: string;
  agreementVersionId: string;
  giftCode?: string | undefined;
}
export interface SavingSubmissionInput extends SavingOrderInput {
  idempotencyKey: string;
  expectedQuoteDigest: string;
  agreementAccepted: true;
  hardwareConfirmed: true;
  submitForStaffReview: true;
}
interface ProductRow {
  id: string;
  title: { fa: string; en: string };
  price: string;
  status: string;
}
interface AgreementRow {
  id: string;
  title: string;
  body: string;
  status: string;
}
export interface AddressRow {
  id: string;
  province_id: string;
  city_id: string;
  full_address: string;
  postal_code: string;
}

function requestHash(input: SavingSubmissionInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        profileId: input.profileId,
        savingPlanId: input.savingPlanId,
        hardwareProductId: input.hardwareProductId,
        billIdentifier: input.billIdentifier,
        installationAddressId: input.installationAddressId,
        agreementVersionId: input.agreementVersionId,
        giftCode: input.giftCode ? normalizeGiftCode(input.giftCode) : null,
        expectedQuoteDigest: input.expectedQuoteDigest,
      })
    )
    .digest('hex');
}

@Injectable()
export class SavingOrderService {
  constructor(
    private readonly orders: OrdersService,
    private readonly giftCodes: GiftCodeService,
    private readonly dueDates: DueAtCalculationService,
    private readonly invoiceStates: InvoiceStateMachineService,
    private readonly billProvider: BillVerificationProvider
  ) {}

  private async authorize(client: PoolClient, actor: Actor, profileId: string) {
    if (!(await this.orders.mayManageOrders(client, actor.userId, profileId, true)))
      throw new NotFoundException('Profile not found');
    const row = (
      await client.query<{ profile_type: string }>(
        'SELECT profile_type FROM profiles WHERE id=$1 FOR SHARE',
        [profileId]
      )
    ).rows[0];
    if (row?.profile_type !== 'INDIVIDUAL')
      throw new BadRequestException('Saving orders require an individual profile');
  }

  private async giftDiscount(
    client: PoolClient,
    input: SavingOrderInput,
    subtotal: bigint,
    now: Date
  ) {
    if (!input.giftCode) return { id: null as string | null, amount: 0n };
    const row = (
      await client.query<{
        id: string;
        discount_type: 'fixed_irr' | 'percentage';
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
          FROM gift_codes WHERE code=$1`,
        [normalizeGiftCode(input.giftCode)]
      )
    ).rows[0];
    if (
      !row ||
      row.status !== 'active' ||
      row.valid_from > now ||
      (row.valid_until && row.valid_until <= now) ||
      subtotal < BigInt(row.min_order_amount) ||
      (row.categories.length > 0 && !row.categories.includes('saving_plan'))
    )
      throw new BadRequestException('Gift code is unavailable for this order');
    if (row.eligibility === 'profile') {
      const eligible = await client.query(
        'SELECT 1 FROM gift_code_profiles WHERE gift_code_id=$1 AND profile_id=$2',
        [row.id, input.profileId]
      );
      if (!eligible.rows.length)
        throw new BadRequestException('Gift code is unavailable for this profile');
    }
    const usage = (
      await client.query<{ total: number; profile: number }>(
        `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE profile_id=$2)::int AS profile
         FROM gift_code_redemptions WHERE gift_code_id=$1 AND status='consumed'`,
        [row.id, input.profileId]
      )
    ).rows[0]!;
    if (
      (row.total_limit !== null && usage.total >= row.total_limit) ||
      (row.per_profile_limit !== null && usage.profile >= row.per_profile_limit)
    )
      throw new BadRequestException('Gift code usage limit reached');
    return {
      id: row.id,
      amount: BigInt(
        computeGiftDiscount({
          discountType: row.discount_type,
          discountValue: row.discount_value,
          maxCapIrr: row.max_cap_irr,
          orderAmount: subtotal,
        })
      ),
    };
  }

  private async quoteInTransaction(client: PoolClient, input: SavingOrderInput, now: Date) {
    const products = (
      await client.query<ProductRow>(
        `SELECT id,title,effective_product_price(id)::text AS price,status
         FROM products WHERE id IN ($1,$2) AND status='active' FOR SHARE`,
        [input.savingPlanId, input.hardwareProductId]
      )
    ).rows;
    const plan = products.find((row) => row.id === input.savingPlanId);
    const hardware = products.find((row) => row.id === input.hardwareProductId);
    const assigned =
      (
        await client.query(
          'SELECT 1 FROM saving_plan_hardware WHERE plan_id=$1 AND hardware_id=$2 FOR SHARE',
          [input.savingPlanId, input.hardwareProductId]
        )
      ).rows.length > 0;
    if (
      !plan ||
      !hardware ||
      !assigned ||
      !plan.price ||
      !hardware.price ||
      BigInt(plan.price) <= 0n ||
      BigInt(hardware.price) <= 0n
    )
      throw new ConflictException('Saving plan or hardware is no longer available');
    const agreement = (
      await client.query<AgreementRow>(
        `SELECT id,title,body,status FROM saving_plan_agreement_versions
        WHERE id=$1 AND plan_id=$2 FOR SHARE`,
        [input.agreementVersionId, input.savingPlanId]
      )
    ).rows[0];
    if (!agreement || agreement.status !== 'active')
      throw new ConflictException('Saving agreement changed; review it again');
    const address = (
      await client.query<AddressRow>(
        `SELECT id,province_id,city_id,full_address,postal_code FROM addresses
        WHERE id=$1 AND profile_id=$2 AND deleted_at IS NULL FOR SHARE`,
        [input.installationAddressId, input.profileId]
      )
    ).rows[0];
    if (!address) throw new BadRequestException('Choose an address belonging to this profile');
    const vatRates: number[] = [];
    for (const [index, product] of [plan, hardware].entries()) {
      const override = (
        await client.query<{ rate: number }>(
          `SELECT vc.rate FROM product_vat_overrides pvo JOIN vat_configurations vc ON vc.id=pvo.vat_config_id
          WHERE pvo.product_id=$1 AND pvo.effective_from<=$2
            AND (pvo.effective_until IS NULL OR pvo.effective_until>$2)
          ORDER BY pvo.effective_from DESC LIMIT 1`,
          [product.id, now]
        )
      ).rows[0];
      if (override) {
        vatRates.push(override.rate);
        continue;
      }
      const category = (
        await client.query<{ rate: number }>(
          `SELECT rate FROM vat_configurations WHERE category=$1 AND effective_from<=$2
          AND (effective_until IS NULL OR effective_until>$2)
          ORDER BY effective_from DESC LIMIT 1`,
          [index === 0 ? 'saving_plan' : 'hardware', now]
        )
      ).rows[0];
      vatRates.push(category?.rate ?? 0);
    }
    const lines: [SavingPriceLine, SavingPriceLine] = [
      {
        type: 'plan_price',
        productId: plan.id,
        title: plan.title,
        amountIrR: BigInt(plan.price),
        vatRateBps: vatRates[0]!,
      },
      {
        type: 'hardware_price',
        productId: hardware.id,
        title: hardware.title,
        amountIrR: BigInt(hardware.price),
        vatRateBps: vatRates[1]!,
      },
    ];
    const subtotal = lines[0].amountIrR + lines[1].amountIrR;
    const gift = await this.giftDiscount(client, input, subtotal, now);
    const totals = calculateSavingTotals(lines, gift.amount);
    const publicQuote = {
      plan: { id: plan.id, title: plan.title },
      hardware: { id: hardware.id, title: hardware.title },
      billIdentifier: input.billIdentifier,
      address,
      agreement: { versionId: agreement.id, title: agreement.title, body: agreement.body },
      lines: totals.lines.map((line) => ({
        type: line.type,
        productId: line.productId,
        title: line.title,
        amountIrR: line.amountIrR.toString(),
        discountIrR: line.discountIrR.toString(),
        netIrR: line.netIrR.toString(),
        vatRateBps: line.vatRateBps,
        vatIrR: line.vatIrR.toString(),
      })),
      subtotalIrR: totals.subtotalIrR.toString(),
      discountIrR: totals.discountIrR.toString(),
      vatIrR: totals.vatIrR.toString(),
      totalIrR: totals.totalIrR.toString(),
      giftCodeId: gift.id,
    };
    return {
      quote: {
        ...publicQuote,
        reviewDigest: createHash('sha256').update(JSON.stringify(publicQuote)).digest('hex'),
      },
      totals,
      agreement,
      address,
      gift,
    };
  }

  async quote(actor: Actor, input: SavingOrderInput) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.orders.lockOrderActor(client, actor);
      await this.authorize(client, actor, input.profileId);
      const result = await this.quoteInTransaction(client, input, new Date());
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return result.quote;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async verifyBill(actor: Actor, profileId: string, billIdentifier: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.orders.lockOrderActor(client, actor);
      await this.authorize(client, actor, profileId);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return this.billProvider.verify(billIdentifier);
  }

  async duplicate(actor: Actor, profileId: string, savingPlanId: string, billIdentifier: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.orders.lockOrderActor(client, actor);
      await this.authorize(client, actor, profileId);
      const existing = (
        await client.query<{ id: string; profile_id: string }>(
          `SELECT id,profile_id FROM saving_orders WHERE bill_identifier=$1 AND saving_plan_id=$2
          AND status IN ('submitted','awaiting_staff_review','approved','in_progress') LIMIT 1`,
          [billIdentifier, savingPlanId]
        )
      ).rows[0];
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return {
        duplicate: !!existing,
        existingOrderId: existing?.profile_id === profileId ? existing.id : null,
      };
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
      await this.orders.lockOrderActor(client, actor);
      if (!(await this.orders.mayManageOrders(client, actor.userId, profileId)))
        throw new NotFoundException('Profile not found');
      const rows = (
        await client.query(
          `SELECT s.id,s.order_id,s.bill_identifier,s.status,s.submitted_at,
                p.title AS plan_title,h.title AS hardware_title,
                i.id AS invoice_id,i.state AS invoice_state,i.total_amount::text AS total_amount,
                c.id AS contract_id,c.state AS contract_state
           FROM saving_orders s
           JOIN products p ON p.id=s.saving_plan_id
           JOIN products h ON h.id=s.hardware_product_id
           LEFT JOIN invoices i ON i.order_id=s.order_id AND i.type='auto'
           LEFT JOIN contracts c ON c.order_id=s.order_id AND c.service_type='savings'
          WHERE s.profile_id=$1 ORDER BY s.submitted_at DESC,s.id DESC LIMIT 100`,
          [profileId]
        )
      ).rows;
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return { orders: rows };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async detail(actor: Actor, savingOrderId: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.orders.lockOrderActor(client, actor);
      const row = (
        await client.query<{
          id: string;
          profile_id: string;
          order_id: string;
          status: string;
          bill_identifier: string;
          address_snapshot: unknown;
          pricing_snapshot: unknown;
          verification_result: unknown;
          agreement_version_id: string;
          agreement_snapshot: string;
          submitted_at: Date;
          invoice_id: string;
          invoice_state: string;
          contract_id: string;
          contract_version_id: string;
          contract_state: string;
        }>(
          `SELECT s.id,s.profile_id,s.order_id,s.status,s.bill_identifier,s.address_snapshot,
                s.pricing_snapshot,s.verification_result,s.agreement_version_id,s.agreement_snapshot,
                s.submitted_at,i.id AS invoice_id,i.state AS invoice_state,
                c.id AS contract_id,c.current_version_id AS contract_version_id,
                c.state AS contract_state
           FROM saving_orders s
           LEFT JOIN invoices i ON i.order_id=s.order_id AND i.type='auto'
           LEFT JOIN contracts c ON c.order_id=s.order_id AND c.service_type='savings'
          WHERE s.id=$1`,
          [savingOrderId]
        )
      ).rows[0];
      if (!row || !(await this.orders.mayManageOrders(client, actor.userId, row.profile_id)))
        throw new NotFoundException('Saving order not found');
      const stages = (
        await client.query(
          `SELECT stage,status,started_at,completed_at,explanation,handover_description FROM saving_fulfillment_stages
          WHERE order_id=$1 ORDER BY CASE stage
            WHEN 'request_confirmation' THEN 1 WHEN 'product_delivery' THEN 2
            WHEN 'installation_and_document_upload' THEN 3
            WHEN 'equipment_handover' THEN 4 ELSE 5 END`,
          [savingOrderId]
        )
      ).rows;
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return { ...row, stages };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async submit(actor: Actor, input: SavingSubmissionInput, ip = 'unknown') {
    const verification = process.env.SAVING_BILL_VERIFICATION_URL
      ? await this.verifyBill(actor, input.profileId, input.billIdentifier)
      : await this.billProvider.verify(input.billIdentifier);
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.orders.lockOrderActor(client, actor);
      const hash = requestHash(input);
      const previous = (
        await client.query<{ request_hash: string; response: unknown }>(
          'SELECT request_hash,response FROM saving_order_submissions WHERE user_id=$1 AND idempotency_key=$2',
          [actor.userId, input.idempotencyKey]
        )
      ).rows[0];
      if (previous) {
        if (previous.request_hash !== hash)
          throw new ConflictException('Idempotency key was used for another order');
        await requireCurrentSession(client, actor);
        await client.query('COMMIT');
        return previous.response;
      }
      await this.authorize(client, actor, input.profileId);
      // Acquire product locks before the quote's shared locks. Concurrent
      // submissions must not both upgrade a hardware share lock to a write lock.
      await client.query('SELECT id FROM products WHERE id=$1 FOR UPDATE', [input.savingPlanId]);
      await client.query('SELECT id FROM products WHERE id=$1 FOR UPDATE', [
        input.hardwareProductId,
      ]);
      const now = new Date();
      const { quote, totals, agreement, address, gift } = await this.quoteInTransaction(
        client,
        input,
        now
      );
      if (quote.reviewDigest !== input.expectedQuoteDigest)
        throw new ConflictException('Saving quote changed; review the current price and agreement');
      const duplicate = (
        await client.query<{ id: string }>(
          `SELECT id FROM saving_orders WHERE bill_identifier=$1 AND saving_plan_id=$2
          AND status IN ('submitted','awaiting_staff_review','approved','in_progress') LIMIT 1`,
          [input.billIdentifier, input.savingPlanId]
        )
      ).rows[0];
      if (duplicate)
        throw new ConflictException(`Active saving order already exists: ${duplicate.id}`);
      const orderId = uuidv7(),
        savingId = uuidv7(),
        contractId = uuidv7(),
        versionId = uuidv7(),
        invoiceId = uuidv7();
      await client.query(
        `INSERT INTO orders(id,user_id,profile_id,product_id,order_type,status,
                            snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code)
         VALUES($1,$2,$3,$4,'savings','PENDING',$5,$6,$7,$8)`,
        [
          orderId,
          actor.userId,
          input.profileId,
          input.savingPlanId,
          address.province_id,
          address.city_id,
          address.full_address,
          address.postal_code,
        ]
      );
      if (input.giftCode && gift.id) {
        const redeemed = await this.giftCodes.redeem(
          {
            giftCode: input.giftCode,
            profileId: input.profileId,
            orderId,
            orderAmount: totals.subtotalIrR.toString(),
            category: 'saving_plan',
            actorUserId: actor.userId,
            ip,
          },
          client
        );
        if (redeemed.giftCodeId !== gift.id || BigInt(redeemed.discountAmount) !== gift.amount)
          throw new ConflictException('Gift code changed during submission');
        await client.query(
          'UPDATE orders SET gift_code_id=$2,gift_discount_amount=$3 WHERE id=$1',
          [orderId, gift.id, gift.amount.toString()]
        );
      }
      await client.query(
        `INSERT INTO saving_orders(id,order_id,profile_id,saving_plan_id,hardware_product_id,
          bill_identifier,installation_address_id,agreement_version_id,agreement_snapshot,
          address_snapshot,pricing_snapshot,verification_result,status,submitted_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,'awaiting_staff_review',$13)`,
        [
          savingId,
          orderId,
          input.profileId,
          input.savingPlanId,
          input.hardwareProductId,
          input.billIdentifier,
          input.installationAddressId,
          agreement.id,
          agreement.body,
          JSON.stringify(address),
          JSON.stringify(quote),
          JSON.stringify(verification),
          now,
        ]
      );
      const financialLines = [
        {
          type: 'plan_price',
          description: quote.plan.title.fa,
          amount: totals.lines[0]!.amountIrR,
        },
        {
          type: 'hardware_price',
          description: quote.hardware.title.fa,
          amount: totals.lines[1]!.amountIrR,
        },
        { type: 'discount', description: 'تخفیف', amount: -totals.discountIrR },
        { type: 'vat', description: 'مالیات بر ارزش افزوده', amount: totals.vatIrR },
      ];
      for (const line of financialLines)
        await client.query(
          'INSERT INTO saving_order_lines(id,order_id,description,amount,type) VALUES($1,$2,$3,$4,$5)',
          [uuidv7(), savingId, line.description, line.amount.toString(), line.type]
        );
      for (const stage of [
        'request_confirmation',
        'product_delivery',
        'installation_and_document_upload',
        'equipment_handover',
        'process_completion',
      ])
        await client.query(
          'INSERT INTO saving_fulfillment_stages(id,order_id,stage) VALUES($1,$2,$3)',
          [uuidv7(), savingId, stage]
        );
      await client.query(
        `INSERT INTO contracts(id,profile_id,order_id,service_type,state,current_version_id)
         VALUES($1,$2,$3,'savings','Draft',$4)`,
        [contractId, input.profileId, orderId, versionId]
      );
      await client.query(
        `INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by)
         VALUES($1,$2,1,$3::jsonb,'Initial saving order',$4)`,
        [
          versionId,
          contractId,
          JSON.stringify({
            savingOrderId: savingId,
            quote,
            agreement: {
              versionId: agreement.id,
              title: agreement.title,
              body: agreement.body,
            },
            address,
          }),
          actor.userId,
        ]
      );
      const due = await this.dueDates.resolve(client, {
        serviceType: 'saving_plan',
        issuedAt: now,
      });
      await client.query(
        `INSERT INTO invoices(id,profile_id,order_id,contract_id,type,state,total_amount,due_at,
                              metadata,invoice_calculation_snapshot)
         VALUES($1,$2,$3,$4,'auto','Draft',$5,$6,$7::jsonb,$8::jsonb)`,
        [
          invoiceId,
          input.profileId,
          orderId,
          contractId,
          totals.totalIrR.toString(),
          due.dueAt,
          JSON.stringify({ source: 'saving_order', due }),
          JSON.stringify(quote),
        ]
      );
      for (const [index, line] of totals.lines.entries()) {
        await client.query(
          `INSERT INTO invoice_lines(id,invoice_id,description,quantity,unit_price,line_total,
                                     vat_rate,vat_amount,is_taxable,position)
           VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9)`,
          [
            uuidv7(),
            invoiceId,
            line.title.fa,
            line.amountIrR.toString(),
            line.netIrR.toString(),
            line.vatRateBps,
            line.vatIrR.toString(),
            line.vatRateBps > 0,
            index,
          ]
        );
        await client.query(
          `INSERT INTO invoice_items(id,invoice_id,product_id,product_title,quantity,unit_price,vat_rate)
           VALUES($1,$2,$3,$4::jsonb,1,$5,$6)`,
          [
            uuidv7(),
            invoiceId,
            line.productId,
            JSON.stringify(line.title),
            line.amountIrR.toString(),
            line.vatRateBps,
          ]
        );
      }
      await this.invoiceStates.transition(invoiceId, 'Draft', 'Unpaid', {
        actorUserId: actor.userId,
        now,
        ip,
        client,
      });
      const requirement = await client.query(
        `UPDATE contract_activation_requirements SET initial_invoice_id=$2
          WHERE version_id=$1 AND contract_id=$3`,
        [versionId, invoiceId, contractId]
      );
      if (requirement.rowCount !== 1)
        throw new ConflictException('Contract activation requirements are unavailable');
      await client.query(
        "UPDATE contracts SET state='AwaitingStaffReview',submitted_at=$2 WHERE id=$1",
        [contractId, now]
      );
      const response = { savingOrderId: savingId, orderId, contractId, invoiceId, ...quote };
      await client.query(
        `INSERT INTO saving_order_submissions(id,user_id,idempotency_key,request_hash,order_id,response)
         VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
        [uuidv7(), actor.userId, input.idempotencyKey, hash, savingId, JSON.stringify(response)]
      );
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
         VALUES($1,$2,'order_created',$3::jsonb,$4,$5)`,
        [
          uuidv7(),
          actor.userId,
          JSON.stringify({
            orderId,
            savingOrderId: savingId,
            profileId: input.profileId,
            status: 'awaiting_staff_review',
          }),
          uuidv7(),
          ip,
        ]
      );
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException('An active saving order already exists for this bill and plan');
      if (
        (error as { code?: string; message?: string }).code === '23514' &&
        (error as Error).message.includes('Saving hardware is out of stock')
      )
        throw new ConflictException('Selected saving hardware is out of stock');
      throw error;
    } finally {
      client.release();
    }
  }
}
