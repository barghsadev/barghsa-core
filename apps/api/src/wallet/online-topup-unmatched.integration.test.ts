import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db';
import { OnlineTopUpCallbackService } from './online-topup-callback.service';
import { WalletService } from './wallet.service';
import { signPaymentCallback } from './payment-callback-verifier';
import type { PaymentGateway } from './payment-gateway';
import { ErrorCodes } from '@barghsa/shared/errors';

const holder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }));
vi.mock('@barghsa/db', async (original) => ({
  ...(await original<typeof import('@barghsa/db')>()),
  getDbPool: () => holder.pool,
}));
const secret = 'unmatched-test-secret',
  merchant = 'unmatched-test-merchant';
let db: Awaited<ReturnType<typeof createMigratedTestDb>>, service: OnlineTopUpCallbackService;
const verify = vi.fn(async () => ({ paid: true, providerRefId: 'fixture-ref' }));
beforeAll(async () => {
  db = await createMigratedTestDb();
  holder.pool = db.pool;
  await db.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES('unknown-callback-owner','unknown-callback-owner','fixture')"
  );
  for (const amount of ['10', '11']) {
    const profileId = randomUUID();
    await db.pool.query("INSERT INTO profiles(id,user_id) VALUES($1,'unknown-callback-owner')", [
      profileId,
    ]);
    await db.pool.query('INSERT INTO wallets(profile_id,posted_balance) VALUES($1,$2)', [
      profileId,
      amount,
    ]);
    await db.pool.query(
      "INSERT INTO wallet_transactions(wallet_id,type,state,amount,idempotency_key) VALUES($1,'topup','Completed',$2,$3)",
      [profileId, amount, randomUUID()]
    );
  }
  service = new OnlineTopUpCallbackService(
    new WalletService(),
    { verifyPayment: verify } as unknown as PaymentGateway,
    { webhookSecret: secret, merchantId: merchant }
  );
}, 60000);
afterAll(async () => {
  holder.pool = null;
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE reconciliation_exceptions');
  verify.mockClear();
});
function body(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    merchantOrderId: randomUUID(),
    merchantId: merchant,
    authority: 'private-authority',
    providerRefId: 'private-provider-ref',
    amountIrR: '9007199254740993',
    status: 'paid',
    ...overrides,
  });
}
function signed(
  rawBody: string,
  eventId = randomUUID(),
  signingSecret = secret,
  timestamp = Math.floor(Date.now() / 1000)
) {
  return {
    rawBody,
    headers: {
      eventId,
      timestamp: String(timestamp),
      signature: signPaymentCallback(rawBody, eventId, String(timestamp), signingSecret),
    },
  };
}
async function reports() {
  return (await db.pool.query('SELECT * FROM reconciliation_exceptions ORDER BY id')).rows;
}
async function financialSnapshot() {
  return Object.fromEntries(
    await Promise.all(
      ['wallets', 'wallet_transactions', 'wallet_topup_callback_events'].map(async (table) => [
        table,
        (await db.pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows,
      ])
    )
  );
}
it('records only verified unknown-order callbacks, preserving exact amount, rejection response and every financial row', async () => {
  const raw = body(),
    event = randomUUID(),
    before = await financialSnapshot();
  await expect(service.handle(signed(raw, event))).rejects.toMatchObject({
    response: {
      error: ErrorCodes.PROVIDER_CALLBACK_INVALID.code,
      statusCode: ErrorCodes.PROVIDER_CALLBACK_INVALID.httpStatus,
    },
  });
  const rows = await reports();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    exception_type: 'payment_mismatch',
    severity: 'high',
    status: 'open',
    details: {
      source: 'provider_callback',
      reason: 'unmatched_callback',
      amount: '9007199254740993',
      eventHash: createHash('sha256').update(event).digest('hex'),
    },
  });
  expect(JSON.stringify(rows)).not.toContain('private-authority');
  expect(JSON.stringify(rows)).not.toContain('private-provider-ref');
  expect(JSON.stringify(rows)).not.toContain(secret);
  expect(await financialSnapshot()).toEqual(before);
  expect(verify).not.toHaveBeenCalled();
});
it.each([
  'unsigned',
  'bad-signature',
  'replayed',
  'merchant',
  'invalid-amount',
  'invalid-json',
] as const)('does not turn %s input into a finance incident', async (invalid) => {
  const raw =
    invalid === 'invalid-json'
      ? 'invalid-json'
      : body(
          invalid === 'merchant'
            ? { merchantId: 'other' }
            : invalid === 'invalid-amount'
              ? { amountIrR: '0' }
              : {}
        );
  const input = signed(
    raw,
    randomUUID(),
    invalid === 'bad-signature' ? 'wrong' : secret,
    invalid === 'replayed' ? 1 : Math.floor(Date.now() / 1000)
  );
  if (invalid === 'unsigned') input.headers.signature = '';
  await expect(service.handle(input)).rejects.toThrow();
  expect(await reports()).toHaveLength(0);
  expect(verify).not.toHaveBeenCalled();
});
it('does not report an unverified browser return for an unknown order', async () => {
  await expect(
    service.handleZarinpalReturn({ orderId: randomUUID(), authority: 'untrusted', status: 'OK' })
  ).rejects.toThrow();
  expect(await reports()).toHaveLength(0);
  expect(verify).not.toHaveBeenCalled();
});
it('concurrent and post-closure redelivery retains one immutable event report', async () => {
  const raw = body(),
    event = randomUUID();
  const result = await Promise.allSettled([
    service.handle(signed(raw, event)),
    service.handle(signed(raw, event)),
  ]);
  expect(result.every((r) => r.status === 'rejected')).toBe(true);
  expect(await reports()).toHaveLength(1);
  await db.pool.query(
    "UPDATE reconciliation_exceptions SET status='closed',resolution_note='investigated'"
  );
  const before = await reports();
  await expect(service.handle(signed(body(), event))).rejects.toThrow();
  expect(await reports()).toEqual(before);
  expect(verify).not.toHaveBeenCalled();
});
it('rolls back an unavailable report and allows a later authenticated retry without money mutation', async () => {
  const raw = body(),
    event = randomUUID(),
    before = await financialSnapshot();
  await db.pool.query(
    "CREATE FUNCTION fail_unknown_report() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture report unavailable'; END $$;CREATE TRIGGER fail_unknown_report BEFORE INSERT ON reconciliation_exceptions FOR EACH ROW EXECUTE FUNCTION fail_unknown_report()"
  );
  try {
    await expect(service.handle(signed(raw, event))).rejects.toThrow('fixture report unavailable');
    expect(await reports()).toHaveLength(0);
    expect(await financialSnapshot()).toEqual(before);
  } finally {
    await db.pool.query(
      'DROP TRIGGER fail_unknown_report ON reconciliation_exceptions;DROP FUNCTION fail_unknown_report()'
    );
  }
  await expect(service.handle(signed(raw, event))).rejects.toThrow();
  expect(await reports()).toHaveLength(1);
  expect(await financialSnapshot()).toEqual(before);
});
