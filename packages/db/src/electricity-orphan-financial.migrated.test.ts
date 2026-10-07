import { randomUUID } from 'node:crypto';
import { readFileSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { runMigrations } from './migrate';
const folder = resolve('drizzle/production');
it('adds orphan authority atomically to the unchanged0255 prefix, retains rows and journal, and replays exactly once', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'orphan-financial-upgrade-')),
    name = 'orphan_upgrade_' + randomUUID().replaceAll('-', '');
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL }),
    url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = '/' + name;
  const pool = new Pool({ connectionString: url.toString() });
  try {
    await management.query(`CREATE DATABASE "${name}"`);
    mkdirSync(join(temp, 'meta'));
    const journal = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { tag: string }) => e.tag < '0256');
    writeFileSync(join(temp, 'meta/_journal.json'), JSON.stringify(journal));
    for (const e of journal.entries)
      symlinkSync(join(folder, e.tag + '.sql'), join(temp, e.tag + '.sql'));
    const options = { connection: { pgdirectUrl: url.toString() } };
    const prior = await runMigrations({ ...options, migrationsFolder: temp });
    expect(prior.ok, prior.error).toBe(true);
    const user = randomUUID(),
      profile = randomUUID(),
      order = randomUUID();
    await pool.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'test')", [
      user,
    ]);
    await pool.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, user]);
    const product = (
      await pool.query(
        "INSERT INTO products(type,system_key,title,status,price) VALUES('electricity','thermal','{}','active',100) ON CONFLICT(system_key) DO UPDATE SET price=100 RETURNING id"
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO orders(id,user_id,profile_id,product_id,order_type,status,snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code) VALUES($1,$2,$3,$4,'electricity','DRAFT','test','test','Retained address','1234567890')",
      [order, user, profile, product]
    );
    await pool.query(
      "INSERT INTO electricity_orders(id,profile_id,status,settings_snapshot) VALUES($1,$2,'draft','{}')",
      [order, profile]
    );
    await pool.query(
      "INSERT INTO invoices(profile_id,order_id,type,state,total_amount,paid_amount) VALUES($1,$2,'auto','Paid',100,100)",
      [profile, order]
    );
    const retained = async () =>
      (
        await pool.query(
          'SELECT (SELECT to_jsonb(o) FROM orders o WHERE id=$1) AS root,(SELECT to_jsonb(e) FROM electricity_orders e WHERE id=$1) AS draft,(SELECT jsonb_agg(to_jsonb(i)) FROM invoices i WHERE order_id=$1) AS invoices',
          [order]
        )
      ).rows[0];
    const oldRows = await retained(),
      history = (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows;
    const definition =
      "SELECT pg_get_functiondef('guard_electricity_order_settings_snapshot()'::regprocedure) AS definition";
    const oldDefinition = (await pool.query(definition)).rows[0].definition,
      client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        readFileSync(join(folder, '0256_electricity_orphan_financial.sql'), 'utf8')
      );
      await client.query('ROLLBACK');
      expect(
        (await client.query("SELECT to_regclass('electricity_draft_terminations') AS table"))
          .rows[0].table
      ).toBeNull();
      expect((await client.query(definition)).rows[0].definition).toBe(oldDefinition);
      expect(
        (
          await client.query(
            "SELECT indexdef FROM pg_indexes WHERE indexname='refund_obligations_order_unique'"
          )
        ).rows[0].indexdef
      ).not.toContain('WHERE');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect(await runMigrations(options)).toEqual({
      ok: true,
      applied: [
        '0256_electricity_orphan_financial',
        '0257_electricity_legacy_refund_adoption',
        '0258_action_step_up_audit',
      ],
    });
    expect(
      (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows.slice(0, -3)
    ).toEqual(history);
    expect(await runMigrations(options)).toEqual({ ok: true, applied: [] });
    expect(await retained()).toEqual(oldRows);
    expect(
      (await pool.query('SELECT order_id FROM electricity_draft_terminations')).rows
    ).toHaveLength(0);
    const indexes = (
      await pool.query(
        "SELECT indexname,indexdef FROM pg_indexes WHERE tablename='refund_obligations'"
      )
    ).rows;
    expect(
      indexes.find((i) => i.indexname === 'refund_obligations_order_unique').indexdef
    ).toContain('contract_id IS NOT NULL');
    expect(
      indexes.find((i) => i.indexname === 'refund_obligations_orphan_invoice_unique').indexdef
    ).toContain('contract_id IS NULL');
  } finally {
    await pool.end();
    await management.query(`DROP DATABASE IF EXISTS "${name}"`);
    await management.end();
    rmSync(temp, { recursive: true, force: true });
  }
}, 30000);
it('preserves the complete0255 guard apart from one immutable orphan-financial prefix', () => {
  const definition = (s: string) => {
    const begin = s.indexOf('CREATE OR REPLACE FUNCTION guard_electricity_order_settings_snapshot');
    return s.slice(begin, s.indexOf('END $$;', begin) + 7);
  };
  const old = definition(
    readFileSync(join(folder, '0255_electricity_orphan_draft_gifts.sql'), 'utf8')
  );
  const newer = definition(
    readFileSync(join(folder, '0256_electricity_orphan_financial.sql'), 'utf8')
  ).replace(/ {2}-- Contractless financial closure[\s\S]*? {2}THEN RETURN NEW; END IF;\n/, '');
  expect(newer).toBe(old);
});
