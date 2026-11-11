import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './no-dynamic-drizzle-raw.mjs';

const drizzle = "import { sql } from 'drizzle-orm';";

new RuleTester({ languageOptions: { parser: tseslint.parser } }).run(
  'no-dynamic-drizzle-raw',
  rule,
  {
    valid: [
      drizzle + "sql.raw('ORDER BY name');",
      drizzle + "const column = 'name'; const text = `ORDER BY ${column}`; sql.raw(text);",
      drizzle + "sql.raw(descending ? 'ORDER BY name DESC' : 'ORDER BY name ASC');",
      drizzle + "const text = ('ORDER BY name' as const) + ' DESC'; sql.raw(text);",
      drizzle + 'sql`SELECT * FROM products WHERE name = ${name}`;',
      drizzle + "sql.identifier('name'); const { join } = sql; join(parts);",
      drizzle + 'function read(sql) { return sql.raw(text); }',
      "import { sql } from './unrelated'; sql.raw(text);",
    ],
    invalid: [
      [drizzle + 'sql.raw(text);', 'dynamic'],
      [drizzle + 'const text = makeText(); sql.raw(text);', 'dynamic'],
      [drizzle + 'const text = `ORDER BY ${column}`; sql.raw(text);', 'dynamic'],
      [drizzle + "let text = 'ORDER BY name'; sql.raw(text);", 'dynamic'],
      [drizzle + "sql.raw(flag ? 'ORDER BY name' : text);", 'dynamic'],
      [drizzle + "sql.raw('ORDER BY ' + (column as string));", 'dynamic'],
      [drizzle + "sql['raw'](text);", 'dynamic'],
      ["import { sql as query } from 'drizzle-orm/sql'; query.raw(text);", 'dynamic'],
      ["import * as db from 'drizzle-orm'; db.sql.raw(text);", 'dynamic'],
      [drizzle + 'const query = sql; query.raw(text);', 'dynamic'],
      [drizzle + 'sql.raw();', 'dynamic'],
      [drizzle + 'const raw = sql.raw; raw(text);', 'rawReference'],
      [drizzle + 'const { raw } = sql; raw(text);', 'rawReference'],
      [drizzle + 'let raw; ({ raw } = sql); raw(text);', 'rawReference'],
      [drizzle + 'const { ...methods } = sql; methods.raw(text);', 'rawReference'],
      [drizzle + 'sql[method](text);', 'rawReference'],
    ].map(([code, messageId]) => ({ code, errors: [{ messageId }] })),
  }
);
