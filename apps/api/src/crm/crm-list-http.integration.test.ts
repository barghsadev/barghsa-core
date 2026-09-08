import type { CrmUsersResponse } from './crm.service.js';
import type { CrmProfileDetail } from './crm-v2.service.js';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let cookie: string;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_admin) VALUES ('crm-admin','crm-admin@example.test','test-only',true)"
  );
  const session = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
    VALUES ($1,'crm-admin',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
    [session, randomUUID(), randomUUID()]
  );
  cookie = `barghsa_session=${session}`;
  for (let n = 0; n < 7; n++) {
    await http.pool.query(
      `INSERT INTO users(user_id,username,password_hash,created_at)
      VALUES ($1,$2,'test-only',$3::timestamptz)`,
      [
        `crm-page-${n}`,
        `crm-page-${n}@example.test`,
        `2026-08-01T10:00:00.${n < 4 ? '000001' : String(n).padStart(6, '0')}Z`,
      ]
    );
    await http.pool.query(
      `INSERT INTO profiles(id,user_id,profile_type,status,first_name,last_name) VALUES ($1,$2,'INDIVIDUAL',$3,'Example','Family')`,
      [
        randomUUID(),
        `crm-page-${n}`,
        n === 0 ? 'PENDING_VERIFICATION' : n === 1 ? 'SUSPENDED' : n === 2 ? 'VERIFIED' : 'ACTIVE',
      ]
    );
  }
}, 40000);
afterAll(async () => {
  await http?.close();
});
async function list(params: Record<string, string>) {
  return fetch(`${http.base}/api/crm/users?${new URLSearchParams(params)}`, {
    headers: { Cookie: cookie },
  });
}
for (const order of ['asc', 'desc'])
  it(`paginates text user IDs and microseconds without omissions (${order})`, async () => {
    const seen: string[] = [];
    let cursor = '';
    do {
      const response = await list({
        search: 'crm-page-',
        order,
        limit: '2',
        ...(cursor ? { cursor } : {}),
      });
      expect(response.status).toBe(200);
      const data = (await response.json()) as CrmUsersResponse;
      seen.push(...data.users.map((user: { userId: string }) => user.userId));
      cursor = data.cursor ?? '';
      expect(seen.length).toBeLessThanOrEqual(7);
    } while (cursor);
    expect(seen).toEqual(
      Array.from({ length: 7 }, (_, n) => `crm-page-${order === 'asc' ? n : 6 - n}`)
    );
  });
it('uses actual profile states, supports surname search, and refuses invalid cursors/dates', async () => {
  for (const [verification, id] of [
    ['PENDING', 'crm-page-0'],
    ['DISABLED', 'crm-page-1'],
    ['VERIFIED', 'crm-page-2'],
  ]) {
    const response = await list({ search: 'Family', verification: verification! });
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as CrmUsersResponse).users.map(
        (user: { userId: string }) => user.userId
      )
    ).toEqual([id]);
  }
  expect((await list({ cursor: 'bad' })).status).toBe(400);
  expect((await list({ dateFrom: 'bad' })).status).toBe(400);
  expect((await list({ dateFrom: '2026-09-01', dateTo: '2026-08-01' })).status).toBe(400);
});
it('keeps the complete profile summary when a type or name matches only one profile', async () => {
  const profileId = randomUUID();
  await http.pool.query(
    `INSERT INTO profiles(id,user_id,profile_type,status,title) VALUES ($1,'crm-page-0','LEGAL','ACTIVE','Additional company')`,
    [profileId]
  );
  const response = await list({ type: 'INDIVIDUAL', search: 'Family', verification: 'PENDING' });
  expect(response.status).toBe(200);
  const user = ((await response.json()) as CrmUsersResponse).users[0]!;
  expect(user.profileCount).toBe(2);
  expect(user.hasLegalProfile).toBe(true);
  expect(user.profiles).toContainEqual({
    id: profileId,
    profileType: 'LEGAL',
    status: 'ACTIVE',
    title: 'Additional company',
  });
  const staff = await list({ staffOnly: 'true', search: 'crm-page-' });
  expect(((await staff.json()) as CrmUsersResponse).users).toEqual([]);
});
it('profile detail reports the current viewer capabilities', async () => {
  const id = (await http.pool.query("SELECT id FROM profiles WHERE user_id='crm-page-0' LIMIT 1"))
    .rows[0].id;
  const response = await fetch(`${http.base}/api/crm/profiles/${id}`, {
    headers: { Cookie: cookie },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    viewerPermissions: { canEdit: true, canVerify: true, canManageUser: true },
    user: { isAdmin: false },
  });
});
it('never exposes usable customer session cookies and excludes expired sessions from the count', async () => {
  const profileId = (
    await http.pool.query("SELECT id FROM profiles WHERE user_id='crm-page-0' LIMIT 1")
  ).rows[0].id;
  const active = randomUUID(),
    expired = randomUUID();
  for (const [id, expiry] of [
    [active, '1 day'],
    [expired, '-1 day'],
  ])
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
    VALUES ($1,'crm-page-0',$2,$3,NOW()+$4::interval,NOW()+INTERVAL '30 minutes')`,
      [id, randomUUID(), randomUUID(), expiry]
    );
  const response = await fetch(`${http.base}/api/crm/profiles/${profileId}`, {
    headers: { Cookie: cookie },
  });
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).not.toContain(active);
  expect(body).not.toContain(expired);
  const data = JSON.parse(body);
  expect(data.sessions.count).toBe(1);
  for (const session of data.sessions.entries) {
    expect(session.sessionId).toMatch(/^session-ref:[a-f0-9]{64}$/);
    const impersonation = await fetch(`${http.base}/api/profiles`, {
      headers: { Cookie: `barghsa_session=${session.sessionId}` },
    });
    expect(impersonation.status).toBe(401);
  }
});
it("reports only the customer's latest recorded password change without disclosing hashes", async () => {
  const owner = `crm-password-${randomUUID()}`;
  const profileId = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ($1,$2,'private-current-password-hash')",
    [owner, `${owner}@example.test`]
  );
  await http.pool.query('INSERT INTO profiles(id,user_id) VALUES ($1,$2)', [profileId, owner]);
  const read = () =>
    fetch(`${http.base}/api/crm/profiles/${profileId}`, { headers: { Cookie: cookie } });
  const initial = await read();
  expect(initial.status).toBe(200);
  expect(((await initial.json()) as CrmProfileDetail).user.lastPasswordChange).toBeNull();
  for (const [userId, version, date] of [
    [owner, 1, '2026-08-01T01:00:00Z'],
    [owner, 2, '2026-08-02T01:00:00Z'],
    ['crm-page-1', 1, '2026-08-03T01:00:00Z'],
  ] as const) {
    await http.pool.query(
      'INSERT INTO password_history(id,user_id,password_hash,version,created_at) VALUES ($1,$2,$3,$4,$5)',
      [randomUUID(), userId, 'private-old-password-hash', version, date]
    );
  }
  await http.pool.query('UPDATE users SET updated_at=NOW() WHERE user_id=$1', [owner]);
  const response = await read();
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(JSON.parse(body).user.lastPasswordChange).toBe('2026-08-02T01:00:00.000Z');
  expect(body).not.toContain('private-current-password-hash');
  expect(body).not.toContain('private-old-password-hash');
});
it('requires recent step-up before every sensitive CRM mutation', async () => {
  const id = (await http.pool.query("SELECT id FROM profiles WHERE user_id='crm-page-3'")).rows[0]
    .id;
  const csrf = (await http.pool.query("SELECT csrf_token FROM sessions WHERE user_id='crm-admin'"))
    .rows[0].csrf_token;
  const headers = { Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' };
  const actions = [
    { path: `profiles/${id}`, method: 'PUT', body: { title: 'Reviewed title' } },
    { path: `profiles/${id}/verify`, method: 'POST', body: { action: 'verify' } },
    {
      path: 'users/crm-page-3/force-password-change',
      method: 'POST',
      body: { reason: 'Account recovery' },
    },
    {
      path: 'users/crm-page-3/expire-sessions',
      method: 'POST',
      body: { reason: 'Account recovery' },
    },
    { path: `profiles/${id}`, method: 'DELETE', body: { reason: 'Requested closure' } },
  ];
  for (const age of ['NULL', "NOW()-INTERVAL '16 minutes'"]) {
    await http.pool.query(
      `UPDATE sessions SET step_up_verified_at=${age} WHERE user_id='crm-admin'`
    );
    for (const action of actions) {
      const response = await fetch(`${http.base}/api/crm/${action.path}`, {
        method: action.method,
        headers,
        body: JSON.stringify(action.body),
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: 'AUTHZ:STEP_UP_REQUIRED' } });
    }
  }
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='crm-admin'");
  const edited = await fetch(`${http.base}/api/crm/profiles/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ title: 'Reviewed title' }),
  });
  expect(edited.status).toBe(200);
  expect(await edited.json()).toMatchObject({
    profile: { title: 'Reviewed title' },
    viewerPermissions: { canEdit: true },
  });
  const identity = await fetch(`${http.base}/api/crm/profiles/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ nationalId: '1234567890' }),
  });
  expect(identity.status).toBe(400);
});
it('archives an empty profile once and blocks funds and canonical legal ownership', async () => {
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='crm-admin'");
  const csrf = (await http.pool.query("SELECT csrf_token FROM sessions WHERE user_id='crm-admin'"))
    .rows[0].csrf_token;
  const headers = { Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' };
  const blocked = randomUUID(),
    empty = randomUUID(),
    legal = randomUUID();
  for (const [id, type] of [
    [blocked, 'INDIVIDUAL'],
    [empty, 'INDIVIDUAL'],
    [legal, 'LEGAL'],
  ])
    await http.pool.query(
      "INSERT INTO profiles(id,user_id,profile_type,status) VALUES ($1,'crm-page-4',$2,'ACTIVE')",
      [id, type]
    );
  await http.pool.query(
    'INSERT INTO wallets(profile_id,posted_balance) VALUES ($1,10000000000000001)',
    [blocked]
  );
  async function archive(id: string) {
    return fetch(`${http.base}/api/crm/profiles/${id}`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ reason: 'Closure requested' }),
    });
  }
  expect((await archive(blocked)).status).toBe(409);
  expect((await archive(legal)).status).toBe(409);
  expect(
    (await http.pool.query('SELECT archived FROM profiles WHERE id=$1', [blocked])).rows[0].archived
  ).toBe(false);
  const results = await Promise.all(Array.from({ length: 4 }, () => archive(empty)));
  expect(results.map((response) => response.status).sort()).toEqual([200, 409, 409, 409]);
  expect(
    (
      await http.pool.query(
        "SELECT id FROM audit_log WHERE event='profile_deleted' AND metadata::jsonb->>'profileId'=$1",
        [empty]
      )
    ).rows
  ).toHaveLength(1);
  expect(
    (await http.pool.query('SELECT archived,archived_reason FROM profiles WHERE id=$1', [empty]))
      .rows[0]
  ).toMatchObject({ archived: true, archived_reason: 'Closure requested' });
});
