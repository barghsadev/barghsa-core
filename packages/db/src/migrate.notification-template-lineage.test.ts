import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { Pool } from 'pg';
import { runMigrations } from './migrate.js';
const production = resolve(__dirname, '../drizzle/production');
const previous = mkdtempSync(join(tmpdir(), 'notification-lineage-before-'));
const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
const prior = {
  ...journal,
  entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 117),
};
mkdirSync(join(previous, 'meta'));
writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
for (const entry of prior.entries)
  copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
let management: Pool;
const databases: string[] = [];
beforeAll(() => {
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
});
afterAll(async () => {
  try {
    for (const name of databases) await management.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  } finally {
    await management?.end();
    rmSync(previous, { recursive: true, force: true });
  }
});
async function legacy() {
  const name = 'test_lineage_' + randomUUID().replaceAll('-', '');
  await management.query(`CREATE DATABASE "${name}"`);
  databases.push(name);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = '/' + name;
  const connection = { pgdirectUrl: url.toString() };
  expect((await runMigrations({ connection, migrationsFolder: previous })).ok).toBe(true);
  return { pool: new Pool({ connectionString: url.toString() }), connection };
}
async function add(
  pool: Pool,
  version: number,
  status = 'archived',
  event = 'fixture-event',
  supersedes?: number
) {
  const id = randomUUID();
  if (supersedes === undefined)
    await pool.query(
      `INSERT INTO notification_templates(id,event_key,channel,locale,body_template,status,is_active,version,published_at)
 VALUES($1,$2,'email','en',$3,$4,$5,$6,NOW())`,
      [id, event, 'Immutable v' + version, status, status === 'active', version]
    );
  else
    await pool.query(
      `INSERT INTO notification_templates(id,event_key,channel,locale,body_template,status,is_active,version,supersedes_version)
 VALUES($1,$2,'email','en',$3,'draft',false,$4,$5)`,
      [id, event, 'Draft v' + version, version, supersedes]
    );
  return id;
}
it('upgrades valid history without rewriting publication identity and enforces lineage', async () => {
  const db = await legacy();
  try {
    await add(db.pool, 1);
    const active = await add(db.pool, 2, 'active');
    const before = (await db.pool.query('SELECT * FROM notification_templates ORDER BY version'))
      .rows;
    expect(await runMigrations({ connection: db.connection })).toEqual({
      ok: true,
      applied: [
        '0117_notification_template_lineage',
        '0118_reconcile_schema_snapshot',
        '0119_brand_history',
      ],
    });
    const after = (await db.pool.query('SELECT * FROM notification_templates ORDER BY version'))
      .rows;
    expect(after).toEqual(before.map((row) => ({ ...row, supersedes_version: null })));
    await add(db.pool, 3, 'draft', 'fixture-event', 2);
    await expect(add(db.pool, 3)).rejects.toMatchObject({ code: '23505' });
    await expect(add(db.pool, 4, 'draft', 'other-family', 2)).rejects.toMatchObject({
      code: '23503',
    });
    await expect(add(db.pool, 4, 'draft', 'fixture-event', 4)).rejects.toMatchObject({
      code: '23514',
    });
    await expect(add(db.pool, 0)).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.pool.query('DELETE FROM notification_templates WHERE id=$1', [active])
    ).rejects.toMatchObject({ code: '23503' });
    expect(await runMigrations({ connection: db.connection })).toEqual({ ok: true, applied: [] });
  } finally {
    await db.pool.end();
  }
}, 20000);
for (const status of ['archived', 'draft'])
  it(`blocks duplicate ${status} versions without rewriting history or recording completion`, async () => {
    const db = await legacy();
    try {
      await add(db.pool, 1, status);
      await add(db.pool, 1, status);
      const before = (await db.pool.query('SELECT * FROM notification_templates ORDER BY id')).rows;
      const result = await runMigrations({ connection: db.connection });
      expect(result).toMatchObject({ ok: false });
      expect(result.error).toContain('duplicate versions');
      expect(
        (await db.pool.query('SELECT * FROM notification_templates ORDER BY id')).rows
      ).toEqual(before);
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='notification_templates' AND column_name='supersedes_version'"
          )
        ).rows[0].n
      ).toBe(0);
    } finally {
      await db.pool.end();
    }
  }, 20000);
it('allows only one concurrent insert for the same new version', async () => {
  const db = await legacy();
  try {
    expect((await runMigrations({ connection: db.connection })).ok).toBe(true);
    const results = await Promise.allSettled([add(db.pool, 1, 'draft'), add(db.pool, 1, 'draft')]);
    expect(results.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((value) => value.status === 'rejected');
    expect(failed).toMatchObject({ status: 'rejected', reason: { code: '23505' } });
  } finally {
    await db.pool.end();
  }
}, 20000);
