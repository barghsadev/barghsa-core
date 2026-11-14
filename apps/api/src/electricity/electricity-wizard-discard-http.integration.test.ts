import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let profileId: string;
const session = randomUUID(),
  csrf = randomUUID();
const headers: Record<string, string> = {
  cookie: `barghsa_session=${session}`,
  'x-csrf-token': csrf,
};
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('discard-owner','discard-owner@example.test','test-only'),('discard-other','discard-other@example.test','test-only')"
  );
  profileId = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES ('discard-owner','LEGAL','ACTIVE') RETURNING id"
    )
  ).rows[0].id;
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES($1,'discard-owner',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
    [session, csrf, randomUUID()]
  );
}, 40000);
afterAll(async () => {
  await http?.close();
});
const seed = async () => {
  await http.pool.query(
    `INSERT INTO electricity_customer_drafts(user_id,profile_id,mode,current_step,data)
    VALUES ('discard-owner',$1,'simple',2,'{"period":"next_week","totalKwh":"100"}'),
           ('discard-owner',$1,'advanced',2,'{"quantities":{"thermal":"100"}}'),
           ('discard-other',$1,'simple',2,'{"period":"next_week","totalKwh":"200"}')
    ON CONFLICT(user_id,profile_id,mode) DO UPDATE SET data=EXCLUDED.data`,
    [profileId]
  );
};
const discard = (mode = 'simple', custom = headers) =>
  fetch(`${http.base}/api/electricity/drafts/${mode}?profileId=${profileId}`, {
    method: 'DELETE',
    headers: custom,
  });

const guardedUrl = (mode: string, profile?: string) =>
  `${http.base}/api/electricity/drafts/${mode}/guarded${profile ? `?profileId=${profile}` : ''}`;
const versionHeaders = (revision: string | null) => ({
  ...headers,
  'x-draft-revision': revision ?? 'initial',
});
const readGuarded = async (mode: 'simple' | 'advanced', profile: string) => {
  const response = await fetch(guardedUrl(mode, profile), { headers });
  expect(response.status, http.logs()).toBe(200);
  return response.json() as Promise<{
    revision: string | null;
    currentStep: number;
    data: object | null;
  }>;
};
const saveGuarded = (profile: string, revision: string | null, totalKwh: string) =>
  fetch(guardedUrl('simple'), {
    method: 'PUT',
    headers: { ...versionHeaders(revision), 'content-type': 'application/json' },
    body: JSON.stringify({
      profileId: profile,
      currentStep: 2,
      data: { period: 'next_week', totalKwh },
    }),
  });
const discardGuarded = (profile: string, revision: string | null) =>
  fetch(guardedUrl('simple', profile), { method: 'DELETE', headers: versionHeaders(revision) });
it('deletes only current actor/profile/mode progress, audits and preserves all business records', async () => {
  await seed();
  const counts = async () =>
    (
      await http.pool.query(
        'SELECT (SELECT count(*) FROM orders) AS orders,(SELECT count(*) FROM invoices) AS invoices,(SELECT count(*) FROM contracts) AS contracts'
      )
    ).rows[0];
  const before = await counts();
  const response = await discard();
  expect(response.status, http.logs()).toBe(200);
  expect(await response.json()).toEqual({ discarded: true, profileId, mode: 'simple' });
  expect(
    (
      await http.pool.query(
        'SELECT user_id,mode FROM electricity_customer_drafts WHERE profile_id=$1 ORDER BY user_id,mode',
        [profileId]
      )
    ).rows
  ).toEqual([
    { user_id: 'discard-other', mode: 'simple' },
    { user_id: 'discard-owner', mode: 'advanced' },
  ]);
  expect(await counts()).toEqual(before);
  expect(
    JSON.parse(
      (
        await http.pool.query(
          "SELECT metadata FROM audit_log WHERE event='electricity_wizard_discarded' AND user_id='discard-owner'"
        )
      ).rows.at(-1)?.metadata
    )
  ).toEqual({ profileId, mode: 'simple' });
  expect((await discard()).status).toBe(200);
  expect((await discard('advanced')).status).toBe(200);
});
it('refuses absent CSRF, foreign ownership, invalid mode and expired session without deleting progress', async () => {
  await seed();
  expect((await discard('simple', { cookie: headers.cookie!, 'x-csrf-token': '' })).status).toBe(
    403
  );
  expect((await discard('invalid')).status).toBe(400);
  await http.pool.query("UPDATE profiles SET user_id='discard-other' WHERE id=$1", [profileId]);
  expect((await discard()).status).toBe(404);
  await http.pool.query("UPDATE profiles SET user_id='discard-owner' WHERE id=$1", [profileId]);
  await http.pool.query(
    "UPDATE sessions SET idle_deadline=NOW()-INTERVAL '1 second' WHERE session_id=$1",
    [session]
  );
  expect((await discard()).status).toBe(401);
  expect(
    (
      await http.pool.query(
        'SELECT count(*)::int AS count FROM electricity_customer_drafts WHERE profile_id=$1',
        [profileId]
      )
    ).rows[0].count
  ).toBe(3);
  await http.pool.query(
    "UPDATE sessions SET idle_deadline=NOW()+INTERVAL '30 minutes' WHERE session_id=$1",
    [session]
  );
});
it('rejects unexpected discard bodies without changing the saved progress or revision', async () => {
  await seed();
  const before = await readGuarded('simple', profileId);
  const candidates = [
    `${http.base}/api/electricity/drafts/simple?profileId=${profileId}`,
    guardedUrl('simple', profileId),
  ];
  for (const url of candidates) {
    const reply = await fetch(url, {
      method: 'DELETE',
      headers: { ...versionHeaders(before.revision), 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true }),
    });
    expect(reply.status, http.logs()).toBe(400);
    expect(await reply.json()).toMatchObject({ error: { code: 'VALIDATION:INPUT_INVALID' } });
  }
  expect(await readGuarded('simple', profileId)).toEqual(before);
  const discarded = await fetch(guardedUrl('simple', profileId), {
    method: 'DELETE',
    headers: { ...versionHeaders(before.revision), 'content-type': 'application/json' },
    body: '{}',
  });
  expect(discarded.status, http.logs()).toBe(200);
  expect(await discarded.json()).toMatchObject({ discarded: true, profileId, mode: 'simple' });
});
it('rolls back deletion if its mandatory audit cannot commit', async () => {
  await seed();
  await http.pool
    .query(`CREATE FUNCTION reject_wizard_discard_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='electricity_wizard_discarded' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_wizard_discard_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_wizard_discard_audit()`);
  try {
    expect((await discard()).status).toBe(500);
    const before = await readGuarded('simple', profileId);
    expect((await discardGuarded(profileId, before.revision)).status).toBe(500);
    expect(await readGuarded('simple', profileId)).toEqual(before);
    expect(
      (
        await http.pool.query(
          "SELECT count(*)::int AS count FROM electricity_customer_drafts WHERE user_id='discard-owner' AND profile_id=$1 AND mode='simple'",
          [profileId]
        )
      ).rows[0].count
    ).toBe(1);
  } finally {
    await http.pool.query(
      'DROP TRIGGER reject_wizard_discard_audit ON audit_log; DROP FUNCTION reject_wizard_discard_audit()'
    );
  }
});

it('serializes competing saves and rejects stale writes even after the slot becomes empty again', async () => {
  const profile = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES ('discard-owner','LEGAL','ACTIVE') RETURNING id"
    )
  ).rows[0].id as string;
  expect(await readGuarded('simple', profile)).toMatchObject({
    revision: null,
    currentStep: 1,
    data: null,
  });
  const contenders = await Promise.all([
    saveGuarded(profile, null, '100'),
    saveGuarded(profile, null, '200'),
  ]);
  expect(contenders.map((reply) => reply.status).sort()).toEqual([200, 409]);
  const winner = (await contenders.find((reply) => reply.status === 200)!.json()) as {
    revision: string;
    currentStep: number;
    data: object;
  };
  expect(await readGuarded('simple', profile)).toMatchObject(winner);
  expect(winner.revision).toMatch(/^[0-9a-f-]{36}$/);
  expect((await discardGuarded(profile, null)).status).toBe(409);
  const deletion = await discardGuarded(profile, winner.revision);
  expect(deletion.status, http.logs()).toBe(200);
  const removed = (await deletion.json()) as { revision: string };
  expect(removed).toMatchObject({ discarded: true, profileId: profile, mode: 'simple' });
  expect(removed.revision).not.toBe(winner.revision);
  expect((await saveGuarded(profile, null, '100')).status).toBe(409);
  expect((await saveGuarded(profile, winner.revision, '200')).status).toBe(409);
  expect(await readGuarded('simple', profile)).toMatchObject({
    revision: removed.revision,
    currentStep: 1,
    data: null,
  });
  expect((await readGuarded('advanced', profile)).revision).toBeNull();
});

it('versions legacy writes, requires an explicit revision and keeps newer progress on a stale discard', async () => {
  await seed();
  const before = await readGuarded('simple', profileId);
  const legacy = await fetch(`${http.base}/api/electricity/drafts/simple`, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      profileId,
      currentStep: 2,
      data: { period: 'next_week', totalKwh: '333' },
    }),
  });
  expect(legacy.status, http.logs()).toBe(200);
  expect(await legacy.json()).not.toHaveProperty('revision');
  const updated = await readGuarded('simple', profileId);
  expect(updated.revision).not.toBe(before.revision);
  expect((await discardGuarded(profileId, before.revision)).status).toBe(409);
  expect((await fetch(guardedUrl('simple', profileId), { method: 'DELETE', headers })).status).toBe(
    400
  );
  expect(await readGuarded('simple', profileId)).toEqual(updated);
});

it('keeps guarded draft validation and ownership separate for each wizard mode', async () => {
  await seed();
  const simple = await readGuarded('simple', profileId);
  const advanced = await readGuarded('advanced', profileId);
  const put = (mode: string, revision: string | null, body: object) =>
    fetch(guardedUrl(mode), {
      method: 'PUT',
      headers: { ...versionHeaders(revision), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const advancedInput = {
    profileId,
    currentStep: 3,
    data: { quantities: { thermal: '456' } },
  };
  const simpleInput = { profileId, currentStep: 3, data: { period: 'next_week' } };
  expect((await fetch(guardedUrl('unknown', profileId), { headers })).status).toBe(400);
  expect((await put('unknown', simple.revision, simpleInput)).status).toBe(400);
  expect((await put('simple', simple.revision, advancedInput)).status).toBe(400);
  expect((await put('simple', simple.revision, simpleInput)).status).toBe(400);
  expect((await put('advanced', simple.revision, advancedInput)).status).toBe(409);
  const foreignProfile = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES ('discard-other','LEGAL','ACTIVE') RETURNING id"
    )
  ).rows[0].id as string;
  expect((await fetch(guardedUrl('advanced', foreignProfile), { headers })).status).toBe(404);
  expect(
    (await put('advanced', null, { ...advancedInput, profileId: foreignProfile })).status
  ).toBe(404);
  const individualProfile = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES ('discard-owner','INDIVIDUAL','ACTIVE') RETURNING id"
    )
  ).rows[0].id as string;
  expect((await fetch(guardedUrl('advanced', individualProfile), { headers })).status).toBe(404);
  expect(
    (await put('advanced', null, { ...advancedInput, profileId: individualProfile })).status
  ).toBe(404);
  expect(await readGuarded('simple', profileId)).toEqual(simple);
  expect(await readGuarded('advanced', profileId)).toEqual(advanced);
  const saved = await put('advanced', advanced.revision, advancedInput);
  expect(saved.status, http.logs()).toBe(200);
  const receipt = (await saved.json()) as { revision: string };
  expect(receipt.revision).not.toBe(advanced.revision);
  expect(await readGuarded('advanced', profileId)).toMatchObject({
    revision: receipt.revision,
    currentStep: 3,
    data: advancedInput.data,
  });
  expect(await readGuarded('simple', profileId)).toEqual(simple);
});
