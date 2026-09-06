/**
 * Real-PostgreSQL integration tests for CreateAdjustmentInvoiceService
 * (T-04.1.05.03).
 *
 * Proves against actual PostgreSQL:
 *   1. Paid invoice receives a linked additional-charge invoice with
 *      `adjustment_for_invoice_id` set; original state/lines/amounts
 *      are unchanged.
 *   2. Negative amount stores a credit note (`adjustment_kind='credit'`,
 *      negative `accounting_amount`, null due_at/payable_from) that
 *      reduces net customer liability and cannot enter PayFromWallet /
 *      SubmitBankReceipt.
 *   3. Unpaid originals are rejected and left untouched.
 *   4. Multiple adjustments on the same order-linked original do not
 *      collide with `uq_invoices_order_id_type`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db';
import { CreateAdjustmentInvoiceService } from './create-adjustment-invoice.service.js';
import { InvoiceStateMachineService } from './invoice-state-machine.service.js';
import { InvoiceAuditRepository } from './invoice-audit.repository.js';
import { DueAtCalculationRepository } from './due-at.repository.js';
import { DueAtCalculationService } from './due-at.service.js';
import {
  NET_CUSTOMER_LIABILITY_SELECT,
  UNPAID_CUSTOMER_INVOICE_PREDICATE,
} from '@barghsa/shared/finance';

const poolHolder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }));

vi.mock('@barghsa/db', () => ({
  getDbPool: () => {
    if (!poolHolder.pool) {
      throw new Error('test pool not initialized — beforeAll must run first');
    }
    return poolHolder.pool;
  },
}));

const PROFILE_ID = '33333333-3333-7333-8333-333333333333';
const ACTOR_USER_ID = 'staff-create-adjustment';
const ISSUED = new Date('2026-08-01T10:00:00.000Z');
const DUE = new Date('2026-08-08T10:00:00.000Z');
const NOW = new Date('2026-08-15T12:00:00.000Z');
const ORIGINAL_TOTAL = 1_090_000n;

describe('CreateAdjustmentInvoiceService — real PostgreSQL (T-04.1.05.03)', () => {
  let ctx: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let service: CreateAdjustmentInvoiceService;
  let stateMachine: InvoiceStateMachineService;

  beforeAll(async () => {
    ctx = await createMigratedTestDb();
    poolHolder.pool = ctx.pool;
    stateMachine = new InvoiceStateMachineService(new InvoiceAuditRepository());
    service = new CreateAdjustmentInvoiceService(
      stateMachine,
      new DueAtCalculationService(new DueAtCalculationRepository())
    );

    await ctx.pool.query(
      `INSERT INTO users (user_id, username, password_hash, is_staff)
      VALUES ($1, 'invoice-staff@example.test', 'test-only', true)`,
      [ACTOR_USER_ID]
    );
    await ctx.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES ($1,'role-finance')", [
      ACTOR_USER_ID,
    ]);
    await ctx.pool.query(`INSERT INTO profiles (id, user_id) VALUES ($1, $2)`, [
      PROFILE_ID,
      ACTOR_USER_ID,
    ]);
  }, 60_000);

  afterAll(async () => {
    poolHolder.pool = null;
    await ctx.close();
  });

  async function insertOrder(id: string) {
    const product = (
      await ctx.pool.query(`INSERT INTO products(type,title,price)
      VALUES ('electricity', '{"en":"Test electricity"}', 1000000) RETURNING id`)
    ).rows[0].id;
    await ctx.pool.query(
      `INSERT INTO orders(id,user_id,profile_id,product_id,order_type,
      snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code)
      VALUES ($1,$2,$3,$4,'electricity','test-province','test-city','Test address','1234567890')`,
      [id, ACTOR_USER_ID, PROFILE_ID, product]
    );
  }

  async function insertInvoice(opts: {
    state: string;
    paidAmount?: bigint;
    type?: string;
    orderId?: string | null;
    profileId?: string;
  }): Promise<string> {
    const id = uuidv7();
    let orderId: string | null;
    if (opts.orderId === undefined) {
      orderId = uuidv7();
      await insertOrder(orderId);
    } else {
      orderId = opts.orderId;
    }
    const paidAmount = opts.paidAmount ?? (opts.state === 'Paid' ? ORIGINAL_TOTAL : 0n);
    await ctx.pool.query(
      `INSERT INTO invoices
         (id, profile_id, order_id, type, state, total_amount, paid_amount,
          issued_at, payable_from, due_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10::jsonb)`,
      [
        id,
        opts.profileId ?? PROFILE_ID,
        orderId,
        opts.type ?? 'auto',
        opts.state,
        ORIGINAL_TOTAL,
        paidAmount,
        ISSUED,
        DUE,
        JSON.stringify({ source: opts.type ?? 'auto' }),
      ]
    );
    await ctx.pool.query(
      `INSERT INTO invoice_lines
         (id, invoice_id, description, quantity, unit_price, line_total,
          vat_rate, vat_amount, is_taxable, position)
       VALUES ($1, $2, $3, 1, $4, $4, 0, 0, false, 0)`,
      [uuidv7(), id, 'Original billed usage', ORIGINAL_TOTAL]
    );
    return id;
  }

  async function originalSnapshot(invoiceId: string) {
    const invoice = await ctx.pool.query<{
      state: string;
      total_amount: string;
      paid_amount: string;
      metadata: Record<string, unknown>;
    }>(`SELECT state, total_amount, paid_amount, metadata FROM invoices WHERE id = $1`, [
      invoiceId,
    ]);
    const lines = await ctx.pool.query<{
      description: string;
      line_total: string;
    }>(
      `SELECT description, line_total::text AS line_total
         FROM invoice_lines WHERE invoice_id = $1 ORDER BY position`,
      [invoiceId]
    );
    return { invoice: invoice.rows[0]!, lines: lines.rows };
  }

  it('creates a linked additional-charge invoice without editing the original', async () => {
    const originalId = await insertInvoice({ state: 'Paid' });
    const before = await originalSnapshot(originalId);

    const result = await service.createAdjustmentInvoice({
      originalInvoiceId: originalId,
      amount: 250_000n,
      reason: 'Post-payment quantity increase',
      actorUserId: ACTOR_USER_ID,
      correlationId: 'corr-adj-charge-01',
      ip: '10.0.0.4',
      now: NOW,
    });

    expect(result.kind).toBe('charge');
    expect(result.amount).toBe(250_000n);
    expect(result.totalAmount).toBe(250_000n);
    expect(result.accountingAmount).toBe(250_000n);
    expect(result.originalInvoiceId).toBe(originalId);
    expect(result.originalState).toBe('Paid');
    expect(result.adjustmentForInvoiceId).toBe(originalId);
    expect(result.adjustmentState).toBe('Unpaid');
    expect(result.dueAt).not.toBeNull();
    expect(result.payableFrom).not.toBeNull();
    expect(result.issuedAt.toISOString()).toBe(NOW.toISOString());
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]!.lineTotal).toBe(250_000n);
    expect(result.lines[0]!.vatAmount).toBe(0n);
    expect(result.lines[0]!.isTaxable).toBe(false);

    const after = await originalSnapshot(originalId);
    expect(after.invoice.state).toBe('Paid');
    expect(after.invoice.total_amount).toBe(before.invoice.total_amount);
    expect(after.invoice.paid_amount).toBe(before.invoice.paid_amount);
    expect(after.lines).toEqual(before.lines);
    expect(after.invoice.metadata.adjustedByInvoiceIds).toEqual([result.adjustmentInvoiceId]);

    const adjustment = await ctx.pool.query<{
      state: string;
      type: string | null;
      total_amount: string;
      accounting_amount: string;
      adjustment_kind: string | null;
      adjustment_for_invoice_id: string | null;
      replaces_invoice_id: string | null;
      order_id: string | null;
      due_at: Date | null;
      invoice_calculation_snapshot: { source: string; totals: { totalAmount: string } };
      metadata: { kind: string; amount: string };
    }>(
      `SELECT state, type, total_amount, accounting_amount, adjustment_kind,
              adjustment_for_invoice_id,
              replaces_invoice_id, order_id, due_at, invoice_calculation_snapshot,
              metadata
         FROM invoices WHERE id = $1`,
      [result.adjustmentInvoiceId]
    );
    expect(adjustment.rows[0]!.state).toBe('Unpaid');
    expect(adjustment.rows[0]!.type).toBe('manual');
    expect(adjustment.rows[0]!.total_amount).toBe('250000');
    expect(adjustment.rows[0]!.accounting_amount).toBe('250000');
    expect(adjustment.rows[0]!.adjustment_kind).toBe('charge');
    expect(adjustment.rows[0]!.adjustment_for_invoice_id).toBe(originalId);
    expect(adjustment.rows[0]!.replaces_invoice_id).toBeNull();
    expect(adjustment.rows[0]!.order_id).toBe(result.orderId);
    expect(adjustment.rows[0]!.due_at).not.toBeNull();
    expect(adjustment.rows[0]!.invoice_calculation_snapshot.totals.totalAmount).toBe('250000');
    expect(adjustment.rows[0]!.metadata.kind).toBe('charge');
    expect(adjustment.rows[0]!.metadata.amount).toBe('250000');

    const issueAudit = await ctx.pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM audit_log
        WHERE event = 'invoice.issue'
          AND metadata::jsonb ->> 'invoiceId' = $1`,
      [result.adjustmentInvoiceId]
    );
    expect(issueAudit.rows[0]!.n).toBe(1);
  });

  it('creates a linked credit that reduces net liability and cannot be paid', async () => {
    const liabilityProfileId = uuidv7();
    await ctx.pool.query(`INSERT INTO profiles (id, user_id) VALUES ($1, $2)`, [
      liabilityProfileId,
      ACTOR_USER_ID,
    ]);

    const unpaidSiblingId = await insertInvoice({
      state: 'Unpaid',
      paidAmount: 0n,
      profileId: liabilityProfileId,
    });
    const originalId = await insertInvoice({
      state: 'Paid',
      profileId: liabilityProfileId,
    });
    const beforeLiability = await ctx.pool.query<{ net: string }>(
      `SELECT ${NET_CUSTOMER_LIABILITY_SELECT} AS net
         FROM invoices WHERE profile_id = $1`,
      [liabilityProfileId]
    );
    expect(beforeLiability.rows[0]!.net).toBe(ORIGINAL_TOTAL.toString());

    const result = await service.createAdjustmentInvoice({
      originalInvoiceId: originalId,
      amount: -80_000n,
      reason: 'Overbilled usage credit',
      actorUserId: ACTOR_USER_ID,
      now: NOW,
    });

    expect(result.kind).toBe('credit');
    expect(result.amount).toBe(-80_000n);
    expect(result.totalAmount).toBe(80_000n);
    expect(result.accountingAmount).toBe(-80_000n);
    expect(result.dueAt).toBeNull();
    expect(result.payableFrom).toBeNull();
    expect(result.adjustmentState).toBe('Unpaid');
    expect(result.originalState).toBe('Paid');

    const adjustment = await ctx.pool.query<{
      total_amount: string;
      accounting_amount: string;
      adjustment_kind: string | null;
      due_at: Date | null;
      payable_from: Date | null;
      metadata: { kind: string; amount: string };
    }>(
      `SELECT total_amount, accounting_amount, adjustment_kind, due_at,
              payable_from, metadata
         FROM invoices WHERE id = $1`,
      [result.adjustmentInvoiceId]
    );
    expect(adjustment.rows[0]!.total_amount).toBe('80000');
    expect(adjustment.rows[0]!.accounting_amount).toBe('-80000');
    expect(adjustment.rows[0]!.adjustment_kind).toBe('credit');
    expect(adjustment.rows[0]!.due_at).toBeNull();
    expect(adjustment.rows[0]!.payable_from).toBeNull();
    expect(adjustment.rows[0]!.metadata.kind).toBe('credit');
    expect(adjustment.rows[0]!.metadata.amount).toBe('-80000');

    const unpaidCount = await ctx.pool.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt
         FROM invoices
        WHERE profile_id = $1 AND ${UNPAID_CUSTOMER_INVOICE_PREDICATE}`,
      [liabilityProfileId]
    );
    expect(unpaidCount.rows[0]!.cnt).toBe(1);

    const afterLiability = await ctx.pool.query<{ net: string }>(
      `SELECT ${NET_CUSTOMER_LIABILITY_SELECT} AS net
         FROM invoices WHERE profile_id = $1`,
      [liabilityProfileId]
    );
    expect(afterLiability.rows[0]!.net).toBe((ORIGINAL_TOTAL - 80_000n).toString());

    await expect(
      stateMachine.transition(result.adjustmentInvoiceId, 'Unpaid', 'Paid', {
        actorUserId: ACTOR_USER_ID,
        now: NOW,
      })
    ).rejects.toThrow(BadRequestException);

    await expect(
      stateMachine.transition(result.adjustmentInvoiceId, 'Unpaid', 'PaymentUnderReview', {
        actorUserId: ACTOR_USER_ID,
        now: NOW,
      })
    ).rejects.toThrow(BadRequestException);

    const stillUnpaid = await ctx.pool.query<{ state: string }>(
      `SELECT state FROM invoices WHERE id = $1`,
      [result.adjustmentInvoiceId]
    );
    expect(stillUnpaid.rows[0]!.state).toBe('Unpaid');
    expect(unpaidSiblingId).toBeTruthy();
  });

  it('rejects an unpaid invoice and leaves it untouched', async () => {
    const originalId = await insertInvoice({ state: 'Unpaid', paidAmount: 0n });
    const before = await originalSnapshot(originalId);

    await expect(
      service.createAdjustmentInvoice({
        originalInvoiceId: originalId,
        amount: 10_000n,
        reason: 'Should not apply',
        actorUserId: ACTOR_USER_ID,
        now: NOW,
      })
    ).rejects.toThrow(ConflictException);

    const after = await originalSnapshot(originalId);
    expect(after.invoice.state).toBe('Unpaid');
    expect(after.invoice.metadata).toEqual(before.invoice.metadata);
    expect(after.lines).toEqual(before.lines);

    const extras = await ctx.pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM invoices WHERE adjustment_for_invoice_id = $1`,
      [originalId]
    );
    expect(extras.rows[0]!.n).toBe(0);
  });

  it('throws NotFoundException for a missing original', async () => {
    await expect(
      service.createAdjustmentInvoice({
        originalInvoiceId: '00000000-0000-7000-8000-000000000099',
        amount: 10_000n,
        reason: 'Missing original',
        actorUserId: ACTOR_USER_ID,
        now: NOW,
      })
    ).rejects.toThrow(NotFoundException);
  });

  it('allows two adjustments on the same order-linked paid original', async () => {
    const orderId = uuidv7();
    await insertOrder(orderId);
    const originalId = await insertInvoice({
      state: 'Paid',
      type: 'manual',
      orderId,
    });

    const charge = await service.createAdjustmentInvoice({
      originalInvoiceId: originalId,
      amount: 40_000n,
      reason: 'First additional charge',
      actorUserId: ACTOR_USER_ID,
      now: NOW,
    });
    const credit = await service.createAdjustmentInvoice({
      originalInvoiceId: originalId,
      amount: -15_000n,
      reason: 'Follow-up credit',
      actorUserId: ACTOR_USER_ID,
      now: NOW,
    });

    expect(charge.orderId).toBe(orderId);
    expect(credit.orderId).toBe(orderId);
    expect(charge.kind).toBe('charge');
    expect(credit.kind).toBe('credit');

    const after = await originalSnapshot(originalId);
    expect(after.invoice.state).toBe('Paid');
    expect(after.invoice.metadata.adjustedByInvoiceIds).toEqual([
      charge.adjustmentInvoiceId,
      credit.adjustmentInvoiceId,
    ]);
  });
  it.each([1000n, -1000n])(
    'rolls back a %s adjustment when its issue audit fails',
    async (amount) => {
      const originalId = await insertInvoice({ state: 'Paid', paidAmount: ORIGINAL_TOTAL });
      const before = (await ctx.pool.query('SELECT * FROM invoices WHERE id=$1', [originalId]))
        .rows[0];
      await ctx.pool.query(
        "CREATE OR REPLACE FUNCTION reject_adjustment_issue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test adjustment audit failure'; END $$; CREATE TRIGGER reject_adjustment_issue BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event='invoice.issue') EXECUTE FUNCTION reject_adjustment_issue()"
      );
      try {
        await expect(
          service.createAdjustmentInvoice({
            originalInvoiceId: originalId,
            amount,
            reason: 'Correction',
            actorUserId: ACTOR_USER_ID,
            now: NOW,
          })
        ).rejects.toThrow('test adjustment audit failure');
        expect(
          (await ctx.pool.query('SELECT * FROM invoices WHERE id=$1', [originalId])).rows[0]
        ).toEqual(before);
        expect(
          (
            await ctx.pool.query('SELECT id FROM invoices WHERE adjustment_for_invoice_id=$1', [
              originalId,
            ])
          ).rows
        ).toHaveLength(0);
      } finally {
        await ctx.pool.query('DROP TRIGGER reject_adjustment_issue ON audit_log');
      }
    }
  );

  it.each([1000n, -1000n])(
    'rejects a %s adjustment after current invoice authority is revoked',
    async (amount) => {
      const originalId = await insertInvoice({ state: 'Paid', paidAmount: ORIGINAL_TOTAL });
      const before = (await ctx.pool.query('SELECT * FROM invoices WHERE id=$1', [originalId]))
        .rows[0];
      const client = await ctx.pool.connect();
      let pending: Promise<unknown> | undefined;
      try {
        await client.query('BEGIN');
        await client.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [
          ACTOR_USER_ID,
        ]);
        pending = service
          .createAdjustmentInvoice({
            originalInvoiceId: originalId,
            amount,
            reason: 'Correction',
            actorUserId: ACTOR_USER_ID,
            now: NOW,
          })
          .then(
            (value) => value,
            (error) => error
          );
        await expect
          .poll(async () =>
            Number(
              (
                await ctx.pool.query(
                  "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%activation_pending%ORDER BY user_id FOR UPDATE%' "
                )
              ).rows[0].count
            )
          )
          .toBe(1);
        await client.query('DELETE FROM user_roles WHERE user_id=$1', [ACTOR_USER_ID]);
        await client.query('COMMIT');
        expect(await pending).toMatchObject({ status: 403 });
        expect(
          (await ctx.pool.query('SELECT * FROM invoices WHERE id=$1', [originalId])).rows[0]
        ).toEqual(before);
        expect(
          (
            await ctx.pool.query('SELECT id FROM invoices WHERE adjustment_for_invoice_id=$1', [
              originalId,
            ])
          ).rows
        ).toHaveLength(0);
      } finally {
        await client.query('ROLLBACK');
        client.release();
        await pending;
        await ctx.pool.query(
          "INSERT INTO user_roles(user_id,role_id) VALUES ($1,'role-finance') ON CONFLICT DO NOTHING",
          [ACTOR_USER_ID]
        );
      }
    }
  );
});
