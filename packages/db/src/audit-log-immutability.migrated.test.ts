import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createMigratedTestDb } from './test/migrated-db';

let fixture: Awaited<ReturnType<typeof createMigratedTestDb>>;
let id: string;
beforeAll(async () => {
  fixture = await createMigratedTestDb();
  await fixture.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES('audit-owner','audit-owner@example.test','test-only')"
  );
  id = randomUUID();
  await fixture.pool.query(
    "INSERT INTO audit_log(id,user_id,event,metadata,correlation_id) VALUES($1,'audit-owner','test.audit',$2,$3)",
    [
      id,
      JSON.stringify({
        entity: 'order',
        entityId: 'original',
        fromState: null,
        toState: 'submitted',
        reason: null,
      }),
      randomUUID(),
    ]
  );
}, 30000);
afterAll(async () => {
  await fixture?.close();
});

it.each([
  "UPDATE audit_log SET metadata='{}' WHERE id=$1",
  'DELETE FROM audit_log WHERE id=$1',
  "UPDATE audit_log SET created_at=created_at+INTERVAL '1 day' WHERE id=$1",
  "UPDATE audit_log SET user_id='replacement-actor' WHERE id=$1",
  "UPDATE audit_log SET event='replacement-event' WHERE id=$1",
  "UPDATE audit_log SET correlation_id='replacement-correlation' WHERE id=$1",
  "UPDATE audit_log SET id='replacement-id' WHERE id=$1",
  'UPDATE audit_log SET metadata=metadata WHERE id=$1',
])('rejects historical row mutation: %s', async (sql) => {
  const before = (await fixture.pool.query('SELECT * FROM audit_log WHERE id=$1', [id])).rows;
  await expect(fixture.pool.query(sql, [id])).rejects.toMatchObject({ code: '55000' });
  expect((await fixture.pool.query('SELECT * FROM audit_log WHERE id=$1', [id])).rows).toEqual(
    before
  );
});

it('rejects table truncation and preserves the existing acting-context constraint', async () => {
  await expect(fixture.pool.query('TRUNCATE audit_log')).rejects.toMatchObject({ code: '55000' });
  await expect(
    fixture.pool.query("UPDATE audit_log SET operating_context='staff' WHERE id=$1", [id])
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (await fixture.pool.query('SELECT id FROM audit_log WHERE id=$1', [id])).rows
  ).toHaveLength(1);
});

it('rolls back the business write and new audit event together without rewriting prior history', async () => {
  const client = await fixture.pool.connect();
  const before = (await fixture.pool.query('SELECT * FROM audit_log ORDER BY id')).rows;
  try {
    await client.query('BEGIN');
    await client.query(
      "INSERT INTO profiles(user_id,profile_type) VALUES('audit-owner','INDIVIDUAL')"
    );
    await client.query(
      "INSERT INTO audit_log(id,user_id,event,metadata,correlation_id) VALUES($1,'audit-owner','test.new','{}',$2)",
      [randomUUID(), randomUUID()]
    );
    await expect(client.query('DELETE FROM audit_log WHERE id=$1', [id])).rejects.toMatchObject({
      code: '55000',
    });
    await client.query('ROLLBACK');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect(
    (await fixture.pool.query("SELECT id FROM profiles WHERE user_id='audit-owner'")).rows
  ).toEqual([]);
  expect((await fixture.pool.query('SELECT * FROM audit_log ORDER BY id')).rows).toEqual(before);
});
