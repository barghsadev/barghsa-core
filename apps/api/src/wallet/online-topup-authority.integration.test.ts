import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db';
import { WalletService } from './wallet.service.js';
import { OnlineTopUpService, onlineTopUpAdvisoryLockKeys } from './online-topup.service.js';
import type { PaymentGateway } from './payment-gateway.js';

const holder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }));
vi.mock('@barghsa/db', async (original) => ({
  ...(await original<typeof import('@barghsa/db')>()),
  getDbPool: () => holder.pool!,
}));
let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
beforeAll(async () => {
  db = await createMigratedTestDb();
  holder.pool = db.pool;
}, 60000);
afterAll(async () => {
  holder.pool = null;
  await db?.close();
});

async function seed() {
  const userId = randomUUID(),
    owner = randomUUID(),
    profileId = randomUUID();
  const actor = {
    userId,
    sessionId: randomUUID(),
    csrfToken: randomUUID(),
    correlationId: randomUUID(),
  };
  await db.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ($1,$1,'test-only'),($2,$2,'test-only')",
    [userId, owner]
  );
  await db.pool.query(
    "INSERT INTO profiles(id,user_id,profile_type,status) VALUES ($1,$2,'LEGAL','ACTIVE')",
    [profileId, owner]
  );
  await db.pool.query(
    "INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,$2,'Finance')",
    [profileId, userId]
  );
  await db.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,$2,$3,$1,NOW()+INTERVAL '1 hour',NOW()+INTERVAL '30 minutes')",
    [actor.sessionId, userId, actor.csrfToken]
  );
  return { profileId, amountIrR: 1000n, idempotencyKey: randomUUID(), actor, originalOwner: owner };
}
type Input = Awaited<ReturnType<typeof seed>>;
function gateway() {
  const startPayment = vi.fn<PaymentGateway['startPayment']>(async (request) => ({
    authority: `auth-${request.merchantOrderId}`,
    redirectUrl: `https://pay.test/${request.merchantOrderId}`,
  }));
  const recoverPayment = vi.fn<PaymentGateway['recoverPayment']>(async () => null);
  const provider = {
    startPayment,
    recoverPayment,
    verifyPayment: async () => ({ paid: true, providerRefId: 'verified' }),
  };
  return {
    startPayment,
    recoverPayment,
    service: new OnlineTopUpService(new WalletService(), provider),
  };
}
async function empty(input: Input) {
  expect(
    (await db.pool.query('SELECT profile_id FROM wallets WHERE profile_id=$1', [input.profileId]))
      .rows
  ).toEqual([]);
  expect(
    (
      await db.pool.query('SELECT id FROM wallet_transactions WHERE wallet_id=$1', [
        input.profileId,
      ])
    ).rows
  ).toEqual([]);
  expect(
    (await db.pool.query('SELECT id FROM audit_log WHERE user_id=$1', [input.actor.userId])).rows
  ).toEqual([]);
}
async function changeAuthority(input: Input, change: string) {
  const { actor, profileId } = input;
  if (change === 'revoke')
    await db.pool.query('UPDATE sessions SET revoked_at=NOW() WHERE session_id=$1', [
      actor.sessionId,
    ]);
  if (change === 'csrf')
    await db.pool.query("UPDATE sessions SET csrf_token='changed' WHERE session_id=$1", [
      actor.sessionId,
    ]);
  if (change === 'role')
    await db.pool.query('DELETE FROM profile_agents WHERE profile_id=$1 AND user_id=$2', [
      profileId,
      actor.userId,
    ]);
  if (change === 'disabled')
    await db.pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [actor.userId]);
  if (change === 'archive')
    await db.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [profileId]);
  if (change === 'owner')
    await db.pool.query('UPDATE profiles SET user_id=$2 WHERE id=$1', [
      profileId,
      input.originalOwner,
    ]);
}
const status = (change: string) =>
  change === 'role' || change === 'owner'
    ? 404
    : change === 'archive'
      ? 409
      : change === 'csrf'
        ? 403
        : 401;

it('online initiation rejects Manager/Legal/stale Owner but accepts additive Finance permission', async () => {
  const input = await seed(),
    client = gateway();
  for (const role of ['Manager', 'Legal', 'Owner']) {
    await db.pool.query('UPDATE profile_agents SET role=$3 WHERE profile_id=$1 AND user_id=$2', [
      input.profileId,
      input.actor.userId,
      role,
    ]);
    await expect(client.service.initiate(input)).rejects.toMatchObject({ status: 404 });
    await empty(input);
  }
  expect(client.startPayment).not.toHaveBeenCalled();
  await db.pool.query(
    "INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,$2,'Finance')",
    [input.profileId, input.actor.userId]
  );
  await expect(client.service.initiate(input)).resolves.toMatchObject({ state: 'Pending' });
  expect(client.startPayment).toHaveBeenCalledTimes(1);
});

for (const change of ['revoke', 'csrf', 'role', 'disabled', 'archive', 'owner'] as const) {
  it(`online initiation rejects ${change} after waiting on its request identity`, async () => {
    const input = await seed(),
      client = gateway(),
      blocker = await db.pool.connect();
    if (change === 'owner') {
      await db.pool.query('DELETE FROM profile_agents WHERE profile_id=$1', [input.profileId]);
      await db.pool.query('UPDATE profiles SET user_id=$2 WHERE id=$1', [
        input.profileId,
        input.actor.userId,
      ]);
    }
    const keys = onlineTopUpAdvisoryLockKeys(input.idempotencyKey);
    let pending: Promise<unknown> | undefined;
    try {
      await blocker.query('SELECT pg_advisory_lock($1,$2)', keys);
      pending = client.service.initiate(input).then(
        (value) => ({ value }),
        (error) => ({ error })
      );
      await expect
        .poll(async () =>
          Number(
            (
              await db.pool.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT pg_advisory_lock%'"
              )
            ).rows[0].count
          )
        )
        .toBe(1);
      await changeAuthority(input, change);
      await blocker.query('SELECT pg_advisory_unlock($1,$2)', keys);
      expect(await pending).toMatchObject({ error: { status: status(change) } });
      expect(client.startPayment).not.toHaveBeenCalled();
      await empty(input);
    } finally {
      await blocker.query('SELECT pg_advisory_unlock_all()');
      blocker.release();
      await pending;
    }
  });
}

it('online initiation rolls back its new wallet and Pending intent if submission audit fails', async () => {
  const input = await seed(),
    client = gateway();
  await db.pool.query('ALTER TABLE audit_log RENAME TO unavailable_online_audit');
  try {
    await expect(client.service.initiate(input)).rejects.toMatchObject({ code: '42P01' });
    expect(client.startPayment).not.toHaveBeenCalled();
  } finally {
    await db.pool.query('ALTER TABLE unavailable_online_audit RENAME TO audit_log');
  }
  await empty(input);
});

it('online initiation rolls back its new wallet, intent and audit when session expires during insertion', async () => {
  const input = await seed(),
    client = gateway();
  await db.pool.query(
    'CREATE FUNCTION delay_online_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1.2); RETURN NEW; END $$'
  );
  await db.pool.query(
    'CREATE TRIGGER delay_online_intent BEFORE INSERT ON wallet_transactions FOR EACH ROW EXECUTE FUNCTION delay_online_intent()'
  );
  try {
    await db.pool.query(
      "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '800 milliseconds' WHERE session_id=$1",
      [input.actor.sessionId]
    );
    await expect(client.service.initiate(input)).rejects.toMatchObject({ status: 401 });
    await empty(input);
    expect(client.startPayment).not.toHaveBeenCalled();
  } finally {
    await db.pool.query('DROP TRIGGER delay_online_intent ON wallet_transactions');
    await db.pool.query('DROP FUNCTION delay_online_intent()');
  }
});

it('online intent and submission audit commit once; replay keeps balances unchanged', async () => {
  const input = await seed(),
    client = gateway();
  const first = await client.service.initiate(input);
  await expect(client.service.initiate(input)).resolves.toEqual(first);
  expect(client.startPayment).toHaveBeenCalledTimes(1);
  expect(
    (
      await db.pool.query(
        'SELECT posted_balance,reserved_balance FROM wallets WHERE profile_id=$1',
        [input.profileId]
      )
    ).rows
  ).toEqual([{ posted_balance: '0', reserved_balance: '0' }]);
  expect(
    (
      await db.pool.query(
        'SELECT user_id,metadata::jsonb AS metadata,correlation_id FROM audit_log WHERE user_id=$1',
        [input.actor.userId]
      )
    ).rows
  ).toEqual([
    {
      user_id: input.actor.userId,
      metadata: {
        sessionId: input.actor.sessionId,
        profileId: input.profileId,
        transactionId: first.transactionId,
      },
      correlation_id: input.actor.correlationId,
    },
  ]);
});

for (const change of ['revoke', 'csrf', 'role', 'disabled'] as const) {
  it(`online provider result remains recoverable after ${change}, but checkout redirect is withheld`, async () => {
    const input = await seed(),
      client = gateway();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    client.startPayment.mockImplementation(async (request) => {
      await gate;
      return {
        authority: `auth-${request.merchantOrderId}`,
        redirectUrl: `https://pay.test/${request.merchantOrderId}`,
      };
    });
    const pending = client.service.initiate(input).then(
      (value) => ({ value }),
      (error) => ({ error })
    );
    try {
      await expect.poll(() => client.startPayment.mock.calls.length).toBe(1);
      await changeAuthority(input, change);
      release();
      expect(await pending).toMatchObject({ error: { status: status(change) } });
      const rows = (
        await db.pool.query(
          'SELECT id,ref_id,metadata FROM wallet_transactions WHERE wallet_id=$1',
          [input.profileId]
        )
      ).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ ref_id: `auth-${rows[0].id}` });
      await db.pool.query('UPDATE users SET disabled_at=NULL WHERE user_id=$1', [
        input.actor.userId,
      ]);
      await db.pool.query('UPDATE sessions SET revoked_at=NULL,csrf_token=$2 WHERE session_id=$1', [
        input.actor.sessionId,
        input.actor.csrfToken,
      ]);
      await db.pool.query(
        "INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,$2,'Finance') ON CONFLICT DO NOTHING",
        [input.profileId, input.actor.userId]
      );
      await expect(client.service.initiate(input)).resolves.toMatchObject({
        transactionId: rows[0].id,
        redirectUrl: `https://pay.test/${rows[0].id}`,
      });
      expect(client.startPayment).toHaveBeenCalledTimes(1);
      expect(client.recoverPayment).not.toHaveBeenCalled();
    } finally {
      release();
      await pending;
    }
  });
}
