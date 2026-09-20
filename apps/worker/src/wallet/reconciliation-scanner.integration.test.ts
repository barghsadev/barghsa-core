/**
 * Real-PostgreSQL integration tests for the wallet reconciliation
 * scanner (T-04.2.01.08).
 *
 * Fake-pool unit tests cannot prove FILTER/HAVING bigint comparison or
 * the finance-queue insert against `reconciliation_exceptions`. This
 * suite applies the complete production migration journal and runs a full
 * `reconcileWalletBalances` pass against Testcontainers PostgreSQL 17.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db';
import { WALLET_MISMATCH_EXCEPTION_TYPE } from '@barghsa/shared/finance';
import { reconcileWalletBalances } from './reconciliation-scanner.js';

const WALLET_OK = '11111111-1111-7111-8111-111111111111';
const WALLET_POSTED_DRIFT = '22222222-2222-7222-8222-222222222222';
const WALLET_RESERVED_DRIFT = '33333333-3333-7333-8333-333333333333';
const WALLET_PENDING_ONLY = '44444444-4444-7444-8444-444444444444';

describe('wallet reconciliation — real PostgreSQL (T-04.2.01.08)', () => {
  let ctx: Awaited<ReturnType<typeof createMigratedTestDb>>;

  beforeAll(async () => {
    ctx = await createMigratedTestDb();
    await ctx.pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES ('reconciliation-owner','reconciliation@example.test','fixture')"
    );
    await ctx.pool.query(
      `INSERT INTO profiles (id,user_id) VALUES ($1,'reconciliation-owner'), ($2,'reconciliation-owner'), ($3,'reconciliation-owner'), ($4,'reconciliation-owner')`,
      [WALLET_OK, WALLET_POSTED_DRIFT, WALLET_RESERVED_DRIFT, WALLET_PENDING_ONLY]
    );
  }, 60_000);

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.pool.query('DELETE FROM reconciliation_exceptions');
    await ctx.pool.query('DELETE FROM wallet_transactions');
    await ctx.pool.query('DELETE FROM wallets');
    await ctx.pool.query(
      `INSERT INTO wallets (profile_id, posted_balance, reserved_balance, version)
       VALUES
         ($1, 250000, 0, 2),
         ($2, 500000, 0, 1),
         ($3, 1000000, 200000, 3),
         ($4, 0, 0, 0)`,
      [WALLET_OK, WALLET_POSTED_DRIFT, WALLET_RESERVED_DRIFT, WALLET_PENDING_ONLY]
    );
    await ctx.pool.query(
      `INSERT INTO wallet_transactions
         (wallet_id, type, amount, state, idempotency_key)
       VALUES
         ($1, 'topup', 300000, 'Completed', 'ok-credit'),
         ($1, 'payment', -50000, 'Completed', 'ok-debit'),
         ($2, 'topup', 400000, 'Completed', 'posted-drift-credit'),
         ($3, 'topup', 1000000, 'Completed', 'reserved-credit'),
         ($3, 'reservation', 100000, 'Released', 'reserved-released'),
         ($4, 'topup', 75000, 'Pending', 'pending-only')`,
      [WALLET_OK, WALLET_POSTED_DRIFT, WALLET_RESERVED_DRIFT, WALLET_PENDING_ONLY]
    );
  });

  async function exceptions() {
    const result = await ctx.pool.query<{
      exception_type: string;
      severity: string;
      status: string;
      description: string;
      details: { walletId?: string; postedDelta?: string; reservedDelta?: string };
    }>(
      `SELECT exception_type, severity, status, description, details
       FROM reconciliation_exceptions
       ORDER BY details->>'walletId'`
    );
    return result.rows;
  }

  it('reports posted and reserved cache drift and ignores matching / pending-only wallets', async () => {
    const result = await reconcileWalletBalances({ pool: ctx.pool, batchSize: 50 });

    expect(result.errors).toEqual([]);
    expect(result.reported).toBe(2);
    expect(result.scanned).toBe(2);

    const rows = await exceptions();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.exception_type === WALLET_MISMATCH_EXCEPTION_TYPE)).toBe(true);
    expect(rows.every((r) => r.status === 'open')).toBe(true);
    expect(rows.every((r) => r.severity === 'high')).toBe(true);

    const posted = rows.find((r) => r.details.walletId === WALLET_POSTED_DRIFT);
    expect(posted).toBeDefined();
    expect(posted!.details.postedDelta).toBe('100000');
    expect(posted!.description).toContain(WALLET_POSTED_DRIFT);

    const reserved = rows.find((r) => r.details.walletId === WALLET_RESERVED_DRIFT);
    expect(reserved).toBeDefined();
    expect(reserved!.details.reservedDelta).toBe('200000');
    expect(reserved!.details.postedDelta).toBe('0');

    expect(rows.some((r) => r.details.walletId === WALLET_OK)).toBe(false);
    expect(rows.some((r) => r.details.walletId === WALLET_PENDING_ONLY)).toBe(false);
  });

  it.each([
    ['Completed', 'topup', '9223372036854775807', '-18446744073709551614'],
    ['Reserved', 'reservation', '9223372036854775807', '-18446744073709551614'],
    ['Completed', 'payment', '-9223372036854775807', '18446744073709551614'],
  ])(
    'reports an oversized %s/%s ledger sum without losing other mismatches',
    async (state, type, amount, delta) => {
      await ctx.pool.query(
        `INSERT INTO wallet_transactions(wallet_id,type,amount,state,idempotency_key)
      VALUES ($1,$2,$3::bigint,$4,'oversized-one'),($1,$2,$3::bigint,$4,'oversized-two')`,
        [WALLET_PENDING_ONLY, type, amount, state]
      );
      const before = (await ctx.pool.query('SELECT * FROM wallets ORDER BY profile_id')).rows;
      const ledgerBefore = (await ctx.pool.query('SELECT * FROM wallet_transactions ORDER BY id'))
        .rows;
      const result = await reconcileWalletBalances({ pool: ctx.pool, batchSize: 50 });
      expect(result).toMatchObject({ scanned: 3, reported: 3, errors: [] });
      const rows = await exceptions();
      expect(rows).toHaveLength(3);
      expect(rows.find((row) => row.details.walletId === WALLET_PENDING_ONLY)).toMatchObject({
        severity: 'critical',
        status: 'open',
        details:
          state === 'Completed'
            ? { postedDelta: delta, reservedDelta: '0' }
            : { postedDelta: '0', reservedDelta: delta },
      });
      expect((await ctx.pool.query('SELECT * FROM wallets ORDER BY profile_id')).rows).toEqual(
        before
      );
      expect((await ctx.pool.query('SELECT * FROM wallet_transactions ORDER BY id')).rows).toEqual(
        ledgerBefore
      );
      expect(await reconcileWalletBalances({ pool: ctx.pool, batchSize: 50 })).toMatchObject({
        scanned: 0,
        reported: 0,
        errors: [],
      });
    }
  );

  it('does not duplicate an open finance-queue row on a second tick', async () => {
    const first = await reconcileWalletBalances({ pool: ctx.pool, batchSize: 50 });
    expect(first.reported).toBe(2);

    const second = await reconcileWalletBalances({ pool: ctx.pool, batchSize: 50 });
    expect(second.reported).toBe(0);
    expect(second.scanned).toBe(0);

    const rows = await exceptions();
    expect(rows).toHaveLength(2);
  });
});
