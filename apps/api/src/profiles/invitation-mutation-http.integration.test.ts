import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
}, 40000);
afterAll(async () => {
  await http?.close();
}, 15000);
// The fixture is shared to avoid rebuilding a database per case. Isolate only its
// per-IP decline quota; production limits and each profile's invitation quota remain active.
beforeEach(async () => {
  await http.pool.query("DELETE FROM rate_limit_counters WHERE key LIKE 'invitations:decline:%'");
  await http.pool.query(
    "DELETE FROM rate_limit_windows WHERE NOT security AND key LIKE 'invitations:decline:%'"
  );
});
async function setup(role = 'Manager', invitee = false) {
  const actor = randomUUID(),
    owner = role === 'Owner' ? actor : randomUUID();
  const session = randomUUID(),
    csrf = randomUUID(),
    correlation = randomUUID(),
    inviteId = randomUUID();
  for (const user of new Set([actor, owner]))
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES ($1,$2,'test-only')",
      [user, `${user}@example.test`]
    );
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
    VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
    [session, actor, csrf, randomUUID()]
  );
  const profileId = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES ($1,'LEGAL','ACTIVE') RETURNING id",
      [owner]
    )
  ).rows[0].id as string;
  if (role !== 'Owner' && role !== 'removed')
    await http.pool.query('INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,$2,$3)', [
      profileId,
      actor,
      role,
    ]);
  await http.pool.query(
    `INSERT INTO profile_invitations(id,profile_id,username,role,invited_by,expires_at)
    VALUES ($1,$2,$4,'Finance',$3,NOW()+INTERVAL '7 days')`,
    [inviteId, profileId, actor, invitee ? `${actor}@example.test` : 'existing@example.test']
  );
  return { actor, owner, session, csrf, correlation, profileId, inviteId };
}
type Context = Awaited<ReturnType<typeof setup>>;
type Operation = 'create' | 'withdraw' | 'decline';
function request(
  c: Context,
  operation: Operation,
  options: { body?: unknown; profileId?: string; inviteId?: string } = {}
) {
  return fetch(
    operation === 'decline'
      ? `${http.base}/api/invitations/${options.inviteId ?? c.inviteId}/decline`
      : `${http.base}/api/profiles/${options.profileId ?? c.profileId}/invitations${operation === 'withdraw' ? `/${options.inviteId ?? c.inviteId}` : ''}`,
    {
      method: operation === 'withdraw' ? 'DELETE' : 'POST',
      headers: {
        Cookie: `barghsa_session=${c.session}`,
        'X-CSRF-Token': c.csrf,
        'Content-Type': 'application/json',
        'X-Correlation-ID': c.correlation,
      },
      ...(operation === 'create'
        ? {
            body: JSON.stringify(
              options.body === undefined ? { username: '09121234567', role: 'Legal' } : options.body
            ),
          }
        : {}),
    }
  );
}
async function state(c: Context) {
  return {
    invitations: (
      await http.pool.query(
        'SELECT id,username,role,invited_by,status FROM profile_invitations WHERE profile_id=$1 ORDER BY id',
        [c.profileId]
      )
    ).rows,
    audit: (
      await http.pool.query(
        "SELECT event,metadata::jsonb AS metadata,correlation_id FROM audit_log WHERE metadata::jsonb->>'profileId'=$1 ORDER BY id",
        [c.profileId]
      )
    ).rows,
  };
}
for (const operation of ['create', 'withdraw', 'decline'] as const) {
  for (const role of ['Owner', 'Manager'])
    it(`${role} can ${operation} with no step-up and a correlated audit`, async () => {
      const c = await setup(role, operation === 'decline'),
        response = await request(c, operation);
      expect(response.status, (await response.text()) + http.logs()).toBe(
        operation === 'create' ? 201 : 200
      );
      const result = await state(c);
      expect(result.audit).toHaveLength(1);
      expect(result.audit[0]).toMatchObject({
        event:
          operation === 'create'
            ? 'invitation_created'
            : operation === 'withdraw'
              ? 'invitation_withdrawn'
              : 'invitation_declined',
        correlation_id: c.correlation,
        metadata: { profileId: c.profileId },
      });
      if (operation === 'create') {
        expect(result.invitations).toHaveLength(2);
        expect(result.invitations).toContainEqual(
          expect.objectContaining({
            username: '+989121234567',
            role: 'Legal',
            invited_by: c.actor,
            status: 'Pending',
          })
        );
        const ttl = (
          await http.pool.query(
            "SELECT expires_at-created_at AS ttl FROM profile_invitations WHERE profile_id=$1 AND username='+989121234567'",
            [c.profileId]
          )
        ).rows[0].ttl;
        expect(ttl.days).toBe(7);
      } else
        expect(result.invitations[0]).toMatchObject({
          status: operation === 'withdraw' ? 'Withdrawn' : 'Declined',
          invited_by: c.actor,
        });
    });
  for (const role of operation === 'decline' ? [] : ['Finance', 'Legal', 'removed'])
    it(`${role} original inviter cannot ${operation}`, async () => {
      const c = await setup(role, operation === 'decline'),
        before = await state(c),
        response = await request(c, operation);
      expect(response.status, (await response.text()) + http.logs()).toBe(403);
      expect(await state(c)).toEqual(before);
    });
  for (const change of operation === 'decline'
    ? ['disable', 'revoke', 'csrf', 'archive']
    : ['remove-role', 'disable', 'revoke', 'csrf', 'archive'])
    it(`${operation} rechecks ${change} after request guards`, async () => {
      const c = await setup('Manager', operation === 'decline'),
        before = await state(c),
        lock = await http.pool.connect();
      let pending: Promise<Response> | undefined;
      try {
        await lock.query('BEGIN');
        const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await lock.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [c.profileId]);
        pending = request(c, operation);
        await expect
          .poll(
            async () =>
              (
                await http.pool.query(
                  `SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
        AND $1=ANY(pg_blocking_pids(pid)) AND query LIKE 'SELECT user_id%FROM profiles WHERE id=%FOR UPDATE'`,
                  [pid]
                )
              ).rows.length,
            { timeout: 10000 }
          )
          .toBe(1);
        if (change === 'remove-role')
          await lock.query('DELETE FROM profile_agents WHERE profile_id=$1 AND user_id=$2', [
            c.profileId,
            c.actor,
          ]);
        else if (change === 'disable')
          await lock.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [c.actor]);
        else if (change === 'revoke')
          await lock.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE session_id=$1', [
            c.session,
          ]);
        else if (change === 'csrf')
          await lock.query(
            "UPDATE sessions SET csrf_token='rotated-fixture-csrf' WHERE session_id=$1",
            [c.session]
          );
        else await lock.query('UPDATE profiles SET archived=true WHERE id=$1', [c.profileId]);
        await lock.query('COMMIT');
        const response = await pending;
        expect(response.status, (await response.text()) + http.logs()).toBe(
          change === 'revoke' ? 401 : change === 'archive' && operation === 'decline' ? 409 : 403
        );
        expect(await state(c)).toEqual(before);
      } finally {
        await lock.query('ROLLBACK');
        lock.release();
        await pending;
      }
    }, 20000);
  for (const failure of ['expiry', 'audit'] as const)
    it(`${operation} rolls back ${failure} after writes`, async () => {
      const c = await setup('Manager', operation === 'decline'),
        before = await state(c);
      await http.pool.query('CREATE SEQUENCE invitation_mutation_witness');
      await http.pool
        .query(`CREATE FUNCTION interrupt_invitation_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.event IN ('invitation_created','invitation_withdrawn','invitation_declined') THEN
        PERFORM nextval('invitation_mutation_witness');
        ${failure === 'expiry' ? 'PERFORM pg_sleep(2.2);' : "RAISE EXCEPTION 'Injected invitation audit failure';"}
      END IF; RETURN NEW; END $$`);
      await http.pool.query(
        'CREATE TRIGGER interrupt_invitation_mutation BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION interrupt_invitation_mutation()'
      );
      try {
        if (failure === 'expiry')
          await http.pool.query(
            "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE session_id=$1",
            [c.session]
          );
        const response = await request(c, operation);
        expect(response.status, (await response.text()) + http.logs()).toBe(
          failure === 'expiry' ? 401 : 500
        );
        expect(
          (await http.pool.query('SELECT is_called FROM invitation_mutation_witness')).rows[0]
            .is_called
        ).toBe(true);
        expect(await state(c)).toEqual(before);
      } finally {
        await http.pool.query('DROP TRIGGER interrupt_invitation_mutation ON audit_log');
        await http.pool.query('DROP FUNCTION interrupt_invitation_mutation()');
        await http.pool.query('DROP SEQUENCE invitation_mutation_witness');
      }
    }, 10000);
}
it('serializes duplicate creation and returns conflict without a duplicate audit', async () => {
  const c = await setup(),
    other = await setup(),
    lock = await http.pool.connect();
  await http.pool.query(
    "INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,$2,'Manager')",
    [c.profileId, other.actor]
  );
  let pending: Promise<Response>[] = [];
  try {
    await lock.query('BEGIN');
    const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await lock.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [c.profileId]);
    pending = [request(c, 'create'), request({ ...other, profileId: c.profileId }, 'create')];
    await expect
      .poll(
        async () =>
          (
            await http.pool.query(
              `WITH RECURSIVE blocked AS (
        SELECT pid,query FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))
        UNION SELECT a.pid,a.query FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid)) WHERE a.datname=current_database()
      ) SELECT pid FROM blocked WHERE query LIKE 'SELECT user_id FROM profiles WHERE id=%FOR UPDATE'`,
              [pid]
            )
          ).rows.length,
        { timeout: 10000 }
      )
      .toBe(2);
    await lock.query('COMMIT');
    expect((await Promise.all(pending)).map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await state(c)).invitations).toHaveLength(2);
    expect((await state(c)).audit).toHaveLength(1);
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
    await Promise.allSettled(pending);
  }
}, 20000);
it('rejects duplicate members and pending invitations without writes', async () => {
  const c = await setup(),
    before = await state(c);
  for (const username of [`${c.actor}@example.test`, 'existing@example.test'])
    expect((await request(c, 'create', { body: { username, role: 'Finance' } })).status).toBe(409);
  expect(await state(c)).toEqual(before);
});
it('validates bodies and IDs before database writes', async () => {
  const c = await setup(),
    before = await state(c);
  for (const body of [
    null,
    {},
    { username: 32, role: 'Manager' },
    { username: 'user@example.test', role: 'Owner' },
  ])
    expect((await request(c, 'create', { body })).status).toBe(400);
  expect((await request(c, 'create', { profileId: 'invalid' })).status).toBe(400);
  expect((await request(c, 'withdraw', { inviteId: 'invalid' })).status).toBe(400);
  expect(await state(c)).toEqual(before);
});
it('withdrawal distinguishes missing scope from changed or expired decisions', async () => {
  const c = await setup(),
    before = await state(c);
  expect((await request(c, 'withdraw', { inviteId: randomUUID() })).status).toBe(404);
  const other = await setup();
  expect((await request(c, 'withdraw', { inviteId: other.inviteId })).status).toBe(404);
  await http.pool.query("UPDATE profile_invitations SET status='Accepted' WHERE id=$1", [
    c.inviteId,
  ]);
  expect((await request(c, 'withdraw')).status).toBe(409);
  await http.pool.query(
    "UPDATE profile_invitations SET status='Pending',expires_at=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",
    [c.inviteId]
  );
  expect((await request(c, 'withdraw')).status).toBe(409);
  expect(await state(c)).toEqual(before);
});

it('decline accepts the invited nonmember and preserves membership history', async () => {
  const c = await setup('removed', true);
  expect((await request(c, 'decline')).status).toBe(200);
  expect((await state(c)).invitations[0]).toMatchObject({
    status: 'Declined',
    invited_by: c.actor,
  });
  expect(
    (await http.pool.query('SELECT id FROM profile_agents WHERE profile_id=$1', [c.profileId])).rows
  ).toEqual([]);
});
it('decline rejects unowned, missing, malformed and changed invitations', async () => {
  const c = await setup('removed'),
    before = await state(c);
  expect((await request(c, 'decline')).status).toBe(404);
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [c.profileId]);
  expect((await request(c, 'decline')).status).toBe(404);
  await http.pool.query('UPDATE profiles SET archived=false WHERE id=$1', [c.profileId]);
  expect((await request(c, 'decline', { inviteId: randomUUID() })).status).toBe(404);
  expect((await request(c, 'decline', { inviteId: 'invalid' })).status).toBe(400);
  expect(await state(c)).toEqual(before);
  await http.pool.query(
    "UPDATE profile_invitations SET username=$2,status='Accepted' WHERE id=$1",
    [c.inviteId, `${c.actor}@example.test`]
  );
  expect((await request(c, 'decline')).status).toBe(409);
  await http.pool.query(
    "UPDATE profile_invitations SET status='Pending',expires_at=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",
    [c.inviteId]
  );
  expect((await request(c, 'decline')).status).toBe(409);
  expect((await state(c)).audit).toEqual([]);
});
it('decline checks current username after the profile lock wait', async () => {
  const c = await setup('removed', true),
    before = await state(c),
    lock = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await lock.query('BEGIN');
    const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await lock.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [c.profileId]);
    pending = request(c, 'decline');
    await expect
      .poll(
        async () =>
          (
            await http.pool.query(
              `SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
      AND $1=ANY(pg_blocking_pids(pid)) AND query LIKE 'SELECT user_id,profile_type,archived FROM profiles%FOR UPDATE'`,
              [pid]
            )
          ).rows.length,
        { timeout: 10000 }
      )
      .toBe(1);
    await lock.query('UPDATE users SET username=$2 WHERE user_id=$1', [
      c.actor,
      `changed-${c.actor}@example.test`,
    ]);
    await lock.query('COMMIT');
    expect((await pending).status).toBe(404);
    expect(await state(c)).toEqual(before);
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
    await pending;
  }
}, 15000);
for (const operation of ['withdraw', 'decline'] as const) {
  it(`${operation} rolls back decision expiry during its audit`, async () => {
    const c = await setup('Manager', operation === 'decline'),
      before = await state(c);
    await http.pool.query('CREATE SEQUENCE invitation_deadline_witness');
    await http.pool
      .query(`CREATE FUNCTION delay_invitation_deadline() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.event IN ('invitation_withdrawn','invitation_declined') THEN
        PERFORM nextval('invitation_deadline_witness'); PERFORM pg_sleep(2.2);
      END IF; RETURN NEW; END $$`);
    await http.pool.query(
      'CREATE TRIGGER delay_invitation_deadline BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION delay_invitation_deadline()'
    );
    try {
      await http.pool.query(
        "UPDATE profile_invitations SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE id=$1",
        [c.inviteId]
      );
      const response = await request(c, operation);
      expect(response.status, (await response.text()) + http.logs()).toBe(409);
      expect(
        (await http.pool.query('SELECT is_called FROM invitation_deadline_witness')).rows[0]
          .is_called
      ).toBe(true);
      expect(await state(c)).toEqual(before);
    } finally {
      await http.pool.query('DROP TRIGGER delay_invitation_deadline ON audit_log');
      await http.pool.query('DROP FUNCTION delay_invitation_deadline()');
      await http.pool.query('DROP SEQUENCE invitation_deadline_witness');
    }
  }, 10000);
}
