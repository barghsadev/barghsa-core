import { afterAll, beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createIsolatedTestDb, dropTestSchema, type IsolatedTestDb } from './test/testDb.js';

const tables = [
  ['audit_log', 'user_id', 'operating_context'],
  ['consultation_request_events', 'actor_user_id', 'actor_context'],
  ['saving_fulfillment_events', 'actor_user_id', 'actor_context'],
  ['saving_order_revisions', 'user_id', 'actor_context'],
  ['saving_address_amendments', 'actor_user_id', 'actor_context'],
  ['saving_hardware_amendments', 'actor_user_id', 'actor_context'],
  ['saving_hardware_upgrade_requests', 'actor_user_id', 'actor_context'],
  ['solar_construction_progress_events', 'actor_user_id', 'actor_context'],
] as const;
let db: IsolatedTestDb;
beforeAll(async () => {
  db = await createIsolatedTestDb('test_actor_context_');
  for (const [table, actor] of tables) {
    await db.pool.query(
      `CREATE TABLE ${table}(id text PRIMARY KEY,${actor} text NOT NULL,amount bigint NOT NULL DEFAULT 9007199254740993,note text NOT NULL DEFAULT 'historical fact')`
    );
    await db.pool.query(`INSERT INTO ${table}(id,${actor}) VALUES('legacy','dual-user')`);
  }
  await db.pool.query(
    readFileSync(
      resolve(__dirname, '../drizzle/production/0245_business_actor_context.sql'),
      'utf8'
    )
  );
});
afterAll(async () => {
  await db?.pool.end();
  if (db) await dropTestSchema(db.schemaName);
});
it('adds nullable provenance without rewriting old facts or precision', async () => {
  for (const [table, actor, context] of tables) {
    expect(
      (
        await db.pool.query(
          `SELECT ${actor} AS actor,${context} AS context,amount::text,note FROM ${table} WHERE id='legacy'`
        )
      ).rows
    ).toEqual([
      { actor: 'dual-user', context: null, amount: '9007199254740993', note: 'historical fact' },
    ]);
    await expect(
      db.pool.query(`UPDATE ${table} SET ${context}='staff' WHERE id='legacy'`)
    ).rejects.toMatchObject({ code: '23514' });
  }
});
it.each(['customer', 'staff'] as const)(
  'captures %s only for the matched actor and resets at commit',
  async (mode) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('barghsa.actor_user_id','dual-user',true),set_config('barghsa.actor_context',$1,true)",
        [mode]
      );
      for (const [table, actor, context] of tables) {
        await client.query(
          `INSERT INTO ${table}(id,${actor}) VALUES($1,'dual-user'),($2,'another-user')`,
          [mode, mode + '-other']
        );
        expect(
          (
            await client.query(
              `SELECT id,${context} AS context,amount::text FROM ${table} WHERE id=$1 OR id=$2 ORDER BY id`,
              [mode, mode + '-other']
            )
          ).rows
        ).toEqual([
          { id: mode, context: mode, amount: '9007199254740993' },
          { id: mode + '-other', context: null, amount: '9007199254740993' },
        ]);
      }
      await client.query('COMMIT');
      for (const [table, actor, context] of tables) {
        await client.query(`INSERT INTO ${table}(id,${actor}) VALUES($1,'dual-user')`, [
          mode + '-later',
        ]);
        expect(
          (
            await client.query(`SELECT ${context} AS context FROM ${table} WHERE id=$1`, [
              mode + '-later',
            ])
          ).rows[0].context
        ).toBeNull();
        await expect(
          client.query(`UPDATE ${table} SET ${context}=$2 WHERE id=$1`, [
            mode,
            mode === 'staff' ? 'customer' : 'staff',
          ])
        ).rejects.toMatchObject({ code: '23514' });
      }
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }
);
it('rejects spoofed context and leaves no scope after rollback', async () => {
  const client = await db.pool.connect();
  try {
    for (const [table, actor, context] of tables) {
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('barghsa.actor_user_id','dual-user',true),set_config('barghsa.actor_context','customer',true)"
      );
      await expect(
        client.query(
          `INSERT INTO ${table}(id,${actor},${context}) VALUES('spoof','dual-user','staff')`
        )
      ).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK');
      await client.query(`INSERT INTO ${table}(id,${actor}) VALUES('after-rollback','dual-user')`);
      expect(
        (await client.query(`SELECT ${context} AS context FROM ${table} WHERE id='after-rollback'`))
          .rows[0].context
      ).toBeNull();
      await expect(
        client.query(
          `INSERT INTO ${table}(id,${actor},${context}) VALUES('bad','dual-user','admin')`
        )
      ).rejects.toMatchObject({ code: '23514' });
    }
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
