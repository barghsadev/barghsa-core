/**
 * Real-PostgreSQL integration tests for ManualInvoiceService
 * (T-04.1.02.02).
 *
 * Runs the actual service against a Testcontainers-managed PostgreSQL 17
 * instance with all production migrations and proves:
 *
 *   1. Create + issue is ATOMIC: one BEGIN/COMMIT on a single connection.
 *   2. The invoice lands in `Unpaid` with issuedAt/payableFrom/dueAt set
 *      and the canonical `invoice.issue` audit entry written.
 *   3. Lines persist with computed lineTotal / vatAmount / position in
 *      staff entry order; a non-taxable line carries zero VAT.
 *   4. Half-up VAT rounding is applied at the line level.
 *   5. Idempotency: replay with the same key returns the same invoice.
 *   6. Errors roll back everything (no orphan Draft, no lines, no audit).
 *
 * Wiring: only `getDbPool()` is stubbed, handing the service the
 * fully migrated disposable database pool.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db';
import { ManualInvoiceService } from './manual-invoice.service.js';
import { InvoiceStateMachineService } from './invoice-state-machine.service.js';
import { InvoiceAuditRepository } from './invoice-audit.repository.js';
import { DueAtCalculationRepository } from './due-at.repository.js';
import { DueAtCalculationService } from './due-at.service.js';

// ---- Real-DB wiring ------------------------------------------------------
const poolHolder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }));

vi.mock('@barghsa/db', () => ({
  getDbPool: () => {
    if (!poolHolder.pool) {
      throw new Error('test pool not initialized — beforeAll must run first');
    }
    return poolHolder.pool;
  },
}));

// ---- Fixtures ------------------------------------------------------------

const PROFILE_ID = '22222222-2222-7222-8222-222222222222';
const ACTOR_USER_ID = 'staff-integration-manual';

describe('ManualInvoiceService — real PostgreSQL integration (T-04.1.02.02)', () => {
  let ctx: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let service: ManualInvoiceService;

  beforeAll(async () => {
    ctx = await createMigratedTestDb();
    poolHolder.pool = ctx.pool;
    service = new ManualInvoiceService(
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

  // ---- Helpers ------------------------------------------------------------

  async function countAuditRows(invoiceId: string): Promise<number> {
    const result = await ctx.db.execute<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM audit_log
       WHERE event = 'invoice.issue'
         AND metadata::jsonb ->> 'invoiceId' = '${invoiceId}'`
    );
    return result.rows[0]!.n;
  }

  it('creates and issues a manual invoice atomically with correct totals', async () => {
    const result = await service.createManualInvoice({
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      lines: [
        {
          description: 'برق مصرفی — دوره اردیبهشت',
          quantity: 2,
          unitPrice: 500_000n,
          vatRate: 900,
        },
        {
          description: 'کارمزد اداری (بدون مالیات)',
          quantity: 1,
          unitPrice: 100_000n,
          vatRate: 0,
          isTaxable: false,
        },
      ],
      correlationId: 'corr-manual-01',
      reason: 'Manual invoice for integration test',
      ip: '10.0.0.2',
    });

    // Line 1: 2 × 500,000 = 1,000,000 + VAT 90,000
    // Line 2: 1 × 100,000 = 100,000 + VAT 0 (non-taxable)
    expect(result.totalAmount).toBe(1_190_000n);
    expect(result.state).toBe('Unpaid');
    expect(result.contractId).toBeNull();
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]!.lineTotal).toBe(1_000_000n);
    expect(result.lines[0]!.vatAmount).toBe(90_000n);
    expect(result.lines[0]!.position).toBe(0);
    expect(result.lines[1]!.vatAmount).toBe(0n);
    expect(result.lines[1]!.position).toBe(1);
    expect(result.transition.transition).toBe('Issue');

    // --- Verify the stored invoice row
    const invoiceRow = await ctx.db.execute<{
      state: string;
      total_amount: string;
      issued_at: Date | null;
      payable_from: Date | null;
      due_at: Date | null;
    }>(`SELECT state, total_amount, issued_at, payable_from, due_at
        FROM invoices WHERE id = '${result.invoiceId}'`);
    expect(invoiceRow.rows[0]!.state).toBe('Unpaid');
    expect(invoiceRow.rows[0]!.total_amount).toBe('1190000');
    expect(invoiceRow.rows[0]!.issued_at).not.toBeNull();
    expect(invoiceRow.rows[0]!.payable_from).not.toBeNull();
    expect(invoiceRow.rows[0]!.due_at).not.toBeNull();

    // --- Calculation snapshot: inputs, rounding steps, totals
    const snapRow = await ctx.db.execute<{
      invoice_calculation_snapshot: {
        version: number;
        source: string;
        inputs: { lines: Array<{ unitPrice: string; vatRate: number }> };
        steps: Array<{ vat: { result: string; numerator: string } }>;
        totals: { totalAmount: string; totalVat: string; subtotal: string };
      } | null;
    }>(`SELECT invoice_calculation_snapshot FROM invoices WHERE id = '${result.invoiceId}'`);
    const snap = snapRow.rows[0]!.invoice_calculation_snapshot;
    expect(snap).not.toBeNull();
    expect(snap!.version).toBe(1);
    expect(snap!.source).toBe('manual');
    expect(snap!.inputs.lines).toHaveLength(2);
    expect(snap!.inputs.lines[0]!.unitPrice).toBe('500000');
    expect(snap!.inputs.lines[0]!.vatRate).toBe(900);
    expect(snap!.steps[0]!.vat.result).toBe('90000');
    expect(snap!.steps[0]!.vat.numerator).toBe('900000000');
    expect(snap!.totals.subtotal).toBe('1100000');
    expect(snap!.totals.totalVat).toBe('90000');
    expect(snap!.totals.totalAmount).toBe('1190000');

    // --- Exactly one canonical audit entry (invoice.issue)
    expect(await countAuditRows(result.invoiceId)).toBe(1);
  });

  it('applies half-up VAT rounding at the line level', async () => {
    const result = await service.createManualInvoice({
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      lines: [
        // 1 IRR at 50% → 0.5 → rounds up to 1
        { description: 'نیم تومان مالیات', quantity: 1, unitPrice: 1n, vatRate: 5000 },
      ],
    });

    expect(result.lines[0]!.vatAmount).toBe(1n);
    expect(result.totalAmount).toBe(2n);

    const stored = await ctx.db.execute<{ vat_amount: string; line_total: string }>(
      `SELECT vat_amount, line_total FROM invoice_lines WHERE invoice_id = '${result.invoiceId}'`
    );
    expect(stored.rows[0]!.vat_amount).toBe('1');
  });

  it('defaults dueAt to issuedAt + 7 days (fallback) unless overridden', async () => {
    const withDefault = await service.createManualInvoice({
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      lines: [{ description: 'x', quantity: 1, unitPrice: 10_000n, vatRate: 0 }],
    });
    const defaultDue = new Date(withDefault.dueAt!).getTime();
    const defaultIssued = new Date(withDefault.issuedAt).getTime();
    expect(defaultDue - defaultIssued).toBe(7 * 24 * 60 * 60 * 1000);

    const explicit = new Date('2027-01-01T00:00:00.000Z');
    const withOverride = await service.createManualInvoice({
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      lines: [{ description: 'y', quantity: 1, unitPrice: 10_000n, vatRate: 0 }],
      dueAt: explicit,
    });
    expect(new Date(withOverride.dueAt!).getTime()).toBe(explicit.getTime());
  });

  it('computes dueAt as issuedAt + service_due_periods default_days', async () => {
    await ctx.db.execute(
      `INSERT INTO service_due_periods
         (service_type, default_days, effective_from, created_by)
       VALUES ('manual', 14, '2026-01-01T00:00:00.000Z', '${ACTOR_USER_ID}')`
    );
    const issuedAt = new Date('2026-08-01T10:00:00.000Z');
    const result = await service.createManualInvoice({
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      now: issuedAt,
      lines: [{ description: 'config days', quantity: 1, unitPrice: 10_000n, vatRate: 0 }],
    });
    expect(new Date(result.dueAt!).getTime() - issuedAt.getTime()).toBe(14 * 24 * 60 * 60 * 1000);
    await ctx.db.execute(`DELETE FROM service_due_periods WHERE service_type = 'manual'`);
  });

  it('replays the same invoice when the idempotency key is reused', async () => {
    const first = await service.createManualInvoice({
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      idempotencyKey: 'manual-idem-001',
      lines: [{ description: 'idem', quantity: 1, unitPrice: 200_000n, vatRate: 900 }],
    });

    const second = await service.createManualInvoice({
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      idempotencyKey: 'manual-idem-001',
      lines: [{ description: 'idem', quantity: 1, unitPrice: 200_000n, vatRate: 900 }],
    });

    expect(second.invoiceId).toBe(first.invoiceId);
    // No duplicate invoice, no duplicate audit row
    const result = await ctx.db.execute<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM invoices WHERE id = '${first.invoiceId}'`
    );
    expect(result.rows[0]!.n).toBe(1);
    expect(await countAuditRows(first.invoiceId)).toBe(1);
    // The replay result still describes the same invoice
    expect(second.totalAmount).toBe(first.totalAmount);
  });

  it('throws BadRequestException for an invalid line list', async () => {
    await expect(
      service.createManualInvoice({
        profileId: PROFILE_ID,
        actorUserId: ACTOR_USER_ID,
        lines: [{ description: 'x', quantity: 0, unitPrice: 100n, vatRate: 0 }],
      })
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException for a missing profile and leaves no rows', async () => {
    const missing = '99999999-9999-7999-8999-999999999999';
    await expect(
      service.createManualInvoice({
        profileId: missing,
        actorUserId: ACTOR_USER_ID,
        lines: [{ description: 'x', quantity: 1, unitPrice: 100n, vatRate: 0 }],
      })
    ).rejects.toThrow(NotFoundException);

    const orphans = await ctx.db.execute<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM invoices WHERE profile_id = '${missing}'`
    );
    expect(orphans.rows[0]!.n).toBe(0);
  });

  it('rolls back every row when the audit insert fails mid-transaction', async () => {
    const before = {
      invoices: (await ctx.db.execute<{ n: number }>(`SELECT COUNT(*)::int AS n FROM invoices`))
        .rows[0]!.n,
      lines: (await ctx.db.execute<{ n: number }>(`SELECT COUNT(*)::int AS n FROM invoice_lines`))
        .rows[0]!.n,
      audit: (await ctx.db.execute<{ n: number }>(`SELECT COUNT(*)::int AS n FROM audit_log`))
        .rows[0]!.n,
    };

    await ctx.pool.query(
      "CREATE FUNCTION reject_manual_issue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test manual issue audit failure'; END $$; CREATE TRIGGER reject_manual_issue BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event='invoice.issue') EXECUTE FUNCTION reject_manual_issue()"
    );
    try {
      await expect(
        service.createManualInvoice({
          profileId: PROFILE_ID,
          actorUserId: ACTOR_USER_ID,
          lines: [{ description: 'x', quantity: 1, unitPrice: 100n, vatRate: 0 }],
        })
      ).rejects.toThrow('test manual issue audit failure');
    } finally {
      await ctx.pool.query('DROP TRIGGER reject_manual_issue ON audit_log');
    }

    const after = {
      invoices: (await ctx.db.execute<{ n: number }>(`SELECT COUNT(*)::int AS n FROM invoices`))
        .rows[0]!.n,
      lines: (await ctx.db.execute<{ n: number }>(`SELECT COUNT(*)::int AS n FROM invoice_lines`))
        .rows[0]!.n,
      audit: (await ctx.db.execute<{ n: number }>(`SELECT COUNT(*)::int AS n FROM audit_log`))
        .rows[0]!.n,
    };
    expect(after.invoices).toBe(before.invoices);
    expect(after.lines).toBe(before.lines);
    expect(after.audit).toBe(before.audit);

    // No Draft invoice may linger for the profile after the failed create
    const drafts = await ctx.db.execute<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM invoices
       WHERE profile_id = '${PROFILE_ID}' AND state = 'Draft'`
    );
    expect(drafts.rows[0]!.n).toBe(0);
  });

  it('rejects an idempotency key reused with a different payload', async () => {
    await service.createManualInvoice({
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      idempotencyKey: 'manual-idem-conflict',
      lines: [{ description: 'first', quantity: 1, unitPrice: 100_000n, vatRate: 0 }],
    });

    await expect(
      service.createManualInvoice({
        profileId: PROFILE_ID,
        actorUserId: ACTOR_USER_ID,
        idempotencyKey: 'manual-idem-conflict',
        lines: [{ description: 'DIFFERENT', quantity: 2, unitPrice: 200_000n, vatRate: 900 }],
      })
    ).rejects.toThrow();

    // Still exactly one invoice with the key
    const result = await ctx.db.execute<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM invoices
       WHERE metadata->>'idempotencyKey' = 'manual-idem-conflict'`
    );
    expect(result.rows[0]!.n).toBe(1);
  });

  it('never returns another profile invoice on an idempotency key collision', async () => {
    // Second profile exists so a cross-profile key collision is possible
    const otherProfile = '33333333-3333-7333-8333-333333333333';
    await ctx.db.execute(
      `INSERT INTO profiles (id, user_id) VALUES ('${otherProfile}', '${ACTOR_USER_ID}') ON CONFLICT (id) DO NOTHING`
    );

    const first = await service.createManualInvoice({
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      idempotencyKey: 'shared-key-001',
      lines: [{ description: 'for profile A', quantity: 1, unitPrice: 50_000n, vatRate: 0 }],
    });

    // Same key on a different profile must create a NEW invoice, not
    // replay profile A's invoice.
    const second = await service.createManualInvoice({
      profileId: otherProfile,
      actorUserId: ACTOR_USER_ID,
      idempotencyKey: 'shared-key-001',
      lines: [{ description: 'for profile B', quantity: 1, unitPrice: 60_000n, vatRate: 0 }],
    });

    expect(second.invoiceId).not.toBe(first.invoiceId);
    expect(second.profileId).toBe(otherProfile);
  });
  it('requires current invoice authority for both creation and idempotent replay', async () => {
    const cmd = {
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      lines: [{ description: 'x', quantity: 1, unitPrice: 100n, vatRate: 0 }],
      idempotencyKey: 'authority-replay',
    };
    const first = await service.createManualInvoice(cmd);
    const countBefore = (await ctx.pool.query('SELECT count(*) AS count FROM invoices')).rows[0]
      .count;
    const client = await ctx.pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await client.query('BEGIN');
      await client.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [ACTOR_USER_ID]);
      pending = service.createManualInvoice(cmd).then(
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
      await expect(
        service.createManualInvoice({ ...cmd, idempotencyKey: 'authority-new' })
      ).rejects.toMatchObject({ status: 403 });
      expect((await ctx.pool.query('SELECT count(*) AS count FROM invoices')).rows[0].count).toBe(
        countBefore
      );
      expect(await countAuditRows(first.invoiceId)).toBe(1);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pending;
      await ctx.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES ($1,'role-finance') ON CONFLICT DO NOTHING",
        [ACTOR_USER_ID]
      );
    }
    expect((await service.createManualInvoice(cmd)).invoiceId).toBe(first.invoiceId);
  });
  it('returns one invoice for concurrent same-key requests from different staff', async () => {
    const other = 'manual-second-staff';
    await ctx.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$1,'test-only',true)",
      [other]
    );
    await ctx.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES ($1,'role-finance')", [
      other,
    ]);
    await ctx.pool.query(
      "CREATE FUNCTION slow_manual_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$; CREATE TRIGGER slow_manual_insert BEFORE INSERT ON invoices FOR EACH ROW WHEN (NEW.metadata->>'idempotencyKey'='concurrent-manual') EXECUTE FUNCTION slow_manual_insert()"
    );
    const cmd = {
      profileId: PROFILE_ID,
      actorUserId: ACTOR_USER_ID,
      lines: [{ description: 'Concurrent invoice', quantity: 1, unitPrice: 100n, vatRate: 0 }],
      idempotencyKey: 'concurrent-manual',
    };
    try {
      const results = await Promise.all([
        service.createManualInvoice(cmd),
        service.createManualInvoice({ ...cmd, actorUserId: other }),
      ]);
      expect(results[0]!.invoiceId).toBe(results[1]!.invoiceId);
      expect(results[0]!.auditId).toBe(results[1]!.auditId);
      expect(
        (
          await ctx.pool.query(
            "SELECT id FROM invoices WHERE profile_id=$1 AND metadata->>'idempotencyKey'='concurrent-manual'",
            [PROFILE_ID]
          )
        ).rows
      ).toHaveLength(1);
      expect(await countAuditRows(results[0]!.invoiceId)).toBe(1);
    } finally {
      await ctx.pool.query('DROP TRIGGER slow_manual_insert ON invoices');
    }
  });

  it.each(['missing fingerprint', 'duplicate records', 'missing audit', 'missing timestamps'])(
    'rejects unverifiable legacy replay with %s',
    async (scenario) => {
      const cmd = {
        profileId: PROFILE_ID,
        actorUserId: ACTOR_USER_ID,
        lines: [{ description: 'Legacy replay', quantity: 1, unitPrice: 100n, vatRate: 0 }],
        idempotencyKey: `legacy-${scenario}`,
      };
      const first = await service.createManualInvoice(cmd);
      if (scenario === 'missing fingerprint') {
        await ctx.pool.query("UPDATE invoices SET metadata=metadata-'fingerprint' WHERE id=$1", [
          first.invoiceId,
        ]);
      } else if (scenario === 'missing audit') {
        await ctx.pool.query('DELETE FROM audit_log WHERE id=$1', [first.auditId]);
      } else if (scenario === 'missing timestamps') {
        await ctx.pool.query('UPDATE invoices SET issued_at=NULL,payable_from=NULL WHERE id=$1', [
          first.invoiceId,
        ]);
      } else {
        await ctx.pool.query(
          "INSERT INTO invoices(profile_id,type,state,total_amount,metadata) SELECT profile_id,type,'Draft',total_amount,metadata FROM invoices WHERE id=$1",
          [first.invoiceId]
        );
      }
      const before = (
        await ctx.pool.query(
          "SELECT id,state,metadata FROM invoices WHERE profile_id=$1 AND metadata->>'idempotencyKey'=$2 ORDER BY id",
          [PROFILE_ID, cmd.idempotencyKey]
        )
      ).rows;
      await expect(service.createManualInvoice(cmd)).rejects.toBeInstanceOf(ConflictException);
      expect(
        (
          await ctx.pool.query(
            "SELECT id,state,metadata FROM invoices WHERE profile_id=$1 AND metadata->>'idempotencyKey'=$2 ORDER BY id",
            [PROFILE_ID, cmd.idempotencyKey]
          )
        ).rows
      ).toEqual(before);
    }
  );
});
