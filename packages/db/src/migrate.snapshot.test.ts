import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { runMigrations } from './migrate';

type Column = {
  name: string;
  type: string;
  notNull: boolean;
  default?: unknown;
  generated?: { as: string; type: string };
};
type Index = {
  name: string;
  columns: { expression: string; isExpression: boolean; asc: boolean; nulls: string }[];
  isUnique: boolean;
  method: string;
  where?: string;
};
type ForeignKey = {
  columnsFrom: string[];
  columnsTo: string[];
  tableTo: string;
  onDelete: string;
  onUpdate: string;
};
type Table = {
  name: string;
  columns: Record<string, Column>;
  checkConstraints: Record<string, { name: string; value: string }>;
  foreignKeys: Record<string, ForeignKey>;
  indexes: Record<string, Index>;
  uniqueConstraints: Record<string, { columns: string[] }>;
  compositePrimaryKeys: Record<string, { columns: string[] }>;
};
const folder = resolve(__dirname, '../drizzle/production/meta');
const snapshotFile = readdirSync(folder)
  .filter((name) => /^\d+_snapshot\.json$/.test(name))
  .sort()
  .at(-1);
if (!snapshotFile) throw new Error('No committed production schema snapshot');
const snapshot = JSON.parse(readFileSync(resolve(folder, snapshotFile), 'utf8')) as {
  tables: Record<string, Table>;
};
const tables = Object.entries(snapshot.tables);
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
let management: Pool, pool: Pool, client: PoolClient;
const database = 'test_snapshot_' + randomUUID().replaceAll('-', '');
beforeAll(async () => {
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = '/' + database;
  expect(await runMigrations({ connection: { pgdirectUrl: url.toString() } })).toMatchObject({
    ok: true,
  });
  pool = new Pool({ connectionString: url.toString() });
  client = await pool.connect();
}, 30000);
afterAll(async () => {
  client?.release();
  await pool?.end();
  if (management) {
    await management.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await management.end();
  }
});
async function columns(table: string) {
  return (
    await client.query(
      `SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required,a.attgenerated AS generated,pg_get_expr(d.adbin,d.adrelid) AS expression FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname`,
      [table]
    )
  ).rows;
}
async function checks(table: string) {
  return (
    await client.query(
      `SELECT conname AS name,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=$1::regclass AND contype='c' ORDER BY conname`,
      [table]
    )
  ).rows;
}
async function indexes(table: string) {
  return (
    await client.query(
      `SELECT i.indisunique AS unique,i.indisvalid AS valid,am.amname AS method,pg_get_expr(i.indpred,i.indrelid) AS predicate,ARRAY(SELECT pg_get_indexdef(i.indexrelid,k,true) FROM generate_series(1,i.indnkeyatts) k) AS columns FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam WHERE i.indrelid=$1::regclass`,
      [table]
    )
  ).rows;
}
for (const [key, table] of tables)
  it(`current snapshot matches migrated ${table.name}`, async () => {
    const temp = 'snapshot_expected';
    const unqualify = (sql: string) => sql.replaceAll(quote(table.name) + '.', '');
    await client.query('BEGIN');
    try {
      const definitions = Object.values(table.columns).map(
        (c) =>
          `${quote(c.name)} ${c.type}${c.generated ? ` GENERATED ALWAYS AS (${unqualify(c.generated.as)}) STORED` : c.default !== undefined ? ` DEFAULT ${String(c.default)}` : ''}${c.notNull ? ' NOT NULL' : ''}`
      );
      await client.query(`CREATE TEMP TABLE ${temp} (${definitions.join(',')}) ON COMMIT DROP`);
      const actualColumns = await columns(key);
      const expectedColumns = await columns(temp);
      for (const c of expectedColumns)
        expect
          .soft(
            actualColumns.find((a) => a.name === c.name),
            key + '.' + c.name
          )
          .toEqual(c);
      for (const c of Object.values(table.checkConstraints))
        await client.query(
          `ALTER TABLE ${temp} ADD CONSTRAINT ${quote(c.name)} CHECK (${unqualify(c.value)})`
        );
      const actualChecks = await checks(key);
      for (const c of await checks(temp))
        expect.soft(actualChecks, key + '.' + c.name).toContainEqual(c);
      const actualForeignKeys = (
        await client.query(
          `SELECT ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n,o) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.o) AS "columnsFrom",ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n,o) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.o) AS "columnsTo",t.relname AS "tableTo",c.confdeltype AS "onDelete",c.confupdtype AS "onUpdate" FROM pg_constraint c JOIN pg_class t ON t.oid=c.confrelid WHERE c.conrelid=$1::regclass AND c.contype='f'`,
          [key]
        )
      ).rows;
      const actions: Record<string, string> = {
        'no action': 'a',
        restrict: 'r',
        cascade: 'c',
        'set null': 'n',
        'set default': 'd',
      };
      for (const fk of Object.values(table.foreignKeys))
        expect.soft(actualForeignKeys, key + '.' + fk.columnsFrom.join(',')).toContainEqual({
          columnsFrom: fk.columnsFrom,
          columnsTo: fk.columnsTo,
          tableTo: fk.tableTo,
          onDelete: actions[fk.onDelete],
          onUpdate: actions[fk.onUpdate],
        });
      let n = 0;
      for (const index of Object.values(table.indexes)) {
        const cols = index.columns.map((c) => {
          // Older declarations include sort direction in their raw SQL expression.
          if (c.isExpression && /\s(?:asc|desc)$/i.test(c.expression))
            return unqualify(c.expression);
          return `${c.isExpression ? '(' + unqualify(c.expression) + ')' : quote(c.expression)} ${c.asc ? 'ASC' : 'DESC'} NULLS ${c.nulls}`;
        });
        await client.query(
          `CREATE ${index.isUnique ? 'UNIQUE' : ''} INDEX snapshot_index_${n++} ON ${temp} USING ${index.method} (${cols.join(',')})${index.where ? ' WHERE ' + unqualify(index.where) : ''}`
        );
      }
      for (const value of [
        ...Object.values(table.uniqueConstraints),
        ...Object.values(table.compositePrimaryKeys),
      ])
        await client.query(
          `CREATE UNIQUE INDEX snapshot_index_${n++} ON ${temp} (${value.columns.map(quote).join(',')})`
        );
      const actualIndexes = await indexes(key);
      for (const index of await indexes(temp))
        expect.soft(actualIndexes, key + ' index').toContainEqual(index);
    } finally {
      await client.query('ROLLBACK');
    }
  });
