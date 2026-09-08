import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
}, 40000);
afterAll(async () => {
  await http?.close();
}, 15000);

async function setup(self = false) {
  const owner = randomUUID(),
    actor = randomUUID(),
    target = self ? actor : randomUUID();
  const sessionId = randomUUID(),
    csrf = randomUUID(),
    correlationId = randomUUID();
  for (const user of new Set([owner, actor, target])) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES ($1,$2,'test-only')",
      [user, `${user}@example.test`]
    );
    const session = user === actor ? sessionId : randomUUID(),
      family = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
      VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
      [session, user, csrf, family]
    );
    await http.pool.query(
      'INSERT INTO refresh_tokens(id,family_id,token_hash,user_id,session_id) VALUES ($1,$2,$3,$4,$5)',
      [randomUUID(), family, randomUUID(), user, session]
    );
  }
  const profileId = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES ($1,'LEGAL','ACTIVE') RETURNING id",
      [owner]
    )
  ).rows[0].id as string;
  for (const user of new Set([actor, target])) {
    await http.pool.query(
      "INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,$2,'Manager')",
      [profileId, user]
    );
  }
  return { owner, actor, target, profileId, sessionId, csrf, correlationId };
}
type Context = Awaited<ReturnType<typeof setup>>;
type Operation = 'roles' | 'remove';
function mutate(c: Context, operation: Operation, roles = ['Finance']) {
  return fetch(
    `${http.base}/api/profiles/${c.profileId}/agents/${c.target}${operation === 'roles' ? '/roles' : ''}`,
    {
      method: operation === 'roles' ? 'PUT' : 'DELETE',
      headers: {
        Cookie: `barghsa_session=${c.sessionId}`,
        'X-CSRF-Token': c.csrf,
        'Content-Type': 'application/json',
        'X-Correlation-ID': c.correlationId,
      },
      ...(operation === 'roles' ? { body: JSON.stringify({ roles }) } : {}),
    }
  );
}
async function snapshot(c: Context) {
  return {
    members: (
      await http.pool.query(
        'SELECT id,role FROM profile_agents WHERE profile_id=$1 AND user_id=$2 ORDER BY role',
        [c.profileId, c.target]
      )
    ).rows,
    sessions: (
      await http.pool.query(
        'SELECT session_id,revoked_at FROM sessions WHERE user_id=$1 ORDER BY session_id',
        [c.target]
      )
    ).rows,
    refresh: (
      await http.pool.query(
        'SELECT id,consumed_at FROM refresh_tokens WHERE user_id=$1 ORDER BY id',
        [c.target]
      )
    ).rows,
    audit: (
      await http.pool.query(
        "SELECT id FROM audit_log WHERE metadata::jsonb->>'profileId'=$1 ORDER BY id",
        [c.profileId]
      )
    ).rows,
  };
}
for (const operation of ['roles', 'remove'] as const) {
  for (const change of ['remove-role', 'disable-actor', 'revoke-session', 'rotate-csrf'] as const) {
    it(`${operation} rechecks ${change} after request guards`, async () => {
      const c = await setup(),
        before = await snapshot(c),
        lock = await http.pool.connect();
      let pending: Promise<Response> | undefined;
      try {
        await lock.query('BEGIN');
        const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await lock.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [c.profileId]);
        pending = mutate(c, operation);
        await expect
          .poll(
            async () =>
              (
                await http.pool.query(
                  `SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND $1=ANY(pg_blocking_pids(pid)) AND query LIKE 'SELECT user_id FROM profiles WHERE id=%FOR UPDATE'`,
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
        else if (change === 'disable-actor')
          await lock.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [c.actor]);
        else if (change === 'revoke-session')
          await lock.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE session_id=$1', [
            c.sessionId,
          ]);
        else
          await lock.query(
            "UPDATE sessions SET csrf_token='replacement-fixture-token' WHERE session_id=$1",
            [c.sessionId]
          );
        await lock.query('COMMIT');
        const response = await pending;
        expect(response.status, (await response.text()) + http.logs()).toBe(
          change === 'revoke-session' ? 401 : 403
        );
        expect(await snapshot(c)).toEqual(before);
        if (change === 'rotate-csrf') {
          const line = http
            .logs()
            .split('\n')
            .find((value) =>
              value.includes(
                `CSRF check failed: session token changed | correlationId=${c.correlationId}`
              )
            );
          expect(line).toBeDefined();
          expect(line).not.toContain(c.csrf);
          expect(line).not.toContain('replacement-fixture-token');
        }
      } finally {
        await lock.query('ROLLBACK');
        lock.release();
        await pending;
      }
    }, 20000);
  }
  for (const self of [false, true]) {
    it(`${operation} audits current step-up and reports self sign-out=${self}`, async () => {
      const c = await setup(self);
      const verifiedAt = (
        await http.pool.query('SELECT step_up_verified_at FROM sessions WHERE session_id=$1', [
          c.sessionId,
        ])
      ).rows[0].step_up_verified_at as Date;
      const response = await mutate(c, operation);
      expect(response.status, http.logs()).toBe(200);
      expect(await response.json()).toMatchObject({ sessionRevoked: self });
      const after = await snapshot(c);
      expect(after.members.map((row) => row.role)).toEqual(
        operation === 'roles' ? ['Finance'] : []
      );
      expect(after.sessions.every((row) => row.revoked_at instanceof Date)).toBe(true);
      expect(after.refresh.every((row) => row.consumed_at instanceof Date)).toBe(true);
      expect(after.audit).toHaveLength(1);
      const audit = (
        await http.pool.query(
          'SELECT event,metadata::jsonb AS metadata,correlation_id FROM audit_log WHERE id=$1',
          [after.audit[0]!.id]
        )
      ).rows[0];
      expect(audit).toMatchObject({
        event: operation === 'roles' ? 'agent_roles_changed' : 'agent_removed',
        correlation_id: c.correlationId,
        metadata: {
          profileId: c.profileId,
          targetUserId: c.target,
          before: ['Manager'],
          after: operation === 'roles' ? ['Finance'] : [],
          stepUpVerified: true,
          stepUpVerifiedAt: verifiedAt.toISOString(),
        },
      });
      expect(
        (await http.pool.query('SELECT user_id FROM users WHERE user_id=$1', [c.target])).rows
      ).toHaveLength(1);
    });
    for (const expiry of ['step-up', 'session'] as const) {
      it(`${operation} rolls back ${expiry} expiry during audit, self=${self}`, async () => {
        const c = await setup(self),
          before = await snapshot(c);
        await http.pool.query('CREATE SEQUENCE agent_delay_witness');
        await http.pool
          .query(`CREATE FUNCTION delay_agent_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.event IN ('agent_roles_changed','agent_removed') THEN
            PERFORM nextval('agent_delay_witness'); PERFORM pg_sleep(2.2);
          END IF; RETURN NEW; END $$`);
        await http.pool.query(
          'CREATE TRIGGER delay_agent_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION delay_agent_audit()'
        );
        try {
          await http.pool.query(
            expiry === 'step-up'
              ? "UPDATE sessions SET step_up_verified_at=clock_timestamp()-INTERVAL '15 minutes'+INTERVAL '2 seconds' WHERE session_id=$1"
              : "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE session_id=$1",
            [c.sessionId]
          );
          const response = await mutate(c, operation);
          expect(response.status, (await response.text()) + http.logs()).toBe(
            expiry === 'step-up' ? 403 : 401
          );
          expect(
            (await http.pool.query('SELECT is_called FROM agent_delay_witness')).rows[0].is_called
          ).toBe(true);
          expect(await snapshot(c)).toEqual(before);
        } finally {
          await http.pool.query('DROP TRIGGER delay_agent_audit ON audit_log');
          await http.pool.query('DROP FUNCTION delay_agent_audit()');
          await http.pool.query('DROP SEQUENCE agent_delay_witness');
        }
      }, 10000);
    }
  }
}
it('unchanged self roles preserve credentials and do not request sign-out', async () => {
  const c = await setup(true),
    before = await snapshot(c);
  const response = await mutate(c, 'roles', ['Manager']);
  expect(response.status, http.logs()).toBe(200);
  expect(await response.json()).toMatchObject({ roles: ['Manager'], sessionRevoked: false });
  expect(await snapshot(c)).toEqual(before);
});
