import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runMigrations } from './migrate';
const production = resolve('drizzle/production');
const previous = mkdtempSync(join(tmpdir(), 'electricity-system-audit-upgrade-'));
const name = 'test_electricity_system_audit_' + randomUUID().replaceAll('-', '');
let pool: Pool, management: Pool, connection: { pgdirectUrl: string };
let historical: Awaited<ReturnType<typeof snapshot>>, legacy: Awaited<ReturnType<typeof seed>>;
let migration: Awaited<ReturnType<typeof runMigrations>>;
const oldFunctions = () => {
  const sql = readFileSync(join(production, '0158_electricity_increase_expiry.sql'), 'utf8');
  return ['finalize_paid_electricity_increase', 'expire_electricity_increase'].map((name) => {
    const start = sql.indexOf('FUNCTION ' + name + '('),
      first = sql.lastIndexOf('CREATE', start),
      end = sql.indexOf('END $$;', start) + 'END $$;'.length;
    return sql
      .slice(first, end)
      .replace(/^CREATE(?: OR REPLACE)? FUNCTION/, 'CREATE OR REPLACE FUNCTION');
  });
};
beforeAll(async () => {
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((e: { idx: number }) => e.idx < 251),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const e of prior.entries)
    copyFileSync(join(production, e.tag + '.sql'), join(previous, e.tag + '.sql'));
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = '/' + name;
  connection = { pgdirectUrl: url.toString() };
  expect((await runMigrations({ connection, migrationsFolder: previous })).ok).toBe(true);
  pool = new Pool({ connectionString: url.toString() });
  legacy = await seed();
  expect((await expire(legacy)).rows[0].disposition).toBe('unsigned');
  historical = await snapshot(legacy);
  migration = await runMigrations({ connection });
}, 30000);
afterAll(async () => {
  await pool?.end();
  try {
    if (management) await management.query(`DROP DATABASE "${name}"`);
  } finally {
    await management?.end();
    rmSync(previous, { recursive: true, force: true });
  }
}, 30000);
async function seed(signed = false) {
  const actor = randomUUID(),
    profile = randomUUID(),
    order = randomUUID(),
    contract = randomUUID(),
    version = randomUUID(),
    request = randomUUID(),
    baseInvoice = randomUUID(),
    invoice = randomUUID();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'test')", [
      actor,
    ]);
    await c.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, actor]);
    const product = (
      await c.query(
        `INSERT INTO products(type,system_key,title,status,price) VALUES('electricity','thermal','{"en":"Thermal"}','active',100) ON CONFLICT(system_key) DO UPDATE SET price=100 RETURNING id`
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO orders(id,user_id,profile_id,product_id,order_type,status,snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code) VALUES($1,$2,$3,$4,'electricity','CONFIRMED','province','city','Address','1234567890')`,
      [order, actor, profile, product]
    );
    await c.query(
      `INSERT INTO electricity_orders(id,profile_id,status,settings_snapshot,period_start,period_end,submitted_at,pricing_snapshot,total_kwh,average_power_kw,green_rule_applied,submitted_by) VALUES($1,$2,'draft','{}','2020-01-01T00:00:00Z','2030-01-01T00:00:00Z',NOW(),'{}',10,1,false,$3)`,
      [order, profile, actor]
    );
    await c.query(
      "INSERT INTO contracts(id,profile_id,order_id,service_type,current_version_id) VALUES($1,$2,$3,'electricity',$4)",
      [contract, profile, order, version]
    );
    await c.query(
      "INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,$4::jsonb,'Initial',$3)",
      [version, contract, actor, JSON.stringify({ text: 'Terms' })]
    );
    await c.query(
      `INSERT INTO electricity_quantity_increase_requests(id,contract_id,order_id,profile_id,version_id,requested_by,original_kwh,requested_kwh,max_percentage,effective_from,period_end) VALUES($1,$2,$3,$4,$5,$6,10,12,20,'2020-01-01T00:00:00Z','2030-01-01T00:00:00Z')`,
      [request, contract, order, profile, version, actor]
    );
    if (signed) {
      await c.query(
        `INSERT INTO invoices(id,profile_id,contract_id,order_id,type,state,total_amount) VALUES($1,$2,$3,$4,'auto','Unpaid',100)`,
        [baseInvoice, profile, contract, order]
      );
      await c.query(
        'UPDATE contract_activation_requirements SET initial_invoice_id=$2 WHERE version_id=$1',
        [version, baseInvoice]
      );
      await c.query(
        `UPDATE electricity_quantity_increase_requests SET status='awaiting_signature',reviewed_by=$2,reviewed_at=NOW(),amendment_document='{}',amendment_sha256=repeat('a',64) WHERE id=$1`,
        [request, actor]
      );
      await c.query(
        `INSERT INTO invoices(id,profile_id,contract_id,order_id,type,state,total_amount,adjustment_for_invoice_id,adjustment_kind) VALUES($1,$2,$3,$4,'manual','Unpaid',20,$5,'charge')`,
        [invoice, profile, contract, order, baseInvoice]
      );
      await c.query(
        `UPDATE electricity_quantity_increase_requests SET status='awaiting_payment',signature_evidence='{}',signed_at=NOW(),pricing_snapshot='{"eligibleFrom":"2020-01-01T00:00:00Z"}',adjustment_amount=20,adjustment_invoice_id=$2 WHERE id=$1`,
        [request, invoice]
      );
    }
    await c.query('COMMIT');
    return { actor, profile, order, contract, version, request, invoice };
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
const expire = (f: { request: string }, executor: Pool | import('pg').PoolClient = pool) =>
  executor.query("SELECT expire_electricity_increase($1,'2030-01-02T00:00:00Z') AS disposition", [
    f.request,
  ]);
async function snapshot(f: Awaited<ReturnType<typeof seed>>) {
  return {
    request: (
      await pool.query('SELECT * FROM electricity_quantity_increase_requests WHERE id=$1', [
        f.request,
      ])
    ).rows,
    invoices: (await pool.query('SELECT * FROM invoices WHERE order_id=$1 ORDER BY id', [f.order]))
      .rows,
    audits: (await pool.query('SELECT * FROM audit_log WHERE user_id=$1 ORDER BY id', [f.actor]))
      .rows,
    notices: (
      await pool.query(
        'SELECT * FROM in_app_notifications WHERE recipient_user_id=$1 ORDER BY id',
        [f.actor]
      )
    ).rows,
    contract: (await pool.query('SELECT * FROM contracts WHERE id=$1', [f.contract])).rows,
  };
}
it('upgrades from250 without rewriting prior audits, requests, contracts, invoices or notices and replays safely', async () => {
  expect(migration).toEqual({ ok: true, applied: ['0251_electricity_increase_audit'] });
  expect(await snapshot(legacy)).toEqual(historical);
  expect(historical.audits).toHaveLength(1);
  expect(JSON.parse(historical.audits[0].metadata)).not.toHaveProperty('entity');
  expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
  expect(await snapshot(legacy)).toEqual(historical);
});
it('records exact pending and signed expiry with only unpaid invoice cancellation, then makes retries no-ops', async () => {
  for (const signed of [false, true]) {
    const f = await seed(signed);
    const before = await snapshot(f);
    expect((await expire(f)).rows[0].disposition).toBe(signed ? 'invoice_cancelled' : 'unsigned');
    const after = await snapshot(f);
    expect(after.contract).toEqual(before.contract);
    expect(after.request[0].status).toBe('expired');
    const events = after.audits.map((r) => ({ ...r, metadata: JSON.parse(r.metadata) }));
    expect(events).toHaveLength(signed ? 2 : 1);
    const expiry = events.filter((r) => r.event === 'electricity.increase_expired');
    expect(expiry).toHaveLength(1);
    expect(expiry[0]).toMatchObject({
      user_id: f.actor,
      operating_context: null,
      created_at: new Date('2030-01-02T00:00:00Z'),
    });
    expect(expiry[0].correlation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(expiry[0].metadata).toMatchObject({
      entity: 'electricity_quantity_increase_request',
      entityId: f.request,
      fromState: signed ? 'awaiting_payment' : 'pending',
      toState: 'expired',
      reason: 'Electricity increase delivery period ended',
      actor: 'system',
      actorType: 'system',
      profileId: f.profile,
      affectedUserId: f.actor,
    });
    if (signed) {
      const cancelled = events.filter((r) => r.event === 'invoice.cancel');
      expect(cancelled).toHaveLength(1);
      expect(cancelled[0].metadata).toMatchObject({
        entity: 'invoice',
        entityId: f.invoice,
        fromState: 'Unpaid',
        toState: 'Cancelled',
        actor: 'system',
        actorType: 'system',
        reason: 'Electricity increase delivery period ended',
      });
      expect(after.invoices.find((r) => r.id === f.invoice)).toMatchObject({
        state: 'Cancelled',
        paid_amount: '0',
      });
    }
    expect((await expire(f)).rows[0].disposition).toBe('skipped');
    expect(await snapshot(f)).toEqual(after);
  }
});
it.each(['invoice.cancel', 'electricity.increase_expired'])(
  'rolls back request, invoice, audits and notices when %s audit persistence fails and retries safely',
  async (event) => {
    const f = await seed(true),
      before = await snapshot(f);
    await pool.query(
      `CREATE FUNCTION test_reject_increase_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='${event}' THEN RAISE EXCEPTION 'increase audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_reject_increase_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION test_reject_increase_audit()`
    );
    try {
      await expect(expire(f)).rejects.toThrow('increase audit unavailable');
      expect(await snapshot(f)).toEqual(before);
    } finally {
      await pool.query(
        'DROP TRIGGER test_reject_increase_audit ON audit_log;DROP FUNCTION test_reject_increase_audit()'
      );
    }
    expect((await expire(f)).rows[0].disposition).toBe('invoice_cancelled');
    expect((await snapshot(f)).audits).toHaveLength(2);
  }
);
it('can roll back both function replacements transactionally without losing history or forward compatibility', async () => {
  const f = await seed(),
    before = await snapshot(f),
    client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const sql of oldFunctions()) await client.query(sql);
    expect((await expire(f, client)).rows[0].disposition).toBe('unsigned');
    const rows = (await client.query('SELECT metadata FROM audit_log WHERE user_id=$1', [f.actor]))
      .rows;
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].metadata)).not.toHaveProperty('entity');
    await client.query('ROLLBACK');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect(await snapshot(f)).toEqual(before);
  expect((await expire(f)).rows[0].disposition).toBe('unsigned');
  expect(JSON.parse((await snapshot(f)).audits[0].metadata)).toMatchObject({
    entity: 'electricity_quantity_increase_request',
    actor: 'system',
  });
  expect(await snapshot(legacy)).toEqual(historical);
});
