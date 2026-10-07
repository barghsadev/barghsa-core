import { completeDueContracts } from './contract-completion';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runMigrations } from './migrate';
const production = resolve('drizzle/production');
const previous = mkdtempSync(join(tmpdir(), 'electricity-lifecycle-notification-upgrade-'));
const scoped = mkdtempSync(join(tmpdir(), 'migration-265-scope-'));
const name = `test_electricity_notice_upgrade_${randomUUID().replaceAll('-', '')}`;
let management: Pool, pool: Pool, connection: { pgdirectUrl: string };
beforeAll(async () => {
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 265),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const entry of prior.entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
  // Keep this historical upgrade/replay proof bound to its original target.
  const own = {
    ...journal,
    entries: journal.entries.filter((entry: { idx: number }) => entry.idx <= 265),
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
async function seed(active = true) {
  const user = randomUUID(),
    profile = randomUUID(),
    order = randomUUID(),
    contract = randomUUID(),
    version = randomUUID(),
    invoice = randomUUID();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'test')", [user]);
    await c.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, user]);
    const product = (
      await c.query(
        `INSERT INTO products(type,system_key,title,status,price)
         VALUES('electricity','thermal','{"en":"Thermal"}','active',100)
         ON CONFLICT (system_key) DO UPDATE SET price=100 RETURNING id`
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO orders(id,user_id,profile_id,product_id,order_type,status,
       snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code)
       VALUES($1,$2,$3,$4,'electricity','PENDING','province','city','Address','1234567890')`,
      [order, user, profile, product]
    );
    await c.query(
      `INSERT INTO electricity_orders(id,profile_id,status,settings_snapshot,period_start,
       period_end,submitted_at,pricing_snapshot,total_kwh,average_power_kw,green_rule_applied,submitted_by)
       VALUES($1,$2,'approved','{}','2000-01-01T00:00:00Z','2000-02-01T00:00:00Z',
       '2000-01-01T00:00:00Z','{}',10,1,false,$3)`,
      [order, profile, user]
    );
    await c.query(
      `INSERT INTO contracts(id,profile_id,order_id,service_type,current_version_id)
       VALUES($1,$2,$3,'electricity',$4)`,
      [contract, profile, order, version]
    );
    await c.query(
      `INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by)
       VALUES($1,$2,1,$3::jsonb,'Initial',$4)`,
      [version, contract, JSON.stringify({ text: 'Terms' }), user]
    );
    await c.query(
      `INSERT INTO invoices(id,profile_id,contract_id,order_id,type,state,total_amount,paid_amount)
       VALUES($1,$2,$3,$4,'auto',$5,100,$6)`,
      [invoice, profile, contract, order, active ? 'Paid' : 'Unpaid', active ? 100 : 0]
    );
    await c.query(
      `UPDATE contract_activation_requirements SET initial_invoice_id=$2,
       service_starts_at='2000-01-01T00:00:00Z',service_ends_at='2000-02-01T00:00:00Z'
       WHERE version_id=$1`,
      [version, invoice]
    );
    await c.query('INSERT INTO electricity_contracts(order_id,contract_id) VALUES($1,$2)', [
      order,
      contract,
    ]);
    await c.query("UPDATE contracts SET state='AwaitingStaffReview' WHERE id=$1", [contract]);
    await c.query(
      'INSERT INTO contract_publications(contract_id,version_id,published_by) VALUES($1,$2,$3)',
      [contract, version, user]
    );
    await c.query(
      'INSERT INTO contract_acceptances(contract_id,version_id,accepted_by) VALUES($1,$2,$3)',
      [contract, version, user]
    );
    if (active)
      await c.query('INSERT INTO contract_activations(contract_id,version_id) VALUES($1,$2)', [
        contract,
        version,
      ]);
    await c.query('COMMIT');
    return { order, contract, version, invoice, profile, user };
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
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
async function deliveries(f: Awaited<ReturnType<typeof seed>>, states: string[], owner = f.user) {
  const rows = (
    await pool.query(
      "SELECT * FROM notification_outbox WHERE event_key='order.status_changed' AND payload->>'orderNumber'=$1 ORDER BY created_at,id",
      [f.order]
    )
  ).rows;
  expect(rows.map((r) => r.payload.status)).toEqual(states);
  for (const row of rows) {
    expect(row).toMatchObject({
      profile_id: f.profile,
      user_id: owner,
      channels: ['in_app', 'email'],
      max_attempts: 5,
      idempotency_key: `order.status_changed:electricity:${f.order}:contract_${row.payload.status}:${f.version}:${owner}`,
      payload: {
        orderNumber: f.order,
        contractId: f.contract,
        link_route: '/electricity/orders/' + f.order,
      },
    });
    const inbox = (
      await pool.query(
        "SELECT * FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text",
        [row.id]
      )
    ).rows;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      recipient_user_id: owner,
      profile_id: f.profile,
      operating_context: 'customer',
      type: 'order.status_changed',
      link_route: '/electricity/orders/' + f.order,
    });
    expect(inbox[0].localized_content.fa.body).toMatch(/[\u0600-\u06ff]/);
    expect(inbox[0].localized_content.en.body).toMatch(/[A-Za-z]/);
    expect(
      (
        await pool.query(
          'SELECT channel,status,attempts,provider_ref FROM notification_job WHERE outbox_id=$1 ORDER BY channel',
          [row.id]
        )
      ).rows
    ).toEqual([
      { channel: 'email', status: 'queued', attempts: 0, provider_ref: null },
      { channel: 'in_app', status: 'done', attempts: 1, provider_ref: inbox[0].id },
    ]);
    expect(
      (
        await pool.query(
          'SELECT channel,status,attempt_number,provider_ref FROM notification_delivery_log WHERE notification_id=$1',
          [row.id]
        )
      ).rows
    ).toEqual([
      { channel: 'in_app', status: 'delivered', attempt_number: 1, provider_ref: inbox[0].id },
    ]);
  }
  return rows;
}
async function activate(f: Awaited<ReturnType<typeof seed>>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("UPDATE invoices SET state='Paid',paid_amount=100 WHERE id=$1", [f.invoice]);
    await client.query('INSERT INTO contract_activations(contract_id,version_id) VALUES($1,$2)', [
      f.contract,
      f.version,
    ]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
async function complete(f: Awaited<ReturnType<typeof seed>>) {
  await pool.query('INSERT INTO contract_completions(contract_id,version_id) VALUES($1,$2)', [
    f.contract,
    f.version,
  ]);
}
async function cancel(f: Awaited<ReturnType<typeof seed>>) {
  const client = await pool.connect(),
    intent = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query(
      "INSERT INTO contract_cancellation_intents(id,contract_id,version_id,actor_id,reason,refund_decision,financial_snapshot,financial_fingerprint,financial_impact_amount,approval_policy,idempotency_key) VALUES($1,$2,$3,$4,'Unpaid cancellation','{\"refunds\":[]}',$5,$6,0,'{\"enabled\":false}',$7)",
      [
        intent,
        f.contract,
        f.version,
        f.user,
        {
          contractId: f.contract,
          versionId: f.version,
          profileId: f.profile,
          state: 'Accepted',
          refundableAmount: '0',
          invoices: [],
        },
        'a'.repeat(64),
        randomUUID(),
      ]
    );
    await client.query(
      "UPDATE contracts SET state='Cancelled',cancelled_at=clock_timestamp() WHERE id=$1",
      [f.contract]
    );
    await client.query(
      'INSERT INTO contract_cancellations(contract_id,intent_id,executed_by) VALUES($1,$2,$3)',
      [f.contract, intent, f.user]
    );
    await client.query("UPDATE invoices SET state='Cancelled' WHERE id=$1 AND paid_amount=0", [
      f.invoice,
    ]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
it('retains every old public row/function through upgrade/replay and emits only future active/completed/cancelled occurrences', async () => {
  const oldActive = await seed(),
    oldCompleted = await seed();
  await complete(oldCompleted);
  const before = await snapshot(),
    defs = await functions();
  expect(await runMigrations({ connection, migrationsFolder: scoped })).toEqual({
    ok: true,
    applied: ['0265_electricity_lifecycle_notifications'],
  });
  expect(await snapshot()).toEqual(before);
  const current = await functions();
  for (const d of defs) expect(current.find((row) => row.oid === d.oid)).toEqual(d);
  expect(await runMigrations({ connection, migrationsFolder: scoped })).toEqual({
    ok: true,
    applied: [],
  });
  expect(await snapshot()).toEqual(before);
  await deliveries(oldActive, []);
  await deliveries(oldCompleted, []);
  const fresh = await seed();
  await deliveries(fresh, ['active']);
  await complete(fresh);
  await deliveries(fresh, ['active', 'completed']);
  const unpaid = await seed(false);
  await cancel(unpaid);
  await deliveries(unpaid, ['cancelled']);
  const saved = await snapshot();
  await pool.query('UPDATE electricity_orders SET status=status WHERE id=ANY($1::uuid[])', [
    [fresh.order, unpaid.order],
  ]);
  const after = await snapshot();
  // The existing timestamp trigger still runs on a no-op UPDATE; delivery remains exact.
  const touched = new Set<string>([fresh.order, unpaid.order]);
  for (const row of after.electricity_orders as Array<Record<string, unknown>>) {
    if (touched.has(row.id as string)) {
      const old = (saved.electricity_orders as Array<Record<string, unknown>>).find(
        (r) => r.id === row.id
      )!;
      expect(Date.parse(row.updated_at as string)).toBeGreaterThanOrEqual(
        Date.parse(old.updated_at as string)
      );
      row.updated_at = old.updated_at;
    }
  }
  expect(after).toEqual(saved);
});
it('keeps system polling idempotent and targets the current owner without rewriting created receipts', async () => {
  const f = await seed(false),
    owner = randomUUID();
  await pool.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'fixture')", [
    owner,
  ]);
  const created = (
    await pool.query(
      "SELECT * FROM notification_outbox WHERE profile_id=$1 AND event_key='contract.created'",
      [f.profile]
    )
  ).rows;
  await pool.query('UPDATE profiles SET user_id=$2 WHERE id=$1', [f.profile, owner]);
  await activate(f);
  await deliveries(f, ['active'], owner);
  expect(
    (
      await pool.query(
        "SELECT * FROM notification_outbox WHERE profile_id=$1 AND event_key='contract.created'",
        [f.profile]
      )
    ).rows
  ).toEqual(created);
  await completeDueContracts(pool);
  await deliveries(f, ['active', 'completed'], owner);
  const before = await snapshot();
  await completeDueContracts(pool);
  expect(await snapshot()).toEqual(before);
});
it.each(['active', 'completed', 'cancelled'])(
  'rolls back every mandatory %s sink on raised and silent failures and recovers',
  async (state) => {
    const f = await seed(state === 'completed');
    const work = () =>
      state === 'active' ? activate(f) : state === 'completed' ? complete(f) : cancel(f);
    const match = `event_key='order.status_changed' AND payload->>'orderNumber'='${f.order}' AND payload->>'status'='${state}'`;
    for (const [table, predicate] of [
      [
        'notification_outbox',
        `NEW.event_key='order.status_changed' AND NEW.payload->>'orderNumber'='${f.order}' AND NEW.payload->>'status'='${state}'`,
      ],
      [
        'in_app_notifications',
        `NEW.type='order.status_changed' AND EXISTS(SELECT 1 FROM notification_outbox WHERE 'outbox:'||id::text=NEW.delivery_key AND ${match})`,
      ],
      [
        'notification_job',
        `EXISTS(SELECT 1 FROM notification_outbox WHERE id=NEW.outbox_id AND ${match})`,
      ],
      [
        'notification_delivery_log',
        `EXISTS(SELECT 1 FROM notification_outbox WHERE id=NEW.notification_id AND ${match})`,
      ],
    ])
      for (const mode of ['raise', 'suppress']) {
        const before = await snapshot();
        await pool.query(
          `CREATE FUNCTION fail_electricity_lifecycle_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN ${mode === 'raise' ? "RAISE EXCEPTION 'lifecycle notice unavailable';" : 'RETURN NULL;'} END IF;RETURN NEW;END $$;CREATE TRIGGER fail_electricity_lifecycle_notice BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_electricity_lifecycle_notice()`
        );
        try {
          await expect(work()).rejects.toMatchObject({
            code: mode === 'raise' ? 'P0001' : '23514',
          });
          expect(await snapshot()).toEqual(before);
        } finally {
          await pool.query(
            `DROP TRIGGER fail_electricity_lifecycle_notice ON ${table};DROP FUNCTION fail_electricity_lifecycle_notice()`
          );
        }
      }
    await work();
    await deliveries(f, state === 'completed' ? ['active', 'completed'] : [state]);
  }
);
it('transactionally removes and restores only the new boundary without changing retained history', async () => {
  const before = await snapshot(),
    client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DROP TRIGGER electricity_lifecycle_customer_notifications ON electricity_orders;DROP FUNCTION notify_electricity_lifecycle_customer()'
    );
    expect(
      (
        await client.query(
          "SELECT * FROM pg_trigger WHERE tgname='electricity_lifecycle_customer_notifications'"
        )
      ).rows
    ).toEqual([]);
    await client.query('ROLLBACK');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect(await snapshot()).toEqual(before);
  expect(
    (
      await pool.query(
        "SELECT * FROM pg_trigger WHERE tgname='electricity_lifecycle_customer_notifications'"
      )
    ).rows
  ).toHaveLength(1);
});
