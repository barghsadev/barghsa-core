import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { runMigrations } from '../../../../packages/db/src/migrate';
import { expireInvitations } from './invitation-expiry.js';

let pool: Pool, management: Pool;
const database = `test_invitation_expiry_${randomUUID().replaceAll('-', '')}`;
const actor = 'invitation-worker';
let profile: string;
beforeAll(async () => {
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${database}`;
  const migration = await runMigrations({ connection: { pgdirectUrl: url.toString() } });
  if (!migration.ok) throw new Error(JSON.stringify(migration));
  pool = new Pool({ connectionString: url.toString() });
  await pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_admin) VALUES ($1,'worker@example.test','fixture-only',true)",
    [actor]
  );
  profile = (
    await pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES ($1,'LEGAL','ACTIVE') RETURNING id",
      [actor]
    )
  ).rows[0].id;
}, 40000);
afterAll(async () => {
  await pool?.end();
  await management.query(`DROP DATABASE "${database}"`);
  await management.end();
});
beforeEach(async () => {
  await pool.query('DELETE FROM audit_log');
  await pool.query('DELETE FROM profile_invitations');
  await pool.query('UPDATE users SET is_admin=true,disabled_at=NULL WHERE user_id=$1', [actor]);
});
async function seed(status = 'Pending', seconds: number | null = -1) {
  return (
    await pool.query(
      `INSERT INTO profile_invitations(profile_id,username,role,invited_by,status,expires_at)
     VALUES ($1,$2,'Finance',$3,$4,clock_timestamp()+$5*INTERVAL '1 second') RETURNING id`,
      [profile, `${randomUUID()}@example.test`, actor, status, seconds]
    )
  ).rows[0].id as string;
}
async function status(id: string) {
  return (await pool.query('SELECT status FROM profile_invitations WHERE id=$1', [id])).rows[0]
    .status;
}

it('expires due pending invitations once, preserving other states and writing correlated audit', async () => {
  const due = await seed(),
    boundary = await seed('Pending', 0);
  const preserved = [await seed('Pending', 3600), await seed('Pending', null)];
  for (const state of ['Accepted', 'Declined', 'Withdrawn', 'Expired']) {
    const id = await seed(state);
    expect(await status(id)).toBe(state);
  }
  expect(await expireInvitations(pool, actor)).toBe(2);
  expect(await status(due)).toBe('Expired');
  expect(await status(boundary)).toBe('Expired');
  for (const id of preserved) expect(await status(id)).toBe('Pending');
  const records = (
    await pool.query('SELECT user_id,event,metadata::jsonb,correlation_id FROM audit_log')
  ).rows;
  expect(records).toHaveLength(2);
  for (const row of records)
    expect(row).toMatchObject({
      user_id: actor,
      event: 'invitation_expired',
      correlation_id: expect.any(String),
      metadata: { profileId: profile, invitationId: expect.any(String), source: 'worker' },
    });
  expect(new Set(records.map((row) => row.correlation_id)).size).toBe(1);
  expect(await expireInvitations(pool, actor)).toBe(0);
  expect((await pool.query('SELECT id FROM audit_log')).rows).toHaveLength(2);
});

it('audit failure rolls back expiry and a retry records it exactly once', async () => {
  const id = await seed();
  await pool.query(
    "CREATE FUNCTION reject_expiry_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure';END $$"
  );
  await pool.query(
    'CREATE TRIGGER reject_expiry_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_expiry_audit()'
  );
  try {
    await expect(expireInvitations(pool, actor)).rejects.toThrow('fixture audit failure');
    expect(await status(id)).toBe('Pending');
    expect((await pool.query('SELECT id FROM audit_log')).rows).toEqual([]);
  } finally {
    await pool.query('DROP TRIGGER reject_expiry_audit ON audit_log');
    await pool.query('DROP FUNCTION reject_expiry_audit()');
  }
  expect(await expireInvitations(pool, actor)).toBe(1);
});

it('concurrent workers skip locked decisions and partition bounded batches without duplicate audit', async () => {
  const locked = await seed();
  for (let i = 0; i < 6; i++) await seed();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM profile_invitations WHERE id=$1 FOR UPDATE', [locked]);
    const counts = await Promise.all([
      expireInvitations(pool, actor, 2),
      expireInvitations(pool, actor, 2),
    ]);
    expect(counts).toEqual([2, 2]);
    expect(await status(locked)).toBe('Pending');
    await client.query("UPDATE profile_invitations SET status='Declined' WHERE id=$1", [locked]);
    await client.query('COMMIT');
    expect(await expireInvitations(pool, actor)).toBe(2);
    expect(await status(locked)).toBe('Declined');
    const audit = (await pool.query("SELECT metadata::jsonb->>'invitationId' AS id FROM audit_log"))
      .rows;
    expect(audit).toHaveLength(6);
    expect(new Set(audit.map((row) => row.id)).size).toBe(6);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

it('requires a valid audit actor only when work is due and never silently substitutes a configured actor', async () => {
  expect(await expireInvitations(pool, 'missing')).toBe(0);
  const id = await seed();
  await expect(expireInvitations(pool, 'missing')).rejects.toThrow('audit actor');
  expect(await status(id)).toBe('Pending');
  await pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [actor]);
  await expect(expireInvitations(pool, actor)).rejects.toThrow('audit actor');
  await pool.query('UPDATE users SET disabled_at=NULL,is_admin=false WHERE user_id=$1', [actor]);
  await expect(expireInvitations(pool, '')).rejects.toThrow('audit actor');
  await pool.query('UPDATE users SET is_admin=true WHERE user_id=$1', [actor]);
  expect(await expireInvitations(pool, '')).toBe(1);
});

it.each([0, 201, 1.5])(
  'rejects invalid batch size %s without changing invitations',
  async (limit) => {
    const id = await seed();
    await expect(expireInvitations(pool, actor, limit)).rejects.toThrow('batch size');
    expect(await status(id)).toBe('Pending');
  }
);
