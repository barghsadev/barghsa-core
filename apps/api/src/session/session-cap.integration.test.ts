import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db';
import { SessionService } from './session.service.js';
const holder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }));
vi.mock('@barghsa/db', async (original) => ({
  ...(await original<typeof import('@barghsa/db')>()),
  getDbPool: () => holder.pool!,
}));
let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
const service = new SessionService();
beforeEach(async () => {
  db = await createMigratedTestDb();
  holder.pool = db.pool;
  await db.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('cap-user','cap@example.test','test-only')"
  );
}, 30000);
afterEach(async () => {
  holder.pool = null;
  await db?.close();
});
async function usable() {
  return (
    await db.pool
      .query(`SELECT session_id FROM sessions WHERE user_id='cap-user' AND revoked_at IS NULL
    AND expires_at>NOW() AND idle_deadline>NOW()`)
  ).rows;
}

it('preserves the absolute deadline across identifier rotation, refresh and idle touch', async () => {
  const original = await service.createSession('cap-user', false);
  const cutoff = (
    await db.pool.query(
      "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '5 minutes',idle_deadline=clock_timestamp()+INTERVAL '1 minute' WHERE session_id=$1 RETURNING expires_at",
      [original.sessionId]
    )
  ).rows[0].expires_at;
  const rotated = await service.rotateSession(original.sessionId, 'deadline test');
  expect(rotated!.expiresAt).toEqual(cutoff);
  await service.redeemRefreshToken(rotated!.refreshToken);
  const validated = await service.validateSession(rotated!.sessionId);
  expect(validated).toMatchObject({ expiresAt: cutoff, idleDeadline: cutoff });
  expect(
    (
      await db.pool.query('SELECT expires_at,idle_deadline FROM sessions WHERE session_id=$1', [
        rotated!.sessionId,
      ])
    ).rows
  ).toEqual([{ expires_at: cutoff, idle_deadline: cutoff }]);
});

it.each(['revoked', 'disabled'] as const)(
  'does not validate a session made %s while waiting for its account',
  async (condition) => {
    const original = await service.createSession('cap-user', false);
    const before = (
      await db.pool.query('SELECT idle_deadline FROM sessions WHERE session_id=$1', [
        original.sessionId,
      ])
    ).rows[0];
    const lock = await db.pool.connect();
    let validating: ReturnType<typeof service.validateSession> | undefined;
    try {
      await lock.query('BEGIN');
      await lock.query("SELECT user_id FROM users WHERE user_id='cap-user' FOR UPDATE");
      const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      validating = service.validateSession(original.sessionId);
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
      if (condition === 'disabled')
        await lock.query("UPDATE users SET disabled_at=NOW() WHERE user_id='cap-user'");
      else
        await lock.query('UPDATE sessions SET revoked_at=NOW() WHERE session_id=$1', [
          original.sessionId,
        ]);
      await lock.query('COMMIT');
      expect(await validating).toBeNull();
      expect(
        (
          await db.pool.query('SELECT idle_deadline FROM sessions WHERE session_id=$1', [
            original.sessionId,
          ])
        ).rows[0]
      ).toEqual(before);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
      await validating;
    }
  }
);

for (const deadline of ['idle_deadline', 'expires_at'] as const) {
  it(`does not extend ${deadline} after validation waits for the session row`, async () => {
    const original = await service.createSession('cap-user', false);
    await db.pool.query(
      `UPDATE sessions SET ${deadline}=clock_timestamp()+INTERVAL '1 second' WHERE session_id=$1`,
      [original.sessionId]
    );
    const before = (
      await db.pool.query('SELECT * FROM sessions WHERE session_id=$1', [original.sessionId])
    ).rows;
    const lock = await db.pool.connect();
    let validating: ReturnType<typeof service.validateSession> | undefined;
    try {
      await lock.query('BEGIN');
      await lock.query('SELECT session_id FROM sessions WHERE session_id=$1 FOR UPDATE', [
        original.sessionId,
      ]);
      const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      validating = service.validateSession(original.sessionId);
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
      await expect
        .poll(
          async () =>
            (
              await db.pool.query(
                `SELECT ${deadline}<=clock_timestamp() AS expired FROM sessions WHERE session_id=$1`,
                [original.sessionId]
              )
            ).rows[0].expired,
          { timeout: 4000 }
        )
        .toBe(true);
      await lock.query('COMMIT');
      expect(await validating).toBeNull();
      expect(
        (await db.pool.query('SELECT * FROM sessions WHERE session_id=$1', [original.sessionId]))
          .rows
      ).toEqual(before);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
      await validating;
    }
  });

  for (const action of ['refresh', 'rotate'] as const) {
    it(`rolls back ${action} if ${deadline} passes during credential writes`, async () => {
      const original = await service.createSession('cap-user', false);
      await db.pool.query(
        `UPDATE sessions SET ${deadline}=clock_timestamp()+INTERVAL '1 second' WHERE session_id=$1`,
        [original.sessionId]
      );
      const beforeSession = (await db.pool.query('SELECT * FROM sessions ORDER BY session_id'))
        .rows;
      const beforeTokens = (await db.pool.query('SELECT * FROM refresh_tokens ORDER BY id')).rows;
      const lock = await db.pool.connect();
      let outcome: Promise<unknown> | undefined;
      try {
        await lock.query('BEGIN');
        // Permit authorization reads/row locks but delay subsequent writes.
        await lock.query('LOCK TABLE refresh_tokens IN SHARE MODE');
        const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        const operation =
          action === 'refresh'
            ? service.redeemRefreshToken(original.refreshToken)
            : service.rotateSession(original.sessionId, 'late deadline');
        outcome = operation.then(
          (value) => ({ value }),
          (error) => ({ error })
        );
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
        await expect
          .poll(
            async () =>
              (
                await db.pool.query(
                  `SELECT ${deadline}<=clock_timestamp() AS expired FROM sessions WHERE session_id=$1`,
                  [original.sessionId]
                )
              ).rows[0].expired,
            { timeout: 4000 }
          )
          .toBe(true);
        await lock.query('COMMIT');
        expect(await outcome).toMatchObject(
          action === 'refresh' ? { error: { status: 401 } } : { value: null }
        );
        expect((await db.pool.query('SELECT * FROM sessions ORDER BY session_id')).rows).toEqual(
          beforeSession
        );
        expect((await db.pool.query('SELECT * FROM refresh_tokens ORDER BY id')).rows).toEqual(
          beforeTokens
        );
      } finally {
        await lock.query('ROLLBACK');
        lock.release();
        await outcome;
      }
    });
  }
}

it('does not acknowledge step-up when the session no longer exists', async () => {
  await expect(service.verifyStepUp('cap-user', randomUUID(), 'not-used')).rejects.toMatchObject({
    status: 401,
  });
});

it.each(['revoked', 'idle-expired', 'expired', 'disabled', 'wrong-owner'])(
  'does not grant step-up for a %s session',
  async (state) => {
    const session = await service.createSession('cap-user', false);
    if (state === 'revoked') await service.revokeSession(session.sessionId);
    if (state === 'idle-expired')
      await db.pool.query("UPDATE sessions SET idle_deadline=NOW()-INTERVAL '1 minute'");
    if (state === 'expired')
      await db.pool.query("UPDATE sessions SET expires_at=NOW()-INTERVAL '1 minute'");
    if (state === 'disabled')
      await db.pool.query("UPDATE users SET disabled_at=NOW() WHERE user_id='cap-user'");
    if (state === 'wrong-owner') {
      await db.pool.query(
        "INSERT INTO users(user_id,username,password_hash) VALUES ('other-user','other@example.test','unused')"
      );
      await db.pool.query("UPDATE sessions SET user_id='other-user'");
    }
    await expect(
      service.verifyStepUp('cap-user', session.sessionId, 'unused')
    ).rejects.toMatchObject({ status: 401 });
    expect(
      (await db.pool.query('SELECT step_up_verified_at FROM sessions')).rows[0].step_up_verified_at
    ).toBeNull();
    expect(
      (await db.pool.query("SELECT id FROM audit_log WHERE event='step_up_verified'")).rows
    ).toHaveLength(0);
  }
);

it('rolls back step-up if its audit record cannot be persisted', async () => {
  const { hash } = await import('argon2');
  await db.pool.query("UPDATE users SET password_hash=$1 WHERE user_id='cap-user'", [
    await hash('current-password'),
  ]);
  const session = await service.createSession('cap-user', false);
  await db.pool
    .query(`CREATE FUNCTION fail_step_up_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$;
    CREATE TRIGGER fail_step_up_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_step_up_audit()`);
  await expect(
    service.verifyStepUp('cap-user', session.sessionId, 'current-password')
  ).rejects.toMatchObject({ status: 500 });
  expect(
    (await db.pool.query('SELECT step_up_verified_at FROM sessions')).rows[0].step_up_verified_at
  ).toBeNull();
  expect(
    (await db.pool.query("SELECT id FROM audit_log WHERE event='step_up_verified'")).rows
  ).toHaveLength(0);
});

it('verifies the current password after waiting for an account update', async () => {
  const { hash } = await import('argon2');
  const newHash = await hash('new-password');
  await db.pool.query("UPDATE users SET password_hash=$1 WHERE user_id='cap-user'", [
    await hash('old-password'),
  ]);
  const session = await service.createSession('cap-user', false);
  const client = await db.pool.connect();
  let pending: Promise<unknown> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT user_id FROM users WHERE user_id='cap-user' FOR UPDATE");
    pending = service.verifyStepUp('cap-user', session.sessionId, 'old-password');
    const rejected = expect(pending).rejects.toMatchObject({ status: 422 });
    await expect
      .poll(async () =>
        Number(
          (
            await db.pool.query(`SELECT count(*) AS count FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock'
      AND query='SELECT password_hash,disabled_at FROM users WHERE user_id=$1 FOR UPDATE'`)
          ).rows[0].count
        )
      )
      .toBe(1);
    await client.query("UPDATE users SET password_hash=$1 WHERE user_id='cap-user'", [newHash]);
    await client.query('COMMIT');
    await rejected;
    expect(
      (await db.pool.query('SELECT step_up_verified_at FROM sessions')).rows[0].step_up_verified_at
    ).toBeNull();
    expect(
      (await db.pool.query("SELECT id FROM audit_log WHERE event='step_up_verified'")).rows
    ).toHaveLength(0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pending?.catch(() => {});
  }
});

it('records one private security alert when concurrent refresh reuse revokes a token family', async () => {
  const original = await service.createSession('cap-user', false);
  const other = await service.createSession('cap-user', false);
  const next = await service.redeemRefreshToken(original.refreshToken);
  expect((await db.pool.query('SELECT id FROM in_app_notifications')).rows).toHaveLength(0);
  const attempts = await Promise.allSettled([
    service.redeemRefreshToken(original.refreshToken),
    service.redeemRefreshToken(original.refreshToken),
  ]);
  expect(attempts).toEqual([
    expect.objectContaining({
      status: 'rejected',
      reason: expect.objectContaining({ status: 401 }),
    }),
    expect.objectContaining({
      status: 'rejected',
      reason: expect.objectContaining({ status: 401 }),
    }),
  ]);
  expect(await service.validateSession(original.sessionId)).toBeNull();
  expect(await service.validateSession(other.sessionId)).not.toBeNull();
  const notices = (await db.pool.query('SELECT * FROM in_app_notifications')).rows;
  expect(notices).toHaveLength(1);
  expect(notices[0]).toMatchObject({
    recipient_user_id: 'cap-user',
    profile_id: null,
    type: 'auth.refresh_token_reused',
    link_route: '/settings/security',
    is_read: false,
  });
  expect(notices[0].localized_content.en.body).toContain('Review your other sessions');
  expect(notices[0].localized_content.fa.body).toContain('نشست');
  const serialized = JSON.stringify(notices[0]);
  for (const credential of [original.refreshToken, next.refreshToken, original.csrfToken])
    expect(serialized).not.toContain(credential);
  await expect(service.redeemRefreshToken(next.refreshToken)).rejects.toMatchObject({
    status: 401,
  });
  expect((await db.pool.query('SELECT id FROM in_app_notifications')).rows).toHaveLength(1);
});

it('caps concurrent standalone creation from an empty account at fifty usable sessions', async () => {
  const created = await Promise.all(
    Array.from({ length: 65 }, () => service.createSession('cap-user', false))
  );
  expect(created).toHaveLength(65);
  expect(await usable()).toHaveLength(50);
  expect(
    (await db.pool.query('SELECT session_id FROM sessions WHERE revoked_at IS NOT NULL')).rows
  ).toHaveLength(15);
  expect((await db.pool.query('SELECT id FROM refresh_tokens')).rows).toHaveLength(65);
});
it('repairs an existing excess and revokes the oldest sessions in deterministic order', async () => {
  const ids = Array.from({ length: 60 }, () => randomUUID()).sort();
  for (const id of ids)
    await db.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,created_at)
    VALUES ($1,'cap-user',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes','2026-01-01')`,
      [id, randomUUID(), randomUUID()]
    );
  await service.createSession('cap-user', false);
  expect(await usable()).toHaveLength(50);
  expect(
    (
      await db.pool.query(
        'SELECT session_id FROM sessions WHERE revoked_at IS NOT NULL ORDER BY session_id'
      )
    ).rows.map((row) => row.session_id)
  ).toEqual(ids.slice(0, 11));
});
it('rechecks account eligibility after waiting for concurrent disable and commits no session', async () => {
  const client = await db.pool.connect();
  let creating: Promise<unknown> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("UPDATE users SET disabled_at=NOW() WHERE user_id='cap-user'");
    const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    creating = service.createSession('cap-user', false);
    const outcome = creating.then(
      (value) => ({ value }),
      (error) => ({ error })
    );
    await expect
      .poll(async () =>
        Number(
          (
            await db.pool.query(
              'SELECT count(*) AS count FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))',
              [pid]
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await client.query('COMMIT');
    expect(await outcome).toMatchObject({ error: { status: 401 } });
    expect(await usable()).toHaveLength(0);
    expect((await db.pool.query('SELECT id FROM refresh_tokens')).rows).toHaveLength(0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await creating?.catch(() => {});
  }
});
it('rolls back cap eviction if the new refresh credential cannot commit', async () => {
  await Promise.all(Array.from({ length: 50 }, () => service.createSession('cap-user', false)));
  const original = (await usable()).map((row) => row.session_id).sort();
  await db.pool
    .query(`CREATE FUNCTION fail_cap_refresh() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test refresh failure'; END $$;
    CREATE TRIGGER fail_cap_refresh BEFORE INSERT ON refresh_tokens FOR EACH ROW EXECUTE FUNCTION fail_cap_refresh()`);
  await expect(service.createSession('cap-user', false)).rejects.toMatchObject({ status: 500 });
  expect((await usable()).map((row) => row.session_id).sort()).toEqual(original);
  expect((await db.pool.query('SELECT id FROM refresh_tokens')).rows).toHaveLength(50);
});

it('rotates an actual session with a usable fresh refresh credential and invalidates the old credentials', async () => {
  const original = await service.createSession('cap-user', false);
  const rotated = await service.rotateSession(original.sessionId, 'test rotation');
  expect(rotated).not.toBeNull();
  expect(rotated!.sessionId).not.toBe(original.sessionId);
  expect(rotated!.csrfToken).not.toBe(original.csrfToken);
  expect(rotated!.refreshToken).not.toBe(original.refreshToken);
  expect(await service.rotateSession(original.sessionId, 'repeat')).toBeNull();
  const tokens = (
    await db.pool.query('SELECT session_id,consumed_at FROM refresh_tokens ORDER BY version')
  ).rows;
  expect(tokens).toHaveLength(2);
  expect(tokens[0].consumed_at).not.toBeNull();
  expect(tokens[1]).toMatchObject({ session_id: rotated!.sessionId, consumed_at: null });
  expect(await service.validateRefreshCsrf(rotated!.refreshToken, original.csrfToken)).toBe(false);
  expect(await service.validateRefreshCsrf(rotated!.refreshToken, rotated!.csrfToken)).toBe(true);
  expect(await service.redeemRefreshToken(rotated!.refreshToken)).toMatchObject({
    sessionId: rotated!.sessionId,
  });
  // Replaying the consumed old credential still triggers family revocation.
  await expect(service.redeemRefreshToken(original.refreshToken)).rejects.toMatchObject({
    status: 401,
  });
  expect(await usable()).toHaveLength(0);
});
it('cannot rotate a disabled, idle-expired or absolutely expired session', async () => {
  for (const condition of ['idle', 'absolute', 'disabled']) {
    const original = await service.createSession('cap-user', false);
    if (condition === 'disabled')
      await db.pool.query("UPDATE users SET disabled_at=NOW() WHERE user_id='cap-user'");
    else
      await db.pool.query(
        `UPDATE sessions SET ${condition === 'idle' ? 'idle_deadline' : 'expires_at'}=NOW()-INTERVAL '1 second' WHERE session_id=$1`,
        [original.sessionId]
      );
    expect(await service.rotateSession(original.sessionId, 'test rejection')).toBeNull();
    expect(
      (
        await db.pool.query('SELECT id FROM refresh_tokens WHERE session_id=$1', [
          original.sessionId,
        ])
      ).rows
    ).toHaveLength(1);
  }
});
it('keeps the original session usable when rotation cannot write its new credential', async () => {
  const original = await service.createSession('cap-user', false);
  await db.pool
    .query(`CREATE FUNCTION fail_rotation_refresh() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rotation failure'; END $$;
    CREATE TRIGGER fail_rotation_refresh BEFORE INSERT ON refresh_tokens FOR EACH ROW EXECUTE FUNCTION fail_rotation_refresh()`);
  await expect(service.rotateSession(original.sessionId, 'test rollback')).rejects.toMatchObject({
    status: 500,
  });
  expect((await usable()).map((row) => row.session_id)).toEqual([original.sessionId]);
  expect(await service.validateRefreshCsrf(original.refreshToken, original.csrfToken)).toBe(true);
  expect((await db.pool.query('SELECT consumed_at FROM refresh_tokens')).rows).toEqual([
    { consumed_at: null },
  ]);
});
it('concurrent rotation and creation keep the account within its usable-session cap', async () => {
  const sessions = await Promise.all(
    Array.from({ length: 50 }, () => service.createSession('cap-user', false))
  );
  await Promise.all([
    ...sessions
      .slice(-10)
      .map((session) => service.rotateSession(session.sessionId, 'concurrent rotation')),
    ...Array.from({ length: 10 }, () => service.createSession('cap-user', false)),
  ]);
  expect(await usable()).toHaveLength(50);
});

it('does not revive an idle-expired session through refresh', async () => {
  const original = await service.createSession('cap-user', false);
  await db.pool.query(
    "UPDATE sessions SET idle_deadline=NOW()-INTERVAL '1 second' WHERE session_id=$1",
    [original.sessionId]
  );
  const before = (
    await db.pool.query(
      'SELECT idle_deadline,refresh_token_hash FROM sessions WHERE session_id=$1',
      [original.sessionId]
    )
  ).rows[0];
  expect(await service.validateRefreshCsrf(original.refreshToken, original.csrfToken)).toBe(false);
  await expect(service.redeemRefreshToken(original.refreshToken)).rejects.toMatchObject({
    status: 401,
  });
  expect(
    (
      await db.pool.query(
        'SELECT idle_deadline,refresh_token_hash FROM sessions WHERE session_id=$1',
        [original.sessionId]
      )
    ).rows[0]
  ).toEqual(before);
  expect((await db.pool.query('SELECT consumed_at FROM refresh_tokens')).rows).toEqual([
    { consumed_at: null },
  ]);
});

for (const action of ['single', 'all', 'family', 'rotate'] as const) {
  for (const first of ['refresh', 'mutation'] as const) {
    it(`serializes ${action} with refresh when ${first} queues first`, async () => {
      const original = await service.createSession('cap-user', false);
      const family = (
        await db.pool.query('SELECT family_id FROM sessions WHERE session_id=$1', [
          original.sessionId,
        ])
      ).rows[0].family_id;
      const blocker = await db.pool.connect();
      const operations: Promise<PromiseSettledResult<unknown>[]>[] = [];
      const waitForLocks = (count: number) =>
        expect
          .poll(async () =>
            Number(
              (
                await db.pool.query(
                  `SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM users%'`
                )
              ).rows[0].count
            )
          )
          .toBe(count);
      const refresh = () => service.redeemRefreshToken(original.refreshToken);
      const mutate = () =>
        action === 'single'
          ? service.revokeSession(original.sessionId)
          : action === 'all'
            ? service.revokeAllUserSessions('cap-user')
            : action === 'family'
              ? service.revokeFamily(family)
              : service.rotateSession(original.sessionId, 'concurrent refresh');
      try {
        await blocker.query('BEGIN');
        await blocker.query("SELECT user_id FROM users WHERE user_id='cap-user' FOR UPDATE");
        operations.push(Promise.allSettled([first === 'refresh' ? refresh() : mutate()]));
        await waitForLocks(1);
        operations.push(Promise.allSettled([first === 'refresh' ? mutate() : refresh()]));
        await waitForLocks(2);
        await blocker.query('COMMIT');
        const results = (await Promise.all(operations)).flat();
        for (const result of results) {
          if (result.status === 'rejected') expect(result.reason).toMatchObject({ status: 401 });
        }
        const refreshResult = results[first === 'refresh' ? 0 : 1]!;
        expect(refreshResult.status).toBe(first === 'refresh' ? 'fulfilled' : 'rejected');
        expect(await service.validateSession(original.sessionId)).toBeNull();
        expect(await usable()).toHaveLength(action === 'rotate' && first === 'refresh' ? 1 : 0);
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
        await Promise.all(operations);
      }
    });
  }
}

it('keeps the excluded session refresh credential usable when signing out all other sessions', async () => {
  const current = await service.createSession('cap-user', false);
  const other = await service.createSession('cap-user', false);
  await service.revokeAllUserSessions('cap-user', current.sessionId);
  expect(await usable()).toEqual([{ session_id: current.sessionId }]);
  expect(await service.redeemRefreshToken(current.refreshToken)).toMatchObject({
    sessionId: current.sessionId,
  });
  await expect(service.redeemRefreshToken(other.refreshToken)).rejects.toMatchObject({
    status: 401,
  });
  expect(await usable()).toEqual([{ session_id: current.sessionId }]);
});

for (const method of ['forcePasswordChange', 'expireSessions'] as const) {
  it(`rolls back CRM ${method} and credentials when audit insertion fails`, async () => {
    const { CrmV2Service } = await import('../crm/crm-v2.service.js');
    const { NotificationsService } = await import('../notifications/notifications.service.js');
    const crm = new CrmV2Service(service, new NotificationsService());
    await db.pool.query("UPDATE users SET is_admin=true,is_staff=true WHERE user_id='cap-user'");
    const original = await service.createSession('cap-user', false);
    const before = (
      await db.pool.query("SELECT must_change_password FROM users WHERE user_id='cap-user'")
    ).rows[0];
    await db.pool
      .query(`CREATE FUNCTION fail_session_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$;
      CREATE TRIGGER fail_session_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_session_audit()`);
    await expect(crm[method]('cap-user', 'test reason', 'cap-user', '127.0.0.1')).rejects.toThrow(
      'test audit failure'
    );
    expect(
      (await db.pool.query("SELECT must_change_password FROM users WHERE user_id='cap-user'"))
        .rows[0]
    ).toEqual(before);
    expect(await usable()).toEqual([{ session_id: original.sessionId }]);
    expect(await service.redeemRefreshToken(original.refreshToken)).toMatchObject({
      sessionId: original.sessionId,
    });
    await db.pool.query('DROP TRIGGER fail_session_audit ON audit_log');
    await expect(
      crm[method]('cap-user', 'test reason', 'cap-user', '127.0.0.1')
    ).resolves.toMatchObject({ success: true });
    expect(await usable()).toHaveLength(0);
    expect((await db.pool.query('SELECT id FROM audit_log')).rows).toHaveLength(1);
  });
}

it('rechecks disabled status after refresh waits for an account edit', async () => {
  const original = await service.createSession('cap-user', false);
  const client = await db.pool.connect();
  let refresh: Promise<PromiseSettledResult<unknown>[]> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("UPDATE users SET disabled_at=NOW() WHERE user_id='cap-user'");
    refresh = Promise.allSettled([service.redeemRefreshToken(original.refreshToken)]);
    await expect
      .poll(async () =>
        Number(
          (
            await db.pool.query(
              `SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%JOIN refresh_tokens r ON r.user_id=u.user_id%'`
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await client.query('COMMIT');
    expect((await refresh)[0]).toMatchObject({ status: 'rejected', reason: { status: 401 } });
    expect((await db.pool.query('SELECT consumed_at FROM refresh_tokens')).rows).toEqual([
      { consumed_at: null },
    ]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await refresh;
  }
});

it('does not rotate a session whose idle cutoff passes while waiting for the account lock', async () => {
  const original = await service.createSession('cap-user', false);
  const client = await db.pool.connect();
  let rotation: Promise<unknown> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT user_id FROM users WHERE user_id='cap-user' FOR UPDATE");
    await db.pool.query(
      "UPDATE sessions SET idle_deadline=clock_timestamp()+INTERVAL '250 milliseconds' WHERE session_id=$1",
      [original.sessionId]
    );
    rotation = service.rotateSession(original.sessionId, 'idle cutoff during lock wait');
    await expect
      .poll(async () =>
        Number(
          (
            await db.pool.query(
              `SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%JOIN sessions s ON s.user_id=u.user_id%'`
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await expect
      .poll(
        async () =>
          (
            await db.pool.query(
              'SELECT idle_deadline<=clock_timestamp() AS expired FROM sessions WHERE session_id=$1',
              [original.sessionId]
            )
          ).rows[0].expired
      )
      .toBe(true);
    await client.query('COMMIT');
    await expect(rotation).resolves.toBeNull();
    expect((await db.pool.query('SELECT consumed_at FROM refresh_tokens')).rows).toEqual([
      { consumed_at: null },
    ]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await rotation;
  }
});
