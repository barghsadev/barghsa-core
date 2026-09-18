import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const sessionId = randomUUID();
const csrf = randomUUID();
const teamId = randomUUID();
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(`INSERT INTO users(user_id,username,password_hash,is_admin,is_staff)
    VALUES ('support-admin','support-admin@example.test','test-only',true,true)`);
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES ($1,'support-admin',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [sessionId, csrf, randomUUID()]
  );
  await http.pool.query("INSERT INTO staff_teams(id,name) VALUES ($1,'Existing support team')", [
    teamId,
  ]);
}, 40000);
afterAll(async () => {
  await http?.close();
});
beforeEach(async () => {
  await http.pool.query(
    `UPDATE sessions SET revoked_at=NULL,csrf_token=$1,step_up_verified_at=clock_timestamp(),
    expires_at=clock_timestamp()+INTERVAL '1 day',idle_deadline=clock_timestamp()+INTERVAL '30 minutes'
    WHERE session_id=$2`,
    [csrf, sessionId]
  );
});

const actions = [
  {
    name: 'response targets',
    path: 'config/service-response-targets',
    method: 'PUT',
    body: { ticket: 24 },
  },
  {
    name: 'escalation policy',
    path: 'config/escalation-policy',
    method: 'PUT',
    body: {
      ticket: {
        level2: { delayHours: 2, channels: ['in_app'] },
        level3: { delayHours: 3, channels: ['in_app', 'email'] },
      },
    },
  },
  {
    name: 'assignment rules',
    path: 'config/assignment-rules',
    method: 'PUT',
    body: { ticket: { teamId, strategy: 'load' } },
  },
  {
    name: 'team creation',
    path: 'staff-teams',
    method: 'POST',
    body: { name: 'New support team' },
  },
  {
    name: 'team update',
    path: `staff-teams/${teamId}`,
    method: 'PUT',
    body: { name: 'Changed support team' },
  },
  { name: 'team deletion', path: `staff-teams/${teamId}`, method: 'DELETE' },
];
function call(action: (typeof actions)[number]) {
  return fetch(`${http.base}/api/admin/${action.path}`, {
    method: action.method,
    headers: {
      Cookie: `barghsa_session=${sessionId}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    },
    ...(action.body === undefined ? {} : { body: JSON.stringify(action.body) }),
  });
}
async function snapshot() {
  return {
    teams: (await http.pool.query('SELECT * FROM staff_teams ORDER BY id')).rows,
    members: (await http.pool.query('SELECT * FROM staff_team_members ORDER BY team_id,user_id'))
      .rows,
    config: (await http.pool.query('SELECT * FROM app_config ORDER BY key')).rows,
    version: (await http.pool.query('SELECT * FROM config_version ORDER BY id')).rows,
    audit: (
      await http.pool.query(
        "SELECT * FROM audit_log WHERE event IN ('config_change','team_create','team_update','team_delete') ORDER BY id"
      )
    ).rows,
  };
}
const changes = [
  { name: 'revoked', sql: 'revoked_at=clock_timestamp()', status: 401 },
  { name: 'expired', sql: "expires_at=clock_timestamp()-INTERVAL '1 second'", status: 401 },
  { name: 'changed CSRF', sql: "csrf_token='changed-proof'", status: 403 },
  { name: 'stale step-up', sql: 'step_up_verified_at=NULL', status: 403 },
];
for (const action of actions) {
  for (const change of changes) {
    it(`${action.name} rolls back ${change.name} authority before commit`, async () => {
      const before = await snapshot();
      // Change authority after the guards and transaction writes. This isolates
      // the final authorization check from authentication middleware checks.
      await http.pool
        .query(`CREATE FUNCTION change_support_session() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN UPDATE sessions SET ${change.sql} WHERE user_id='support-admin'; RETURN NEW; END $$;
        CREATE TRIGGER change_support_session BEFORE INSERT ON audit_log FOR EACH ROW
        WHEN (NEW.event IN ('config_change','team_create','team_update','team_delete')) EXECUTE FUNCTION change_support_session()`);
      try {
        expect((await call(action)).status, http.logs()).toBe(change.status);
        expect(await snapshot()).toEqual(before);
      } finally {
        await http.pool.query(
          'DROP TRIGGER change_support_session ON audit_log; DROP FUNCTION change_support_session()'
        );
      }
    });
  }
}
