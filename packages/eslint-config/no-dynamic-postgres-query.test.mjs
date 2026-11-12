import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Linter, RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './no-dynamic-postgres-query.mjs';

new RuleTester({ languageOptions: { parser: tseslint.parser } }).run(
  'no-dynamic-postgres-query',
  rule,
  {
    valid: [
      "await pool.query('SELECT id FROM users WHERE id = $1', [id]);",
      "const text = 'SELECT id'; await getDbPool().query(text + ' FROM users');",
      "await (client ?? pool).query(lock ? 'SELECT 1 FOR SHARE' : 'SELECT 1');",
      "await client.query({ text: 'SELECT $1::text', values: [value] });",
      "const query = pool.query; await query('SELECT 1');",
      'const filter = request.query.status;',
      "import { Query } from 'pg'; new Query('SELECT $1', [id]);",
    ],
    invalid: [
      ['await pool.query(text, [id]);', 'dynamic'],
      ['await pool.query(`SELECT ${column} FROM users`);', 'dynamic'],
      ['await client["query"]({ text, values });', 'dynamic'],
      ["await client.query({ text: 'SELECT 1', ...configuration });", 'dynamic'],
      ["await client.query({ text: 'SELECT 1', text });", 'dynamic'],
      ["let text = 'SELECT 1'; await client.query(text);", 'dynamic'],
      ['const query = pool.query; await query(text);', 'dynamic'],
      ['const { query: run } = pool; await run(text);', 'dynamic'],
      ['const run = pool.query.bind(pool);', 'indirect'],
      ['await client.query.call(client, text);', 'indirect'],
      ["import { Query as Statement } from 'pg'; new Statement(text);", 'dynamic'],
      ["import pg from 'pg'; new pg.Query({ text, values });", 'dynamic'],
      ["const { Query: Statement } = require('pg'); new Statement(text);", 'dynamic'],
    ].map(([code, messageId]) => ({ code, errors: [{ messageId }] })),
  }
);

test('a reviewed driver adapter requires an exact source digest', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const filename = fileURLToPath(new URL('../db/src/transaction-pool.ts', import.meta.url));
  const original = readFileSync(filename, 'utf8');
  const linter = new Linter({ cwd: root });
  const config = [
    {
      files: ['**/*.ts'],
      languageOptions: { parser: tseslint.parser },
      plugins: { 'barghsa-db': { rules: { 'no-dynamic-postgres-query': rule } } },
      rules: { 'barghsa-db/no-dynamic-postgres-query': 'error' },
    },
  ];
  assert.deepEqual(linter.verify(original, config, { filename }), []);
  const changed = linter.verify(original + '\n', config, { filename });
  assert(changed.some(({ messageId }) => messageId === 'staleReview'));
  assert(changed.some(({ messageId }) => messageId === 'indirect'));
});
