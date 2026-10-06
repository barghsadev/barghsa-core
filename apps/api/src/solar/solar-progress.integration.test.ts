import { expectSolarAudit, expectSolarAuditRollback } from '../test/solar-audit.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import { seedSolarConstruction } from '../../../../packages/db/src/test/solar-construction-fixture.js';
import type { SolarProgressService } from './solar-progress.service.js';
type Progress = Awaited<ReturnType<SolarProgressService['detail']>>;
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions) VALUES('construction-writer','Construction writer','Test','["orders:read","orders:write"]'),('construction-reader','Construction reader','Test','["orders:read"]')`
  );
}, 40000);
afterAll(async () => {
  await http?.close();
});
async function login(role?: string) {
  const user = randomUUID(),
    session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$1,'test-only',$2)",
    [user, !!role]
  );
  if (role)
    await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at,operating_context) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW()-INTERVAL '1 second',$5)",
    [session, user, csrf, randomUUID(), role ? 'staff' : 'customer']
  );
  headers[user] = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
  return user;
}
async function fixture(options: Parameters<typeof seedSolarConstruction>[3] = {}) {
  const owner = await login(),
    actor = await login('construction-writer');
  return seedSolarConstruction(http.pool, owner, actor, options);
}
function send(
  user: string,
  path: string,
  method = 'GET',
  body?: unknown,
  extra?: Record<string, string>
) {
  return fetch(http.base + '/api/' + path, {
    method,
    headers: { ...headers[user], ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const command = (revision = 0, stage = 'in_progress') => ({
  stage,
  note: 'Verified work, visible to the customer.',
  expectedRevision: revision,
  operationId: randomUUID(),
});
async function preview(f: Awaited<ReturnType<typeof fixture>>, body = command()) {
  const response = await send(
    f.actor,
    `admin/solar/construction/${f.request}/review`,
    'POST',
    body
  );
  expect(response.status, (await response.clone().text()) + http.logs()).toBe(200);
  const review = (await response.json()) as { hash: string; data: Record<string, unknown> };
  return { ...body, expectedReviewHash: review.hash };
}
const record = (f: Awaited<ReturnType<typeof fixture>>, body: unknown, user = f.actor) =>
  send(user, `admin/solar/construction/${f.request}`, 'POST', body);
async function detail(f: Awaited<ReturnType<typeof fixture>>) {
  const response = await send(f.actor, `admin/solar/construction/${f.request}`);
  expect(response.status, http.logs()).toBe(200);
  return response.json() as Promise<Progress>;
}

it('projects construction note feedback without weakening protected commands, live grants or step-up', async () => {
  const f = await fixture();
  const route = `admin/solar/construction/${f.request}`;
  const snapshot = async () => ({
    request: (
      await http.pool.query('SELECT * FROM solar_construction_requests WHERE id=$1', [f.request])
    ).rows,
    postal: (
      await http.pool.query('SELECT * FROM solar_construction_postal WHERE request_id=$1', [
        f.request,
      ])
    ).rows,
    contract: (await http.pool.query('SELECT * FROM contracts WHERE id=$1', [f.contract])).rows,
    events: (
      await http.pool.query(
        'SELECT * FROM solar_construction_progress_events WHERE request_id=$1 ORDER BY revision',
        [f.request]
      )
    ).rows,
    audit: (
      await http.pool.query(
        "SELECT id,event,metadata FROM audit_log WHERE metadata::jsonb->>'requestId'=$1::text ORDER BY id",
        [f.request]
      )
    ).rows,
    notifications: (
      await http.pool.query('SELECT id FROM in_app_notifications WHERE profile_id=$1 ORDER BY id', [
        f.profile,
      ])
    ).rows,
  });
  const before = await snapshot();
  const reject = async (path: string, body: unknown, status: number, owned = false) => {
    const response = await send(f.actor, path, 'POST', body);
    expect(response.status, http.logs()).toBe(status);
    const result = await response.json();
    if (owned)
      expect(result).toMatchObject({
        error: { code: 'VALIDATION:INPUT:INVALID', fields: ['note'] },
      });
    else expect(result).not.toHaveProperty('error.fields');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(await snapshot()).toEqual(before);
    return result;
  };
  for (const confirm of [false, true]) {
    const path = route + (confirm ? '' : '/review');
    const base = { ...command(), ...(confirm ? { expectedReviewHash: 'a'.repeat(64) } : {}) };
    for (const note of [null, ' ', 'PRIVATE'.repeat(143)])
      await reject(path, { ...base, note }, 400, true);
    for (const body of [
      { ...base, stage: 'PRIVATE' },
      { ...base, operationId: 'PRIVATE', note: ' ' },
      { ...base, expectedRevision: -1, note: ' ' },
      { ...base, extra: 'PRIVATE', note: ' ' },
    ])
      await reject(path, body, 400);
  }
  await reject(route, { ...command(), expectedReviewHash: 'PRIVATE' }, 400);
  await http.pool.query("UPDATE user_roles SET role_id='construction-reader' WHERE user_id=$1", [
    f.actor,
  ]);
  for (const path of [route + '/review', route]) {
    const result = await reject(path, { ...command(), note: 'PRIVATE'.repeat(143) }, 403);
    expect(result).toMatchObject({ error: { code: 'AUTHZ:FORBIDDEN' } });
  }
  await http.pool.query("UPDATE user_roles SET role_id='construction-writer' WHERE user_id=$1", [
    f.actor,
  ]);
  const input = await preview(f, { ...command(), note: `  ${'x'.repeat(1000)}  ` });
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NULL WHERE user_id=$1', [f.actor]);
  const stepUp = await reject(route, input, 403);
  expect(stepUp).toMatchObject({ requiresStepUp: true });
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NOW()-INTERVAL '1 second' WHERE user_id=$1",
    [f.actor]
  );
  const saved = await record(f, input);
  expect(saved.status, http.logs()).toBe(200);
  const receipt = (await saved.json()) as Progress;
  expect(receipt).toMatchObject({
    requestId: f.request,
    profileId: f.profile,
    contractId: f.contract,
    revision: 1,
  });
  expect(receipt.events).toHaveLength(1);
  expect(receipt.events[0]).toMatchObject({ stage: 'in_progress', note: 'x'.repeat(1000) });
  expect(await (await record(f, input)).json()).toEqual(receipt);
  const after = await snapshot();
  expect(after.events).toHaveLength(1);
  expect(after.audit).toHaveLength(1);
  expect(after.notifications).toHaveLength(1);
  expect(after.request).toEqual(before.request);
  expect(after.postal).toEqual(before.postal);
  expect(after.contract).toEqual(before.contract);
});

it('records three ordered milestones and exposes the same authorized customer timeline without author IDs', async () => {
  const f = await fixture();
  const before = await detail(f);
  expect(before).toMatchObject({
    revision: 0,
    nextMilestone: 'in_progress',
    canRecord: true,
    events: [],
  });
  expect(before.steps.map((s) => s.state)).toEqual([
    'complete',
    'complete',
    'complete',
    'current',
    'pending',
    'pending',
  ]);
  await http.pool.query(
    "INSERT INTO conversation_identities(user_id,display_name,share_in_activity) VALUES($1,'Chosen construction staff',true)",
    [f.actor]
  );
  for (const [revision, stage] of ['in_progress', 'delivered', 'installed'].entries()) {
    const input = await preview(f, command(revision, stage));
    if (revision === 0)
      await expectSolarAuditRollback(http.pool, 'solar.construction.recorded', () =>
        record(f, input)
      );
    const response = await record(f, input);
    expect(response.status, (await response.clone().text()) + http.logs()).toBe(200);
    await expectSolarAudit(http.pool, 'solar.construction.recorded', f.request, {
      entity: 'solar_construction_progress',
      fromState: revision === 0 ? null : ['in_progress', 'delivered'][revision - 1],
      toState: stage,
      reason: input.note,
      actor: f.actor,
      profileId: f.profile,
      revision: revision + 1,
      operationId: input.operationId,
    });
    const value = (await response.json()) as Progress;
    expect(value.revision).toBe(revision + 1);
    expect(value.events.at(-1)).toMatchObject({
      stage,
      actorName: 'Chosen construction staff',
      actorContext: 'staff',
      note: input.note,
    });
    expect(value.canRecord).toBe(revision < 2);
  }
  const customer = await send(f.owner, `solar/requests/${f.request}`);
  expect(customer.status, http.logs()).toBe(200);
  const value = (await customer.json()) as { progress: Progress };
  expect(value.progress.revision).toBe(3);
  expect(value.progress.steps.every((s) => s.state === 'complete')).toBe(true);
  expect(value.progress).not.toHaveProperty('canRecord');
  expect(JSON.stringify(value.progress)).not.toContain(f.actor);
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS n FROM audit_log WHERE event='solar.construction.recorded' AND metadata::jsonb->>'requestId'=$1",
        [f.request]
      )
    ).rows[0].n
  ).toBe(3);
  expect(
    (
      await http.pool.query(
        'SELECT count(*)::int AS n FROM in_app_notifications WHERE recipient_user_id=$1 AND profile_id=$2',
        [f.owner, f.profile]
      )
    ).rows[0].n
  ).toBe(3);
  expect(
    (await http.pool.query('SELECT state FROM contracts WHERE id=$1', [f.contract])).rows[0].state
  ).toBe('Active');
});
it('replays a lost response once, including concurrently, and rejects changed operation contents or actor', async () => {
  const f = await fixture(),
    input = await preview(f);
  const responses = await Promise.all([record(f, input), record(f, input)]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect(await responses[0]!.json()).toEqual(await responses[1]!.json());
  expect((await record(f, input)).status).toBe(200);
  expect((await record(f, { ...input, note: 'Changed after review' })).status).toBe(409);
  expect((await record(f, { ...input, expectedReviewHash: '0'.repeat(64) })).status).toBe(409);
  expect((await record(f, input, await login('construction-writer'))).status).toBe(409);
  expect(
    (
      await http.pool.query(
        'SELECT count(*)::int AS n FROM in_app_notifications WHERE profile_id=$1',
        [f.profile]
      )
    ).rows[0].n
  ).toBe(1);
});
it('rejects skipped milestones, stale revisions, changed eligibility and strict invalid commands', async () => {
  const f = await fixture();
  for (const body of [
    { ...command(), stage: 'installed' },
    { ...command(), expectedRevision: 1 },
  ])
    expect(
      (await send(f.actor, `admin/solar/construction/${f.request}/review`, 'POST', body)).status
    ).toBe(409);
  for (const body of [
    { ...command(), stage: 'unknown' },
    { ...command(), note: ' ' },
    { ...command(), note: 'x'.repeat(1001) },
    { ...command(), extra: true },
    { ...command(), operationId: 'wrong' },
  ])
    expect(
      (await send(f.actor, `admin/solar/construction/${f.request}/review`, 'POST', body)).status
    ).toBe(400);
  const old = await preview(f),
    other = await preview(f);
  expect((await record(f, other)).status).toBe(200);
  expect((await record(f, old)).status).toBe(409);
  const delivery = await preview(f, command(1, 'delivered'));
  await http.pool.query("UPDATE profiles SET status='SUSPENDED' WHERE id=$1", [f.profile]);
  expect((await record(f, delivery)).status).toBe(409);
  expect((await detail(f)).canRecord).toBe(false);
  await http.pool.query("UPDATE profiles SET status='ACTIVE' WHERE id=$1", [f.profile]);
  await http.pool.query(
    "UPDATE solar_construction_postal SET status='incomplete' WHERE request_id=$1",
    [f.request]
  );
  expect((await record(f, delivery)).status).toBe(409);
});
it('requires current write grants, staff context, CSRF and step-up, including on exact replay', async () => {
  const f = await fixture(),
    reader = await login('construction-reader'),
    input = await preview(f);
  const response = await send(reader, `admin/solar/construction/${f.request}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ canRecord: false });
  expect((await record(f, input, reader)).status).toBe(403);
  expect(
    (
      await send(f.actor, `admin/solar/construction/${f.request}`, 'POST', input, {
        'X-CSRF-Token': '',
      })
    ).status
  ).toBe(403);
  await http.pool.query("UPDATE sessions SET operating_context='customer' WHERE user_id=$1", [
    f.actor,
  ]);
  expect((await record(f, input)).status).toBe(403);
  await http.pool.query(
    "UPDATE sessions SET operating_context='staff',step_up_verified_at=NULL WHERE user_id=$1",
    [f.actor]
  );
  expect((await record(f, input)).status).toBe(403);
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NOW()-INTERVAL '1 second' WHERE user_id=$1",
    [f.actor]
  );
  expect((await record(f, input)).status).toBe(200);
  await http.pool.query('DELETE FROM user_roles WHERE user_id=$1', [f.actor]);
  expect((await record(f, input)).status).toBe(403);
});
it('keeps other profiles private and stops resolving chosen names after consent withdrawal', async () => {
  const f = await fixture(),
    other = await login();
  expect((await send(other, `solar/requests/${f.request}`)).status).toBe(404);
  expect((await send(f.owner, `admin/solar/construction/${f.request}`)).status).toBe(403);
  await http.pool.query(
    "INSERT INTO conversation_identities(user_id,display_name,share_in_activity) VALUES($1,'Opted display name',true)",
    [f.actor]
  );
  expect((await record(f, await preview(f))).status).toBe(200);
  await http.pool.query(
    'UPDATE conversation_identities SET share_in_activity=false WHERE user_id=$1',
    [f.actor]
  );
  expect((await detail(f)).events[0]!.actorName).toBeNull();
  await http.pool.query('UPDATE sessions SET revoked_at=NOW() WHERE user_id=$1', [f.owner]);
  expect((await send(f.owner, `solar/requests/${f.request}`)).status).toBe(401);
});
it('requires activation and postal evidence, and never invents delivery for a completed service term', async () => {
  for (const options of [{ activate: false }, { postal: false }]) {
    const f = await fixture(options);
    expect((await detail(f)).canRecord).toBe(false);
    expect(
      (await send(f.actor, `admin/solar/construction/${f.request}/review`, 'POST', command()))
        .status
    ).toBe(409);
  }
  const f = await fixture({ completed: true }),
    progress = await detail(f);
  expect(progress).toMatchObject({
    contractState: 'Completed',
    revision: 0,
    events: [],
    canRecord: true,
    nextMilestone: 'in_progress',
  });
});
it('paginates and searches within the linked solar contract scope, rejecting foreign cursors', async () => {
  const f = await fixture();
  const number = (
    await http.pool.query('SELECT contract_number::text AS n FROM contracts WHERE id=$1', [
      f.contract,
    ])
  ).rows[0].n;
  const result = await send(f.actor, 'admin/solar/construction?q=' + number);
  expect(result.status, http.logs()).toBe(200);
  expect(
    ((await result.json()) as { items: Array<{ requestId: string }> }).items.map((r) => r.requestId)
  ).toContain(f.request);
  const literal = await send(f.actor, 'admin/solar/construction?q=%25');
  expect(await literal.json()).toMatchObject({ items: [] });
  expect((await send(f.actor, 'admin/solar/construction?before=' + randomUUID())).status).toBe(404);
  expect((await send(f.actor, 'admin/solar/construction?before=invalid')).status).toBe(400);
  expect((await send(f.actor, 'admin/solar/construction?q=' + 'x'.repeat(201))).status).toBe(400);
});

it('rolls back the milestone and audit if its transactional customer notification fails', async () => {
  const f = await fixture(),
    input = await preview(f);
  await http.pool.query(
    `CREATE FUNCTION fail_construction_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.profile_id='${f.profile}'::uuid THEN RAISE EXCEPTION 'Test notification failure'; END IF;RETURN NEW;END;$$;CREATE TRIGGER fail_construction_notice BEFORE INSERT ON in_app_notifications FOR EACH ROW EXECUTE FUNCTION fail_construction_notice()`
  );
  try {
    expect((await record(f, input)).status).toBe(500);
    expect((await detail(f)).revision).toBe(0);
    expect(
      (
        await http.pool.query(
          "SELECT count(*)::int AS n FROM audit_log WHERE event='solar.construction.recorded' AND metadata::jsonb->>'requestId'=$1",
          [f.request]
        )
      ).rows[0].n
    ).toBe(0);
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_construction_notice ON in_app_notifications;DROP FUNCTION fail_construction_notice()'
    );
  }
  expect((await record(f, input)).status).toBe(200);
});

it('serializes competing staff milestones and pages fifty requests without losing or repeating rows', async () => {
  const f = await fixture(),
    second = await login('construction-writer');
  const firstInput = await preview(f),
    secondBody = command();
  const reviewed = await send(
    second,
    `admin/solar/construction/${f.request}/review`,
    'POST',
    secondBody
  );
  expect(reviewed.status).toBe(200);
  const review = (await reviewed.json()) as { hash: string };
  const responses = await Promise.all([
    record(f, firstInput),
    record(f, { ...secondBody, expectedReviewHash: review.hash }, second),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  expect((await detail(f)).revision).toBe(1);
  // List eligibility includes linked drafts; physical progress remains separately gated.
  const client = await http.pool.connect();
  try {
    await client.query('BEGIN');
    for (let index = 0; index < 51; index++) {
      const contract = randomUUID(),
        version = randomUUID();
      await client.query(
        "INSERT INTO contracts(id,profile_id,service_type,current_version_id) VALUES($1,$2,'solar',$3)",
        [contract, f.profile, version]
      );
      await client.query(
        "INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,jsonb_build_object('text','Queue fixture'),'Queue fixture',$3)",
        [version, contract, f.actor]
      );
      await client.query(
        "INSERT INTO solar_construction_requests(profile_id,submitted_by,submission_key,status,contract_id,building_type,grid_type,property_form,structural_frame,building_completion_date,agreement_accepted,agreement_version,agreement_snapshot,agreement_accepted_at) VALUES($1,$2,$3,'contract_created',$4,'building_apartment','off_grid','villa','concrete','2020-01-01',true,'queue-fixture','Accepted terms',NOW())",
        [f.profile, f.owner, randomUUID(), contract]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  const firstPage = await send(f.actor, 'admin/solar/construction');
  expect(firstPage.status).toBe(200);
  const page = (await firstPage.json()) as {
    items: Array<{ requestId: string }>;
    nextBefore: string;
  };
  expect(page.items).toHaveLength(50);
  expect(page.nextBefore).toBe(page.items.at(-1)!.requestId);
  const nextPage = await send(f.actor, 'admin/solar/construction?before=' + page.nextBefore);
  expect(nextPage.status).toBe(200);
  const next = (await nextPage.json()) as { items: Array<{ requestId: string }> };
  expect(next.items.length).toBeGreaterThan(0);
  expect(next.items.some((row) => page.items.some((old) => old.requestId === row.requestId))).toBe(
    false
  );
});

it('returns a conflict when two independent requests race to reuse one operation, with one durable effect', async () => {
  const first = await fixture(),
    second = await fixture(),
    shared = command();
  const a = await preview(first, shared),
    b = await preview(second, shared);
  const results = await Promise.all([record(first, a), record(second, b)]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(
    (
      await http.pool.query(
        'SELECT count(*)::int AS n FROM solar_construction_progress_events WHERE operation_id=$1',
        [shared.operationId]
      )
    ).rows[0].n
  ).toBe(1);
  expect(
    (
      await http.pool.query(
        'SELECT count(*)::int AS n FROM in_app_notifications WHERE profile_id=ANY($1::uuid[])',
        [[first.profile, second.profile]]
      )
    ).rows[0].n
  ).toBe(1);
});

it('fails safely on a locked profile and lets the exact reviewed command retry after the competing transaction', async () => {
  const f = await fixture(),
    input = await preview(f),
    client = await http.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [f.profile]);
    expect((await record(f, input)).status).toBe(409);
    expect(
      (
        await http.pool.query(
          'SELECT count(*)::int AS n FROM solar_construction_progress_events WHERE request_id=$1',
          [f.request]
        )
      ).rows[0].n
    ).toBe(0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect((await record(f, input)).status).toBe(200);
}, 10000);
