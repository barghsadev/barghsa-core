/**
 * Real-PostgreSQL integration tests for online top-up initiation
 * (T-04.2.02.01).
 *
 * Proves against actual PostgreSQL:
 *   1. A valid amount creates a Pending topup ledger row and does not
 *      change posted_balance or reserved_balance.
 *   2. Amounts above the configured (or default) limit are rejected
 *      before any ledger insert.
 *   3. Retrying with the same idempotency key returns the original
 *      Pending row and does not insert a second transaction.
 *   4. A colliding key with a different amount is ConflictException.
 *   5. Concurrent same-key retries call startPayment once and keep
 *      metadata.authority aligned with ref_id.
 *   6. A crash after startPayment succeeds but before persist is recovered
 *      via provider inquiry and does not mint a second payable session.
 *   8. A first admin write cannot commit a tighter ceiling while a
 *      submission has already observed the absent-row default
 *      (T-04.2.02.06).
 *   9. A corrupt persisted onlineTopUpLimit row fails closed at submission
 *      and does not insert a Pending row (T-04.2.02.06).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db';
import { WalletService, type WalletQueryClient } from './wallet.service.js';
import { OnlineTopUpService } from './online-topup.service.js';
import { createZarinpalPaymentGateway, type PaymentGateway } from './payment-gateway.js';
import { AdminService } from '../admin/admin.service.js';
import { WALLET_TOP_UP_LIMIT_CONFIG_KEY } from '@barghsa/shared/finance';

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
const ADMIN_ACTOR = 'topup-limit-admin';
const limitActor = {
  userId: ADMIN_ACTOR,
  sessionId: '55555555-5555-4555-8555-555555555555',
  csrfToken: 'limit-integration-csrf',
};

describe('OnlineTopUpService — real PostgreSQL (T-04.2.02.01)', () => {
  let ctx: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let walletService: WalletService;
  let gateway: PaymentGateway;
  let service: OnlineTopUpService;
  let adminService: AdminService;
  let startCalls: number;

  beforeAll(async () => {
    ctx = await createMigratedTestDb();
    poolHolder.pool = ctx.pool;
    walletService = new WalletService();
    adminService = new AdminService();
    startCalls = 0;
    gateway = {
      async startPayment(request) {
        startCalls += 1;
        return {
          authority: `auth-${request.merchantOrderId}`,
          redirectUrl: `https://pay.test/start?order=${request.merchantOrderId}&amount=${request.amountIrR.toString()}`,
        };
      },
      async recoverPayment() {
        return null;
      },
      async verifyPayment() {
        return { paid: true, providerRefId: 'ref-1' };
      },
    };
    service = new OnlineTopUpService(walletService, gateway);

    await ctx.pool.query(
      `INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,'test-only',true)`,
      [ADMIN_ACTOR, `${ADMIN_ACTOR}@example.test`]
    );
    await ctx.pool.query(
      `INSERT INTO staff_roles(role_id,name,description,permissions)
       VALUES ('topup-limit-config-editor','Top-up limit editor','Test role','["admin:financial:edit"]')`
    );
    await ctx.pool.query(
      `INSERT INTO user_roles(user_id,role_id) VALUES ($1,'topup-limit-config-editor')`,
      [ADMIN_ACTOR]
    );
    await ctx.pool.query(
      `INSERT INTO profiles(id,user_id,status) VALUES ($1,$3,'ACTIVE'),($2,$3,'ACTIVE')`,
      [PROFILE_A, PROFILE_B, ADMIN_ACTOR]
    );
    await ctx.pool.query(`INSERT INTO wallets(profile_id) VALUES ($1)`, [PROFILE_A]);
    await ctx.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
       VALUES ($1,$2,$3,$1,clock_timestamp()+INTERVAL '1 day',clock_timestamp()+INTERVAL '30 minutes',clock_timestamp())`,
      [limitActor.sessionId, limitActor.userId, limitActor.csrfToken]
    );
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
      metadata: unknown;
    }>(
      `SELECT id, type, amount::text AS amount, state, idempotency_key, ref_id, metadata
       FROM wallet_transactions
       WHERE wallet_id = $1
       ORDER BY created_at, id`,
      [profileId]
    );
    return result.rows;
  }

  it('creates a Pending top-up, stores the gateway session, and leaves balances unchanged', async () => {
    const before = await fetchWallet(PROFILE_A);
    const result = await service.initiate({
      profileId: PROFILE_A,
      amountIrR: 250_000n,
      idempotencyKey: 'online-topup-happy',
      actor: limitActor,
    });

    expect(result.state).toBe('Pending');
    expect(result.amount).toBe(250_000n);
    expect(result.redirectUrl).toContain('order=');
    expect(result.redirectUrl).toContain('amount=250000');

    const after = await fetchWallet(PROFILE_A);
    expect(after.posted_balance).toBe(before.posted_balance);
    expect(after.reserved_balance).toBe(before.reserved_balance);
    expect(after.version).toBe(before.version);

    const ledger = await fetchLedger(PROFILE_A);
    const row = ledger.find((entry) => entry.idempotency_key === 'online-topup-happy');
    expect(row).toMatchObject({
      type: 'topup',
      amount: '250000',
      state: 'Pending',
    });
    expect(row!.ref_id).toBe(`auth-${row!.id}`);
    expect(row!.metadata).toMatchObject({
      channel: 'online',
      onlineTopUpLimit: 2_000_000_000,
      configVersion: 0,
      gateway: {
        authority: `auth-${row!.id}`,
        redirectUrl: result.redirectUrl,
      },
    });
  });

  it('creates the wallet when missing and still inserts a Pending top-up', async () => {
    const result = await service.initiate({
      profileId: PROFILE_B,
      amountIrR: 1_000n,
      idempotencyKey: 'online-topup-new-wallet',
      actor: limitActor,
    });
    expect(result.state).toBe('Pending');
    const wallet = await fetchWallet(PROFILE_B);
    expect(wallet.posted_balance).toBe('0');
    expect(wallet.reserved_balance).toBe('0');
  });

  it('rejects an amount above the default 2e9 IRR limit without inserting a ledger row', async () => {
    await expect(
      service.initiate({
        profileId: PROFILE_A,
        amountIrR: 2_000_000_001n,
        idempotencyKey: 'online-topup-over-default',
        actor: limitActor,
      })
    ).rejects.toBeInstanceOf(BadRequestException);

    const ledger = await fetchLedger(PROFILE_A);
    expect(ledger.some((row) => row.idempotency_key === 'online-topup-over-default')).toBe(false);
  });

  it('enforces a persisted admin limit at submission', async () => {
    await ctx.pool.query(
      `INSERT INTO app_config (key, value) VALUES ('finance.wallet_top_up_limit', $1::jsonb)`,
      [JSON.stringify({ limit_irr: 50_000 })]
    );
    try {
      await expect(
        service.initiate({
          profileId: PROFILE_A,
          amountIrR: 50_001n,
          idempotencyKey: 'online-topup-over-admin',
          actor: limitActor,
        })
      ).rejects.toBeInstanceOf(BadRequestException);
      try {
        await service.initiate({
          profileId: PROFILE_A,
          amountIrR: 50_001n,
          idempotencyKey: 'online-topup-over-admin-body',
          actor: limitActor,
        });
        throw new Error('expected over-limit rejection');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as BadRequestException).getResponse()).toMatchObject({
          onlineTopUpLimit: 50_000,
          configVersion: 1,
        });
      }

      const ok = await service.initiate({
        profileId: PROFILE_A,
        amountIrR: 50_000n,
        idempotencyKey: 'online-topup-at-admin',
        actor: limitActor,
      });
      expect(ok.amount).toBe(50_000n);
      const ledger = await fetchLedger(PROFILE_A);
      const row = ledger.find((entry) => entry.idempotency_key === 'online-topup-at-admin');
      expect(row!.metadata).toMatchObject({
        channel: 'online',
        onlineTopUpLimit: 50_000,
        configVersion: 1,
      });
    } finally {
      await ctx.pool.query(`DELETE FROM app_config WHERE key = 'finance.wallet_top_up_limit'`);
    }
  });

  it('uses a later config version at the next submission and keeps in-flight Pending rows', async () => {
    await ctx.pool.query(
      `INSERT INTO app_config (key, value, version) VALUES ('finance.wallet_top_up_limit', $1::jsonb, 1)`,
      [JSON.stringify({ limit_irr: 80_000 })]
    );
    try {
      const first = await service.initiate({
        profileId: PROFILE_A,
        amountIrR: 80_000n,
        idempotencyKey: 'online-topup-before-tighten',
        actor: limitActor,
      });
      expect(first.amount).toBe(80_000n);

      await ctx.pool.query(
        `UPDATE app_config
         SET value = $1::jsonb, version = version + 1, updated_at = NOW()
         WHERE key = 'finance.wallet_top_up_limit'`,
        [JSON.stringify({ limit_irr: 10_000 })]
      );

      const replay = await service.initiate({
        profileId: PROFILE_A,
        amountIrR: 80_000n,
        idempotencyKey: 'online-topup-before-tighten',
        actor: limitActor,
      });
      expect(replay.transactionId).toBe(first.transactionId);

      await expect(
        service.initiate({
          profileId: PROFILE_A,
          amountIrR: 10_001n,
          idempotencyKey: 'online-topup-after-tighten',
          actor: limitActor,
        })
      ).rejects.toBeInstanceOf(BadRequestException);

      const next = await service.initiate({
        profileId: PROFILE_A,
        amountIrR: 10_000n,
        idempotencyKey: 'online-topup-after-tighten-ok',
        actor: limitActor,
      });
      expect(next.amount).toBe(10_000n);
      const ledger = await fetchLedger(PROFILE_A);
      expect(
        ledger.find((row) => row.idempotency_key === 'online-topup-before-tighten')!.metadata
      ).toMatchObject({ onlineTopUpLimit: 80_000, configVersion: 1 });
      expect(
        ledger.find((row) => row.idempotency_key === 'online-topup-after-tighten-ok')!.metadata
      ).toMatchObject({ onlineTopUpLimit: 10_000, configVersion: 2 });
    } finally {
      await ctx.pool.query(`DELETE FROM app_config WHERE key = 'finance.wallet_top_up_limit'`);
    }
  });

  it('fails closed at submission when the persisted onlineTopUpLimit row is corrupt', async () => {
    await ctx.pool.query(
      `INSERT INTO app_config (key, value, version) VALUES ('finance.wallet_top_up_limit', $1::jsonb, 7)`,
      [JSON.stringify({ limit_irr: 'not-an-integer' })]
    );
    try {
      await expect(
        service.initiate({
          profileId: PROFILE_A,
          amountIrR: 1_000n,
          idempotencyKey: 'online-topup-corrupt-limit',
          actor: limitActor,
        })
      ).rejects.toBeInstanceOf(BadRequestException);
      try {
        await service.initiate({
          profileId: PROFILE_A,
          amountIrR: 1_000n,
          idempotencyKey: 'online-topup-corrupt-limit-body',
          actor: limitActor,
        });
        throw new Error('expected corrupt-config rejection');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as BadRequestException).getResponse()).toMatchObject({
          message: 'Online top-up limit configuration is unavailable',
        });
      }
      const ledger = await fetchLedger(PROFILE_A);
      expect(
        ledger.find((row) => row.idempotency_key === 'online-topup-corrupt-limit')
      ).toBeUndefined();
      expect(
        ledger.find((row) => row.idempotency_key === 'online-topup-corrupt-limit-body')
      ).toBeUndefined();
    } finally {
      await ctx.pool.query(`DELETE FROM app_config WHERE key = 'finance.wallet_top_up_limit'`);
    }
  });

  it('replays the same Pending row and redirect on idempotent retry', async () => {
    const startsBefore = startCalls;
    const first = await service.initiate({
      profileId: PROFILE_A,
      amountIrR: 10_000n,
      idempotencyKey: 'online-topup-retry',
      actor: limitActor,
    });
    const second = await service.initiate({
      profileId: PROFILE_A,
      amountIrR: 10_000n,
      idempotencyKey: 'online-topup-retry',
      actor: limitActor,
    });

    expect(second.transactionId).toBe(first.transactionId);
    expect(second.redirectUrl).toBe(first.redirectUrl);
    expect(startCalls).toBe(startsBefore + 1);

    const ledger = await fetchLedger(PROFILE_A);
    expect(ledger.filter((row) => row.idempotency_key === 'online-topup-retry')).toHaveLength(1);
  });

  it('retries the same idempotency key with uppercase/lowercase UUID spellings', async () => {
    const first = await service.initiate({
      profileId: PROFILE_A,
      amountIrR: 7_000n,
      idempotencyKey: 'online-topup-uuid-case',
      actor: limitActor,
    });
    const second = await service.initiate({
      profileId: PROFILE_A.toUpperCase(),
      amountIrR: 7_000n,
      idempotencyKey: 'online-topup-uuid-case',
      actor: limitActor,
    });

    expect(second.transactionId).toBe(first.transactionId);
    expect(second.redirectUrl).toBe(first.redirectUrl);

    const ledger = await fetchLedger(PROFILE_A);
    const matching = ledger.filter((row) => row.idempotency_key === 'online-topup-uuid-case');
    expect(matching).toHaveLength(1);
    expect(matching[0]!.id).toBe(first.transactionId);
  });

  it('rejects a colliding idempotency key with a different amount', async () => {
    await service.initiate({
      profileId: PROFILE_A,
      amountIrR: 3_000n,
      idempotencyKey: 'online-topup-collision',
      actor: limitActor,
    });
    await expect(
      service.initiate({
        profileId: PROFILE_A,
        amountIrR: 4_000n,
        idempotencyKey: 'online-topup-collision',
        actor: limitActor,
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('serializes concurrent same-key retries to a single gateway session', async () => {
    let localStarts = 0;
    const slowGateway: PaymentGateway = {
      async startPayment(request) {
        localStarts += 1;
        await new Promise((resolve) => setTimeout(resolve, 150));
        return {
          authority: `auth-once-${request.merchantOrderId}`,
          redirectUrl: `https://pay.test/start?authority=auth-once-${request.merchantOrderId}`,
        };
      },
      async recoverPayment() {
        return null;
      },
      async verifyPayment() {
        return { paid: true, providerRefId: 'ref-1' };
      },
    };
    const concurrentService = new OnlineTopUpService(walletService, slowGateway);
    const input = {
      profileId: PROFILE_A,
      amountIrR: 8_000n,
      idempotencyKey: 'online-topup-concurrent',
    };

    const [first, second] = await Promise.all([
      concurrentService.initiate({ ...input, actor: limitActor }),
      concurrentService.initiate({ ...input, actor: limitActor }),
    ]);

    expect(localStarts).toBe(1);
    expect(first.transactionId).toBe(second.transactionId);
    expect(first.redirectUrl).toBe(second.redirectUrl);
    expect(first.redirectUrl).toBe(
      `https://pay.test/start?authority=auth-once-${first.transactionId}`
    );

    const ledger = await fetchLedger(PROFILE_A);
    const matching = ledger.filter((row) => row.idempotency_key === 'online-topup-concurrent');
    expect(matching).toHaveLength(1);
    const row = matching[0]!;
    expect(row.ref_id).toBe(`auth-once-${row.id}`);
    expect(row.metadata).toMatchObject({
      channel: 'online',
      gateway: {
        authority: row.ref_id,
        redirectUrl: first.redirectUrl,
      },
    });
  });

  it('recovers a crash after startPayment before persist without creating a second provider session', async () => {
    const sessions = new Map<string, { authority: string; redirectUrl: string }>();
    let startCallsLocal = 0;
    let recoverCallsLocal = 0;
    const reconcilingGateway: PaymentGateway = {
      async startPayment(request) {
        if (!request.idempotencyKey) {
          throw new Error('provider idempotency key is required');
        }
        startCallsLocal += 1;
        const existing = sessions.get(request.idempotencyKey);
        if (existing) return existing;
        const session = {
          authority: `auth-crash-${request.idempotencyKey}`,
          redirectUrl: `https://pay.test/start?authority=auth-crash-${request.idempotencyKey}`,
        };
        sessions.set(request.idempotencyKey, session);
        return session;
      },
      async recoverPayment(request) {
        recoverCallsLocal += 1;
        return sessions.get(request.idempotencyKey) ?? null;
      },
      async verifyPayment() {
        return { paid: true, providerRefId: 'ref-1' };
      },
    };
    const recoverService = new OnlineTopUpService(walletService, reconcilingGateway);

    const inserted = await ctx.pool.query<{ id: string }>(
      `INSERT INTO wallet_transactions
         (wallet_id, type, amount, state, idempotency_key, description, metadata)
       VALUES ($1, 'topup', $2::bigint, 'Pending', $3, $4, $5::jsonb)
       RETURNING id`,
      [
        PROFILE_A,
        '9000',
        'online-topup-crash-before-persist',
        'Online wallet top-up',
        JSON.stringify({ channel: 'online' }),
      ]
    );
    const transactionId = inserted.rows[0]!.id;
    const claimId = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';
    const seeded = {
      authority: `auth-crash-${transactionId}`,
      redirectUrl: `https://pay.test/start?authority=auth-crash-${transactionId}`,
    };
    sessions.set(transactionId, seeded);

    await ctx.pool.query(
      `UPDATE wallet_transactions
       SET metadata = $2::jsonb
       WHERE id = $1`,
      [
        transactionId,
        JSON.stringify({
          channel: 'online',
          gateway: {
            status: 'initializing',
            claimId,
            providerIdempotencyKey: transactionId,
            merchantOrderId: transactionId,
            amountIrR: '9000',
            callbackUrl: `http://localhost:4000/api/wallet/top-ups/callback?orderId=${transactionId}`,
          },
        }),
      ]
    );

    const result = await recoverService.initiate({
      profileId: PROFILE_A,
      amountIrR: 9_000n,
      idempotencyKey: 'online-topup-crash-before-persist',
      actor: limitActor,
    });

    expect(result.transactionId).toBe(transactionId);
    expect(result.redirectUrl).toBe(seeded.redirectUrl);
    expect(startCallsLocal).toBe(0);
    expect(recoverCallsLocal).toBe(1);
    expect(sessions.size).toBe(1);

    const ledger = await fetchLedger(PROFILE_A);
    const matching = ledger.filter(
      (row) => row.idempotency_key === 'online-topup-crash-before-persist'
    );
    expect(matching).toHaveLength(1);
    const row = matching[0]!;
    expect(row.ref_id).toBe(seeded.authority);
    expect(row.metadata).toMatchObject({
      channel: 'online',
      gateway: {
        authority: seeded.authority,
        redirectUrl: seeded.redirectUrl,
        claimId,
        providerIdempotencyKey: transactionId,
      },
    });
  });

  it('preserves an ambiguous malformed provider success and recovers without another create', async () => {
    let creates = 0;
    let created: { amount: number; callback_url: string };
    const provider = createZarinpalPaymentGateway({
      merchantId: 'test-merchant',
      fetchImpl: async (url, init) => {
        if (url.endsWith('/request.json')) {
          creates++;
          created = JSON.parse(init!.body!);
          return { ok: true, status: 200, json: async () => ({ data: { code: 100 } }) };
        }
        expect(url).toContain('/unVerified.json');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              code: 100,
              authorities: [{ ...created, authority: 'created-before-response-loss' }],
            },
          }),
        };
      },
    });
    const repairedService = new OnlineTopUpService(walletService, provider);
    const input = {
      profileId: PROFILE_A,
      amountIrR: 11_000n,
      idempotencyKey: 'malformed-provider-response',
    };
    await expect(repairedService.initiate({ ...input, actor: limitActor })).rejects.toBeInstanceOf(
      HttpException
    );
    const pending = (await fetchLedger(PROFILE_A)).find(
      (row) => row.idempotency_key === input.idempotencyKey
    )!;
    expect(pending.metadata).toMatchObject({ gateway: { status: 'initializing' } });
    const recovered = await repairedService.initiate({ ...input, actor: limitActor });
    expect(recovered.transactionId).toBe(pending.id);
    expect(recovered.redirectUrl).toContain('created-before-response-loss');
    expect(creates).toBe(1);
    expect(
      (await fetchLedger(PROFILE_A)).filter((row) => row.idempotency_key === input.idempotencyKey)
    ).toHaveLength(1);
  });

  it('recovers the provider session after a client timeout and cannot create a second authority', async () => {
    const createdAuthorities: string[] = [];
    const sessions = new Map<string, { authority: string; redirectUrl: string }>();
    const timeoutGateway: PaymentGateway = {
      async startPayment(request) {
        const session = {
          authority: `auth-timeout-${request.idempotencyKey}-${createdAuthorities.length + 1}`,
          redirectUrl: `https://pay.test/start?authority=auth-timeout-${request.idempotencyKey}-${createdAuthorities.length + 1}`,
        };
        createdAuthorities.push(session.authority);
        sessions.set(request.idempotencyKey, session);
        throw Object.assign(new Error('The operation was aborted due to timeout'), {
          name: 'TimeoutError',
        });
      },
      async recoverPayment(request) {
        return sessions.get(request.idempotencyKey) ?? null;
      },
      async verifyPayment() {
        return { paid: true, providerRefId: 'ref-1' };
      },
    };
    const timeoutService = new OnlineTopUpService(walletService, timeoutGateway);
    const input = {
      profileId: PROFILE_A,
      amountIrR: 11_000n,
      idempotencyKey: 'online-topup-timeout-then-retry',
    };

    const first = await timeoutService
      .initiate({ ...input, actor: limitActor })
      .catch((error: unknown) => error);
    expect(first).toBeInstanceOf(HttpException);
    expect((first as HttpException).getStatus()).toBe(502);
    expect(createdAuthorities).toHaveLength(1);

    const pending = (await fetchLedger(PROFILE_A)).find(
      (row) => row.idempotency_key === 'online-topup-timeout-then-retry'
    );
    expect(pending?.state).toBe('Pending');
    expect(pending?.ref_id).toBeNull();
    expect(pending?.metadata).toMatchObject({
      channel: 'online',
      gateway: {
        status: 'initializing',
        providerIdempotencyKey: pending!.id,
        merchantOrderId: pending!.id,
      },
    });

    const result = await timeoutService.initiate({ ...input, actor: limitActor });
    expect(result.transactionId).toBe(pending!.id);
    expect(result.redirectUrl).toBe(sessions.get(pending!.id)!.redirectUrl);
    expect(createdAuthorities).toEqual([`auth-timeout-${pending!.id}-1`]);
    expect(createdAuthorities).toHaveLength(1);

    const ledger = await fetchLedger(PROFILE_A);
    const matching = ledger.filter(
      (row) => row.idempotency_key === 'online-topup-timeout-then-retry'
    );
    expect(matching).toHaveLength(1);
    const row = matching[0]!;
    expect(row.ref_id).toBe(createdAuthorities[0]);
    expect(row.metadata).toMatchObject({
      channel: 'online',
      gateway: {
        authority: createdAuthorities[0],
        redirectUrl: result.redirectUrl,
        providerIdempotencyKey: row.id,
      },
    });
  });

  it('serializes a first admin write against an in-flight submission when the config row is absent', async () => {
    await ctx.pool.query(`DELETE FROM app_config WHERE key = $1`, [WALLET_TOP_UP_LIMIT_CONFIG_KEY]);

    class GateAfterLockedReadWalletService extends WalletService {
      private resolveRead = (): void => {};
      private resolveContinue = (): void => {};
      readonly readReleased: Promise<void>;
      readonly continueInsert: Promise<void>;

      constructor() {
        super();
        this.readReleased = new Promise((resolve) => {
          this.resolveRead = resolve;
        });
        this.continueInsert = new Promise((resolve) => {
          this.resolveContinue = resolve;
        });
      }

      releaseInsert(): void {
        this.resolveContinue();
      }

      override async resolveOnlineTopUpLimit(client?: WalletQueryClient) {
        const snapshot = await super.resolveOnlineTopUpLimit(client);
        if (client) {
          this.resolveRead();
          await this.continueInsert;
        }
        return snapshot;
      }
    }

    const gatedWallet = new GateAfterLockedReadWalletService();
    const gatedService = new OnlineTopUpService(gatedWallet, gateway);

    const initiatePromise = gatedService.initiate({
      profileId: PROFILE_A,
      amountIrR: 100_000n,
      idempotencyKey: 'online-topup-absent-row-race',
      actor: limitActor,
    });

    await gatedWallet.readReleased;

    let adminSettled = false;
    const adminPromise = adminService
      .setWalletTopUpLimitConfig({ limit_irr: 50_000 }, limitActor, '127.0.0.1')
      .finally(() => {
        adminSettled = true;
      });

    const blockedUntil = Date.now() + 500;
    while (Date.now() < blockedUntil) {
      expect(adminSettled).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    gatedWallet.releaseInsert();

    const pending = await initiatePromise;
    expect(pending.amount).toBe(100_000n);

    const written = await adminPromise;
    expect(written).toEqual({ limitIrR: 50_000, version: 1 });
    expect(adminSettled).toBe(true);

    const ledger = await fetchLedger(PROFILE_A);
    const row = ledger.find((entry) => entry.idempotency_key === 'online-topup-absent-row-race');
    expect(row!.metadata).toMatchObject({
      channel: 'online',
      onlineTopUpLimit: 2_000_000_000,
      configVersion: 0,
    });
  }, 20_000);
});
