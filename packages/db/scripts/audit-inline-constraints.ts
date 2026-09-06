import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { setup, teardown } from '../src/test/globalSetup';
import { runMigrations } from '../src/migrate';

async function main() {
  await setup();
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    const result = await runMigrations({
      connection: { pgdirectUrl: process.env.TEST_DATABASE_URL },
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    const path = resolve(__dirname, '../../../audit/legacy-inline-constraints.json');
    const expected = JSON.parse(readFileSync(path, 'utf8')) as Array<{
      table: string;
      name: string;
      definition: string;
    }>;
    const actual = (
      await pool.query(`SELECT t.relname AS "table",c.conname AS name,pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public'`)
    ).rows;
    const optionalDefaults = (
      await pool.query(`SELECT DISTINCT t.relname AS "table",a.attname AS "column",pg_get_expr(d.adbin,d.adrelid) AS "default"
      FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=ANY(c.conkey)
      JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
      WHERE n.nspname='public' AND c.contype='f' AND NOT a.attnotnull ORDER BY 1,2`)
    ).rows;
    writeFileSync(
      resolve(__dirname, '../../../audit/optional-foreign-key-defaults-current.json'),
      JSON.stringify(optionalDefaults, null, 2) + '\n'
    );
    writeFileSync(
      resolve(__dirname, '../../../audit/production-constraints.json'),
      JSON.stringify(actual, null, 2) + '\n'
    );
    const indexes = (
      await pool.query(`SELECT t.relname AS "table",i.relname AS name,pg_get_indexdef(i.oid) AS definition
      FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid
      JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND x.indisunique`)
    ).rows;
    const normalize = (value: string) => value.replace(/[\s"]/g, '').toLowerCase();
    const report = expected.map((item) => {
      const match = actual.find(
        (row) =>
          row.table === item.table &&
          (row.name === item.name || normalize(row.definition) === normalize(item.definition))
      );
      const index = item.definition.startsWith('UNIQUE')
        ? indexes.find((row) => row.table === item.table && row.name === item.name)
        : undefined;
      return {
        ...item,
        actual: match?.definition ?? index?.definition ?? null,
        actualName: match?.name ?? index?.name ?? null,
      };
    });
    writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
    console.log(
      JSON.stringify(
        { checked: report.length, missing: report.filter((item) => !item.actual) },
        null,
        2
      )
    );
  } finally {
    await pool.end();
    await teardown();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
