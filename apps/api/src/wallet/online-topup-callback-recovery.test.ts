import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startHttpFixture } from '../test/http-fixture';
import { WalletService } from './wallet.service.js';
import { OnlineTopUpCallbackService } from './online-topup-callback.service.js';
import { signPaymentCallback } from './payment-callback-verifier.js';
import type { PaymentGateway } from './payment-gateway.js';

const holder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }));
vi.mock('@barghsa/db', async (original) => ({
  ...(await original<typeof import('@barghsa/db')>()),
  getDbPool: () => holder.pool!,
}));
const secret = 'callback-recovery-test-only';
const merchant = 'recovery-merchant';

describe('durable callback acknowledgement and replay binding', () => {
  let ctx: Awaited<ReturnType<typeof startHttpFixture>>;
  let service: OnlineTopUpCallbackService;
  beforeAll(async () => {
    ctx = await startHttpFixture(process.env.TEST_DATABASE_URL!, undefined, '', 4);
    holder.pool = ctx.pool;
    const gateway: PaymentGateway = {
      async startPayment() {
        throw new Error('unused');
      },
      async recoverPayment() {
        return null;
      },
      async verifyPayment() {
        return { paid: true, providerRefId: 'verified-reference' };
      },
    };
    service = new OnlineTopUpCallbackService(new WalletService(), gateway, {
      webhookSecret: secret,
      merchantId: merchant,
    });
    await ctx.pool.query(
      "INSERT INTO users (user_id, username, password_hash) VALUES ('callback-owner','callback-owner@example.test','test-only')"
    );
  }, 60_000);
  afterAll(async () => {
    holder.pool = null;
    await ctx.close();
  });

  async function seed() {
    const profile = randomUUID();
    const order = randomUUID();
    const authority = randomUUID();
    await ctx.pool.query("INSERT INTO profiles(id,user_id) VALUES ($1,'callback-owner')", [
      profile,
    ]);
    await ctx.pool.query('INSERT INTO wallets(profile_id) VALUES ($1)', [profile]);
    await ctx.pool.query(
      `INSERT INTO wallet_transactions(id,wallet_id,type,amount,state,idempotency_key,ref_id,description,metadata)
      VALUES ($1,$2,'topup',25000,'Pending',$5,$3,'Online wallet top-up',$4::jsonb)`,
      [
        order,
        profile,
        authority,
        JSON.stringify({ channel: 'online', gateway: { authority } }),
        order,
      ]
    );
    return { order, profile, authority };
  }
  function callback(data: Awaited<ReturnType<typeof seed>>, eventId: string, status = 'paid') {
    const rawBody = JSON.stringify({
      merchantOrderId: data.order,
      merchantId: merchant,
      authority: data.authority,
      amountIrR: 25000,
      status,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    return service.handle({
      rawBody,
      headers: {
        eventId,
        timestamp,
        signature: signPaymentCallback(rawBody, eventId, timestamp, secret),
      },
    });
  }
  async function creditCount(profile: string) {
    const result = await ctx.pool.query(
      "SELECT count(*)::int AS count FROM wallet_transactions WHERE wallet_id=$1 AND state='Completed' AND type='topup'",
      [profile]
    );
    return result.rows[0]!.count as number;
  }

  for (const transition of ['release', 'finalize', 'fail', 'reopen'] as const) {
    for (const result of ['NULL', 'OLD'] as const) {
      it(`does not acknowledge a ${transition} write returning ${result}; retries settle once`, async () => {
        const data = await seed();
        const event = randomUUID();
        if (transition === 'reopen') await callback(data, event, 'failed');
        const table =
          transition === 'release' || transition === 'fail'
            ? 'wallet_transactions'
            : 'wallet_topup_callback_events';
        const condition =
          transition === 'release'
            ? "NEW.state = 'Released'"
            : transition === 'fail'
              ? "NEW.state = 'Failed'"
              : transition === 'reopen'
                ? "NEW.status = 'processing'"
                : "NEW.status = 'credited'";
        await ctx.pool.query(
          `CREATE FUNCTION suppress_callback_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RETURN ${result}; END IF; RETURN NEW; END $$`
        );
        await ctx.pool.query(
          `CREATE TRIGGER suppress_callback_write BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION suppress_callback_write()`
        );
        try {
          await expect(
            callback(data, event, transition === 'fail' ? 'failed' : 'paid')
          ).rejects.toThrow();
          expect(await creditCount(data.profile)).toBe(
            transition === 'release' || transition === 'finalize' ? 1 : 0
          );
        } finally {
          await ctx.pool.query(`DROP TRIGGER suppress_callback_write ON ${table}`);
          await ctx.pool.query('DROP FUNCTION suppress_callback_write()');
        }
        const recovery = await callback(data, event, transition === 'fail' ? 'failed' : 'paid');
        expect(recovery.credited).toBe(transition !== 'fail');
        expect(await creditCount(data.profile)).toBe(transition === 'fail' ? 0 : 1);
        await callback(data, event, transition === 'fail' ? 'failed' : 'paid');
        expect(await creditCount(data.profile)).toBe(transition === 'fail' ? 0 : 1);
        const pending = await ctx.pool.query('SELECT state FROM wallet_transactions WHERE id=$1', [
          data.order,
        ]);
        expect(pending.rows[0]!.state).toBe(transition === 'fail' ? 'Failed' : 'Released');
        const wallet = await ctx.pool.query(
          'SELECT posted_balance::text AS balance FROM wallets WHERE profile_id=$1',
          [data.profile]
        );
        expect(wallet.rows[0]!.balance).toBe(transition === 'fail' ? '0' : '25000');
      });
    }
  }

  for (const result of ['NULL', 'OLD'] as const) {
    it(`recovers unpaid event finalization returning ${result} without rewriting a failed intent`, async () => {
      const data = await seed();
      const event = randomUUID();
      await ctx.pool.query(
        `CREATE FUNCTION suppress_unpaid_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN ${result}; END $$`
      );
      await ctx.pool.query(
        'CREATE TRIGGER suppress_unpaid_event BEFORE UPDATE ON wallet_topup_callback_events FOR EACH ROW EXECUTE FUNCTION suppress_unpaid_event()'
      );
      try {
        await expect(callback(data, event, 'failed')).rejects.toThrow();
        const pending = await ctx.pool.query('SELECT state FROM wallet_transactions WHERE id=$1', [
          data.order,
        ]);
        expect(pending.rows[0]!.state).toBe('Failed');
      } finally {
        await ctx.pool.query('DROP TRIGGER suppress_unpaid_event ON wallet_topup_callback_events');
        await ctx.pool.query('DROP FUNCTION suppress_unpaid_event()');
      }
      await expect(callback(data, event, 'failed')).resolves.toMatchObject({
        credited: false,
        processed: true,
      });
      await expect(callback(data, event, 'failed')).resolves.toMatchObject({
        credited: false,
        processed: false,
      });
      expect(await creditCount(data.profile)).toBe(0);
      await expect(callback(data, event)).resolves.toMatchObject({ credited: true });
      expect(await creditCount(data.profile)).toBe(1);
    });
  }

  for (const state of ['Pending', 'Failed', 'Rejected']) {
    it(`repairs a historical credited event whose intent stayed ${state}`, async () => {
      const data = await seed();
      const event = randomUUID();
      const first = await callback(data, event);
      await ctx.pool.query('UPDATE wallet_transactions SET state=$2 WHERE id=$1', [
        data.order,
        state,
      ]);
      await expect(callback(data, event)).resolves.toMatchObject({
        processed: false,
        credited: true,
        creditTransactionId: first.creditTransactionId,
      });
      expect(await creditCount(data.profile)).toBe(1);
      const pending = await ctx.pool.query('SELECT state FROM wallet_transactions WHERE id=$1', [
        data.order,
      ]);
      expect(pending.rows[0]!.state).toBe('Released');
    });
  }

  it('rejects an event ID already bound to another merchant order', async () => {
    const first = await seed();
    const second = await seed();
    const event = randomUUID();
    await callback(first, event);
    await expect(callback(second, event)).rejects.toThrow();
    expect(await creditCount(first.profile)).toBe(1);
    expect(await creditCount(second.profile)).toBe(0);
  });

  it('does not report credit when a terminal event has no ledger credit', async () => {
    const data = await seed();
    const event = randomUUID();
    await ctx.pool.query(
      "INSERT INTO wallet_topup_callback_events(event_id,pending_transaction_id,wallet_id,status,raw) VALUES ($1,$2,$3,'credited','{}')",
      [event, data.order, data.profile]
    );
    await expect(callback(data, event)).rejects.toThrow();
    expect(await creditCount(data.profile)).toBe(0);
  });
});
