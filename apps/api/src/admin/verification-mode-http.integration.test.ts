import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import { VERIFICATION_MODE_LOCK } from './verification-mode-config.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const session = randomUUID(),
  csrf = randomUUID();
const headers = {
  Cookie: `barghsa_session=${session}`,
  'X-CSRF-Token': csrf,
  'Content-Type': 'application/json',
};
const path = '/api/admin/config/profile-verification-mode';
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool
    .query(`INSERT INTO users(user_id,username,password_hash,is_staff) VALUES('verifier','verifier@example.test','test-only',true);
    INSERT INTO staff_roles(role_id,name,description,permissions) VALUES('verification-editor','Verification editor','Test role','["admin:config:read","admin:config:write"]');
    INSERT INTO user_roles(user_id,role_id) VALUES('verifier','verification-editor')`);
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES($1,'verifier',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [session, csrf, randomUUID()]
  );
}, 40000);
afterAll(async () => {
  await http?.close();
}, 15000);
beforeEach(async () => {
  await http.pool.query(
    "DELETE FROM app_config WHERE key IN ('profile_verification_mode','profile_verification_mode_draft','verification.required','verification.method'); DELETE FROM audit_log"
  );
  await http.pool.query(
    "UPDATE sessions SET revoked_at=NULL,csrf_token=$1,expires_at=clock_timestamp()+INTERVAL '1 day',idle_deadline=clock_timestamp()+INTERVAL '30 minutes',step_up_verified_at=clock_timestamp() WHERE session_id=$2",
    [csrf, session]
  );
  await http.pool.query(
    'UPDATE staff_roles SET permissions=\'["admin:config:read","admin:config:write"]\' WHERE role_id=\'verification-editor\''
  );
});
const write = (action = 'draft', expectedVersion = 0, mode = 'MANUAL') =>
  fetch(http.base + path, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ action, expectedVersion, mode }),
  });
const read = async () => (await fetch(http.base + path, { headers })).json();
async function snapshot() {
  return {
    config: (
      await http.pool.query(
        "SELECT key,value,version FROM app_config WHERE key LIKE 'profile_verification_mode%' ORDER BY key"
      )
    ).rows,
    global: (await http.pool.query("SELECT version FROM config_version WHERE id='global'")).rows,
    audit: (
      await http.pool.query(
        'SELECT event,metadata,correlation_id FROM audit_log ORDER BY created_at,id'
      )
    ).rows,
  };
}
it('saves a draft without changing runtime policy, then activates exactly that revision with durable audit', async () => {
  const before = await snapshot();
  expect(await read()).toEqual({ mode: 'DISABLED', draft: null, version: 0 });
  expect((await write()).status).toBe(200);
  expect(await read()).toEqual({ mode: 'DISABLED', draft: 'MANUAL', version: 1 });
  expect((await snapshot()).global).toEqual(before.global);
  expect((await write('activate', 1)).status).toBe(200);
  expect(await read()).toEqual({ mode: 'MANUAL', draft: null, version: 2 });
  const after = await snapshot();
  expect(after.global[0].version).toBe(Number(before.global[0].version) + 1);
  expect(after.audit.map((row) => JSON.parse(row.metadata))).toEqual([
    expect.objectContaining({
      action: 'draft',
      sessionId: session,
      previous: { mode: 'DISABLED', draft: null, version: 0 },
      next: { mode: 'DISABLED', draft: 'MANUAL', version: 1 },
    }),
    expect.objectContaining({
      action: 'activate',
      sessionId: session,
      previous: { mode: 'DISABLED', draft: 'MANUAL', version: 1 },
      next: { mode: 'MANUAL', draft: null, version: 2 },
    }),
  ]);
  expect((await write('activate', 1)).status).toBe(409);
  expect(await snapshot()).toEqual(after);
});
it('rejects overwritten drafts, wrong selected modes and activation without a draft', async () => {
  expect((await write('activate')).status).toBe(409);
  expect((await write()).status).toBe(200);
  expect((await write('draft', 1, 'DISABLED')).status).toBe(200);
  const before = await snapshot();
  expect((await write('activate', 1)).status).toBe(409);
  expect((await write('activate', 2)).status).toBe(409);
  expect((await write('draft', 0)).status).toBe(409);
  expect(await snapshot()).toEqual(before);
});
it('allows only one simultaneous save of a reviewed revision', async () => {
  const responses = await Promise.all([write(), write('draft', 0, 'DISABLED')]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  expect((await snapshot()).audit).toHaveLength(1);
});
it('fails closed for invalid stored mode and honors legacy required verification', async () => {
  await http.pool.query(
    "INSERT INTO app_config(key,value) VALUES('verification.required','true'),('verification.method','\"api\"')"
  );
  expect(await read()).toMatchObject({ mode: 'API' });
  await http.pool.query(
    "INSERT INTO app_config(key,value) VALUES('profile_verification_mode','\"invalid\"')"
  );
  expect(await read()).toMatchObject({ mode: 'MANUAL' });
});
it('requires an explicit versioned action and never enables the absent provider', async () => {
  const before = await snapshot();
  expect(
    (
      await fetch(http.base + path, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ mode: 'MANUAL' }),
      })
    ).status
  ).toBe(400);
  for (const action of ['draft', 'activate'])
    expect((await write(action, 0, 'API')).status).toBe(503);
  expect(await snapshot()).toEqual(before);
});
it('does not activate a draft after a legacy writer changed active policy', async () => {
  await write();
  await http.pool.query(
    "INSERT INTO app_config(key,value) VALUES('profile_verification_mode','\"API\"')"
  );
  const before = await snapshot();
  expect((await write('activate', 1)).status).toBe(409);
  expect(await snapshot()).toEqual(before);
});
for (const action of ['draft', 'activate']) {
  it(`${action} rechecks session expiry after writing audit and rolls back`, async () => {
    if (action === 'activate') await write();
    const before = await snapshot();
    await http.pool.query(
      "CREATE OR REPLACE FUNCTION expire_verification_actor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE sessions SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE user_id=NEW.user_id; RETURN NEW; END $$; CREATE TRIGGER expire_verification_actor AFTER INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION expire_verification_actor()"
    );
    try {
      expect((await write(action, action === 'activate' ? 1 : 0)).status).toBe(401);
      expect(await snapshot()).toEqual(before);
    } finally {
      await http.pool.query('DROP TRIGGER expire_verification_actor ON audit_log');
    }
  });
  it(`${action} rolls back all configuration and audit writes when audit insertion fails`, async () => {
    if (action === 'activate') await write();
    const before = await snapshot();
    await http.pool.query(
      "CREATE OR REPLACE FUNCTION reject_verification_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$; CREATE TRIGGER reject_verification_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_verification_audit()"
    );
    try {
      expect((await write(action, action === 'activate' ? 1 : 0)).status).toBe(500);
      expect(await snapshot()).toEqual(before);
    } finally {
      await http.pool.query('DROP TRIGGER reject_verification_audit ON audit_log');
    }
  });
  for (const change of [
    'role',
    'revoke',
    'csrf',
    'expiry',
    ...(action === 'activate' ? ['step-up'] : []),
  ]) {
    it(`${action} rejects ${change} changed after the HTTP guard while waiting on policy`, async () => {
      if (action === 'activate') await write();
      const before = await snapshot();
      const blocker = await http.pool.connect();
      let pending: Promise<Response> | undefined;
      try {
        await blocker.query('BEGIN');
        await blocker.query('SELECT pg_advisory_xact_lock(hashtext($1))', [VERIFICATION_MODE_LOCK]);
        pending = write(action, action === 'activate' ? 1 : 0);
        await expect
          .poll(async () =>
            Number(
              (
                await http.pool.query(
                  "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock(hashtext($1))%'"
                )
              ).rows[0].count
            )
          )
          .toBe(1);
        if (change === 'role')
          await http.pool.query(
            "UPDATE staff_roles SET permissions='[\"admin:config:read\"]' WHERE role_id='verification-editor'"
          );
        else
          await http.pool.query(
            `UPDATE sessions SET ${change === 'revoke' ? 'revoked_at=NOW()' : change === 'csrf' ? "csrf_token='changed'" : change === 'expiry' ? "expires_at=NOW()-INTERVAL '1 second'" : 'step_up_verified_at=NULL'} WHERE session_id=$1`,
            [session]
          );
        await blocker.query('COMMIT');
        expect((await pending).status).toBe(change === 'revoke' || change === 'expiry' ? 401 : 403);
        expect(await snapshot()).toEqual(before);
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
        await pending;
      }
    });
  }
}
