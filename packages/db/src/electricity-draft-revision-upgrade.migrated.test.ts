import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { runMigrations } from './migrate';
import * as electricitySchema from './schema/electricity-orders';
import { runMigrationPrefix } from './test/migration-prefix';

it('preserves pre-upgrade drafts and versions subsequent legacy writes and deletions', async () => {
  const schema = getTableConfig(electricitySchema.electricityCustomerDraftRevisions);
  expect(schema.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
    'user_id',
    'profile_id',
    'mode',
  ]);
  expect(schema.columns.map((column) => column.name)).toEqual([
    'user_id',
    'profile_id',
    'mode',
    'revision',
    'created_at',
    'updated_at',
  ]);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  const management = new Pool({ connectionString: url.toString() });
  const name = 'test_draft_revision_' + randomUUID().replaceAll('-', '');
  let pool: Pool | undefined;
  let created = false;
  try {
    await management.query(`CREATE DATABASE "${name}"`);
    created = true;
    url.pathname = '/' + name;
    const connection = { pgdirectUrl: url.toString() };
    expect((await runMigrationPrefix('0280_service_workflow_targets', { connection })).ok).toBe(
      true
    );
    pool = new Pool({ connectionString: url.toString() });
    await pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES ('draft-upgrade','draft-upgrade@example.test','fixture')"
    );
    const profile = (
      await pool.query(
        "INSERT INTO profiles(user_id,profile_type,status) VALUES ('draft-upgrade','LEGAL','ACTIVE') RETURNING id"
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO electricity_customer_drafts(user_id,profile_id,mode,current_step,data)
       VALUES ('draft-upgrade',$1,'simple',2,'{"period":"next_week","totalKwh":"100"}')`,
      [profile]
    );
    const saved = async () =>
      (
        await pool!.query('SELECT * FROM electricity_customer_drafts WHERE profile_id=$1', [
          profile,
        ])
      ).rows;
    const revisions = async () =>
      (
        await pool!.query(
          'SELECT revision FROM electricity_customer_draft_revisions WHERE profile_id=$1',
          [profile]
        )
      ).rows;
    const domainTables = Object.values(electricitySchema).map(getTableConfig);
    const existingTables = domainTables
      .map(({ name }) => name)
      .filter((name) => name !== schema.name);
    const existingConstraints = async () =>
      (
        await pool!.query(
          `SELECT rel.relname,con.conname,pg_get_constraintdef(con.oid) AS definition
             FROM pg_constraint con JOIN pg_class rel ON rel.oid=con.conrelid
            WHERE rel.relname=ANY($1::text[]) AND rel.relnamespace='public'::regnamespace
            ORDER BY rel.relname,con.conname`,
          [existingTables]
        )
      ).rows;
    const before = await saved();
    const constraints = await existingConstraints();
    expect(constraints.length).toBeGreaterThan(existingTables.length);
    expect(await runMigrations({ connection })).toEqual({
      ok: true,
      applied: ['0281_electricity_draft_revisions'],
    });
    expect(await saved()).toEqual(before);
    expect(await existingConstraints()).toEqual(constraints);
    const foreignKeys = (
      await pool.query(
        `SELECT rel.relname AS table_name,src.attname AS column_name,
                target.relname AS target_table,dst.attname AS target_column,
                CASE con.confdeltype WHEN 'c' THEN 'cascade' WHEN 'r' THEN 'restrict'
                                     ELSE 'no action' END AS on_delete
           FROM pg_constraint con
           JOIN pg_class rel ON rel.oid=con.conrelid
           JOIN pg_class target ON target.oid=con.confrelid
           JOIN LATERAL unnest(con.conkey,con.confkey) AS key(source,target) ON true
           JOIN pg_attribute src ON src.attrelid=rel.oid AND src.attnum=key.source
           JOIN pg_attribute dst ON dst.attrelid=target.oid AND dst.attnum=key.target
          WHERE con.contype='f' AND rel.relname=ANY($1::text[])
            AND rel.relnamespace='public'::regnamespace`,
        [domainTables.map(({ name }) => name)]
      )
    ).rows;
    expect(foreignKeys).toEqual(
      expect.arrayContaining(
        domainTables.flatMap(({ name, foreignKeys }) =>
          foreignKeys.flatMap((foreignKey) => {
            const { columns, foreignColumns, foreignTable } = foreignKey.reference();
            return columns.map((column, index) => ({
              table_name: name,
              column_name: column.name,
              target_table: getTableName(foreignTable),
              target_column: foreignColumns[index]!.name,
              on_delete: foreignKey.onDelete,
            }));
          })
        )
      )
    );
    expect(await revisions()).toEqual([]);
    await pool.query(
      "UPDATE electricity_customer_drafts SET data=jsonb_set(data,'{totalKwh}','\"200\"') WHERE profile_id=$1",
      [profile]
    );
    const first = (await revisions())[0]?.revision;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    await pool.query('DELETE FROM electricity_customer_drafts WHERE profile_id=$1', [profile]);
    expect(await saved()).toEqual([]);
    const next = await revisions();
    expect(next).toHaveLength(1);
    expect(next[0].revision).not.toBe(first);
    expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
    expect(await revisions()).toEqual(next);
  } finally {
    await pool?.end();
    try {
      if (created) await management.query(`DROP DATABASE "${name}"`);
    } finally {
      await management.end();
    }
  }
}, 120000);
