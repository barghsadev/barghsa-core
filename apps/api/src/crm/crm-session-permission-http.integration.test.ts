import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
}, 40000);
afterAll(async () => {
  await http?.close();
});

for (const action of ['edit', 'verify', 'archive'] as const) {
  it(`rejects profile ${action} when staff permission is revoked during its lock wait`, async () => {
    const actor = `crm-profile-${randomUUID()}`;
    const profileId = randomUUID();
    const session = randomUUID();
    const csrf = randomUUID();
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_admin) VALUES ($1,$1||'@example.test','fixture-only',true)",
      [actor]
    );
    await http.pool.query(
      "INSERT INTO profiles(id,user_id,profile_type,status,title) VALUES ($1,$2,'INDIVIDUAL','ACTIVE','Original')",
      [profileId, actor]
    );
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
       VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
      [session, actor, csrf, randomUUID()]
    );
    const blocker = await http.pool.connect();
    let request: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [profileId]);
      const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      request = fetch(
        `${http.base}/api/crm/profiles/${profileId}${action === 'verify' ? '/verify' : ''}`,
        {
          method: action === 'edit' ? 'PUT' : action === 'verify' ? 'POST' : 'DELETE',
          headers: {
            Cookie: `barghsa_session=${session}`,
            'X-CSRF-Token': csrf,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(
            action === 'edit'
              ? { title: 'Changed' }
              : action === 'verify'
                ? { action: 'verify' }
                : { reason: 'Closure request' }
          ),
          signal: AbortSignal.timeout(10000),
        }
      );
      await expect
        .poll(
          async () =>
            (
              await http.pool.query(
                'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::integer=ANY(pg_blocking_pids(pid))) AS waiting',
                [pid]
              )
            ).rows[0].waiting
        )
        .toBe(true);
      await http.pool.query('UPDATE users SET is_admin=false WHERE user_id=$1', [actor]);
      await blocker.query('ROLLBACK');
      const response = await request;
      expect(response.status).toBe(403);
      expect(
        (
          await http.pool.query('SELECT title,status,archived FROM profiles WHERE id=$1', [
            profileId,
          ])
        ).rows[0]
      ).toEqual({ title: 'Original', status: 'ACTIVE', archived: false });
      expect(
        (
          await http.pool.query(
            "SELECT id FROM audit_log WHERE user_id=$1 AND event IN ('profile_updated','verification_change','profile_deleted')",
            [actor]
          )
        ).rows
      ).toHaveLength(0);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await request?.catch(() => undefined);
    }
  });
}

for (const action of ['force-password-change', 'expire-sessions'] as const) {
  for (const scenario of ['revoked', 'retained', 'deleted-target', 'notice-failure'] as const) {
    it(`${action} checks current permission and target after a lock wait (${scenario})`, async () => {
      const revokePermission = scenario === 'revoked';
      const committed = scenario === 'retained';
      const suffix = randomUUID();
      // Target sorts first in the shared account-lock order. The actor can
      // lose permission while the pending request waits for the target.
      const actor = `z-crm-actor-${suffix}`;
      const target = `a-crm-target-${suffix}`;
      await http.pool.query(
        `INSERT INTO users(user_id,username,password_hash,is_admin)
         VALUES ($1,$1||'@example.test','fixture-only',true),
                ($2,$2||'@example.test','fixture-only',false)`,
        [actor, target]
      );
      const actorSession = randomUUID();
      const targetSession = randomUUID();
      const csrf = randomUUID();
      const family = randomUUID();
      await http.pool.query(
        `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
         VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW()),
                ($5,$6,$7,$8,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NULL)`,
        [actorSession, actor, csrf, randomUUID(), targetSession, target, randomUUID(), family]
      );
      const refreshId = randomUUID();
      await http.pool.query(
        `INSERT INTO refresh_tokens(id,family_id,token_hash,user_id,session_id,version)
         VALUES ($1,$2,$3,$4,$5,1)`,
        [
          refreshId,
          family,
          createHash('sha256').update(randomUUID()).digest('hex'),
          target,
          targetSession,
        ]
      );

      const blocker = await http.pool.connect();
      let request: Promise<Response> | undefined;
      try {
        if (scenario === 'notice-failure') {
          await http.pool
            .query(`CREATE OR REPLACE FUNCTION reject_crm_notice() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'controlled account notice failure'; END $$;
            CREATE TRIGGER reject_crm_notice BEFORE INSERT ON in_app_notifications
            FOR EACH ROW EXECUTE FUNCTION reject_crm_notice()`);
        }
        await blocker.query('BEGIN');
        await blocker.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [target]);
        const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        request = fetch(`${http.base}/api/crm/users/${target}/${action}`, {
          method: 'POST',
          headers: {
            Cookie: `barghsa_session=${actorSession}`,
            'X-CSRF-Token': csrf,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reason: `Reviewed case ${suffix}` }),
          signal: AbortSignal.timeout(10000),
        });
        await expect
          .poll(
            async () =>
              (
                await http.pool.query(
                  `SELECT EXISTS(SELECT 1 FROM pg_stat_activity
             WHERE $1::integer=ANY(pg_blocking_pids(pid))) AS waiting`,
                  [pid]
                )
              ).rows[0].waiting
          )
          .toBe(true);
        if (revokePermission) {
          await http.pool.query('UPDATE users SET is_admin=false WHERE user_id=$1', [actor]);
        }
        if (scenario === 'deleted-target') {
          await blocker.query('DELETE FROM users WHERE user_id=$1', [target]);
          await blocker.query('COMMIT');
        } else {
          await blocker.query('ROLLBACK');
        }
        const response = await request;
        if (scenario === 'deleted-target') {
          expect(response.status).toBe(404);
          expect(
            (
              await http.pool.query(
                "SELECT id FROM audit_log WHERE user_id=$1 AND event IN ('force_password_change','expire_sessions')",
                [actor]
              )
            ).rows
          ).toHaveLength(0);
          return;
        }
        expect(response.status).toBe(revokePermission ? 403 : committed ? 200 : 500);
        if (revokePermission) {
          expect(await response.json()).toMatchObject({ error: { code: 'AUTHZ:FORBIDDEN' } });
        } else if (committed) {
          expect(await response.json()).toMatchObject({ success: true, userId: target });
        }
        const state = (
          await http.pool.query(
            `SELECT u.must_change_password,s.revoked_at,r.consumed_at
           FROM users u JOIN sessions s ON s.user_id=u.user_id
           JOIN refresh_tokens r ON r.session_id=s.session_id
           WHERE u.user_id=$1 AND s.session_id=$2 AND r.id=$3`,
            [target, targetSession, refreshId]
          )
        ).rows[0];
        expect(state.must_change_password).toBe(committed && action === 'force-password-change');
        expect(state.revoked_at !== null).toBe(committed);
        expect(state.consumed_at !== null).toBe(committed);
        const audit = await http.pool.query(
          `SELECT event,metadata FROM audit_log WHERE user_id=$1
           AND event IN ('force_password_change','expire_sessions')`,
          [actor]
        );
        expect(audit.rows).toHaveLength(committed ? 1 : 0);
        if (committed) {
          expect(JSON.parse(audit.rows[0].metadata)).toMatchObject({
            targetUserId: target,
            reason: `Reviewed case ${suffix}`,
          });
        }
        const notices = await http.pool.query(
          `SELECT recipient_user_id,profile_id,localized_content,link_route FROM in_app_notifications
           WHERE recipient_user_id=ANY($1::text[])`,
          [[target, actor]]
        );
        expect(notices.rows).toHaveLength(committed ? 1 : 0);
        if (committed) {
          expect(notices.rows[0]).toMatchObject({
            recipient_user_id: target,
            profile_id: null,
            link_route: '/settings/security',
          });
          expect(notices.rows[0].localized_content.en.body).toContain('staff');
          expect(notices.rows[0].localized_content.fa.body).toMatch(/[آ-ی]/u);
          expect(JSON.stringify(notices.rows[0])).not.toContain(`Reviewed case ${suffix}`);
        }
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
        await request?.catch(() => undefined);
        if (scenario === 'notice-failure') {
          await http.pool.query('DROP TRIGGER IF EXISTS reject_crm_notice ON in_app_notifications');
        }
      }
    });
  }
}
