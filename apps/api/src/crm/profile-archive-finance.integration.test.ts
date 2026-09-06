import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import { WalletService } from '../wallet/wallet.service.js';
import { OnlineTopUpService } from '../wallet/online-topup.service.js';
import { BankReceiptTopUpService } from '../wallet/bank-receipt-topup.service.js';

const holder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }));
vi.mock('@barghsa/db', async (original) => ({
  ...(await original<typeof import('@barghsa/db')>()),
  getDbPool: () => holder.pool!,
}));
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let profileId: string, attachmentKey: string, headers: Record<string, string>;
let online: OnlineTopUpService, bank: BankReceiptTopUpService;
let gatewayStarts = 0;
beforeEach(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  holder.pool = http.pool;
  await http.pool.query(`INSERT INTO users(user_id,username,password_hash,is_admin) VALUES
    ('archive-owner','archive-owner@example.test','test-only',false),('archive-staff','archive-staff@example.test','test-only',true)`);
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES ($1,'archive-staff',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [session, csrf, randomUUID()]
  );
  headers = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
  profileId = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,status) VALUES ('archive-owner','ACTIVE') RETURNING id"
    )
  ).rows[0].id;
  await http.pool.query('INSERT INTO wallets(profile_id) VALUES ($1)', [profileId]);
  attachmentKey = `uploads/document/${randomUUID()}.pdf`;
  await http.pool.query(
    `INSERT INTO storage_records(storage_key,status,metadata) VALUES ($1,'active',$2::jsonb)`,
    [
      attachmentKey,
      JSON.stringify({
        verified: true,
        uploadedBy: 'archive-owner',
        profileId,
        purpose: 'bank_receipt',
      }),
    ]
  );
  gatewayStarts = 0;
  const wallet = new WalletService();
  online = new OnlineTopUpService(wallet, {
    async startPayment() {
      gatewayStarts++;
      return { authority: 'test-authority', redirectUrl: 'https://pay.test/start' };
    },
    async recoverPayment() {
      return null;
    },
    async verifyPayment() {
      return { paid: false, providerRefId: null };
    },
  });
  bank = new BankReceiptTopUpService(wallet);
}, 40000);
afterEach(async () => {
  holder.pool = null;
  await http?.close();
}, 15000);
const archive = () =>
  fetch(`${http.base}/api/crm/profiles/${profileId}`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ reason: 'Closure requested' }),
  });
function topup(channel: 'online' | 'bank') {
  return channel === 'online'
    ? online.initiate({ profileId, amountIrR: 100000n, idempotencyKey: randomUUID() })
    : bank.submit({
        profileId,
        amount: '100000',
        paymentDate: '2026-08-15',
        payerReference: 'archive-test',
        attachmentKey,
        idempotencyKey: randomUUID(),
        actorId: 'archive-owner',
      });
}
for (const channel of ['online', 'bank'] as const) {
  it(`keeps a zero-balance profile active until its ${channel} top-up is resolved`, async () => {
    const pending = await topup(channel);
    expect((await archive()).status, http.logs()).toBe(409);
    expect(
      (await http.pool.query('SELECT archived FROM profiles WHERE id=$1', [profileId])).rows[0]
        .archived
    ).toBe(false);
    await http.pool.query("UPDATE wallet_transactions SET state='Rejected' WHERE id=$1", [
      pending.transactionId,
    ]);
    expect((await archive()).status).toBe(200);
    await expect(topup(channel)).rejects.toMatchObject({ status: 409 });
    expect(
      (await http.pool.query('SELECT id FROM wallet_transactions WHERE wallet_id=$1', [profileId]))
        .rows
    ).toHaveLength(1);
  });
  it(`rejects ${channel} initiation after a concurrent archive commits`, async () => {
    const client = await http.pool.connect();
    let operation: ReturnType<typeof topup> | undefined;
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [profileId]);
      operation = topup(channel);
      // Attach rejection handling before releasing the lock.
      const rejected = expect(operation).rejects.toMatchObject({ status: 409 });
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(`SELECT count(*) AS count FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock' AND query='SELECT archived FROM profiles WHERE id=$1 FOR SHARE'`)
            ).rows[0].count
          )
        )
        .toBe(1);
      await client.query('UPDATE profiles SET archived=true WHERE id=$1', [profileId]);
      await client.query('COMMIT');
      await rejected;
      expect(gatewayStarts).toBe(0);
      expect(
        (
          await http.pool.query('SELECT id FROM wallet_transactions WHERE wallet_id=$1', [
            profileId,
          ])
        ).rows
      ).toHaveLength(0);
      expect(
        (
          await http.pool.query('SELECT status FROM storage_records WHERE storage_key=$1', [
            attachmentKey,
          ])
        ).rows[0].status
      ).toBe('active');
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await operation?.catch(() => {});
    }
  });
  it(`archive waits for a ${channel} submission already holding the profile lock`, async () => {
    const client = await http.pool.connect();
    let submitting: ReturnType<typeof topup> | undefined, archiving: Promise<Response> | undefined;
    try {
      await client.query('BEGIN');
      await client.query('SELECT profile_id FROM wallets WHERE profile_id=$1 FOR UPDATE', [
        profileId,
      ]);
      submitting = topup(channel);
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(`SELECT count(*) AS count FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SELECT profile_id FROM wallets%FOR UPDATE%'`)
            ).rows[0].count
          )
        )
        .toBe(1);
      archiving = archive();
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(`SELECT count(*) AS count FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SELECT id,user_id,profile_type,status,archived FROM profiles%'`)
            ).rows[0].count
          )
        )
        .toBe(1);
      await client.query('COMMIT');
      await submitting;
      expect((await archiving).status).toBe(409);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await submitting;
      await archiving;
    }
  });
}

async function prepareOrder() {
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,'archive-owner',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
    [session, csrf, randomUUID()]
  );
  // Seed an allowed system product in this isolated migrated database.
  const productId = (
    await http.pool.query(
      "INSERT INTO products(type,system_key,title,status,price) VALUES ('electricity','thermal_electricity','{\"en\":\"Thermal\"}','active',100000) RETURNING id"
    )
  ).rows[0].id;
  const provinceId = (
    await http.pool.query(
      "INSERT INTO provinces(name_fa,name_en) VALUES ('استان','Province') RETURNING id"
    )
  ).rows[0].id;
  const cityId = (
    await http.pool.query(
      "INSERT INTO cities(province_id,name_fa,name_en) VALUES ($1,'شهر','City') RETURNING id",
      [provinceId]
    )
  ).rows[0].id;
  const create = () =>
    fetch(`${http.base}/api/orders`, {
      method: 'POST',
      headers: {
        Cookie: `barghsa_session=${session}`,
        'X-CSRF-Token': csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        profileId,
        productId,
        orderType: 'electricity',
        address: { provinceId, cityId, fullAddress: 'Order Street', postalCode: '1234567890' },
      }),
    });
  return { productId, create };
}
it('creates an order against the migrated product schema and blocks archival while it is active', async () => {
  const { create } = await prepareOrder();
  const response = await create();
  expect(response.status, http.logs()).toBe(201);
  expect(await response.json()).toMatchObject({ snapshotFullAddress: 'Order Street' });
  expect((await archive()).status).toBe(409);
});
it('order creation rechecks archival after waiting for the profile lock', async () => {
  const { create } = await prepareOrder();
  const client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query('UPDATE profiles SET archived=true WHERE id=$1', [profileId]);
    pending = create();
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%AND NOT archived FOR SHARE%'"
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await client.query('COMMIT');
    expect((await pending).status).toBe(404);
    expect(
      (await http.pool.query('SELECT id FROM orders WHERE profile_id=$1', [profileId])).rows
    ).toHaveLength(0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pending;
  }
});
it('archival waits for an order already holding the profile lock and then sees the committed order', async () => {
  const { productId, create } = await prepareOrder();
  const client = await http.pool.connect();
  let creating: Promise<Response> | undefined, archiving: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM products WHERE id=$1 FOR UPDATE', [productId]);
    creating = create();
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SELECT id, type, price FROM products%'"
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    archiving = archive();
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SELECT id,user_id,profile_type,status,archived FROM profiles%'"
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await client.query('COMMIT');
    expect((await creating).status, http.logs()).toBe(201);
    expect((await archiving).status).toBe(409);
    expect(
      (await http.pool.query('SELECT archived FROM profiles WHERE id=$1', [profileId])).rows[0]
        .archived
    ).toBe(false);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await creating;
    await archiving;
  }
});
