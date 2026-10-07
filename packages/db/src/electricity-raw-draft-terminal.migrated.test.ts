import { randomUUID } from 'node:crypto';
import { readFileSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createMigratedTestDb } from './test/migrated-db';
import { runMigrations } from './migrate';
let fixture: Awaited<ReturnType<typeof createMigratedTestDb>>;
const folder = resolve('drizzle/production');
beforeAll(async () => {
  fixture = await createMigratedTestDb();
}, 30000);
afterAll(async () => {
  await fixture?.close();
}, 30000);
it('upgrades the unchanged 0252 journal prefix exactly once, preserves old rows, and replays without changes', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'raw-electricity-upgrade-')),
    name = 'raw_upgrade_' + randomUUID().replaceAll('-', '');
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL }),
    url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = '/' + name;
  const pool = new Pool({ connectionString: url.toString() });
  try {
    await management.query(`CREATE DATABASE "${name}"`);
    mkdirSync(join(temp, 'meta'));
    const journal = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { tag: string }) => e.tag < '0253');
    writeFileSync(join(temp, 'meta/_journal.json'), JSON.stringify(journal));
    for (const e of journal.entries)
      symlinkSync(join(folder, e.tag + '.sql'), join(temp, e.tag + '.sql'));
    const options = { connection: { pgdirectUrl: url.toString() } };
    const prior = await runMigrations({ ...options, migrationsFolder: temp });
    expect(prior.ok, prior.error).toBe(true);
    const actor = randomUUID(),
      profile = randomUUID(),
      order = randomUUID();
    await pool.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'test')", [
      actor,
    ]);
    await pool.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, actor]);
    const product = (
      await pool.query(
        "INSERT INTO products(type,system_key,title,status,price) VALUES('electricity','thermal','{}','active',100) ON CONFLICT(system_key) DO UPDATE SET price=100 RETURNING id"
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO orders(id,user_id,profile_id,product_id,order_type,snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code) VALUES($1,$2,$3,$4,'electricity','test','test','PRIVATE raw address','1234567890')",
      [order, actor, profile, product]
    );
    await pool.query(
      "INSERT INTO electricity_orders(id,profile_id,status,settings_snapshot) VALUES($1,$2,'draft','{}')",
      [order, profile]
    );
    const retained = async () =>
      (
        await pool.query(
          'SELECT (SELECT to_jsonb(o) FROM orders o WHERE id=$1) AS root,(SELECT to_jsonb(e) FROM electricity_orders e WHERE id=$1) AS draft',
          [order]
        )
      ).rows[0];
    const oldRecord = await retained();
    const before = (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id'))
      .rows;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        readFileSync(join(folder, '0253_electricity_raw_draft_terminal.sql'), 'utf8')
      );
      await client.query('ROLLBACK');
      expect(
        (
          await client.query(
            "SELECT to_regprocedure('assert_raw_electricity_link_allowed(uuid)') AS function"
          )
        ).rows[0].function
      ).toBeNull();
      expect(
        (
          await client.query(
            "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='electricity_orders_submitted_facts'"
          )
        ).rows[0].definition
      ).not.toContain('rejected');
    } finally {
      client.release();
    }
    const next = await runMigrations(options);
    expect(next).toEqual({
      ok: true,
      applied: [
        '0253_electricity_raw_draft_terminal',
        '0254_electricity_reviewed_rejection',
        '0255_electricity_orphan_draft_gifts',
        '0256_electricity_orphan_financial',
        '0257_electricity_legacy_refund_adoption',
      ],
    });
    expect(
      (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows.slice(0, -5)
    ).toEqual(before);
    expect(await runMigrations(options)).toEqual({ ok: true, applied: [] });
    expect(await retained()).toEqual(oldRecord);
  } finally {
    await pool.end();
    await management.query(`DROP DATABASE IF EXISTS "${name}"`);
    await management.end();
    rmSync(temp, { recursive: true, force: true });
  }
}, 30000);
it('keeps the original settings guard apart from narrow raw transition and terminal retention prefixes', () => {
  const old = readFileSync(join(folder, '0185_electricity_order_revisions.sql'), 'utf8');
  const newer = readFileSync(join(folder, '0253_electricity_raw_draft_terminal.sql'), 'utf8');
  const definition = (text: string) =>
    text.slice(
      text.indexOf('CREATE OR REPLACE FUNCTION guard_electricity_order_settings_snapshot'),
      text.indexOf(
        'END $$;',
        text.indexOf('CREATE OR REPLACE FUNCTION guard_electricity_order_settings_snapshot')
      ) + 7
    );
  const actual = definition(newer)
    .replace(/ {2}IF OLD.status IN \('rejected','cancelled'\)[\s\S]*? {2}END IF;\n/, '')
    .replace(/ {2}-- An unlinked, unfunded raw draft[\s\S]*? {2}THEN RETURN NEW; END IF;\n/, '');
  expect(actual).toBe(definition(old));
});
it('fresh migration keeps ordinary submitted-order requirements and refuses arbitrary raw rejection', async () => {
  const actor = randomUUID(),
    profile = randomUUID(),
    id = randomUUID();
  await fixture.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'test')",
    [actor]
  );
  await fixture.pool.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, actor]);
  const product = (
    await fixture.pool.query(
      "INSERT INTO products(type,system_key,title,status,price) VALUES('electricity','thermal','{}','active',100) ON CONFLICT(system_key) DO UPDATE SET price=100 RETURNING id"
    )
  ).rows[0].id;
  await fixture.pool.query(
    "INSERT INTO orders(id,user_id,profile_id,product_id,order_type,snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code) VALUES($1,$2,$3,$4,'electricity','test','test','Retained raw address','1234567890')",
    [id, actor, profile, product]
  );
  await fixture.pool.query(
    "INSERT INTO electricity_orders(id,profile_id,status,settings_snapshot) VALUES($1,$2,'draft','{}')",
    [id, profile]
  );
  for (const status of ['rejected', 'submitted', 'approved', 'active'])
    await expect(
      fixture.pool.query('UPDATE electricity_orders SET status=$2 WHERE id=$1', [id, status])
    ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.pool.query(
      "INSERT INTO electricity_orders(id,profile_id,status,settings_snapshot) VALUES($1,$2,'rejected','{}')",
      [randomUUID(), profile]
    )
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (
      await fixture.pool.query(
        'SELECT status,submitted_at,submitted_by,pricing_snapshot FROM electricity_orders WHERE id=$1',
        [id]
      )
    ).rows[0]
  ).toEqual({ status: 'draft', submitted_at: null, submitted_by: null, pricing_snapshot: null });
});

it('rolls back legacy adoption atomically to the complete0256 authority guards', async () => {
  const client = await fixture.pool.connect();
  const definitions = async () =>
    (
      await client.query(
        "SELECT proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname=ANY($1::text[]) ORDER BY proname",
        [['guard_electricity_draft_termination', 'enforce_electricity_draft_termination_complete']]
      )
    ).rows;
  const current = await definitions();
  try {
    await client.query('BEGIN');
    const old = readFileSync(join(folder, '0256_electricity_orphan_financial.sql'), 'utf8');
    for (const name of [
      'guard_electricity_draft_termination',
      'enforce_electricity_draft_termination_complete',
    ]) {
      const begin = old.indexOf('CREATE FUNCTION ' + name + '(');
      await client.query(
        old
          .slice(begin, old.indexOf('END $$;', begin) + 7)
          .replace('CREATE FUNCTION ', 'CREATE OR REPLACE FUNCTION ')
      );
    }
    await client.query(
      'DROP FUNCTION electricity_draft_return_matches(uuid,uuid,jsonb,jsonb,text); DROP FUNCTION electricity_draft_existing_return(uuid,uuid,uuid)'
    );
    const prior = await definitions();
    await client.query('SAVEPOINT before_adoption');
    await client.query(
      readFileSync(join(folder, '0257_electricity_legacy_refund_adoption.sql'), 'utf8')
    );
    expect(await definitions()).toEqual(current);
    await client.query('ROLLBACK TO SAVEPOINT before_adoption');
    expect(await definitions()).toEqual(prior);
    expect(
      (
        await client.query(
          "SELECT to_regprocedure('electricity_draft_existing_return(uuid,uuid,uuid)') AS helper"
        )
      ).rows[0].helper
    ).toBeNull();
    await client.query('ROLLBACK');
    expect(await definitions()).toEqual(current);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
