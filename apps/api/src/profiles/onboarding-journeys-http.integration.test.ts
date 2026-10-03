import { beforeEach, afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import type { OnboardingJourney } from './onboarding-journeys.service.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
let session: string;
beforeEach(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES('setup-owner','setup-owner','test-only'),('other-owner','other-owner','test-only')"
  );
  session = randomUUID();
  const csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES($1,'setup-owner',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
    [session, csrf, randomUUID()]
  );
  headers = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
}, 40000);
afterEach(async () => {
  await http?.close();
}, 15000);
const post = (path: string, body: unknown, auth = headers) =>
  fetch(http.base + '/api/onboarding/' + path, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify(body),
  });
const start = (types = ['INDIVIDUAL', 'LEGAL'], requestId: string = randomUUID()) =>
  post('journeys', { requestId, profileTypes: types });
const read = (path: string) => fetch(http.base + '/api/onboarding/' + path, { headers });
const finish = (journey: OnboardingJourney, selected = journey.profiles[0]!.id) =>
  post(`journeys/${journey.id}/finish`, { selectedProfileId: selected });
async function ready() {
  const response = await start();
  expect(response.status).toBe(201);
  const journey = (await response.json()) as OnboardingJourney;
  await http.pool.query(
    "UPDATE profiles SET status='ACTIVE',title='Saved Company',first_name='Person',last_name='Owner' WHERE user_id='setup-owner'"
  );
  return journey;
}
const counts = async () =>
  (
    await http.pool.query(
      "SELECT (SELECT count(*)::int FROM profiles WHERE user_id='setup-owner') AS profiles,(SELECT count(*)::int FROM profile_onboarding_journeys) AS journeys,(SELECT count(*)::int FROM audit_log) AS audits"
    )
  ).rows[0];
const state = async (journey: OnboardingJourney) =>
  (
    await http.pool.query(
      'SELECT j.completed_at,j.selected_profile_id,c.profile_id FROM profile_onboarding_journeys j LEFT JOIN user_profile_contexts c ON c.user_id=j.user_id WHERE j.id=$1',
      [journey.id]
    )
  ).rows[0];

it('starts both profiles in canonical order, sets one initial default, and resumes after reload', async () => {
  expect(await (await read('journeys/active')).json()).toEqual({ journey: null });
  const response = await start(['LEGAL', 'INDIVIDUAL']);
  expect(response.status).toBe(201);
  const journey = (await response.json()) as OnboardingJourney;
  expect(journey).toMatchObject({
    completed: false,
    selectedProfileId: null,
    profiles: [
      { profileType: 'INDIVIDUAL', status: 'DRAFT', isDefault: true },
      { profileType: 'LEGAL', status: 'DRAFT', isDefault: false },
    ],
  });
  expect(journey.activeProfileId).toBe(journey.profiles[0]!.id);
  expect(await (await read('journeys/active')).json()).toEqual({ journey });
  expect(await (await read(`journeys/${journey.id}`)).json()).toEqual(journey);
  expect(await counts()).toEqual({ profiles: 2, journeys: 1, audits: 3 });
});
for (const type of ['INDIVIDUAL', 'LEGAL'])
  it(`starts only the selected ${type} profile`, async () => {
    const response = await start([type]);
    expect(response.status).toBe(201);
    const journey = (await response.json()) as OnboardingJourney;
    expect(journey.profiles).toHaveLength(1);
    expect(journey.profiles[0]).toMatchObject({ profileType: type, isDefault: true });
  });
it.each(['retries-first', 'competitor-first'] as const)(
  'serializes concurrent starts with %s without duplicate drafts or audits',
  async (order) => {
    const requestId = randomUUID(),
      competitorId = randomUUID();
    const commands = [
      { types: ['INDIVIDUAL', 'LEGAL'], requestId },
      { types: ['LEGAL', 'INDIVIDUAL'], requestId },
      { types: ['INDIVIDUAL', 'LEGAL'], requestId: competitorId },
    ];
    if (order === 'competitor-first') commands.reverse();
    const responses = await Promise.all(
      commands.map((command) => start(command.types, command.requestId))
    );
    // HTTP invocation order does not determine database-lock acquisition order.
    const stored = await http.pool.query<{ id: string; request_id: string }>(
      "SELECT id,request_id FROM profile_onboarding_journeys WHERE user_id='setup-owner'"
    );
    expect(stored.rows).toHaveLength(1);
    const winner = stored.rows[0]!;
    expect([requestId, competitorId]).toContain(winner.request_id);
    const journey = await (await read(`journeys/${winner.id}`)).json();
    const bodies = await Promise.all(responses.map((response) => response.json()));
    for (const [index, command] of commands.entries()) {
      if (command.requestId === winner.request_id) {
        expect(responses[index]!.status).toBe(201);
        expect(bodies[index]).toEqual(journey);
      } else {
        expect(responses[index]!.status).toBe(409);
        expect(bodies[index]).toHaveProperty('error');
      }
    }
    expect(await (await start(['LEGAL', 'INDIVIDUAL'], winner.request_id)).json()).toEqual(journey);
    const losingId = winner.request_id === requestId ? competitorId : requestId;
    expect((await start(['INDIVIDUAL', 'LEGAL'], losingId)).status).toBe(409);
    expect(await counts()).toEqual({ profiles: 2, journeys: 1, audits: 3 });
  }
);
it('rejects a changed retry or a different selection while setup remains open', async () => {
  const requestId = randomUUID();
  expect((await start(['INDIVIDUAL'], requestId)).status).toBe(201);
  expect((await start(['LEGAL'], requestId)).status).toBe(409);
  expect((await start(['LEGAL'])).status).toBe(409);
  expect(await counts()).toEqual({ profiles: 1, journeys: 1, audits: 2 });
});
for (const types of [[], ['OTHER'], ['INDIVIDUAL', 'INDIVIDUAL'], ['INDIVIDUAL', 'LEGAL', 'LEGAL']])
  it(`rejects invalid profile selection ${JSON.stringify(types)}`, async () => {
    expect((await start(types)).status).toBe(400);
    expect(await counts()).toEqual({ profiles: 0, journeys: 0, audits: 0 });
  });
it('requires a valid request identity, live session, and CSRF protection', async () => {
  expect((await start(['INDIVIDUAL'], 'invalid')).status).toBe(400);
  expect(
    (await post('journeys', { requestId: randomUUID(), profileTypes: ['INDIVIDUAL'] }, {})).status
  ).toBe(401);
  expect(
    (
      await post(
        'journeys',
        { requestId: randomUUID(), profileTypes: ['INDIVIDUAL'] },
        { Cookie: headers.Cookie!, 'Content-Type': 'application/json' }
      )
    ).status
  ).toBe(403);
  expect(await counts()).toEqual({ profiles: 0, journeys: 0, audits: 0 });
});
for (const mode of ['is_staff', 'is_admin', 'disabled_at'])
  it(`rejects account ${mode} before creating profiles`, async () => {
    await http.pool.query(
      `UPDATE users SET ${mode}=${mode === 'disabled_at' ? 'NOW()' : 'true'} WHERE user_id='setup-owner'`
    );
    expect((await start()).status).toBe(mode === 'disabled_at' ? 401 : 403);
    expect(await counts()).toEqual({ profiles: 0, journeys: 0, audits: 0 });
  });
for (const action of ['fail', 'expire'])
  it(`rolls back both drafts, default and setup when start audit ${action}s`, async () => {
    await http.pool.query(
      `CREATE FUNCTION break_setup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='onboarding_journey_started' THEN ${action === 'fail' ? "RAISE EXCEPTION 'test-only audit failure';" : "UPDATE sessions SET idle_deadline=clock_timestamp()-INTERVAL '1 second' WHERE user_id='setup-owner';"} END IF; RETURN NEW; END $$; CREATE TRIGGER break_setup BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION break_setup()`
    );
    expect((await start()).status).toBe(action === 'fail' ? 500 : 401);
    expect(await counts()).toEqual({ profiles: 0, journeys: 0, audits: 0 });
  });
it('requires every profile to be submitted before Done and prevents a foreign selection', async () => {
  const journey = (await (await start()).json()) as OnboardingJourney;
  expect((await finish(journey)).status).toBe(409);
  await http.pool.query("UPDATE profiles SET status='ACTIVE' WHERE id=$1", [
    journey.profiles[0]!.id,
  ]);
  expect((await finish(journey)).status).toBe(409);
  expect((await finish(journey, randomUUID())).status).toBe(404);
  expect(await state(journey)).toEqual({
    completed_at: null,
    selected_profile_id: null,
    profile_id: null,
  });
});
it('selects the requested profile atomically, reads it back through the profile API, and retries Done without duplicate audit', async () => {
  const journey = await ready(),
    selected = journey.profiles[1]!.id;
  const responses = await Promise.all([finish(journey, selected), finish(journey, selected)]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  for (const response of responses)
    expect(await response.json()).toMatchObject({
      completed: true,
      selectedProfileId: selected,
      activeProfileId: selected,
    });
  const profiles = await (await fetch(http.base + '/api/profiles', { headers })).json();
  expect(profiles).toMatchObject({
    activeProfileId: selected,
    profiles: [expect.objectContaining({ id: selected }), expect.anything()],
  });
  expect(await (await read('journeys/active')).json()).toEqual({ journey: null });
  expect(await counts()).toEqual({ profiles: 2, journeys: 1, audits: 4 });
  expect((await finish(journey, journey.profiles[0]!.id)).status).toBe(409);
});
it('never overwrites a later profile context change on a completion retry', async () => {
  const journey = await ready();
  expect((await finish(journey)).status).toBe(200);
  await http.pool.query(
    "UPDATE user_profile_contexts SET profile_id=$1 WHERE user_id='setup-owner'",
    [journey.profiles[1]!.id]
  );
  expect((await finish(journey)).status).toBe(409);
  expect((await state(journey)).profile_id).toBe(journey.profiles[1]!.id);
  expect(await counts()).toEqual({ profiles: 2, journeys: 1, audits: 4 });
});
it('binds a completed retry key to the original setup while allowing a new setup after Done', async () => {
  const requestId = randomUUID();
  const journey = (await (await start(['INDIVIDUAL'], requestId)).json()) as OnboardingJourney;
  await http.pool.query(
    "UPDATE profiles SET status='ACTIVE',first_name='Person',last_name='Owner' WHERE id=$1",
    [journey.profiles[0]!.id]
  );
  expect((await finish(journey)).status).toBe(200);
  expect(await (await start(['INDIVIDUAL'], requestId)).json()).toMatchObject({ id: journey.id });
  expect((await start(['LEGAL'], requestId)).status).toBe(409);
  const next = (await (await start(['LEGAL'])).json()) as OnboardingJourney;
  expect(next.id).not.toBe(journey.id);
  expect(next.profiles[0]!.isDefault).toBe(false);
  expect(next.activeProfileId).toBe(journey.profiles[0]!.id);
});
for (const change of ['archive', 'owner', 'type', 'suspend'])
  it(`rechecks ${change} before projection and completion`, async () => {
    const journey = await ready();
    const mutations: Record<string, string> = {
      archive: 'archived=true',
      owner: "user_id='other-owner'",
      type: "profile_type='LEGAL'",
      suspend: "status='SUSPENDED'",
    };
    await http.pool.query(`UPDATE profiles SET ${mutations[change]} WHERE id=$1`, [
      journey.profiles[0]!.id,
    ]);
    const expected = change === 'archive' || change === 'owner' ? 404 : 409;
    expect((await read(`journeys/${journey.id}`)).status).toBe(expected);
    expect((await finish(journey)).status).toBe(expected);
    expect((await state(journey)).completed_at).toBeNull();
  });
it('does not expose another account setup or allow its completion', async () => {
  const journey = await ready();
  await http.pool.query(
    "UPDATE profile_onboarding_journeys SET user_id='other-owner' WHERE id=$1",
    [journey.id]
  );
  expect((await read(`journeys/${journey.id}`)).status).toBe(404);
  expect((await finish(journey)).status).toBe(404);
  expect(await (await read('journeys/active')).json()).toEqual({ journey: null });
});
for (const action of ['fail', 'expire'])
  it(`rolls back dashboard context and completed setup when finish audit ${action}s`, async () => {
    const journey = await ready();
    await http.pool.query(
      `CREATE FUNCTION break_finish() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='onboarding_journey_completed' THEN ${action === 'fail' ? "RAISE EXCEPTION 'test-only audit failure';" : "UPDATE sessions SET idle_deadline=clock_timestamp()-INTERVAL '1 second' WHERE user_id='setup-owner';"} END IF; RETURN NEW; END $$; CREATE TRIGGER break_finish BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION break_finish()`
    );
    expect((await finish(journey, journey.profiles[1]!.id)).status).toBe(
      action === 'fail' ? 500 : 401
    );
    expect(await state(journey)).toEqual({
      completed_at: null,
      selected_profile_id: null,
      profile_id: null,
    });
    expect(await counts()).toEqual({ profiles: 2, journeys: 1, audits: 3 });
  });
it('returns the remaining profile after completing the first and preserves legal verification status', async () => {
  const journey = await ready();
  await http.pool.query("UPDATE profiles SET status='DRAFT' WHERE id=$1", [
    journey.profiles[1]!.id,
  ]);
  const response = await post('complete/' + journey.profiles[0]!.id, {});
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    id: journey.profiles[0]!.id,
    journey: { id: journey.id, profiles: [{ status: 'ACTIVE' }, { status: 'DRAFT' }] },
  });
  await http.pool.query("UPDATE profiles SET status='VERIFIED' WHERE id=$1", [
    journey.profiles[1]!.id,
  ]);
  expect((await finish(journey)).status).toBe(200);
  expect(
    (await http.pool.query('SELECT status FROM profiles WHERE id=$1', [journey.profiles[1]!.id]))
      .rows[0].status
  ).toBe('VERIFIED');
});

it('rechecks staff eligibility before finishing an existing customer setup', async () => {
  const journey = await ready();
  await http.pool.query("UPDATE users SET is_staff=true WHERE user_id='setup-owner'");
  expect((await finish(journey)).status).toBe(403);
  expect((await state(journey)).completed_at).toBeNull();
});
it('reads persisted completion and context before acknowledging Done', async () => {
  const journey = await ready();
  await http.pool.query(
    `CREATE FUNCTION change_context() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='onboarding_journey_completed' THEN UPDATE user_profile_contexts SET profile_id='${journey.profiles[0]!.id}' WHERE user_id='setup-owner'; END IF; RETURN NEW; END $$; CREATE TRIGGER change_context BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION change_context()`
  );
  expect((await finish(journey, journey.profiles[1]!.id)).status).toBe(409);
  expect(await state(journey)).toEqual({
    completed_at: null,
    selected_profile_id: null,
    profile_id: null,
  });
  expect(await counts()).toEqual({ profiles: 2, journeys: 1, audits: 3 });
});
for (const change of ['archive', 'suspend'])
  it(`rechecks ${change} after completion waits for a profile lock`, async () => {
    const journey = await ready(),
      client = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE profiles SET ${change === 'archive' ? 'archived=true' : "status='SUSPENDED'"} WHERE id=$1`,
        [journey.profiles[1]!.id]
      );
      pending = finish(journey);
      await expect
        .poll(
          async () =>
            Number(
              (
                await http.pool.query(
                  "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%ORDER BY id FOR UPDATE%' "
                )
              ).rows[0].count
            ),
          { timeout: 10000 }
        )
        .toBe(1);
      await client.query('COMMIT');
      expect((await pending).status).toBe(change === 'archive' ? 404 : 409);
      expect(await state(journey)).toEqual({
        completed_at: null,
        selected_profile_id: null,
        profile_id: null,
      });
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pending?.catch(() => {});
    }
  });

it('projects a revoked context as unavailable without selecting the initial default implicitly', async () => {
  const journey = await ready();
  const inaccessible = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES('other-owner','INDIVIDUAL','ACTIVE') RETURNING id"
    )
  ).rows[0].id;
  await http.pool.query(
    "INSERT INTO user_profile_contexts(user_id,profile_id) VALUES('setup-owner',$1)",
    [inaccessible]
  );
  expect(await (await read(`journeys/${journey.id}`)).json()).toMatchObject({
    activeProfileId: null,
  });
  expect(await (await fetch(http.base + '/api/profiles', { headers })).json()).toMatchObject({
    activeProfileId: null,
    hasDefault: false,
  });
  expect((await state(journey)).profile_id).toBe(inaccessible);
  expect((await finish(journey)).status).toBe(200);
  expect((await state(journey)).profile_id).toBe(journey.profiles[0]!.id);
});
