import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { createMigratedTestDb } from './test/migrated-db';
let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
const actor = 'audit-proof-actor',
  other = 'audit-proof-other';
beforeAll(async () => {
  db = await createMigratedTestDb();
  await db.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'test'),($2,$2,'test')",
    [actor, other]
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
async function insert(
  client: Pick<typeof db.pool, 'query'>,
  user = actor,
  metadata: unknown = { reason: 'Retained action' }
) {
  const id = randomUUID();
  await client.query(
    "INSERT INTO audit_log(id,user_id,event,metadata,correlation_id) VALUES($1,$2,'test.sensitive_action',$3,$4)",
    [id, user, JSON.stringify(metadata), randomUUID()]
  );
  return (await client.query('SELECT metadata::jsonb AS metadata FROM audit_log WHERE id=$1', [id]))
    .rows[0].metadata;
}
it.each(['COMMIT', 'ROLLBACK'])('captures matched proof and clears it after %s', async (end) => {
  const client = await db.pool.connect();
  try {
    const now = (
      (await client.query('SELECT clock_timestamp() AS now')).rows[0].now as Date
    ).getTime();
    const verified = new Date(now - 1000).toISOString(),
      expires = new Date(now + 60000).toISOString();
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('barghsa.actor_user_id',$1,true),set_config('barghsa.step_up_actor',$1,true),set_config('barghsa.actor_session_id','session-one',true),set_config('barghsa.step_up_session_id','session-one',true),set_config('barghsa.step_up_verified_at',$2,true),set_config('barghsa.step_up_expires_at',$3,true)",
      [actor, verified, expires]
    );
    expect(await insert(client)).toEqual({
      reason: 'Retained action',
      stepUpVerified: true,
      stepUpVerifiedAt: verified,
    });
    expect(await insert(client, other)).toEqual({ reason: 'Retained action' });
    await client.query(end);
    expect(await insert(client)).toEqual({ reason: 'Retained action' });
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
it.each(['expired', 'future', 'changed_actor', 'changed_session'])(
  'does not invent step-up proof for %s scope',
  async (kind) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const now = (
        (await client.query('SELECT clock_timestamp() AS now')).rows[0].now as Date
      ).getTime();
      const verified = new Date(now + (kind === 'future' ? 60000 : -1000)).toISOString(),
        expires = new Date(now + (kind === 'expired' ? -1 : 120000)).toISOString();
      await client.query(
        "SELECT set_config('barghsa.actor_user_id',$1,true),set_config('barghsa.step_up_actor',$2,true),set_config('barghsa.actor_session_id',$5,true),set_config('barghsa.step_up_session_id','session-one',true),set_config('barghsa.step_up_verified_at',$3,true),set_config('barghsa.step_up_expires_at',$4,true)",
        [
          kind === 'changed_actor' ? other : actor,
          actor,
          verified,
          expires,
          kind === 'changed_session' ? 'session-two' : 'session-one',
        ]
      );
      expect(await insert(client)).toEqual({ reason: 'Retained action' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }
);
it('preserves old metadata and rolls back the additive trigger without rewriting audit rows', async () => {
  const client = await db.pool.connect();
  const before = (await client.query('SELECT * FROM audit_log ORDER BY id')).rows;
  try {
    await client.query('BEGIN');
    await client.query(
      'DROP TRIGGER audit_log_capture_step_up ON audit_log; DROP FUNCTION capture_audit_step_up_proof()'
    );
    await client.query('SAVEPOINT before_upgrade');
    await client.query(
      readFileSync(resolve('drizzle/production/0258_action_step_up_audit.sql'), 'utf8')
    );
    expect((await client.query('SELECT * FROM audit_log ORDER BY id')).rows).toEqual(before);
    await client.query('ROLLBACK TO SAVEPOINT before_upgrade');
    expect(
      (await client.query("SELECT to_regprocedure('capture_audit_step_up_proof()') AS helper"))
        .rows[0].helper
    ).toBeNull();
    await client.query('ROLLBACK');
    expect((await client.query('SELECT * FROM audit_log ORDER BY id')).rows).toEqual(before);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
