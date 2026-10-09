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
it('rolls back deletion if its mandatory audit cannot commit', async () => {
  await seed();
  await http.pool
    .query(`CREATE FUNCTION reject_wizard_discard_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='electricity_wizard_discarded' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_wizard_discard_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_wizard_discard_audit()`);
  try {
    expect((await discard()).status).toBe(500);
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
