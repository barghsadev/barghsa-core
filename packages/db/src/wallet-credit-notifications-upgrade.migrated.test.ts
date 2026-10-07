import { postWalletCredit } from './wallet-credit';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runMigrations } from './migrate';
const production = resolve('drizzle/production');
const previous = mkdtempSync(join(tmpdir(), 'wallet-credit-notification-upgrade-'));
const scoped = mkdtempSync(join(tmpdir(), 'migration-268-scope-'));
const name = `test_wallet_credit_notice_upgrade_${randomUUID().replaceAll('-', '')}`;
let management: Pool, pool: Pool, connection: { pgdirectUrl: string };
beforeAll(async () => {
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 268),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const entry of prior.entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
  // Keep this historical upgrade/replay proof bound to its original target.
  const own = {
    ...journal,
    entries: journal.entries.filter((entry: { idx: number }) => entry.idx <= 268),
  };
  mkdirSync(join(scoped, 'meta'));
  writeFileSync(join(scoped, 'meta/_journal.json'), JSON.stringify(own));
  for (const entry of own.entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(scoped, entry.tag + '.sql'));
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = '/' + name;
  connection = { pgdirectUrl: url.toString() };
  expect((await runMigrations({ connection, migrationsFolder: previous })).ok).toBe(true);
  pool = new Pool({ connectionString: url.toString() });
}, 40000);
afterAll(async () => {
  await pool?.end();
  try {
    if (management) await management.query(`DROP DATABASE "${name}"`);
  } finally {
    await management?.end();
    rmSync(previous, { recursive: true, force: true });
    rmSync(scoped, { recursive: true, force: true });
  }
});
async function seed(amount = 25000n) {
  const user = randomUUID(),
    profile = randomUUID();
  await pool.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'fixture')", [
    user,
  ]);
  await pool.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, user]);
  await pool.query('INSERT INTO wallets(profile_id) VALUES($1)', [profile]);
  const pending = (
    await pool.query(
      "INSERT INTO wallet_transactions(wallet_id,type,amount,state,idempotency_key,ref_id,metadata) VALUES($1,'topup',$2,'Pending',$3,'private-authority', $4) RETURNING id",
      [
        profile,
        amount.toString(),
        randomUUID(),
        { channel: 'online', gateway: { authority: 'private-authority' } },
      ]
    )
  ).rows[0].id as string;
  return { user, profile, pending, amount };
}
type Fixture = Awaited<ReturnType<typeof seed>>;
async function credit(
  f: Fixture,
  channel = 'internal',
  type: 'topup' | 'refund' | 'compensating' = 'refund'
) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [f.profile]);
    const result = (await postWalletCredit(
      c,
      { id: f.profile, archived: false },
      f.profile,
      f.amount,
      {
        type,
        refId: 'private-provider-reference',
        metadata: {
          channel,
          pendingTransactionId: f.pending,
          authority: 'private-authority',
          eventId: 'private-event',
        },
      },
      `wallet-credit-notice:${f.pending}`
    )) as { id: string };
    await c.query('COMMIT');
    return result.id;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
async function failure(f: Fixture, state = 'Failed') {
  await pool.query("UPDATE wallet_transactions SET state=$2 WHERE id=$1 AND state='Pending'", [
    f.pending,
    state,
  ]);
}
async function snapshot() {
  const tables = (
    await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
  ).rows;
  const rows: Record<string, unknown> = {};
  for (const { tablename } of tables)
    rows[tablename] = (
      await pool.query(
        `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM "${tablename.replaceAll('"', '""')}" t`
      )
    ).rows[0].rows;
  return rows;
}
async function functions() {
  return (
    await pool.query(
      "SELECT p.oid,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p') ORDER BY p.oid"
    )
  ).rows;
}
async function notices(f: Fixture) {
  const rows = (
    await pool.query(
      "SELECT * FROM notification_outbox WHERE profile_id=$1 AND event_key='wallet.credit_received' ORDER BY created_at,id",
      [f.profile]
    )
  ).rows;
  for (const o of rows) {
    expect(o).toMatchObject({
      profile_id: f.profile,
      channels: ['in_app', 'email'],
      max_attempts: 5,
      idempotency_key: `${o.event_key}:${o.payload.transactionId}:${o.user_id}`,
    });
    expect(o.payload.amount).toBe(f.amount.toString());
    expect(o.payload.link_route).toBe('/wallet');
    expect(Object.keys(o.payload).sort()).toEqual([
      'amount',
      'link_route',
      'reason',
      'transactionId',
    ]);
    const n = (
      await pool.query(
        "SELECT * FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text",
        [o.id]
      )
    ).rows;
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({
      profile_id: f.profile,
      recipient_user_id: o.user_id,
      operating_context: 'customer',
      type: o.event_key,
      link_route: '/wallet',
    });
    expect(n[0].localized_content.fa.body).toContain(f.amount.toString());
    expect(n[0].localized_content.en.body).toContain(f.amount.toString());
    const jobs = (
      await pool.query(
        'SELECT channel,status,priority,attempts,max_attempts,provider_ref FROM notification_job WHERE outbox_id=$1 ORDER BY channel',
        [o.id]
      )
    ).rows;
    expect(jobs).toEqual([
      {
        channel: 'email',
        status: 'queued',
        priority: 'urgent',
        attempts: 0,
        max_attempts: 5,
        provider_ref: null,
      },
      {
        channel: 'in_app',
        status: 'done',
        priority: 'urgent',
        attempts: 1,
        max_attempts: 5,
        provider_ref: n[0].id,
      },
    ]);
    const history = (
      await pool.query(
        'SELECT channel,status,attempt_number,provider_ref FROM notification_delivery_log WHERE notification_id=$1',
        [o.id]
      )
    ).rows;
    expect(history).toEqual([
      { channel: 'in_app', status: 'delivered', attempt_number: 1, provider_ref: n[0].id },
    ]);
    for (const secret of ['private-authority', 'private-provider-reference', 'private-event'])
      expect(JSON.stringify({ o, n, jobs, history })).not.toContain(secret);
  }
  return rows;
}
it('upgrades without changing old rows/functions or backfilling historical credits and failed intents', async () => {
  const completed = await seed(),
    failed = await seed();
  await credit(completed);
  await failure(failed);
  const before = await snapshot(),
    defs = await functions();
  expect(await runMigrations({ connection, migrationsFolder: scoped })).toEqual({
    ok: true,
    applied: ['0268_wallet_credit_notifications'],
  });
  expect(await snapshot()).toEqual(before);
  const current = await functions();
  for (const d of defs) expect(current.find((r) => r.oid === d.oid)).toEqual(d);
  expect(await runMigrations({ connection, migrationsFolder: scoped })).toEqual({
    ok: true,
    applied: [],
  });
  expect(await snapshot()).toEqual(before);
  expect(await notices(completed)).toEqual([]);
  expect(await notices(failed)).toEqual([]);
});

async function reversal(f: Fixture, positive = true) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT id FROM profiles WHERE id=$1 FOR SHARE', [f.profile]);
    await c.query('SELECT profile_id FROM wallets WHERE profile_id=$1 FOR UPDATE', [f.profile]);
    const original = (
      await c.query(
        "INSERT INTO wallet_transactions(wallet_id,type,amount,state,idempotency_key) VALUES($1,$2,$3,'Completed',$4) RETURNING id",
        [
          f.profile,
          positive ? 'payment' : 'topup',
          (positive ? -f.amount : f.amount).toString(),
          randomUUID(),
        ]
      )
    ).rows[0].id;
    const posted = (
      await c.query(
        "INSERT INTO wallet_transactions(wallet_id,type,amount,state,idempotency_key,reverses_transaction_id,description,metadata) VALUES($1,'reversal',$2,'Completed',$3,$4,'private-finance-decision',$5) RETURNING id",
        [
          f.profile,
          (positive ? f.amount : -f.amount).toString(),
          randomUUID(),
          original,
          { reason: 'private-finance-decision' },
        ]
      )
    ).rows[0].id;
    await c.query(
      'UPDATE wallets SET posted_balance=posted_balance+$2,version=version+1 WHERE profile_id=$1',
      [f.profile, (positive ? f.amount : 0n).toString()]
    );
    await c.query('COMMIT');
    return posted;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
it.each(['refund', 'compensating', 'reversal'] as const)(
  'stores one exact bigint private %s credit notice with urgent email,without financial metadata',
  async (type) => {
    const f = await seed(9007199254740993n),
      id = type === 'reversal' ? await reversal(f) : await credit(f, 'internal', type);
    const rows = await notices(f);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.transactionId).toBe(id);
    expect(rows[0].payload.reason).toBe(
      type === 'refund' ? 'بازپرداخت / Refund' : 'اصلاح تراکنش / Transaction correction'
    );
    expect(JSON.stringify(rows)).not.toContain('private-finance-decision');
    expect(
      (
        await pool.query(
          'SELECT posted_balance::text AS balance FROM wallets WHERE profile_id=$1',
          [f.profile]
        )
      ).rows
    ).toEqual([{ balance: f.amount.toString() }]);
  }
);
it('keeps original credit replay and read/provider history immutable', async () => {
  const f = await seed(),
    id = await credit(f),
    rows = await notices(f);
  await pool.query(
    'UPDATE in_app_notifications SET is_read=true,read_at=now() WHERE delivery_key=$1',
    [`outbox:${rows[0].id}`]
  );
  const before = await snapshot();
  expect(await credit(f)).toBe(id);
  expect(await snapshot()).toEqual(before);
});
it('uses current profile owner for a future credit without rewriting prior history', async () => {
  const f = await seed(),
    next = randomUUID();
  await credit(f);
  const old = (await notices(f))[0];
  await pool.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'fixture')", [
    next,
  ]);
  await pool.query('UPDATE profiles SET user_id=$2 WHERE id=$1', [f.profile, next]);
  await reversal(f);
  const rows = await notices(f);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toEqual(old);
  expect(rows[1].user_id).toBe(next);
});
it.each(['topup', 'negative_reversal', 'pending_refund', 'negative_compensating'] as const)(
  'does not emit a wallet credit receipt for %s',
  async (kind) => {
    const f = await seed();
    if (kind === 'topup') await credit(f, 'bank_receipt', 'topup');
    else if (kind === 'negative_reversal') await reversal(f, false);
    else
      await pool.query(
        'INSERT INTO wallet_transactions(wallet_id,type,amount,state,idempotency_key) VALUES($1,$2,$3,$4,$5)',
        [
          f.profile,
          kind === 'pending_refund' ? 'refund' : 'compensating',
          (kind === 'pending_refund' ? f.amount : -f.amount).toString(),
          kind === 'pending_refund' ? 'Pending' : 'Completed',
          randomUUID(),
        ]
      );
    expect(await notices(f)).toEqual([]);
  }
);
it.each(
  (['refund', 'compensating', 'reversal'] as const).flatMap((type) =>
    [
      'notification_outbox',
      'in_app_notifications',
      'notification_job',
      'notification_delivery_log',
    ].flatMap((table) => ['raise', 'silent'].map((mode) => ({ type, table, mode })))
  )
)(
  'rolls back $type credit after $mode in $table,then recovers one exact ledger/delivery',
  async ({ type, table, mode }) => {
    const f = await seed(),
      before = await snapshot();
    const predicate =
      table === 'notification_outbox'
        ? "NEW.event_key='wallet.credit_received'"
        : table === 'in_app_notifications'
          ? "NEW.type='wallet.credit_received'"
          : `EXISTS(SELECT 1 FROM notification_outbox o WHERE o.id=NEW.${table === 'notification_job' ? 'outbox_id' : 'notification_id'} AND o.event_key='wallet.credit_received')`;
    await pool.query(
      `CREATE FUNCTION fail_credit_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN ${mode === 'raise' ? "RAISE EXCEPTION 'credit notice unavailable';" : 'RETURN NULL;'} END IF; RETURN NEW; END $$; CREATE TRIGGER fail_credit_notice BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_credit_notice()`
    );
    try {
      await expect(
        type === 'reversal' ? reversal(f) : credit(f, 'internal', type)
      ).rejects.toMatchObject({ code: mode === 'raise' ? 'P0001' : '23514' });
      expect(await snapshot()).toEqual(before);
    } finally {
      await pool.query(
        `DROP TRIGGER fail_credit_notice ON ${table};DROP FUNCTION fail_credit_notice()`
      );
    }
    const id = type === 'reversal' ? await reversal(f) : await credit(f, 'internal', type);
    expect((await notices(f))[0].payload.transactionId).toBe(id);
    expect(
      (
        await pool.query(
          'SELECT posted_balance::text AS balance FROM wallets WHERE profile_id=$1',
          [f.profile]
        )
      ).rows
    ).toEqual([{ balance: f.amount.toString() }]);
  }
);
it('transactionally drops only the new trigger/function and retains prior receipts', async () => {
  const before = await snapshot(),
    c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      'DROP TRIGGER wallet_credit_customer_notifications ON wallet_transactions;DROP FUNCTION notify_wallet_credit_customer()'
    );
    expect(
      (
        await c.query(
          "SELECT 1 FROM pg_trigger WHERE tgname='wallet_credit_customer_notifications'"
        )
      ).rows
    ).toEqual([]);
    await c.query('ROLLBACK');
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
  expect(await snapshot()).toEqual(before);
  expect(
    (
      await pool.query(
        "SELECT 1 FROM pg_trigger WHERE tgname='wallet_credit_customer_notifications'"
      )
    ).rows
  ).toHaveLength(1);
});
