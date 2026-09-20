/**
 * Real-PostgreSQL integration tests for WalletService.credit
 * (T-04.2.01.03).
 *
 * Proves against actual PostgreSQL:
 *   1. A credit inserts a Completed ledger row and increments
 *      posted_balance + version under
 *      `WHERE version = X AND posted_balance >= 0`.
 *   2. Retrying with the same idempotency key returns the original
 *      ledger row and does not double-credit.
 *   3. Concurrent credits with distinct keys both post; the final
 *      posted_balance equals the sum.
 *   4. The production constraint rejects negative stored balances
 *      without changing wallet state or history.
 *   5. A missing wallet is NotFound.
 *   6. Reusing a debit or reservation idempotency key, or retrying a credit
 *      with a different amount/type/refId, is ConflictException and does not
 *      mutate the wallet.
 *
 * Wiring: only `getDbPool()` is stubbed, handing the service the
 * fully migrated disposable PostgreSQL pool.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { startHttpFixture } from '../test/http-fixture.js';
import { WalletService } from './wallet.service.js';

const poolHolder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }));

vi.mock('@barghsa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@barghsa/db')>();
  return {
    ...actual,
    getDbPool: () => {
      if (!poolHolder.pool) {
        throw new Error('test pool not initialized — beforeAll must run first');
      }
      return poolHolder.pool;
    },
  };
});

const PROFILE_A = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const PROFILE_B = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';

describe('WalletService.credit — real PostgreSQL (T-04.2.01.03)', () => {
  let ctx: Awaited<ReturnType<typeof startHttpFixture>>;
  let service: WalletService;

  beforeAll(async () => {
    ctx = await startHttpFixture(process.env.TEST_DATABASE_URL!);
    poolHolder.pool = ctx.pool;
    service = new WalletService();

    await ctx.pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES ('wallet-test-owner','wallet-test@example.test','test-only')"
    );
    await ctx.pool.query(
      `INSERT INTO profiles (id,user_id) VALUES ($1,'wallet-test-owner'), ($2,'wallet-test-owner')`,
      [PROFILE_A, PROFILE_B]
    );
    await ctx.pool.query(`INSERT INTO wallets (profile_id) VALUES ($1), ($2)`, [
      PROFILE_A,
      PROFILE_B,
    ]);
  }, 60_000);

  afterAll(async () => {
    poolHolder.pool = null;
    await ctx.close();
  });

  async function fetchWallet(profileId: string) {
    const result = await ctx.pool.query<{
      posted_balance: string;
      reserved_balance: string;
      version: number;
    }>(
      `SELECT posted_balance::text AS posted_balance,
              reserved_balance::text AS reserved_balance,
              version
       FROM wallets WHERE profile_id = $1`,
      [profileId]
    );
    return result.rows[0]!;
  }

  async function fetchLedger(profileId: string) {
    const result = await ctx.pool.query<{
      id: string;
      type: string;
      amount: string;
      state: string;
      idempotency_key: string;
      ref_id: string | null;
    }>(
      `SELECT id, type, amount::text AS amount, state, idempotency_key, ref_id
       FROM wallet_transactions
       WHERE wallet_id = $1
       ORDER BY created_at, id`,
      [profileId]
    );
    return result.rows;
  }

  it('inserts a ledger row and increments postedBalance + version', async () => {
    const before = await fetchWallet(PROFILE_A);
    const tx = await service.credit(
      PROFILE_A,
      250_000n,
      { type: 'topup', refId: 'provider-evt-1', description: 'online top-up' },
      'credit-happy-1'
    );

    expect(tx.state).toBe('Completed');
    expect(tx.type).toBe('topup');
    expect(tx.amount).toBe(250_000n);
    expect(tx.refId).toBe('provider-evt-1');
    expect(tx.idempotencyKey).toBe('credit-happy-1');
    expect(tx.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    const after = await fetchWallet(PROFILE_A);
    expect(BigInt(after.posted_balance)).toBe(BigInt(before.posted_balance) + 250_000n);
    expect(after.version).toBe(before.version + 1);

    const ledger = await fetchLedger(PROFILE_A);
    expect(ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: tx.id,
          type: 'topup',
          amount: '250000',
          state: 'Completed',
          idempotency_key: 'credit-happy-1',
          ref_id: 'provider-evt-1',
        }),
      ])
    );
  });

  it('returns the original ledger row on idempotent retry without double-crediting', async () => {
    const first = await service.credit(
      PROFILE_A,
      10_000n,
      { type: 'refund', refId: 'refund-1' },
      'credit-idem-1'
    );
    const afterFirst = await fetchWallet(PROFILE_A);

    const second = await service.credit(
      PROFILE_A,
      10_000n,
      { type: 'refund', refId: 'refund-1' },
      'credit-idem-1'
    );
    const afterSecond = await fetchWallet(PROFILE_A);

    expect(second.id).toBe(first.id);
    expect(afterSecond.posted_balance).toBe(afterFirst.posted_balance);
    expect(afterSecond.version).toBe(afterFirst.version);

    const matching = (await fetchLedger(PROFILE_A)).filter(
      (row) => row.idempotency_key === 'credit-idem-1'
    );
    expect(matching).toHaveLength(1);
  });

  it('retries the same idempotency key with uppercase/lowercase UUID spellings without changing the balance', async () => {
    const first = await service.credit(PROFILE_A, 5_000n, { type: 'topup' }, 'credit-uuid-case');
    const afterFirst = await fetchWallet(PROFILE_A);

    const second = await service.credit(
      PROFILE_A.toUpperCase(),
      5_000n,
      { type: 'topup' },
      'credit-uuid-case'
    );
    const afterSecond = await fetchWallet(PROFILE_A);

    expect(second.id).toBe(first.id);
    expect(second.walletId).toBe(PROFILE_A);
    expect(afterSecond.posted_balance).toBe(afterFirst.posted_balance);
    expect(afterSecond.version).toBe(afterFirst.version);
    expect(
      (await fetchLedger(PROFILE_A)).filter((row) => row.idempotency_key === 'credit-uuid-case')
    ).toHaveLength(1);
  });

  it('lets concurrent retries of the same idempotency key credit only once', async () => {
    const before = await fetchWallet(PROFILE_A);
    const results = await Promise.all([
      service.credit(PROFILE_A, 4_000n, { type: 'topup' }, 'credit-concurrent-same'),
      service.credit(PROFILE_A, 4_000n, { type: 'topup' }, 'credit-concurrent-same'),
    ]);

    expect(results[0]!.id).toBe(results[1]!.id);
    const after = await fetchWallet(PROFILE_A);
    expect(BigInt(after.posted_balance)).toBe(BigInt(before.posted_balance) + 4_000n);
    expect(after.version).toBe(before.version + 1);
    expect(
      (await fetchLedger(PROFILE_A)).filter(
        (row) => row.idempotency_key === 'credit-concurrent-same'
      )
    ).toHaveLength(1);
  });

  it('posts two concurrent credits with distinct keys; postedBalance equals the sum', async () => {
    const before = await fetchWallet(PROFILE_A);
    const results = await Promise.all([
      service.credit(PROFILE_A, 3_000n, { type: 'topup' }, 'credit-concurrent-a'),
      service.credit(PROFILE_A, 7_000n, { type: 'topup' }, 'credit-concurrent-b'),
    ]);

    expect(new Set(results.map((r) => r.id)).size).toBe(2);

    const after = await fetchWallet(PROFILE_A);
    expect(BigInt(after.posted_balance)).toBe(BigInt(before.posted_balance) + 10_000n);
    expect(after.version).toBe(before.version + 2);
  });

  it('rejects negative stored balances at the production constraint without changing history', async () => {
    const before = await fetchWallet(PROFILE_B);
    await expect(
      ctx.pool.query('UPDATE wallets SET posted_balance=-1,version=0 WHERE profile_id=$1', [
        PROFILE_B,
      ])
    ).rejects.toMatchObject({ code: '23514' });
    expect(await fetchWallet(PROFILE_B)).toEqual(before);
    expect(await fetchLedger(PROFILE_B)).toHaveLength(0);
  });

  it('throws NotFound for a missing wallet', async () => {
    const missing = uuidv7();
    await expect(
      service.credit(missing, 100n, { type: 'topup' }, 'credit-missing')
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a non-positive amount before touching the database', async () => {
    await expect(
      service.credit(PROFILE_A, 0n, { type: 'topup' }, 'credit-zero')
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects credit that reuses a debit idempotency key without changing the balance', async () => {
    await ctx.pool.query(
      `UPDATE wallets SET posted_balance = 50_000, reserved_balance = 0, version = 0 WHERE profile_id = $1`,
      [PROFILE_B]
    );
    await ctx.pool.query(`DELETE FROM wallet_transactions WHERE wallet_id = $1`, [PROFILE_B]);

    const debitTx = await service.debit(
      PROFILE_B,
      1_000n,
      { type: 'payment' },
      'credit-reuses-debit-key'
    );
    const afterDebit = await fetchWallet(PROFILE_B);

    await expect(
      service.credit(PROFILE_B, 1_000n, { type: 'topup' }, 'credit-reuses-debit-key')
    ).rejects.toBeInstanceOf(ConflictException);

    const afterAttempt = await fetchWallet(PROFILE_B);
    expect(afterAttempt.posted_balance).toBe(afterDebit.posted_balance);
    expect(afterAttempt.reserved_balance).toBe(afterDebit.reserved_balance);
    expect(afterAttempt.version).toBe(afterDebit.version);
    expect(debitTx.amount).toBe(-1_000n);
    expect(
      (await fetchLedger(PROFILE_B)).filter(
        (row) => row.idempotency_key === 'credit-reuses-debit-key'
      )
    ).toHaveLength(1);
  });

  it('rejects credit that reuses a reservation idempotency key without completing a credit', async () => {
    await service.reserve(PROFILE_A, 1_000n, 'credit-reuses-reserve-key');
    const afterReserve = await fetchWallet(PROFILE_A);

    await expect(
      service.credit(PROFILE_A, 1_000n, { type: 'topup' }, 'credit-reuses-reserve-key')
    ).rejects.toBeInstanceOf(ConflictException);

    const afterAttempt = await fetchWallet(PROFILE_A);
    expect(afterAttempt.posted_balance).toBe(afterReserve.posted_balance);
    expect(afterAttempt.reserved_balance).toBe(afterReserve.reserved_balance);
    expect(afterAttempt.version).toBe(afterReserve.version);
    expect(
      (await fetchLedger(PROFILE_A)).filter(
        (row) => row.idempotency_key === 'credit-reuses-reserve-key'
      )
    ).toEqual([
      expect.objectContaining({
        type: 'reservation',
        state: 'Reserved',
        idempotency_key: 'credit-reuses-reserve-key',
      }),
    ]);
  });

  it('rejects a same-key credit with a different amount without changing the balance', async () => {
    const first = await service.credit(
      PROFILE_A,
      2_000n,
      { type: 'topup', refId: 'evt-amt' },
      'credit-mismatch-amount'
    );
    const afterFirst = await fetchWallet(PROFILE_A);

    await expect(
      service.credit(
        PROFILE_A,
        3_000n,
        { type: 'topup', refId: 'evt-amt' },
        'credit-mismatch-amount'
      )
    ).rejects.toBeInstanceOf(ConflictException);

    const afterAttempt = await fetchWallet(PROFILE_A);
    expect(afterAttempt.posted_balance).toBe(afterFirst.posted_balance);
    expect(afterAttempt.version).toBe(afterFirst.version);
    expect(first.amount).toBe(2_000n);
    expect(
      (await fetchLedger(PROFILE_A)).filter(
        (row) => row.idempotency_key === 'credit-mismatch-amount'
      )
    ).toHaveLength(1);
  });

  it('rejects a same-key credit with a different refId without changing the balance', async () => {
    const first = await service.credit(
      PROFILE_A,
      1_500n,
      { type: 'refund', refId: 'refund-ref-a' },
      'credit-mismatch-ref'
    );
    const afterFirst = await fetchWallet(PROFILE_A);

    await expect(
      service.credit(
        PROFILE_A,
        1_500n,
        { type: 'refund', refId: 'refund-ref-b' },
        'credit-mismatch-ref'
      )
    ).rejects.toBeInstanceOf(ConflictException);

    const afterAttempt = await fetchWallet(PROFILE_A);
    expect(afterAttempt.posted_balance).toBe(afterFirst.posted_balance);
    expect(afterAttempt.version).toBe(afterFirst.version);
    expect(first.refId).toBe('refund-ref-a');
    expect(
      (await fetchLedger(PROFILE_A)).filter((row) => row.idempotency_key === 'credit-mismatch-ref')
    ).toEqual([
      expect.objectContaining({
        amount: '1500',
        ref_id: 'refund-ref-a',
      }),
    ]);
  });
});
