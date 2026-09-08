import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hash } from 'argon2';
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db';
import { SessionService } from './session.service.js';
import { SessionController } from './session.controller.js';
import type { AuthenticatedRequest } from './session.guard.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';

const holder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }));
vi.mock('@barghsa/db', async (original) => ({
  ...(await original<typeof import('@barghsa/db')>()),
  getDbPool: () => holder.pool!,
}));
const password = 'Self-revocation-test-123!';
const service = new SessionService();
const controller = new SessionController(service);
let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
let actor: Awaited<ReturnType<typeof service.createSession>>;
let other: typeof actor;
let request: AuthenticatedRequest;

beforeEach(async () => {
  db = await createMigratedTestDb();
  holder.pool = db.pool;
  await db.pool.query('INSERT INTO users(user_id,username,password_hash) VALUES ($1,$2,$3)', [
    'self-revoke',
    'self-revoke@example.test',
    await hash(password),
  ]);
  actor = await service.createSession('self-revoke', false);
  other = await service.createSession('self-revoke', false);
  await db.pool.query(
    'UPDATE sessions SET step_up_verified_at=clock_timestamp() WHERE session_id=$1',
    [actor.sessionId]
  );
  // Represents the authorization context already checked by the request guards.
  request = {
    ip: '127.0.0.1',
    session: {
      userId: 'self-revoke',
      sessionId: actor.sessionId,
      csrfToken: actor.csrfToken,
      isAdmin: false,
      stepUpVerifiedAt: new Date(),
    },
  } as AuthenticatedRequest;
}, 30000);

afterEach(async () => {
  holder.pool = null;
  await db?.close();
});

async function unchangedTarget() {
  expect(
    (await db.pool.query('SELECT revoked_at FROM sessions WHERE session_id=$1', [other.sessionId]))
      .rows[0].revoked_at
  ).toBeNull();
  expect(
    (
      await db.pool.query('SELECT consumed_at FROM refresh_tokens WHERE session_id=$1', [
        other.sessionId,
      ])
    ).rows[0].consumed_at
  ).toBeNull();
}

for (const mode of ['one', 'all'] as const) {
  it(`${mode} revocation rejects an actor revoked after guard authorization`, async () => {
    const lock = await db.pool.connect();
    let result: Promise<unknown> | undefined;
    try {
      await lock.query('BEGIN');
      await lock.query("SELECT user_id FROM users WHERE user_id='self-revoke' FOR UPDATE");
      await lock.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE session_id=$1', [
        actor.sessionId,
      ]);
      const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      result = (
        mode === 'one'
          ? controller.revokeSession(other.sessionId, request)
          : controller.revokeAllSessions({ password }, request)
      ).catch((error) => error);
      await expect
        .poll(
          async () =>
            (
              await db.pool.query(
                'SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))',
                [pid]
              )
            ).rows[0].count
        )
        .toBe(1);
      await lock.query('COMMIT');
      expect(await result).toMatchObject({ status: 401 });
      await unchangedTarget();
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
      await result;
    }
  });
}

it('all revocation verifies the password after acquiring the account lock', async () => {
  const lock = await db.pool.connect();
  let result: Promise<unknown> | undefined;
  try {
    await lock.query('BEGIN');
    await lock.query("UPDATE users SET password_hash=$1 WHERE user_id='self-revoke'", [
      await hash('Changed-password-123!'),
    ]);
    const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    result = controller.revokeAllSessions({ password }, request).catch((error) => error);
    await expect
      .poll(
        async () =>
          (
            await db.pool.query(
              'SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))',
              [pid]
            )
          ).rows[0].count
      )
      .toBe(1);
    await lock.query('COMMIT');
    expect(await result).toMatchObject({ status: 422 });
    await unchangedTarget();
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
    await result;
  }
});

it('bulk revocation preserves the caller, reports the committed active count and audits without credentials', async () => {
  const result = await correlationIdStorage.run('self-revoke-test', () =>
    controller.revokeAllSessions({ password }, request)
  );
  expect(result.revokedCount).toBe(1);
  expect(await service.validateSession(actor.sessionId, false)).not.toBeNull();
  expect(await service.validateSession(other.sessionId, false)).toBeNull();
  expect(
    (
      await db.pool.query('SELECT consumed_at FROM refresh_tokens WHERE session_id=$1', [
        other.sessionId,
      ])
    ).rows[0].consumed_at
  ).not.toBeNull();
  const audit = (
    await db.pool.query(
      "SELECT correlation_id,ip,metadata::jsonb AS metadata FROM audit_log WHERE event='sessions_revoked'"
    )
  ).rows;
  expect(audit).toEqual([
    {
      correlation_id: 'self-revoke-test',
      ip: '127.0.0.1',
      metadata: { scope: 'others', revokedCount: 1, changedSessionCount: 1, stepUpVerified: true },
    },
  ]);
  for (const value of [
    password,
    actor.sessionId,
    actor.csrfToken,
    actor.refreshToken,
    other.sessionId,
    other.refreshToken,
  ])
    expect(JSON.stringify(audit)).not.toContain(value);
  expect((await controller.revokeAllSessions({ password }, request)).revokedCount).toBe(0);
});

it('single revocation protects foreign targets and supports deliberately revoking the current session', async () => {
  await db.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('foreign-user','foreign@example.test','unused')"
  );
  const foreign = await service.createSession('foreign-user', false);
  await expect(controller.revokeSession(foreign.sessionId, request)).rejects.toMatchObject({
    status: 404,
  });
  expect(await service.validateSession(foreign.sessionId, false)).not.toBeNull();
  await expect(controller.revokeSession(actor.sessionId, request)).resolves.toEqual({
    message: 'Session revoked.',
  });
  expect(await service.validateSession(actor.sessionId, false)).toBeNull();
  await unchangedTarget();
});

it.each(['expired', 'future', 'missing'] as const)(
  'single revocation rejects %s step-up verification',
  async (condition) => {
    const verifiedAt =
      condition === 'missing'
        ? null
        : new Date(
            Date.now() + (condition === 'future' ? 60000 : -SessionService.STEP_UP_WINDOW_MS)
          );
    await db.pool.query('UPDATE sessions SET step_up_verified_at=$1 WHERE session_id=$2', [
      verifiedAt,
      actor.sessionId,
    ]);
    await expect(controller.revokeSession(other.sessionId, request)).rejects.toMatchObject({
      status: 403,
    });
    await unchangedTarget();
  }
);

it('rejects a changed acting CSRF token after guard authorization', async () => {
  await db.pool.query("UPDATE sessions SET csrf_token='replacement-token' WHERE session_id=$1", [
    actor.sessionId,
  ]);
  await expect(controller.revokeAllSessions({ password }, request)).rejects.toMatchObject({
    status: 403,
  });
  await unchangedTarget();
});

it('concurrent bulk requests report only their own committed revocations', async () => {
  const responses = await Promise.all(
    [0, 1].map(() => controller.revokeAllSessions({ password }, request))
  );
  expect(responses.map((result) => result.revokedCount).sort()).toEqual([0, 1]);
  expect(await service.validateSession(actor.sessionId, false)).not.toBeNull();
});

it('single revocation rolls back if the step-up window expires during audit persistence', async () => {
  await db.pool.query(
    "UPDATE sessions SET step_up_verified_at=clock_timestamp()-($1::double precision*INTERVAL '1 millisecond')+INTERVAL '1 second' WHERE session_id=$2",
    [SessionService.STEP_UP_WINDOW_MS, actor.sessionId]
  );
  await db.pool
    .query(`CREATE SEQUENCE self_revoke_audit_calls; CREATE FUNCTION delay_self_revoke_step_up() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event='sessions_revoked' THEN PERFORM nextval('self_revoke_audit_calls'); PERFORM pg_sleep(1.2); END IF; RETURN NEW; END $$;
    CREATE TRIGGER delay_self_revoke_step_up BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION delay_self_revoke_step_up()`);
  await expect(controller.revokeSession(other.sessionId, request)).rejects.toMatchObject({
    status: 403,
  });
  await unchangedTarget();
  expect(
    (await db.pool.query('SELECT is_called FROM self_revoke_audit_calls')).rows[0].is_called
  ).toBe(true);
});

for (const mode of ['one', 'all'] as const) {
  it(`${mode} revocation rolls back session and refresh changes if audit persistence fails`, async () => {
    await db.pool
      .query(`CREATE FUNCTION reject_self_revoke_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event='sessions_revoked' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_self_revoke_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_self_revoke_audit()`);
    const result =
      mode === 'one'
        ? controller.revokeSession(other.sessionId, request)
        : controller.revokeAllSessions({ password }, request);
    await expect(result).rejects.toMatchObject({ status: 500 });
    await unchangedTarget();
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM audit_log WHERE event='sessions_revoked'"
        )
      ).rows[0].count
    ).toBe(0);
  });

  it(`${mode} revocation rolls back if the actor expires during audit persistence`, async () => {
    await db.pool.query(
      "UPDATE sessions SET idle_deadline=clock_timestamp()+INTERVAL '1 second' WHERE session_id=$1",
      [actor.sessionId]
    );
    await db.pool
      .query(`CREATE SEQUENCE self_revoke_audit_calls; CREATE FUNCTION delay_self_revoke_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event='sessions_revoked' THEN PERFORM nextval('self_revoke_audit_calls'); PERFORM pg_sleep(1.2); END IF; RETURN NEW; END $$;
      CREATE TRIGGER delay_self_revoke_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION delay_self_revoke_audit()`);
    const result =
      mode === 'one'
        ? controller.revokeSession(other.sessionId, request)
        : controller.revokeAllSessions({ password }, request);
    await expect(result).rejects.toMatchObject({ status: 401 });
    await unchangedTarget();
    expect(
      (await db.pool.query('SELECT is_called FROM self_revoke_audit_calls')).rows[0].is_called
    ).toBe(true);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM audit_log WHERE event='sessions_revoked'"
        )
      ).rows[0].count
    ).toBe(0);
  });
}
