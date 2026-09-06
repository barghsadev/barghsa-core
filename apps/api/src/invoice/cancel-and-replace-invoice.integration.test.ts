/**
 * Real-PostgreSQL integration tests for CancelAndReplaceInvoiceService
 * (T-04.1.05.02).
 *
 * Proves against actual PostgreSQL:
 *   1. Unpaid invoice with paid_amount = 0 is cancelled and a linked
 *      replacement is issued with `replaces_invoice_id` set.
 *   2. New lines persist with computed totals / VAT / position.
 *   3. Confirmed payment is rejected and leaves the original untouched.
 *   4. Errors roll back both the cancel and the replacement insert.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db';
import { CancelAndReplaceInvoiceService } from './cancel-and-replace-invoice.service.js';
import { InvoiceStateMachineService } from './invoice-state-machine.service.js';
import { InvoiceAuditRepository } from './invoice-audit.repository.js';
import { DueAtCalculationRepository } from './due-at.repository.js';
import { DueAtCalculationService } from './due-at.service.js';

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
const ACTOR_USER_ID = 'staff-cancel-replace';
const ISSUED = new Date('2026-08-01T10:00:00.000Z');
const DUE = new Date('2026-08-08T10:00:00.000Z');
const NOW = new Date('2026-08-02T12:00:00.000Z');

describe('CancelAndReplaceInvoiceService — real PostgreSQL (T-04.1.05.02)', () => {
  let ctx: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let service: CancelAndReplaceInvoiceService;

  beforeAll(async () => {
    ctx = await createMigratedTestDb();
    poolHolder.pool = ctx.pool;
    service = new CancelAndReplaceInvoiceService(
      new InvoiceStateMachineService(new InvoiceAuditRepository()),
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
    /** Explicit order id. `null` = no order. Omit to create a fresh order. */
    orderId?: string | null;
  }): Promise<string> {
    const id = uuidv7();
    let orderId: string | null;
    if (opts.orderId === undefined) {
      orderId = uuidv7();
      await insertOrder(orderId);
    } else {
      orderId = opts.orderId;
    }
    await ctx.pool.query(
      `INSERT INTO invoices
         (id, profile_id, order_id, type, state, total_amount, paid_amount,
          issued_at, payable_from, due_at, metadata)
       VALUES ($1, $2, $3, $4, $5, 1090000, $6, $7, $7, $8, $9::jsonb)`,
      [
        id,
        PROFILE_ID,
        orderId,
        opts.type ?? 'auto',
        opts.state,
        opts.paidAmount ?? 0n,
        ISSUED,
        DUE,
        JSON.stringify({ source: opts.type ?? 'auto' }),
      ]
    );
    return id;
  }

  it('cancels an unpaid invoice and issues a linked replacement', async () => {
    const originalId = await insertInvoice({ state: 'Unpaid' });

    const result = await service.cancelAndReplaceInvoice({
      invoiceId: originalId,
      reason: 'Quantity was billed as 1 instead of 2',
      newLines: [
        { description: 'برق مصرفی — اصلاح شده', quantity: 2, unitPrice: 500_000n, vatRate: 900 },
        {
          description: 'کارمزد اداری',
          quantity: 1,
          unitPrice: 50_000n,
          vatRate: 0,
          isTaxable: false,
        },
      ],
      actorUserId: ACTOR_USER_ID,
      correlationId: 'corr-replace-01',
      ip: '10.0.0.4',
      now: NOW,
    });

    // 2 × 500,000 = 1,000,000 + VAT 90,000; 50,000 non-taxable
    expect(result.totalAmount).toBe(1_140_000n);
    expect(result.originalInvoiceId).toBe(originalId);
    expect(result.originalState).toBe('Cancelled');
    expect(result.replacesInvoiceId).toBe(originalId);
    expect(result.replacementState).toBe('Unpaid');
    const originalOrder = await ctx.pool.query<{ order_id: string | null }>(
      `SELECT order_id FROM invoices WHERE id = $1`,
      [originalId]
    );
    expect(result.orderId).toBe(originalOrder.rows[0]!.order_id);
    expect(result.orderId).not.toBeNull();
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]!.vatAmount).toBe(90_000n);
    expect(result.lines[1]!.vatAmount).toBe(0n);
    expect(result.issuedAt.toISOString()).toBe(NOW.toISOString());

    const original = await ctx.pool.query<{
      state: string;
      cancelled_at: Date | null;
      paid_amount: string;
      metadata: Record<string, unknown>;
    }>(`SELECT state, cancelled_at, paid_amount, metadata FROM invoices WHERE id = $1`, [
      originalId,
    ]);
    expect(original.rows[0]!.state).toBe('Cancelled');
    expect(original.rows[0]!.cancelled_at).not.toBeNull();
    expect(original.rows[0]!.paid_amount).toBe('0');
    expect(original.rows[0]!.metadata.replacedByInvoiceId).toBe(result.replacementInvoiceId);
    expect(original.rows[0]!.metadata.replacementReason).toBe(
      'Quantity was billed as 1 instead of 2'
    );

    const replacement = await ctx.pool.query<{
      state: string;
      type: string | null;
      replaces_invoice_id: string | null;
      order_id: string | null;
      invoice_calculation_snapshot: { source: string; totals: { totalAmount: string } };
    }>(
      `SELECT state, type, replaces_invoice_id, order_id, invoice_calculation_snapshot
         FROM invoices WHERE id = $1`,
      [result.replacementInvoiceId]
    );
    expect(replacement.rows[0]!.state).toBe('Unpaid');
    expect(replacement.rows[0]!.type).toBe('manual');
    expect(replacement.rows[0]!.replaces_invoice_id).toBe(originalId);
    expect(replacement.rows[0]!.order_id).toBe(result.orderId);
    expect(replacement.rows[0]!.invoice_calculation_snapshot.totals.totalAmount).toBe('1140000');

    const cancelAudit = await ctx.pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM audit_log
        WHERE event = 'invoice.cancel'
          AND metadata::jsonb ->> 'invoiceId' = $1`,
      [originalId]
    );
    expect(cancelAudit.rows[0]!.n).toBe(1);

    const issueAudit = await ctx.pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM audit_log
        WHERE event = 'invoice.issue'
          AND metadata::jsonb ->> 'invoiceId' = $1`,
      [result.replacementInvoiceId]
    );
    expect(issueAudit.rows[0]!.n).toBe(1);
  });

  it('replaces an Overdue unpaid invoice', async () => {
    const originalId = await insertInvoice({ state: 'Overdue' });
    const result = await service.cancelAndReplaceInvoice({
      invoiceId: originalId,
      reason: 'Correct overdue invoice before payment',
      newLines: [
        { description: 'اصلاح', quantity: 1, unitPrice: 100_000n, vatRate: 0, isTaxable: false },
      ],
      actorUserId: ACTOR_USER_ID,
      now: NOW,
    });
    expect(result.originalState).toBe('Cancelled');
    expect(result.replacementState).toBe('Unpaid');
    expect(result.replacesInvoiceId).toBe(originalId);
  });

  it('rejects a missing invoice', async () => {
    await expect(
      service.cancelAndReplaceInvoice({
        invoiceId: uuidv7(),
        reason: 'Does not exist',
        newLines: [
          { description: 'x', quantity: 1, unitPrice: 1000n, vatRate: 0, isTaxable: false },
        ],
        actorUserId: ACTOR_USER_ID,
      })
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a paid invoice and leaves it unchanged', async () => {
    const originalId = await insertInvoice({
      state: 'PartiallyFunded',
      paidAmount: 100_000n,
    });

    await expect(
      service.cancelAndReplaceInvoice({
        invoiceId: originalId,
        reason: 'Tried to replace after payment',
        newLines: [
          { description: 'x', quantity: 1, unitPrice: 1000n, vatRate: 0, isTaxable: false },
        ],
        actorUserId: ACTOR_USER_ID,
        now: NOW,
      })
    ).rejects.toThrow(ConflictException);

    const original = await ctx.pool.query<{
      state: string;
      paid_amount: string;
      cancelled_at: Date | null;
    }>(`SELECT state, paid_amount, cancelled_at FROM invoices WHERE id = $1`, [originalId]);
    expect(original.rows[0]!.state).toBe('PartiallyFunded');
    expect(original.rows[0]!.paid_amount).toBe('100000');
    expect(original.rows[0]!.cancelled_at).toBeNull();

    const extras = await ctx.pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM invoices WHERE replaces_invoice_id = $1`,
      [originalId]
    );
    expect(extras.rows[0]!.n).toBe(0);
  });

  it('does not write when the reason is empty', async () => {
    const originalId = await insertInvoice({ state: 'Unpaid' });
    await expect(
      service.cancelAndReplaceInvoice({
        invoiceId: originalId,
        reason: '  ',
        newLines: [
          { description: 'x', quantity: 1, unitPrice: 1000n, vatRate: 0, isTaxable: false },
        ],
        actorUserId: ACTOR_USER_ID,
      })
    ).rejects.toThrow();

    const original = await ctx.pool.query<{ state: string }>(
      `SELECT state FROM invoices WHERE id = $1`,
      [originalId]
    );
    expect(original.rows[0]!.state).toBe('Unpaid');
  });

  it('rolls back cancellation, replacement and audits when issuing the replacement fails', async () => {
    const originalId = await insertInvoice({ state: 'Unpaid' });
    await ctx.pool.query(
      "CREATE FUNCTION reject_replacement_issue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test replacement issue audit failure'; END $$; CREATE TRIGGER reject_replacement_issue BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event='invoice.issue') EXECUTE FUNCTION reject_replacement_issue()"
    );
    try {
      await expect(
        service.cancelAndReplaceInvoice({
          invoiceId: originalId,
          reason: 'Corrected lines',
          newLines: [
            { description: 'x', quantity: 1, unitPrice: 1000n, vatRate: 0, isTaxable: false },
          ],
          actorUserId: ACTOR_USER_ID,
          now: NOW,
        })
      ).rejects.toThrow('test replacement issue audit failure');
      expect(
        (
          await ctx.pool.query('SELECT state,cancelled_at,metadata FROM invoices WHERE id=$1', [
            originalId,
          ])
        ).rows[0]
      ).toMatchObject({ state: 'Unpaid', cancelled_at: null, metadata: { source: 'auto' } });
      expect(
        (await ctx.pool.query('SELECT id FROM invoices WHERE replaces_invoice_id=$1', [originalId]))
          .rows
      ).toHaveLength(0);
      expect(
        (
          await ctx.pool.query("SELECT id FROM audit_log WHERE metadata::jsonb->>'invoiceId'=$1", [
            originalId,
          ])
        ).rows
      ).toHaveLength(0);
    } finally {
      await ctx.pool.query('DROP TRIGGER reject_replacement_issue ON audit_log');
    }
  });

  it('rejects revoked invoice authority after waiting and leaves the correction chain unchanged', async () => {
    const originalId = await insertInvoice({ state: 'Unpaid' });
    const client = await ctx.pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await client.query('BEGIN');
      await client.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [ACTOR_USER_ID]);
      pending = service
        .cancelAndReplaceInvoice({
          invoiceId: originalId,
          reason: 'Corrected lines',
          newLines: [{ description: 'x', quantity: 1, unitPrice: 1000n, vatRate: 0 }],
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
        (await ctx.pool.query('SELECT state,cancelled_at FROM invoices WHERE id=$1', [originalId]))
          .rows[0]
      ).toEqual({ state: 'Unpaid', cancelled_at: null });
      expect(
        (await ctx.pool.query('SELECT id FROM invoices WHERE replaces_invoice_id=$1', [originalId]))
          .rows
      ).toHaveLength(0);
      expect(
        (
          await ctx.pool.query("SELECT id FROM audit_log WHERE metadata::jsonb->>'invoiceId'=$1", [
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
  });

  it('replaces an order-linked original of type manual without unique-index collision', async () => {
    const orderId = uuidv7();
    await insertOrder(orderId);
    const originalId = await insertInvoice({
      state: 'Unpaid',
      type: 'manual',
      orderId,
    });

    const result = await service.cancelAndReplaceInvoice({
      invoiceId: originalId,
      reason: 'Correct order-linked manual invoice',
      newLines: [
        {
          description: 'اصلاح دستی',
          quantity: 1,
          unitPrice: 250_000n,
          vatRate: 0,
          isTaxable: false,
        },
      ],
      actorUserId: ACTOR_USER_ID,
      now: NOW,
    });

    expect(result.originalState).toBe('Cancelled');
    expect(result.replacementState).toBe('Unpaid');
    expect(result.orderId).toBe(orderId);
    expect(result.replacesInvoiceId).toBe(originalId);

    const replacement = await ctx.pool.query<{
      type: string | null;
      order_id: string | null;
      replaces_invoice_id: string | null;
    }>(`SELECT type, order_id, replaces_invoice_id FROM invoices WHERE id = $1`, [
      result.replacementInvoiceId,
    ]);
    expect(replacement.rows[0]!.type).toBe('manual');
    expect(replacement.rows[0]!.order_id).toBe(orderId);
    expect(replacement.rows[0]!.replaces_invoice_id).toBe(originalId);
  });

  it('replaces an auto invoice when the order already has another manual invoice', async () => {
    const orderId = uuidv7();
    await insertOrder(orderId);
    const siblingManualId = await insertInvoice({
      state: 'Unpaid',
      type: 'manual',
      orderId,
    });
    const originalId = await insertInvoice({
      state: 'Unpaid',
      type: 'auto',
      orderId,
    });

    const result = await service.cancelAndReplaceInvoice({
      invoiceId: originalId,
      reason: 'Correct auto invoice alongside existing manual invoice',
      newLines: [
        {
          description: 'اصلاح خودکار',
          quantity: 1,
          unitPrice: 300_000n,
          vatRate: 0,
          isTaxable: false,
        },
      ],
      actorUserId: ACTOR_USER_ID,
      now: NOW,
    });

    expect(result.originalState).toBe('Cancelled');
    expect(result.replacementState).toBe('Unpaid');
    expect(result.orderId).toBe(orderId);
    expect(result.replacesInvoiceId).toBe(originalId);

    const sibling = await ctx.pool.query<{ state: string; type: string | null }>(
      `SELECT state, type FROM invoices WHERE id = $1`,
      [siblingManualId]
    );
    expect(sibling.rows[0]!.state).toBe('Unpaid');
    expect(sibling.rows[0]!.type).toBe('manual');

    const replacement = await ctx.pool.query<{
      type: string | null;
      order_id: string | null;
      replaces_invoice_id: string | null;
    }>(`SELECT type, order_id, replaces_invoice_id FROM invoices WHERE id = $1`, [
      result.replacementInvoiceId,
    ]);
    expect(replacement.rows[0]!.type).toBe('manual');
    expect(replacement.rows[0]!.order_id).toBe(orderId);
    expect(replacement.rows[0]!.replaces_invoice_id).toBe(originalId);
  });
});
