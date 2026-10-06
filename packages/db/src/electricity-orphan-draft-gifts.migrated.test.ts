import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createMigratedTestDb } from './test/migrated-db';
let fixture: Awaited<ReturnType<typeof createMigratedTestDb>>;
const folder = resolve('drizzle/production');
beforeAll(async () => {
  fixture = await createMigratedTestDb();
}, 30000);
afterAll(async () => {
  await fixture?.close();
}, 30000);
it('retains the full 0254 settings guard except its consistent unpaid gift predicate', () => {
  const source = (tag: string) => readFileSync(resolve(folder, tag + '.sql'), 'utf8');
  const definition = (s: string) => {
    const begin = s.indexOf('CREATE OR REPLACE FUNCTION guard_electricity_order_settings_snapshot');
    return s.slice(begin, s.indexOf('END $$;', begin) + 7);
  };
  const old = definition(source('0254_electricity_reviewed_rejection'));
  const current = definition(source('0255_electricity_orphan_draft_gifts'))
    .replace(
      ' AND raw_electricity_draft_gift_consistent(o.id,o.profile_id,o.gift_code_id)',
      ' AND o.gift_code_id IS NULL'
    )
    .replace(
      '    AND NOT EXISTS(SELECT 1 FROM refund_obligations WHERE order_id=OLD.id)',
      '    AND NOT EXISTS(SELECT 1 FROM gift_code_redemptions WHERE order_id=OLD.id)\n    AND NOT EXISTS(SELECT 1 FROM refund_obligations WHERE order_id=OLD.id)'
    );
  expect(current).toBe(old);
});
it('rolls back the complete gift migration atomically and restores the prior function', async () => {
  const client = await fixture.pool.connect();
  const query =
    "SELECT pg_get_functiondef('guard_electricity_order_settings_snapshot()'::regprocedure) AS definition";
  const before = (await client.query(query)).rows[0].definition;
  try {
    await client.query('BEGIN');
    await client.query(
      'DROP TRIGGER gifts_raw_electricity_terminal_history_guard ON gift_code_redemptions; DROP FUNCTION guard_raw_electricity_terminal_gift_history()'
    );
    const prior = readFileSync(resolve(folder, '0254_electricity_reviewed_rejection.sql'), 'utf8');
    const begin = prior.indexOf(
      'CREATE OR REPLACE FUNCTION guard_electricity_order_settings_snapshot'
    );
    await client.query(prior.slice(begin, prior.indexOf('END $$;', begin) + 7));
    await client.query('DROP FUNCTION raw_electricity_draft_gift_consistent(uuid,uuid,uuid)');
    const priorDefinition = (await client.query(query)).rows[0].definition;
    await client.query('SAVEPOINT before_upgrade');
    await client.query(
      readFileSync(resolve(folder, '0255_electricity_orphan_draft_gifts.sql'), 'utf8')
    );
    expect((await client.query(query)).rows[0].definition).toBe(before);
    await client.query('ROLLBACK TO SAVEPOINT before_upgrade');
    expect((await client.query(query)).rows[0].definition).toBe(priorDefinition);
    expect(
      (
        await client.query(
          "SELECT to_regprocedure('raw_electricity_draft_gift_consistent(uuid,uuid,uuid)') AS function"
        )
      ).rows[0].function
    ).toBeNull();
    await client.query('ROLLBACK');
    expect((await client.query(query)).rows[0].definition).toBe(before);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
