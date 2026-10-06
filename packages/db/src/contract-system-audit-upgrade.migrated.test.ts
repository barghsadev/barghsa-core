import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runMigrations } from './migrate';
const production = resolve('drizzle/production');
const previous = mkdtempSync(join(tmpdir(), 'contract-system-audit-upgrade-'));
const name = 'test_contract_system_audit_' + randomUUID().replaceAll('-', '');
let pool: Pool, management: Pool, connection: { pgdirectUrl: string };
beforeAll(async () => {
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((e: { idx: number }) => e.idx < 250),
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
async function seed(pool: Pool) {
  const actor = randomUUID(),
    profile = randomUUID(),
    id = randomUUID(),
    version = randomUUID(),
    invoice = randomUUID();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'test')", [
      actor,
    ]);
    await c.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, actor]);
    await c.query(
      'INSERT INTO contracts(id,profile_id,service_type,current_version_id) VALUES($1,$2,$3,$4)',
      [id, profile, 'savings', version]
    );
    await c.query(
      "INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,$3::jsonb,'Initial',$4)",
      [version, id, JSON.stringify({ text: 'Terms' }), actor]
    );
    await c.query(
      "UPDATE contract_activation_requirements SET service_starts_at='2000-01-01T00:00:00Z',service_ends_at='2000-02-01T00:00:00Z' WHERE version_id=$1",
      [version]
    );
    {
      await c.query("UPDATE contracts SET state='AwaitingStaffReview' WHERE id=$1", [id]);
      await c.query(
        'INSERT INTO contract_publications(contract_id,version_id,published_by) VALUES($1,$2,$3)',
        [id, version, actor]
      );
      await c.query(
        'INSERT INTO contract_acceptances(contract_id,version_id,accepted_by) VALUES($1,$2,$3)',
        [id, version, actor]
      );
    }
    await c.query('COMMIT');
    return { id, version, profile, actor, invoice };
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

const apply = (
  f: { id: string; version: string },
  kind: 'activation' | 'completion',
  executor: Pool | import('pg').PoolClient = pool
) =>
  executor.query(`INSERT INTO contract_${kind}s(contract_id,version_id) VALUES($1,$2)`, [
    f.id,
    f.version,
  ]);
const audits = (id: string) =>
  pool.query(
    "SELECT *,metadata AS raw_metadata,metadata::jsonb AS metadata FROM audit_log WHERE metadata::jsonb->>'contractId'=$1 ORDER BY created_at,id",
    [id]
  );
it('upgrades existing automatic history without changing old rows, evidence or contracts and replays safely', async () => {
  const f = await seed(pool);
  await apply(f, 'activation');
  await apply(f, 'completion');
  const history = (await audits(f.id)).rows;
  expect(history).toHaveLength(2);
  expect(history.map((r) => r.user_id)).toEqual([f.actor, f.actor]);
  const records = (await pool.query('SELECT * FROM contracts WHERE id=$1', [f.id])).rows;
  const activation = (
    await pool.query('SELECT * FROM contract_activations WHERE contract_id=$1', [f.id])
  ).rows;
  const completion = (
    await pool.query('SELECT * FROM contract_completions WHERE contract_id=$1', [f.id])
  ).rows;
  expect(await runMigrations({ connection })).toEqual({
    ok: true,
    applied: ['0250_contract_system_audit'],
  });
  expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
  expect((await audits(f.id)).rows).toEqual(history);
  expect((await pool.query('SELECT * FROM contracts WHERE id=$1', [f.id])).rows).toEqual(records);
  expect(
    (await pool.query('SELECT * FROM contract_activations WHERE contract_id=$1', [f.id])).rows
  ).toEqual(activation);
  expect(
    (await pool.query('SELECT * FROM contract_completions WHERE contract_id=$1', [f.id])).rows
  ).toEqual(completion);
});
it('distinguishes system identity and exact states from the affected profile owner and context', async () => {
  const f = await seed(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('barghsa.actor_user_id',$1,true),set_config('barghsa.actor_context','customer',true)",
      [f.actor]
    );
    await apply(f, 'activation', client);
    await apply(f, 'completion', client);
    await client.query('COMMIT');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  const rows = (await audits(f.id)).rows;
  expect(rows).toHaveLength(2);
  for (const [event, from, to] of [
    ['contract.activated', 'Accepted', 'Active'],
    ['contract.completed', 'Active', 'Completed'],
  ] as const) {
    const matches = rows.filter((row) => row.event === event);
    expect(matches).toHaveLength(1);
    const row = matches[0]!;
    expect(row).toMatchObject({ event, user_id: f.actor, operating_context: 'customer' });
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.metadata).toMatchObject({
      entity: 'contract',
      entityId: f.id,
      fromState: from,
      toState: to,
      reason: null,
      actorType: 'system',
      actor: 'system',
      contractId: f.id,
      versionId: f.version,
      profileId: f.profile,
      profileOwnerUserId: f.actor,
    });
  }
  await expect(
    pool.query('UPDATE audit_log SET metadata=metadata WHERE id=$1', [rows[0].id])
  ).rejects.toMatchObject({ code: '55000' });
});
it.each(['activation', 'completion'] as const)(
  'rolls back %s state and evidence on audit failure and allows one corrected retry',
  async (kind) => {
    const f = await seed(pool);
    if (kind === 'completion') await apply(f, 'activation');
    const before = (await audits(f.id)).rows;
    const event = kind === 'activation' ? 'contract.activated' : 'contract.completed';
    await pool.query(
      `CREATE FUNCTION test_reject_system_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='${event}' THEN RAISE EXCEPTION 'system audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_reject_system_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION test_reject_system_audit()`
    );
    try {
      await expect(apply(f, kind)).rejects.toThrow('system audit unavailable');
      expect(
        (await pool.query('SELECT state FROM contracts WHERE id=$1', [f.id])).rows[0].state
      ).toBe(kind === 'activation' ? 'Accepted' : 'Active');
      expect(
        (await pool.query(`SELECT * FROM contract_${kind}s WHERE contract_id=$1`, [f.id])).rows
      ).toHaveLength(0);
      expect((await audits(f.id)).rows).toEqual(before);
    } finally {
      await pool.query(
        'DROP TRIGGER test_reject_system_audit ON audit_log;DROP FUNCTION test_reject_system_audit()'
      );
    }
    await apply(f, kind);
    expect((await audits(f.id)).rows).toHaveLength(before.length + 1);
  }
);
it('can restore prior trigger functions transactionally while keeping immutable history and forward compatibility', async () => {
  const f = await seed(pool),
    client = await pool.connect();
  const original = ['0143_contract_system_activation', '0144_contract_term_completion'].map(
    (tag) => {
      const sql = readFileSync(join(production, tag + '.sql'), 'utf8');
      const match = sql.match(
        /CREATE FUNCTION apply_contract_(?:activation|completion)\(\)[\s\S]*?END \$\$;/
      );
      if (!match) throw new Error('Missing prior function');
      return match[0].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
    }
  );
  try {
    await client.query('BEGIN');
    for (const sql of original) await client.query(sql);
    await apply(f, 'activation', client);
    expect(
      (
        await client.query(
          "SELECT user_id FROM audit_log WHERE event='contract.activated' AND metadata::jsonb->>'contractId'=$1",
          [f.id]
        )
      ).rows
    ).toEqual([{ user_id: f.actor }]);
    await client.query('ROLLBACK');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect((await audits(f.id)).rows).toHaveLength(0);
  expect((await pool.query('SELECT state FROM contracts WHERE id=$1', [f.id])).rows[0].state).toBe(
    'Accepted'
  );
  await apply(f, 'activation');
  expect((await audits(f.id)).rows[0]).toMatchObject({
    user_id: f.actor,
    metadata: expect.objectContaining({
      entity: 'contract',
      fromState: 'Accepted',
      toState: 'Active',
    }),
  });
});
