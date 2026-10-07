import { postWalletCredit } from './wallet-credit';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runMigrations } from './migrate';
const production = resolve('drizzle/production');
const previous = mkdtempSync(join(tmpdir(), 'online-topup-notification-upgrade-'));
const name = `test_online_topup_notice_upgrade_${randomUUID().replaceAll('-', '')}`;
let management: Pool, pool: Pool, connection: { pgdirectUrl: string };
beforeAll(async () => {
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 266),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const entry of prior.entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
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
async function credit(f: Fixture, channel = 'online', type: 'topup' | 'refund' = 'topup') {
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
      `wallet-online-topup-credit:${f.pending}`
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
      "SELECT * FROM notification_outbox WHERE profile_id=$1 AND event_key IN ('payment.wallet_topup_completed','payment.wallet_topup_failed') ORDER BY created_at,id",
      [f.profile]
    )
  ).rows;
  for (const o of rows) {
    expect(o).toMatchObject({
      profile_id: f.profile,
      channels: ['in_app', 'email'],
      max_attempts: 5,
      idempotency_key: `${o.event_key}:online:${o.payload.transactionId}:${o.user_id}`,
    });
    expect(o.payload.amount).toBe(f.amount.toString());
    expect(o.payload.link_route).toBe('/wallet');
    expect(Object.keys(o.payload).sort()).toEqual(
      o.event_key === 'payment.wallet_topup_completed'
        ? ['amount', 'link_route', 'transactionId']
        : ['amount', 'link_route', 'reason', 'transactionId']
    );
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
  expect(await runMigrations({ connection })).toEqual({
    ok: true,
    applied: ['0266_online_topup_notifications'],
  });
  expect(await snapshot()).toEqual(before);
  const current = await functions();
  for (const d of defs) expect(current.find((r) => r.oid === d.oid)).toEqual(d);
  expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
  expect(await snapshot()).toEqual(before);
  expect(await notices(completed)).toEqual([]);
  expect(await notices(failed)).toEqual([]);
});
it('records only excess-safe bigint credits and preserves caller idempotency and past read/history state', async () => {
  const f = await seed(9007199254740993n);
  const id = await credit(f);
  const rows = await notices(f);
  expect(rows).toHaveLength(1);
  expect(rows[0].payload.transactionId).toBe(id);
  expect(rows[0].user_id).toBe(f.user);
  expect(
    (
      await pool.query('SELECT posted_balance::text AS balance FROM wallets WHERE profile_id=$1', [
        f.profile,
      ])
    ).rows
  ).toEqual([{ balance: f.amount.toString() }]);
  await pool.query(
    'UPDATE in_app_notifications SET is_read=true,read_at=NOW() WHERE profile_id=$1',
    [f.profile]
  );
  const before = await snapshot();
  expect(await credit(f)).toBe(id);
  expect(await snapshot()).toEqual(before);
});
it.each(['Failed', 'Rejected'])(
  'notifies %s once and allows a later separately verified credit',
  async (state) => {
    const f = await seed();
    await failure(f, state);
    expect((await notices(f)).map((o) => o.event_key)).toEqual(['payment.wallet_topup_failed']);
    const before = await snapshot();
    await failure(f, state);
    expect(await snapshot()).toEqual(before);
    const id = await credit(f);
    const rows = await notices(f);
    expect(rows.map((o) => o.event_key)).toEqual([
      'payment.wallet_topup_failed',
      'payment.wallet_topup_completed',
    ]);
    expect(rows[1].payload.transactionId).toBe(id);
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
it('uses the current locked profile owner for a future outcome without rewriting prior deliveries', async () => {
  const f = await seed(),
    next = randomUUID();
  await failure(f);
  const previous = (await notices(f))[0];
  await pool.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'fixture')", [
    next,
  ]);
  await pool.query('UPDATE profiles SET user_id=$2 WHERE id=$1', [f.profile, next]);
  await credit(f);
  const rows = await notices(f);
  expect(rows[0]).toEqual(previous);
  expect(rows[1].user_id).toBe(next);
});
it.each([
  ['bank_receipt', 'topup'],
  ['online', 'refund'],
] as const)('does not duplicate %s %s delivery', async (channel, type) => {
  const f = await seed();
  await credit(f, channel, type);
  expect(await notices(f)).toEqual([]);
});
it.each(['Completed', 'Failed', 'Rejected'])(
  'rolls back the original %s outcome on every raised/silent mandatory sink and recovers',
  async (state) => {
    const f = await seed(),
      work = () => (state === 'Completed' ? credit(f) : failure(f, state));
    for (const table of [
      'notification_outbox',
      'in_app_notifications',
      'notification_job',
      'notification_delivery_log',
    ])
      for (const mode of ['raise', 'suppress']) {
        const predicate =
          table === 'notification_outbox'
            ? "NEW.event_key IN ('payment.wallet_topup_completed','payment.wallet_topup_failed')"
            : table === 'in_app_notifications'
              ? "NEW.type IN ('payment.wallet_topup_completed','payment.wallet_topup_failed')"
              : `EXISTS(SELECT 1 FROM notification_outbox o WHERE o.id=NEW.${table === 'notification_job' ? 'outbox_id' : 'notification_id'} AND o.event_key IN ('payment.wallet_topup_completed','payment.wallet_topup_failed'))`;
        const before = await snapshot();
        await pool.query(
          `CREATE FUNCTION fail_online_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN ${mode === 'raise' ? "RAISE EXCEPTION 'online notice unavailable';" : 'RETURN NULL;'} END IF;RETURN NEW;END $$;CREATE TRIGGER fail_online_notice BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_online_notice()`
        );
        try {
          await expect(work()).rejects.toMatchObject({
            code: mode === 'raise' ? 'P0001' : '23514',
          });
          expect(await snapshot()).toEqual(before);
        } finally {
          await pool.query(
            `DROP TRIGGER fail_online_notice ON ${table};DROP FUNCTION fail_online_notice()`
          );
        }
      }
    await work();
    expect(await notices(f)).toHaveLength(1);
  }
);
it('rolls back ledger posting for a foreign conflicting delivery occurrence', async () => {
  const f = await seed();
  await pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES('foreign-outcome-recipient','foreign-outcome@example.test','fixture')"
  );
  await pool.query(
    `CREATE FUNCTION conflict_online_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='topup' AND NEW.state='Completed' AND NEW.metadata->>'channel'='online' THEN INSERT INTO notification_outbox(profile_id,user_id,event_key,payload,channels,status,idempotency_key) SELECT NEW.wallet_id,'foreign-outcome-recipient','payment.wallet_topup_completed','{}',ARRAY['in_app','email'],'queued','payment.wallet_topup_completed:online:'||NEW.id::text||':'||p.user_id FROM profiles p WHERE p.id=NEW.wallet_id; END IF; RETURN NEW; END $$;CREATE TRIGGER conflict_online_notice BEFORE INSERT ON wallet_transactions FOR EACH ROW EXECUTE FUNCTION conflict_online_notice()`
  );
  const before = await snapshot();
  try {
    await expect(credit(f)).rejects.toMatchObject({ code: '23514' });
    expect(await snapshot()).toEqual(before);
  } finally {
    await pool.query(
      'DROP TRIGGER conflict_online_notice ON wallet_transactions;DROP FUNCTION conflict_online_notice()'
    );
  }
});
it('transactionally removes/restores only the new trigger boundary while retaining history', async () => {
  const before = await snapshot(),
    c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      'DROP TRIGGER online_topup_customer_notifications ON wallet_transactions;DROP FUNCTION notify_online_topup_customer()'
    );
    expect(
      (await c.query("SELECT 1 FROM pg_trigger WHERE tgname='online_topup_customer_notifications'"))
        .rows
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
        "SELECT 1 FROM pg_trigger WHERE tgname='online_topup_customer_notifications'"
      )
    ).rows
  ).toHaveLength(1);
});
