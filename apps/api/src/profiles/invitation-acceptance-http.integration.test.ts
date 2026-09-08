import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let profileId: string, inviteId: string, actor: string, other: string, csrf: string;
const headers = () => ({
  Cookie: `barghsa_session=${actor}`,
  'X-CSRF-Token': csrf,
  'Content-Type': 'application/json',
});
const accept = (id = inviteId) =>
  fetch(`${http.base}/api/invitations/${id}/accept`, {
    method: 'POST',
    headers: headers(),
    body: '{}',
  });

beforeEach(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  actor = randomUUID();
  other = randomUUID();
  csrf = randomUUID();
  inviteId = randomUUID();
  await http.pool.query(`INSERT INTO users(user_id,username,password_hash) VALUES
    ('owner','owner@example.test','fixture-only'),('invitee','invitee@example.test','fixture-only')`);
  profileId = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES ('owner','LEGAL','ACTIVE') RETURNING id"
    )
  ).rows[0].id;
  await http.pool.query(
    `INSERT INTO profile_invitations(id,profile_id,username,role,invited_by,expires_at)
    VALUES ($1,$2,'invitee@example.test','Finance','owner',clock_timestamp()+INTERVAL '1 day')`,
    [inviteId, profileId]
  );
  for (const id of [actor, other]) {
    const family = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
      VALUES ($1,'invitee',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
      [id, id === actor ? csrf : randomUUID(), family]
    );
    await http.pool.query(
      `INSERT INTO refresh_tokens(id,family_id,token_hash,user_id,session_id)
      VALUES ($1,$2,$3,'invitee',$4)`,
      [randomUUID(), family, createHash('sha256').update(randomUUID()).digest('hex'), id]
    );
  }
}, 40000);
afterEach(async () => {
  await http?.close();
}, 15000);

async function unchanged() {
  expect(
    (await http.pool.query('SELECT status FROM profile_invitations WHERE id=$1', [inviteId]))
      .rows[0].status
  ).toBe('Pending');
  expect(
    (await http.pool.query("SELECT id FROM profile_agents WHERE user_id='invitee'")).rows
  ).toHaveLength(0);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event='invitation_accepted'")).rows
  ).toHaveLength(0);
  expect((await http.pool.query('SELECT session_id FROM sessions')).rows).toHaveLength(2);
  expect((await http.pool.query('SELECT consumed_at FROM refresh_tokens')).rows).toEqual([
    { consumed_at: null },
    { consumed_at: null },
  ]);
}

it('rotates the accepting session, invalidates other credentials and keeps new profile access usable', async () => {
  const expiry = (
    await http.pool.query('SELECT expires_at FROM sessions WHERE session_id=$1', [actor])
  ).rows[0].expires_at;
  const response = await accept();
  expect(response.status, await response.clone().text()).toBe(200);
  const cookies = Object.fromEntries(
    response.headers
      .getSetCookie()
      .filter((c) => !c.startsWith('barghsa_session=;'))
      .map((c) => c.split(';')[0]!.split('='))
  );
  expect(cookies.barghsa_session).toBeTruthy();
  expect(cookies.barghsa_session).not.toBe(actor);
  expect(cookies.barghsa_csrf).toBeTruthy();
  expect(cookies.barghsa_csrf).not.toBe(csrf);
  expect(cookies.barghsa_refresh).toBeTruthy();
  const fresh = {
    Cookie: `barghsa_session=${cookies.barghsa_session}`,
    'X-CSRF-Token': cookies.barghsa_csrf!,
  };
  for (const id of [actor, other])
    expect(
      (
        await fetch(`${http.base}/api/auth/sessions`, {
          headers: { Cookie: `barghsa_session=${id}` },
        })
      ).status
    ).toBe(401);
  expect((await fetch(`${http.base}/api/profiles`, { headers: fresh })).status).toBe(200);
  expect(
    (await fetch(`${http.base}/api/wallet/${profileId}/create`, { method: 'POST', headers: fresh }))
      .status
  ).toBeLessThan(300);
  const sessions = (
    await http.pool.query('SELECT session_id,expires_at FROM sessions WHERE revoked_at IS NULL')
  ).rows;
  expect(sessions).toEqual([{ session_id: cookies.barghsa_session, expires_at: expiry }]);
  expect(
    (await http.pool.query('SELECT session_id FROM refresh_tokens WHERE consumed_at IS NULL')).rows
  ).toEqual([{ session_id: cookies.barghsa_session }]);
  expect(
    (await http.pool.query('SELECT role FROM profile_agents WHERE profile_id=$1', [profileId])).rows
  ).toEqual([{ role: 'Finance' }]);
  expect(
    (await http.pool.query('SELECT status FROM profile_invitations WHERE id=$1', [inviteId]))
      .rows[0].status
  ).toBe('Accepted');
});

it.each(['archive', 'revoke'])(
  'rejects %s winning a row lock after the request guard',
  async (change) => {
    const lock = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await lock.query('BEGIN');
      if (change === 'archive')
        await lock.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [profileId]);
      else await lock.query("SELECT user_id FROM users WHERE user_id='invitee' FOR UPDATE");
      const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = accept();
      await expect
        .poll(
          async () =>
            (
              await http.pool.query(
                'SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))',
                [pid]
              )
            ).rows[0].count
        )
        .toBe(1);
      if (change === 'archive')
        await lock.query('UPDATE profiles SET archived=true WHERE id=$1', [profileId]);
      else
        await lock.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE session_id=$1', [
          actor,
        ]);
      await lock.query('COMMIT');
      const response = await pending;
      expect(response.status, await response.clone().text()).toBe(change === 'archive' ? 409 : 401);
      expect(response.headers.getSetCookie()).toEqual([]);
      await unchanged();
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
      await pending;
    }
  }
);

it.each(['invitation', 'session'])(
  'rolls back if the %s expires during audit persistence',
  async (deadline) => {
    await http.pool.query(`CREATE SEQUENCE invitation_audit_calls;
    CREATE FUNCTION delay_invitation_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event='invitation_accepted' THEN PERFORM nextval('invitation_audit_calls'); PERFORM pg_sleep(2.2); END IF; RETURN NEW; END $$;
    CREATE TRIGGER delay_invitation_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION delay_invitation_audit()`);
    if (deadline === 'invitation')
      await http.pool.query(
        "UPDATE profile_invitations SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE id=$1",
        [inviteId]
      );
    else
      await http.pool.query(
        "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE session_id=$1",
        [actor]
      );
    const response = await accept();
    expect(
      (await http.pool.query('SELECT is_called FROM invitation_audit_calls')).rows[0].is_called
    ).toBe(true);
    expect(response.status, await response.clone().text()).toBe(
      deadline === 'invitation' ? 400 : 401
    );
    expect(response.headers.getSetCookie()).toEqual([]);
    await unchanged();
  }
);

it.each(['missing', 'other-user', 'not-pending', 'expired', 'member', 'disabled', 'csrf'])(
  'rejects %s acceptance without changing membership or credentials',
  async (reason) => {
    if (reason === 'other-user')
      await http.pool.query(
        "UPDATE profile_invitations SET username='owner@example.test' WHERE id=$1",
        [inviteId]
      );
    if (reason === 'not-pending')
      await http.pool.query("UPDATE profile_invitations SET status='Withdrawn' WHERE id=$1", [
        inviteId,
      ]);
    if (reason === 'expired')
      await http.pool.query(
        "UPDATE profile_invitations SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",
        [inviteId]
      );
    if (reason === 'member')
      await http.pool.query(
        "INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,'invitee','Legal')",
        [profileId]
      );
    if (reason === 'disabled')
      await http.pool.query(
        "UPDATE users SET disabled_at=clock_timestamp() WHERE user_id='invitee'"
      );
    const response =
      reason === 'csrf'
        ? await fetch(`${http.base}/api/invitations/${inviteId}/accept`, {
            method: 'POST',
            headers: { Cookie: headers().Cookie },
          })
        : await accept(reason === 'missing' ? randomUUID() : inviteId);
    const expected =
      reason === 'member'
        ? 409
        : reason === 'disabled'
          ? 401
          : reason === 'csrf'
            ? 403
            : ['missing', 'other-user'].includes(reason)
              ? 404
              : 400;
    expect(response.status, await response.clone().text()).toBe(expected);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(
      (await http.pool.query('SELECT status FROM profile_invitations WHERE id=$1', [inviteId]))
        .rows[0].status
    ).toBe(reason === 'not-pending' ? 'Withdrawn' : 'Pending');
    expect(
      (await http.pool.query("SELECT role FROM profile_agents WHERE user_id='invitee'")).rows
    ).toEqual(reason === 'member' ? [{ role: 'Legal' }] : []);
    expect((await http.pool.query('SELECT consumed_at FROM refresh_tokens')).rows).toEqual([
      { consumed_at: null },
      { consumed_at: null },
    ]);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event='invitation_accepted'")).rows
    ).toHaveLength(0);
  }
);

it('concurrent acceptance grants one membership and one new credential set', async () => {
  const responses = await Promise.all([accept(), accept()]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
  expect(
    (await http.pool.query("SELECT role FROM profile_agents WHERE user_id='invitee'")).rows
  ).toEqual([{ role: 'Finance' }]);
  expect(
    (await http.pool.query('SELECT session_id FROM sessions WHERE revoked_at IS NULL')).rows
  ).toHaveLength(1);
  expect(
    (await http.pool.query('SELECT id FROM refresh_tokens WHERE consumed_at IS NULL')).rows
  ).toHaveLength(1);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event='invitation_accepted'")).rows
  ).toHaveLength(1);
});

it('audit failure rolls back membership, invitation and rotated credentials without cookies', async () => {
  await http.pool
    .query(`CREATE FUNCTION deny_invitation_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event='invitation_accepted' THEN RAISE EXCEPTION 'controlled invitation failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER deny_invitation_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION deny_invitation_audit()`);
  const response = await accept();
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('controlled invitation failure');
  expect(response.headers.getSetCookie()).toEqual([]);
  await unchanged();
  expect((await http.pool.query('SELECT revoked_at FROM sessions')).rows).toEqual([
    { revoked_at: null },
    { revoked_at: null },
  ]);
});
