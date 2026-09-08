import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let profileId: string, inviteId: string;
let ownerHeaders: Record<string, string>, inviteeHeaders: Record<string, string>;
beforeEach(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  for (const user of ['owner', 'invitee']) {
    await http.pool.query('INSERT INTO users(user_id,username,password_hash) VALUES ($1,$2,$3)', [
      user,
      `${user}@example.test`,
      'test-only',
    ]);
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
      VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
      [session, user, csrf, randomUUID()]
    );
    const headers = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
    if (user === 'owner') ownerHeaders = headers;
    else inviteeHeaders = headers;
  }
  profileId = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES ('owner','LEGAL','ACTIVE') RETURNING id"
    )
  ).rows[0].id;
  inviteId = randomUUID();
  await http.pool.query(
    `INSERT INTO profile_invitations(id,profile_id,username,role,invited_by,expires_at)
    VALUES ($1,$2,'invitee@example.test','Finance','owner',NOW()+INTERVAL '1 day')`,
    [inviteId, profileId]
  );
}, 40000);
afterEach(async () => {
  await http?.close();
}, 15000);
function decide(action: string) {
  const withdraw = action === 'withdraw';
  return fetch(
    `${http.base}/api/${withdraw ? `profiles/${profileId}/invitations/${inviteId}` : `invitations/${inviteId}/${action}`}`,
    {
      method: withdraw ? 'DELETE' : 'POST',
      headers: withdraw ? ownerHeaders : inviteeHeaders,
    }
  );
}
it.each(['accept', 'decline', 'withdraw'])(
  'serializes acceptance racing %s and commits one decision',
  async (opponent) => {
    const client = await http.pool.connect();
    let attempts: Promise<Response>[] = [];
    try {
      await client.query('BEGIN');
      const blockerPid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await client.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [profileId]);
      await client.query('SELECT id FROM profile_invitations WHERE id=$1 FOR UPDATE', [inviteId]);
      attempts = [decide('accept'), decide(opponent)];
      await expect
        .poll(
          async () =>
            (
              await http.pool.query(
                `WITH RECURSIVE blocked AS (
        SELECT pid,query FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))
        UNION
        SELECT a.pid,a.query FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid)) WHERE a.datname=current_database()
      ) SELECT count(*)::int AS count FROM blocked
        WHERE query LIKE 'SELECT user_id%FROM profiles%FOR UPDATE' OR query LIKE 'UPDATE profile_invitations%'`,
                [blockerPid]
              )
            ).rows[0].count
        )
        .toBe(2);
      await client.query('COMMIT');
      const statuses = (await Promise.all(attempts)).map((r) => r.status);
      expect(statuses.filter((s) => s === 200 || s === 204)).toHaveLength(1);
      // A losing acceptance can see the changed decision or its intentionally rotated session.
      expect(
        statuses.filter((s) => [400, 401, 409].includes(s)),
        JSON.stringify(statuses) + http.logs()
      ).toHaveLength(1);
      const status = (
        await http.pool.query('SELECT status FROM profile_invitations WHERE id=$1', [inviteId])
      ).rows[0].status;
      const members = (
        await http.pool.query('SELECT role FROM profile_agents WHERE profile_id=$1', [profileId])
      ).rows;
      expect(members).toEqual(status === 'Accepted' ? [{ role: 'Finance' }] : []);
      expect(
        (
          await http.pool.query(
            "SELECT count(*)::int AS count FROM audit_log WHERE event IN ('invitation_accepted','invitation_declined','invitation_withdrawn')"
          )
        ).rows[0].count
      ).toBe(1);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await Promise.allSettled(attempts);
    }
  },
  15000
);
it('rolls back membership and acceptance if the audit write fails', async () => {
  await http.pool
    .query(`CREATE FUNCTION reject_invitation_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event='invitation_accepted' THEN RAISE EXCEPTION 'Injected audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_invitation_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_invitation_audit()`);
  expect((await decide('accept')).status).toBe(500);
  expect(
    (await http.pool.query('SELECT status FROM profile_invitations WHERE id=$1', [inviteId]))
      .rows[0].status
  ).toBe('Pending');
  expect(
    (await http.pool.query('SELECT * FROM profile_agents WHERE profile_id=$1', [profileId])).rows
  ).toEqual([]);
  await http.pool.query('DROP TRIGGER reject_invitation_audit ON audit_log');
  expect((await decide('accept')).status).toBe(200);
});
it('rejects acceptance when expiry changes while the decision waits', async () => {
  const client = await http.pool.connect();
  let attempt: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM profile_invitations WHERE id=$1 FOR UPDATE', [inviteId]);
    attempt = decide('accept');
    await expect
      .poll(
        async () =>
          (
            await http.pool.query(`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT profile_id,username,role,status,expires_at FROM profile_invitations%FOR UPDATE'`)
          ).rows[0].count
      )
      .toBe(1);
    await client.query(
      "UPDATE profile_invitations SET expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1",
      [inviteId]
    );
    await client.query('COMMIT');
    expect((await attempt).status).toBe(400);
    expect(
      (await http.pool.query('SELECT * FROM profile_agents WHERE profile_id=$1', [profileId])).rows
    ).toEqual([]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await attempt;
  }
});
