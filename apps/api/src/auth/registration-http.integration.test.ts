import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let fixture: Awaited<ReturnType<typeof startHttpFixture>>;
const oldTerms = randomUUID();
const newTerms = randomUUID();
const draftTerms = randomUUID();
const password = 'Registration-test-password-123!';

beforeEach(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  fixture = await startHttpFixture(process.env.TEST_DATABASE_URL);
  await fixture.pool.query(
    `INSERT INTO tos_versions(id,version_id,content_fa,content_en,status,is_active,published_at)
    VALUES ($1,'consent-v1','قوانین اول','First terms','published',true,NOW()),
           ($2,'consent-v2','قوانین دوم','Second terms','published',false,NOW()),
           ($3,'consent-draft','پیش نویس','Draft terms','draft',false,NULL)`,
    [oldTerms, newTerms, draftTerms]
  );
}, 40000);

afterEach(async () => {
  await fixture?.close();
}, 15000);

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${fixture.base}/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

it('rejects placeholder, unknown and draft terms before creating a challenge', async () => {
  for (const tosVersionId of ['current', randomUUID(), draftTerms]) {
    const response = await post('auth/register', {
      username: 'invalid-consent@example.test',
      password,
      tosVersionId,
    });
    expect(response.status, await response.text()).toBe(400);
  }
  expect(
    (
      await fixture.pool.query(
        "SELECT count(*)::int AS count FROM otp_challenges WHERE destination='invalid-consent@example.test'"
      )
    ).rows[0].count
  ).toBe(0);
});

it('keeps consent bound to the displayed publication and supports later re-acceptance by ID', async () => {
  const current = await fetch(`${fixture.base}/api/tos/current?locale=en`);
  expect(current.status).toBe(200);
  expect(await current.json()).toMatchObject({
    id: oldTerms,
    versionId: 'consent-v1',
    content: 'First terms',
  });
  const started = await post('auth/register', {
    username: 'consent@example.test',
    password,
    tosVersionId: oldTerms,
  });
  const challenge = (await started.json()) as { challengeId: string };
  expect(started.status, JSON.stringify(challenge) + fixture.logs()).toBe(200);
  expect(
    (
      await fixture.pool.query(
        'SELECT tos_version_id,purpose,user_id FROM otp_challenges WHERE challenge_id=$1',
        [challenge.challengeId]
      )
    ).rows[0]
  ).toEqual({ tos_version_id: oldTerms, purpose: 'registration', user_id: null });
  // This test isolates consent persistence. Provider delivery is tested separately once implemented.
  await fixture.pool.query('UPDATE otp_challenges SET otp_hash=$1 WHERE challenge_id=$2', [
    createHash('sha256').update('123456').digest('hex'),
    challenge.challengeId,
  ]);
  await fixture.pool.query('UPDATE tos_versions SET is_active=false WHERE id=$1', [oldTerms]);
  await fixture.pool.query('UPDATE tos_versions SET is_active=true WHERE id=$1', [newTerms]);
  const verified = await post('auth/register/verify', {
    challengeId: challenge.challengeId,
    otp: '123456',
  });
  const user = (await verified.json()) as { userId: string; csrfToken: string };
  expect(verified.status, JSON.stringify(user) + fixture.logs()).toBe(200);
  expect(
    (
      await fixture.pool.query('SELECT version_id FROM tos_acceptances WHERE user_id=$1', [
        user.userId,
      ])
    ).rows
  ).toEqual([{ version_id: oldTerms }]);
  expect(
    (
      await fixture.pool.query('SELECT last_accepted_tos_version FROM users WHERE user_id=$1', [
        user.userId,
      ])
    ).rows[0].last_accepted_tos_version
  ).toBe(oldTerms);
  const headers = {
    Cookie: verified.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; '),
    'X-CSRF-Token': user.csrfToken,
  };
  const me = await fetch(`${fixture.base}/api/auth/user`, { headers });
  expect(await me.json()).toMatchObject({ requiresTosAcceptance: true });
  expect((await post('tos/accept', { versionId: 'consent-v2' }, headers)).status).toBe(400);
  const acceptance = await post('tos/accept', { versionId: newTerms }, headers);
  expect(acceptance.status, await acceptance.text()).toBe(200);
  expect(
    (
      await fixture.pool.query(
        'SELECT version_id FROM tos_acceptances WHERE user_id=$1 ORDER BY accepted_at',
        [user.userId]
      )
    ).rows
  ).toEqual([{ version_id: oldTerms }, { version_id: newTerms }]);
  const duplicate = await post('auth/register', {
    username: 'consent@example.test',
    password,
    tosVersionId: newTerms,
  });
  expect(duplicate.status, await duplicate.text()).toBe(409);
}, 15000);

it('preserves published content when draft edits race publication', async () => {
  await fixture.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_admin) VALUES ('terms-admin','terms-admin@example.test','test-only',true)"
  );
  const sessionId = randomUUID(),
    token = randomUUID();
  await fixture.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES ($1,'terms-admin',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [sessionId, token, randomUUID()]
  );
  const headers = {
    Cookie: `barghsa_session=${sessionId}`,
    'X-CSRF-Token': token,
    'Content-Type': 'application/json',
  };
  const client = await fixture.pool.connect();
  let edit: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM tos_versions WHERE id=$1 FOR UPDATE', [draftTerms]);
    edit = fetch(`${fixture.base}/api/admin/tos/versions/${draftTerms}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ contentEn: 'Racing edit must not overwrite published text' }),
    });
    await expect
      .poll(
        async () =>
          (
            await fixture.pool.query(`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'UPDATE tos_versions%'`)
          ).rows[0].count
      )
      .toBe(1);
    await client.query(
      "UPDATE tos_versions SET status='published',published_at=NOW() WHERE id=$1",
      [draftTerms]
    );
    await client.query('COMMIT');
    const response = await edit;
    expect(response.status, await response.text()).toBe(409);
    expect(
      (await fixture.pool.query('SELECT content_en FROM tos_versions WHERE id=$1', [draftTerms]))
        .rows[0].content_en
    ).toBe('Draft terms');
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await edit;
  }
  const anotherDraft = randomUUID();
  await fixture.pool.query(
    `INSERT INTO tos_versions(id,version_id,content_fa,content_en,status)
    VALUES ($1,'publish-once','قوانین','Publish once','draft')`,
    [anotherDraft]
  );
  const results = await Promise.all(
    [1, 2].map(() =>
      post(`admin/tos/versions/${anotherDraft}/publish`, { changeType: 'major' }, headers)
    )
  );
  expect(results.map((result) => result.status).filter((status) => status === 200)).toHaveLength(1);
  expect(
    results.map((result) => result.status).filter((status) => status === 400 || status === 409)
  ).toHaveLength(1);
  expect(
    (
      await fixture.pool.query(
        "SELECT count(*)::int AS count FROM audit_log WHERE event='tos_updated'"
      )
    ).rows[0].count
  ).toBe(1);
}, 15000);

it('keeps invitations pending after registration until the user explicitly accepts', async () => {
  await fixture.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('inviter','inviter@example.test','test-only')"
  );
  const profileId = (
    await fixture.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES ('inviter','LEGAL','ACTIVE') RETURNING id"
    )
  ).rows[0].id;
  const inviteId = randomUUID();
  await fixture.pool.query(
    `INSERT INTO profile_invitations(id,profile_id,username,role,invited_by,expires_at)
    VALUES ($1,$2,'invitee@example.test','Finance','inviter',NOW()+INTERVAL '1 day')`,
    [inviteId, profileId]
  );
  const started = await post('auth/register', {
    username: 'invitee@example.test',
    password,
    tosVersionId: oldTerms,
  });
  expect(started.status).toBe(200);
  const { challengeId } = (await started.json()) as { challengeId: string };
  // This test isolates membership consent; delivery is covered by the mailbox suite.
  await fixture.pool.query('UPDATE otp_challenges SET otp_hash=$1 WHERE challenge_id=$2', [
    createHash('sha256').update('123456').digest('hex'),
    challengeId,
  ]);
  const verified = await post('auth/register/verify', { challengeId, otp: '123456' });
  const user = (await verified.json()) as { userId: string; csrfToken: string };
  expect(verified.status, JSON.stringify(user)).toBe(200);
  const headers = {
    Cookie: verified.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; '),
    'X-CSRF-Token': user.csrfToken,
  };
  expect(
    (await fixture.pool.query('SELECT status FROM profile_invitations WHERE id=$1', [inviteId]))
      .rows[0].status
  ).toBe('Pending');
  expect(
    (await fixture.pool.query('SELECT * FROM profile_agents WHERE user_id=$1', [user.userId])).rows
  ).toEqual([]);
  expect(
    (
      await fixture.pool.query(
        "SELECT * FROM audit_log WHERE user_id=$1 AND event='invitation_accepted'",
        [user.userId]
      )
    ).rows
  ).toEqual([]);
  const pending = await fetch(`${fixture.base}/api/invitations/pending`, { headers });
  expect(pending.status, fixture.logs()).toBe(200);
  expect(await pending.json()).toMatchObject({ invitations: [{ id: inviteId, role: 'Finance' }] });
  const accepted = await post(`invitations/${inviteId}/accept`, {}, headers);
  expect(accepted.status, await accepted.text()).toBe(200);
  expect(
    (
      await fixture.pool.query(
        'SELECT role FROM profile_agents WHERE user_id=$1 AND profile_id=$2',
        [user.userId, profileId]
      )
    ).rows
  ).toEqual([{ role: 'Finance' }]);
  expect(
    (await fixture.pool.query('SELECT status FROM profile_invitations WHERE id=$1', [inviteId]))
      .rows[0].status
  ).toBe('Accepted');
}, 15000);
