import { fetchWithPreauth } from '../test/public-auth.js';
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
    `INSERT INTO tos_versions(id,version_id,content_fa,content_en,status,is_active,published_at,change_type)
    VALUES ($1,'consent-v1','قوانین اول','First terms','published',true,NOW(),'major'),
           ($2,'consent-v2','قوانین دوم','Second terms','published',false,NOW(),'major'),
           ($3,'consent-draft','پیش نویس','Draft terms','draft',false,NULL,'minor')`,
    [oldTerms, newTerms, draftTerms]
  );
}, 40000);

afterEach(async () => {
  await fixture?.close();
}, 15000);

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  if (path.startsWith('admin/tos/versions/') && path.endsWith('/publish')) {
    const current = await fetch(`${fixture.base}/api/${path.slice(0, -8)}`, { headers });
    const version = (await current.json()) as { revision: string };
    body = { ...(body as Record<string, unknown>), expectedRevision: version.revision };
  }
  return fetchWithPreauth(`${fixture.base}/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function pendingRegistration(username = `atomic-${randomUUID()}@example.test`) {
  const started = await post('auth/register', { username, password, tosVersionId: oldTerms });
  const body = (await started.json()) as { challengeId: string };
  expect(started.status, JSON.stringify(body) + fixture.logs()).toBe(200);
  // Transaction tests control the stored code; real delivery has separate HTTP/worker evidence.
  await fixture.pool.query('UPDATE otp_challenges SET otp_hash=$1 WHERE challenge_id=$2', [
    createHash('sha256').update('123456').digest('hex'),
    body.challengeId,
  ]);
  return { username, body: { challengeId: body.challengeId, otp: '123456' } };
}

async function expectRegistrationRolledBack(challengeId: string, username: string) {
  expect(
    (
      await fixture.pool.query(
        'SELECT consumed_at,attempts_remaining FROM otp_challenges WHERE challenge_id=$1',
        [challengeId]
      )
    ).rows[0]
  ).toEqual({ consumed_at: null, attempts_remaining: 5 });
  const counts = (
    await fixture.pool.query(
      `SELECT (SELECT count(*)::int FROM users WHERE username=$1) AS users,
      (SELECT count(*)::int FROM tos_acceptances) AS consent,
      (SELECT count(*)::int FROM sessions) AS sessions,
      (SELECT count(*)::int FROM refresh_tokens) AS refresh,
      (SELECT count(*)::int FROM audit_log WHERE event='user_created') AS audits`,
      [username]
    )
  ).rows[0];
  expect(counts).toEqual({ users: 0, consent: 0, sessions: 0, refresh: 0, audits: 0 });
}

it('rolls registration back when its creation audit fails, then permits exactly one concurrent retry', async () => {
  const { username, body } = await pendingRegistration();
  await fixture.pool
    .query(`CREATE FUNCTION reject_registration_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event='user_created' THEN RAISE EXCEPTION 'Injected audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_registration_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_registration_audit();`);
  const failed = await post('auth/register/verify', body);
  expect(failed.status).toBe(500);
  expect(failed.headers.getSetCookie()).toEqual([expect.stringMatching(/^barghsa_preauth=;/)]);
  await expectRegistrationRolledBack(body.challengeId, username);
  await fixture.pool.query('DROP TRIGGER reject_registration_audit ON audit_log');
  const responses = await Promise.all([
    post('auth/register/verify', body),
    post('auth/register/verify', body),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  const created = (await responses.find((response) => response.ok)!.json()) as { userId: string };
  expect(
    (await fixture.pool.query("SELECT user_id FROM audit_log WHERE event='user_created'")).rows
  ).toEqual([{ user_id: created.userId }]);
}, 15000);

for (const table of ['tos_versions', 'sessions', 'refresh_tokens', 'audit_log']) {
  it(`rolls registration back if OTP expires while ${table} writes wait`, async () => {
    const { username, body } = await pendingRegistration();
    const deadline = (
      await fixture.pool.query(
        "UPDATE otp_challenges SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE challenge_id=$1 RETURNING expires_at",
        [body.challengeId]
      )
    ).rows[0].expires_at as Date;
    const blocker = await fixture.pool.connect();
    let response: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      // Table identifiers come only from this fixed test list.
      await blocker.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
      const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      response = post('auth/register/verify', body);
      await expect
        .poll(
          async () =>
            (
              await fixture.pool.query(
                'SELECT count(*)::int AS count FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',
                [pid]
              )
            ).rows[0].count
        )
        .toBe(1);
      await expect
        .poll(
          async () =>
            (
              await fixture.pool.query('SELECT clock_timestamp()>$1::timestamptz AS expired', [
                deadline,
              ])
            ).rows[0].expired,
          { timeout: 5000 }
        )
        .toBe(true);
      await blocker.query('COMMIT');
      const rejected = await response;
      expect(rejected.status, fixture.logs()).toBe(401);
      expect(await rejected.json()).toMatchObject({ error: { code: 'AUTH:OTP:EXPIRED' } });
      expect(rejected.headers.getSetCookie()).toEqual([
        expect.stringMatching(/^barghsa_preauth=;/),
      ]);
      await expectRegistrationRolledBack(body.challengeId, username);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await response;
    }
  }, 15000);
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
  const verified = await post(
    'auth/register/verify',
    {
      challengeId: challenge.challengeId,
      otp: '123456',
    },
    { 'User-Agent': 'Registration-consent-test/1.0' }
  );
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
  const registrationEvidence = (
    await fixture.pool.query(
      'SELECT user_id,version_id,accepted_at,ip_address,user_agent FROM tos_acceptances WHERE user_id=$1',
      [user.userId]
    )
  ).rows[0];
  expect(registrationEvidence).toMatchObject({
    user_id: user.userId,
    version_id: oldTerms,
    user_agent: 'Registration-consent-test/1.0',
  });
  const creationAudit = (
    await fixture.pool.query(
      "SELECT user_id,metadata::jsonb AS metadata,correlation_id,ip,created_at FROM audit_log WHERE event='user_created' AND user_id=$1",
      [user.userId]
    )
  ).rows;
  expect(creationAudit).toHaveLength(1);
  expect(creationAudit[0]).toMatchObject({
    user_id: user.userId,
    correlation_id: verified.headers.get('x-correlation-id'),
    metadata: {
      terms: {
        versionId: oldTerms,
        acceptedAt: registrationEvidence.accepted_at.toISOString(),
        hashAlgorithm: 'sha256',
        contentHashes: {
          fa: createHash('sha256').update('قوانین اول').digest('hex'),
          en: createHash('sha256').update('First terms').digest('hex'),
        },
      },
    },
  });
  expect(creationAudit[0].ip).toMatch(/127\.0\.0\.1/);
  expect(creationAudit[0].created_at).toBeInstanceOf(Date);
  expect(JSON.stringify(creationAudit)).not.toContain('123456');
  expect(registrationEvidence.accepted_at).toBeInstanceOf(Date);
  expect(registrationEvidence.ip_address).toMatch(/127\.0\.0\.1/);
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
  const draftSnapshot = (await (
    await fetch(`${fixture.base}/api/admin/tos/versions/${draftTerms}`, { headers })
  ).json()) as { revision: string };
  const client = await fixture.pool.connect();
  let edit: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM tos_versions WHERE id=$1 FOR UPDATE', [draftTerms]);
    edit = fetch(`${fixture.base}/api/admin/tos/versions/${draftTerms}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        contentEn: 'Racing edit must not overwrite published text',
        expectedRevision: draftSnapshot.revision,
      }),
    });
    await expect
      .poll(
        async () =>
          (
            await fixture.pool.query(`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM tos_versions WHERE id=$1 FOR UPDATE%'`)
          ).rows[0].count
      )
      .toBe(1);
    await client.query(
      "UPDATE tos_versions SET status='published',published_at=NOW() WHERE id=$1",
      [draftTerms]
    );
    await client.query('COMMIT');
    const response = await edit;
    expect(response.status, await response.text()).toBe(400);
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

it.each(['email', 'mobile'] as const)(
  'registration initializes available notification defaults for %s',
  async (kind) => {
    const username = kind === 'email' ? `prefs-${randomUUID()}@example.test` : '+989120003333';
    const pending = await pendingRegistration(username);
    const response = await post('auth/register/verify', pending.body);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as { userId: string; csrfToken: string };
    const headers = {
      Cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; '),
      'X-CSRF-Token': body.csrfToken,
      'Content-Type': 'application/json',
    };
    const available = kind === 'email' ? 'EMAIL' : 'SMS';
    const preferences = () => fetch(`${fixture.base}/api/user/settings/notifications`, { headers });
    const initial = await preferences();
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({
      channels: ['IN_APP', available],
      availableChannels: ['IN_APP', available],
    });
    const user = await fetch(`${fixture.base}/api/auth/user`, { headers });
    expect(await user.json()).toMatchObject({
      [kind]: username,
      [kind + 'Verified']: true,
      [kind === 'email' ? 'mobile' : 'email']: null,
    });
    const save = (channels: string[]) =>
      fetch(`${fixture.base}/api/user/settings/notifications`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ channels }),
      });
    expect((await save(['IN_APP'])).status).toBe(200);
    expect(await (await preferences()).json()).toEqual({
      channels: ['IN_APP'],
      availableChannels: ['IN_APP', available],
    });
    expect((await save([available])).status).toBe(200);
    expect((await save([kind === 'email' ? 'SMS' : 'EMAIL'])).status).toBe(400);
    expect(
      (
        await fixture.pool.query('SELECT notification_preferences FROM users WHERE user_id=$1', [
          body.userId,
        ])
      ).rows[0].notification_preferences
        .split(',')
        .sort()
    ).toEqual(['IN_APP', available].sort());
  }
);
