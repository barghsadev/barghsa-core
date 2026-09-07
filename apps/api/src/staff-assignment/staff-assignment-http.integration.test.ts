import { StaffAssignmentService } from './staff-assignment.service.js';
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
const teamId = randomUUID();
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  for (const user of ['customer', 'alpha', 'beta', 'ineligible'])
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_admin) VALUES ($1,$2,'test-only',$3)",
      [user, `${user}@example.test`, ['alpha', 'beta'].includes(user)]
    );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
    VALUES ($1,'customer',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
    [session, csrf, randomUUID()]
  );
  headers = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
  await http.pool.query(
    "INSERT INTO staff_teams(id,name,skill_tags) VALUES ($1,'Routing team','[]')",
    [teamId]
  );
  for (const user of ['alpha', 'beta', 'ineligible'])
    await http.pool.query('INSERT INTO staff_team_members(team_id,user_id) VALUES ($1,$2)', [
      teamId,
      user,
    ]);
}, 40000);
beforeEach(async () => {
  await http.pool.query(
    "DELETE FROM rate_limit_counters; DELETE FROM rate_limit_windows WHERE NOT security; DELETE FROM app_config WHERE key='admin.staff_assignment_rules'; DELETE FROM staff_assignment_cursors; UPDATE users SET disabled_at=NULL; UPDATE staff_teams SET is_active=true,skill_tags='[]'"
  );
});
afterAll(async () => {
  await http?.close();
});
function create(subject = 'Routing test') {
  return fetch(`${http.base}/api/tickets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ subject, body: 'Details' }),
  });
}
async function rule(strategy: string, team: string | null = teamId) {
  await http.pool.query(
    `INSERT INTO app_config(key,value) VALUES ('admin.staff_assignment_rules',$1::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,version=app_config.version+1`,
    [JSON.stringify({ ticket: { teamId: team, strategy } })]
  );
}
it('keeps work manual by default and assigns eight concurrent new tickets evenly without selecting ineligible members', async () => {
  const manual = await create(),
    old = (await manual.json()) as { id: string; assignedTo: string | null; status: string };
  expect(manual.status).toBe(201);
  expect(old.assignedTo).toBeNull();
  expect(old.status).toBe('open');
  await rule('round_robin');
  const responses = await Promise.all(Array.from({ length: 8 }, () => create()));
  expect(
    responses.map((response) => response.status),
    http.logs()
  ).toEqual(Array(8).fill(201));
  const records = (await Promise.all(responses.map((response) => response.json()))) as {
    assignedTo: string;
    assignedTeamId: string;
    status: string;
  }[];
  expect(records.filter((row) => row.assignedTo === 'alpha')).toHaveLength(4);
  expect(records.filter((row) => row.assignedTo === 'beta')).toHaveLength(4);
  expect(
    records.every((row) => row.assignedTeamId === teamId && row.status === 'in_progress')
  ).toBe(true);
  expect(
    (await http.pool.query('SELECT assigned_to FROM tickets WHERE id=$1', [old.id])).rows[0]
      .assigned_to
  ).toBeNull();
});
it('rolls back round-robin position and new work when the assignment audit fails', async () => {
  await rule('round_robin');
  expect(((await (await create()).json()) as { assignedTo: string }).assignedTo).toBe('alpha');
  await http.pool
    .query(`CREATE FUNCTION fail_assignment_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.event='work_auto_assigned' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_assignment_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_assignment_audit()`);
  try {
    expect((await create('Failed assignment')).status).toBe(500);
    expect(
      (
        await http.pool.query(
          'SELECT last_user_id FROM staff_assignment_cursors WHERE team_id=$1',
          [teamId]
        )
      ).rows[0].last_user_id
    ).toBe('alpha');
    expect(
      (await http.pool.query("SELECT id FROM tickets WHERE subject='Failed assignment'")).rows
    ).toHaveLength(0);
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_assignment_audit ON audit_log; DROP FUNCTION fail_assignment_audit()'
    );
  }
  expect(
    ((await (await create('Retry assignment')).json()) as { assignedTo: string }).assignedTo
  ).toBe('beta');
});
it('selects by current load, excludes disabled accounts and requires matching team expertise tags', async () => {
  await http.pool.query("UPDATE tickets SET assigned_to='alpha'");
  await rule('load');
  expect(((await (await create()).json()) as { assignedTo: string }).assignedTo).toBe('beta');
  await http.pool.query("UPDATE users SET disabled_at=NOW() WHERE user_id='beta'");
  expect(((await (await create()).json()) as { assignedTo: string }).assignedTo).toBe('alpha');
  await rule('expertise');
  expect(((await (await create()).json()) as { assignedTo: string | null }).assignedTo).toBeNull();
  await http.pool.query('UPDATE staff_teams SET skill_tags=\'["support"]\' WHERE id=$1', [teamId]);
  expect(((await (await create()).json()) as { assignedTo: string }).assignedTo).toBe('alpha');
});
it('falls back to manual assignment for malformed rules, missing or inactive teams and no eligible members', async () => {
  for (const [strategy, team] of [
    ['bogus', teamId],
    ['load', randomUUID()],
    ['round_robin', 'bad-id'],
  ] as const) {
    await rule(strategy, team);
    expect(
      ((await (await create()).json()) as { assignedTo: string | null }).assignedTo
    ).toBeNull();
  }
  await rule('round_robin');
  await http.pool.query('UPDATE staff_teams SET is_active=false WHERE id=$1', [teamId]);
  expect(((await (await create()).json()) as { assignedTo: string | null }).assignedTo).toBeNull();
  await http.pool.query('UPDATE staff_teams SET is_active=true WHERE id=$1', [teamId]);
  await http.pool.query("UPDATE users SET disabled_at=NOW() WHERE user_id IN ('alpha','beta')");
  expect(((await (await create()).json()) as { assignedTo: string | null }).assignedTo).toBeNull();
});

it('tries ordered fallback teams and records the chosen priority without advancing skipped cursors', async () => {
  const backup = randomUUID();
  await http.pool.query("INSERT INTO staff_teams(id,name) VALUES ($1,'Fallback team')", [backup]);
  await http.pool.query("INSERT INTO staff_team_members(team_id,user_id) VALUES ($1,'beta')", [
    backup,
  ]);
  await http.pool.query(
    `INSERT INTO app_config(key,value) VALUES ('admin.staff_assignment_rules',$1::jsonb)`,
    [
      JSON.stringify({
        ticket: {
          teamId,
          strategy: 'expertise',
          fallbacks: [{ teamId: backup, strategy: 'round_robin' }],
        },
      }),
    ]
  );
  const response = await create();
  expect(response.status, http.logs()).toBe(201);
  const ticket = (await response.json()) as {
    id: string;
    assignedTo: string;
    assignedTeamId: string;
  };
  expect(ticket).toMatchObject({ assignedTo: 'beta', assignedTeamId: backup });
  expect((await http.pool.query('SELECT team_id FROM staff_assignment_cursors')).rows).toEqual([
    { team_id: backup },
  ]);
  expect(
    (
      await http.pool.query(
        "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='work_auto_assigned' AND metadata::jsonb->>'itemId'=$1",
        [ticket.id]
      )
    ).rows[0].metadata
  ).toMatchObject({ priorityIndex: 1, teamId: backup });
  await http.pool.query('UPDATE staff_teams SET is_active=false WHERE id=$1', [backup]);
  expect(await (await create()).json()).toMatchObject({ assignedTo: null });
});
it('honors reversed priorities without deadlocking teams or shared members', async () => {
  const backup = randomUUID();
  await http.pool.query("INSERT INTO staff_teams(id,name) VALUES ($1,'Shared fallback team')", [
    backup,
  ]);
  for (const user of ['alpha', 'beta'])
    await http.pool.query('INSERT INTO staff_team_members(team_id,user_id) VALUES ($1,$2)', [
      backup,
      user,
    ]);
  await http.pool.query(
    `INSERT INTO app_config(key,value) VALUES ('admin.staff_assignment_rules',$1::jsonb)`,
    [
      JSON.stringify({
        ticket: {
          teamId,
          strategy: 'round_robin',
          fallbacks: [{ teamId: backup, strategy: 'round_robin' }],
        },
        verification_case: {
          teamId: backup,
          strategy: 'round_robin',
          fallbacks: [{ teamId, strategy: 'round_robin' }],
        },
      }),
    ]
  );
  const service = new StaffAssignmentService();
  const assignments = await Promise.all(
    Array.from({ length: 12 }, async (_, index) => {
      const client = await http.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout='5s'");
        const result = await service.choose(
          client,
          index % 2 ? 'ticket' : 'verification_case',
          randomUUID(),
          'customer',
          []
        );
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    })
  );
  assignments.forEach((assignment, index) =>
    expect(assignment?.teamId).toBe(index % 2 ? teamId : backup)
  );
  expect(assignments.filter((assignment) => assignment?.userId === 'alpha')).toHaveLength(6);
  expect(assignments.filter((assignment) => assignment?.userId === 'beta')).toHaveLength(6);
});
