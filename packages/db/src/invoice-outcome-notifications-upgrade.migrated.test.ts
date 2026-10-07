import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runMigrations } from './migrate';
const production = resolve('drizzle/production');
const previous = mkdtempSync(join(tmpdir(), 'invoice-outcome-notification-upgrade-'));
const name = `test_invoice_outcome_notice_upgrade_${randomUUID().replaceAll('-', '')}`;
let management: Pool, pool: Pool, connection: { pgdirectUrl: string };
beforeAll(async () => {
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 267),
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
async function seed(amount = 1000n, due = '2000-01-01T00:00:00Z') {
  const user = randomUUID(),
    profile = randomUUID(),
    invoice = randomUUID();
  await pool.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'fixture')", [
    user,
  ]);
  await pool.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, user]);
  await pool.query(
    "INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount,due_at) VALUES($1,$2,'Unpaid',$3,0,$4)",
    [invoice, profile, amount.toString(), due]
  );
  return { user, profile, invoice, amount };
}
type Fixture = Awaited<ReturnType<typeof seed>>;
async function pay(f: Fixture) {
  await pool.query(
    "UPDATE invoices SET state='Paid',paid_amount=total_amount,paid_at=clock_timestamp() WHERE id=$1 AND state<>'Paid'",
    [f.invoice]
  );
}
async function overdue(f: Fixture) {
  await pool.query(
    "UPDATE invoices SET state='Overdue',overdue_at=clock_timestamp() WHERE id=$1 AND state<>'Overdue'",
    [f.invoice]
  );
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
  expect(
    (
      await pool.query(
        "SELECT 1 FROM pg_trigger WHERE tgname='invoice_outcome_customer_notifications' AND tgenabled='O'"
      )
    ).rows
  ).toHaveLength(1);
  const rows = (
    await pool.query(
      "SELECT * FROM notification_outbox WHERE profile_id=$1 AND event_key IN ('payment.invoice_paid','payment.invoice_overdue') ORDER BY created_at,id",
      [f.profile]
    )
  ).rows;
  for (const o of rows) {
    expect(o).toMatchObject({
      profile_id: f.profile,
      channels: ['in_app', 'email'],
      max_attempts: 5,
      payload: {
        invoiceId: f.invoice,
        invoiceNumber: f.invoice,
        link_route: `/invoices/${f.invoice}`,
      },
    });
    expect(o.idempotency_key).toBe(
      `${o.event_key}:${f.invoice}:${o.user_id}` +
        (o.event_key === 'payment.invoice_overdue' ? `:${o.payload.dueDate}` : '')
    );
    expect(o.payload.amount).toBe(f.amount.toString());
    expect(Object.keys(o.payload).sort()).toEqual(
      o.event_key === 'payment.invoice_paid'
        ? ['amount', 'invoiceId', 'invoiceNumber', 'link_route', 'paidAt']
        : ['amount', 'dueDate', 'invoiceId', 'invoiceNumber', 'link_route']
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
      link_route: `/invoices/${f.invoice}`,
    });
    expect(n[0].localized_content.fa.body).toContain(o.payload.amount);
    expect(n[0].localized_content.en.body).toContain(o.payload.amount);
    const jobs = (
      await pool.query(
        'SELECT channel,status,priority,attempts,max_attempts,provider_ref FROM notification_job WHERE outbox_id=$1 ORDER BY channel',
        [o.id]
      )
    ).rows;
    const priority = o.event_key === 'payment.invoice_paid' ? 'urgent' : 'normal';
    expect(jobs).toEqual([
      {
        channel: 'email',
        status: 'queued',
        priority,
        attempts: 0,
        max_attempts: 5,
        provider_ref: null,
      },
      {
        channel: 'in_app',
        status: 'done',
        priority,
        attempts: 1,
        max_attempts: 5,
        provider_ref: n[0].id,
      },
    ]);
    expect(
      (
        await pool.query(
          'SELECT channel,status,attempt_number,provider_ref FROM notification_delivery_log WHERE notification_id=$1',
          [o.id]
        )
      ).rows
    ).toEqual([
      { channel: 'in_app', status: 'delivered', attempt_number: 1, provider_ref: n[0].id },
    ]);
  }
  return rows;
}
it('preserves all old public rows/functions and scheduled reminder history on upgrade/replay', async () => {
  const p = await seed(),
    o = await seed();
  await pay(p);
  await overdue(o);
  await pool.query(
    `INSERT INTO invoice_reminder_schedule(invoice_id,"offset",channel,scheduled_at) VALUES($1,1,'in_app',clock_timestamp()+interval '1 hour')`,
    [o.invoice]
  );
  const before = await snapshot(),
    defs = await functions();
  expect(await runMigrations({ connection })).toEqual({
    ok: true,
    applied: ['0267_invoice_outcome_notifications'],
  });
  expect(await snapshot()).toEqual(before);
  const current = await functions();
  for (const d of defs) expect(current.find((r) => r.oid === d.oid)).toEqual(d);
  expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
  expect(await snapshot()).toEqual(before);
  expect(await notices(p)).toEqual([]);
  expect(await notices(o)).toEqual([]);
});
it('records one fully settled bigint invoice receipt and retains all delivered/read history on replay', async () => {
  const f = await seed(9007199254740993n);
  await pay(f);
  expect(await notices(f)).toHaveLength(1);
  await pool.query(
    'UPDATE in_app_notifications SET is_read=true,read_at=clock_timestamp() WHERE profile_id=$1',
    [f.profile]
  );
  const before = await snapshot();
  await pay(f);
  expect(await snapshot()).toEqual(before);
});
it('reports only a past-due remaining amount,keeps existing schedule cancellation and emits a separate paid receipt', async () => {
  const f = await seed();
  await pool.query('UPDATE invoices SET paid_amount=400 WHERE id=$1', [f.invoice]);
  await pool.query(
    `INSERT INTO invoice_reminder_schedule(invoice_id,"offset",channel,scheduled_at) VALUES($1,1,'in_app',clock_timestamp()+interval '1 hour')`,
    [f.invoice]
  );
  await overdue(f);
  const overdueRows = await pool.query(
    "SELECT payload FROM notification_outbox WHERE profile_id=$1 AND event_key='payment.invoice_overdue'",
    [f.profile]
  );
  expect(overdueRows.rows).toHaveLength(1);
  expect(overdueRows.rows[0].payload.amount).toBe('600');
  await pay(f);
  expect(
    (
      await pool.query('SELECT status FROM invoice_reminder_schedule WHERE invoice_id=$1', [
        f.invoice,
      ])
    ).rows
  ).toEqual([{ status: 'cancelled' }]);
  expect(
    (
      await pool.query(
        'SELECT event_key FROM notification_outbox WHERE profile_id=$1 ORDER BY created_at,id',
        [f.profile]
      )
    ).rows.map((r) => r.event_key)
  ).toEqual(['payment.invoice_overdue', 'payment.invoice_paid']);
});
it.each(['null', 'future', 'infinity'])(
  'does not announce overdue for a %s deadline',
  async (due) => {
    const f = await seed(
      1000n,
      due === 'null'
        ? '2000-01-01T00:00:00Z'
        : due === 'future'
          ? '2100-01-01T00:00:00Z'
          : 'infinity'
    );
    if (due === 'null')
      await pool.query('UPDATE invoices SET due_at=NULL WHERE id=$1', [f.invoice]);
    await overdue(f);
    expect(await notices(f)).toEqual([]);
  }
);
it('does not announce a zero-value payment and retains mandatory invoice profile binding', async () => {
  const f = await seed(0n);
  await pay(f);
  expect(await notices(f)).toEqual([]);
  await expect(
    pool.query(
      "INSERT INTO invoices(profile_id,state,total_amount,paid_amount) VALUES(NULL,'Unpaid',100,0)"
    )
  ).rejects.toMatchObject({ code: '23502' });
  expect(
    (
      await pool.query(
        "SELECT id FROM notification_outbox WHERE event_key='payment.invoice_paid' AND profile_id IS NULL"
      )
    ).rows
  ).toEqual([]);
});
it('targets the current owner of a future paid outcome without rewriting the old overdue notice', async () => {
  const f = await seed(),
    next = randomUUID();
  await overdue(f);
  const previous = (await notices(f))[0];
  await pool.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'fixture')", [
    next,
  ]);
  await pool.query('UPDATE profiles SET user_id=$2 WHERE id=$1', [f.profile, next]);
  await pay(f);
  const rows = await notices(f);
  expect(rows[0]).toEqual(previous);
  expect(rows[1].user_id).toBe(next);
});
const failures = ['Paid', 'Overdue'].flatMap((state) =>
  [
    'notification_outbox',
    'in_app_notifications',
    'notification_job',
    'notification_delivery_log',
  ].flatMap((table) => ['raise', 'suppress'].map((mode) => ({ state, table, mode })))
);
it.each(failures)(
  'rolls back original $state and $table on $mode,then recovers',
  async ({ state, table, mode }) => {
    const f = await seed(),
      work = () => (state === 'Paid' ? pay(f) : overdue(f));
    const predicate =
      table === 'notification_outbox'
        ? "NEW.event_key IN ('payment.invoice_paid','payment.invoice_overdue')"
        : table === 'in_app_notifications'
          ? "NEW.type IN ('payment.invoice_paid','payment.invoice_overdue')"
          : `EXISTS(SELECT 1 FROM notification_outbox o WHERE o.id=NEW.${table === 'notification_job' ? 'outbox_id' : 'notification_id'} AND o.event_key IN ('payment.invoice_paid','payment.invoice_overdue'))`;
    const before = await snapshot();
    await pool.query(
      `CREATE FUNCTION fail_invoice_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN ${mode === 'raise' ? "RAISE EXCEPTION 'invoice notice unavailable';" : 'RETURN NULL;'} END IF; RETURN NEW; END $$;CREATE TRIGGER fail_invoice_notice BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_invoice_notice()`
    );
    try {
      await expect(work()).rejects.toMatchObject({ code: mode === 'raise' ? 'P0001' : '23514' });
      expect(await snapshot()).toEqual(before);
    } finally {
      await pool.query(
        `DROP TRIGGER fail_invoice_notice ON ${table};DROP FUNCTION fail_invoice_notice()`
      );
    }
    await work();
    expect(await notices(f)).toHaveLength(1);
  }
);
it('removes/restores only the new trigger transactionally without disturbing payment/reminder receipts', async () => {
  const before = await snapshot(),
    c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      'DROP TRIGGER invoice_outcome_customer_notifications ON invoices;DROP FUNCTION notify_invoice_outcome_customer()'
    );
    expect(
      (
        await c.query(
          "SELECT 1 FROM pg_trigger WHERE tgname='invoice_outcome_customer_notifications'"
        )
      ).rows
    ).toEqual([]);
    await c.query('ROLLBACK');
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
  expect(await snapshot()).toEqual(before);
});
