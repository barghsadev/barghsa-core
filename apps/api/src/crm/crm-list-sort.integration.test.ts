import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import { crmSortFields, type CrmUsersResponse } from './crm.service.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let cookie: string;
const prefix = 'crm-sort-' + randomUUID();
const ids = Array.from({ length: 4 }, (_, n) => prefix + '-' + n);
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_admin) VALUES ('sort-admin','sort-admin','fixture',true)"
  );
  const session = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,'sort-admin',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
    [session, randomUUID(), randomUUID()]
  );
  cookie = 'barghsa_session=' + session;
  for (let n = 0; n < 4; n++) {
    await http.pool.query(
      'INSERT INTO users(user_id,username,password_hash,created_at,last_login_at) VALUES ($1,$2,$3,$4,$5)',
      [
        ids[n],
        prefix + ['-z', '-a', '-c', '-b'][n],
        'fixture',
        n < 3 ? '2026-08-01T10:00:00.000001Z' : '2026-08-01T10:00:00.000002Z',
        n === 0 ? null : n < 3 ? '2026-08-02T10:00:00.000001Z' : '2026-08-02T10:00:00.000002Z',
      ]
    );
    if (n)
      await http.pool.query(
        "INSERT INTO profiles(id,user_id,profile_type,status) VALUES ($1,$2,'INDIVIDUAL',$3)",
        [randomUUID(), ids[n], n === 1 ? 'ACTIVE' : n === 2 ? 'PENDING_VERIFICATION' : 'VERIFIED']
      );
    if (n === 1 || n === 3)
      await http.pool.query(
        "INSERT INTO profiles(id,user_id,profile_type,status) VALUES ($1,$2,'LEGAL','ACTIVE')",
        [randomUUID(), ids[n]]
      );
    if (n === 2)
      await http.pool.query(
        "INSERT INTO profiles(id,user_id,profile_type,status,archived) VALUES ($1,$2,'LEGAL','VERIFIED',true)",
        [randomUUID(), ids[n]]
      );
  }
}, 40000);
afterAll(async () => {
  await http?.close();
});
const list = (params: Record<string, string> = {}, auth = cookie) =>
  fetch(http.base + '/api/crm/users?' + new URLSearchParams({ search: prefix, ...params }), {
    headers: { Cookie: auth },
  });
const orders = {
  createdAt: { asc: [0, 1, 2, 3], desc: [3, 2, 1, 0] },
  username: { asc: [1, 3, 2, 0], desc: [0, 2, 3, 1] },
  lastLogin: { asc: [1, 2, 3, 0], desc: [3, 2, 1, 0] },
  profileCount: { asc: [0, 2, 1, 3], desc: [3, 1, 2, 0] },
};
for (const sort of crmSortFields)
  for (const order of ['asc', 'desc'] as const)
    it(
      'paginates ' + sort + ' ' + order + ' with stable ties, full summaries and null logins last',
      async () => {
        const seen: string[] = [];
        let cursor = '';
        do {
          const response = await list({ sort, order, limit: '1', ...(cursor ? { cursor } : {}) });
          expect(response.status, http.logs()).toBe(200);
          const page = (await response.json()) as CrmUsersResponse;
          expect(page.users).toHaveLength(1);
          seen.push(page.users[0]!.userId);
          expect(seen.length).toBeLessThanOrEqual(4);
          expect(page.hasMore).toBe(page.cursor !== null);
          expect(page.users[0]!.profileCount).toBe(page.users[0]!.profiles.length);
          cursor = page.cursor ?? '';
        } while (cursor);
        expect(seen).toEqual(orders[sort][order].map((n) => ids[n]));
      }
    );
it('verification filters agree with displayed status and exclude archived profiles', async () => {
  for (const [verification, expected] of [
    ['VERIFIED', [3]],
    ['PENDING', [2]],
    ['UNVERIFIED', [0, 1]],
  ] as const) {
    const response = await list({ verification, order: 'asc' });
    expect(response.status).toBe(200);
    const page = (await response.json()) as CrmUsersResponse;
    expect(page.users.map((u) => u.userId)).toEqual(expected.map((n) => ids[n]));
  }
});
it('combines profile filtering with aggregate pagination without trimming the summary', async () => {
  let cursor = '';
  const users = [];
  do {
    const r = await list({
      type: 'LEGAL',
      sort: 'profileCount',
      order: 'asc',
      limit: '1',
      ...(cursor ? { cursor } : {}),
    });
    expect(r.status).toBe(200);
    const page = (await r.json()) as CrmUsersResponse;
    users.push(...page.users);
    cursor = page.cursor ?? '';
    expect(users.length).toBeLessThanOrEqual(2);
  } while (cursor);
  expect(users.map((u) => u.userId)).toEqual([ids[1], ids[3]]);
  for (const u of users)
    expect(u).toMatchObject({ profileCount: 2, hasIndividualProfile: true, hasLegalProfile: true });
});
it('refuses reuse after the sort, direction or filters change and validates cursor values', async () => {
  const first = await list({ sort: 'username', order: 'asc', limit: '1' });
  const page = (await first.json()) as CrmUsersResponse;
  for (const changed of [
    { sort: 'lastLogin' },
    { order: 'desc' },
    { type: 'LEGAL' },
    { search: prefix + '-a' },
  ])
    expect(
      (await list({ sort: 'username', order: 'asc', cursor: page.cursor!, ...changed })).status
    ).toBe(400);
  const parsed = JSON.parse(Buffer.from(page.cursor!, 'base64url').toString('utf8'));
  for (const value of [null, 1, {}, '']) {
    const cursor = Buffer.from(JSON.stringify({ ...parsed, value })).toString('base64url');
    expect((await list({ sort: 'username', order: 'asc', cursor })).status).toBe(400);
  }
});
it('rejects invalid query choices and impossible calendar dates', async () => {
  for (const params of [
    { sort: 'untrusted_column' },
    { order: 'sideways' },
    { type: 'UNKNOWN' },
    { verification: 'UNKNOWN' },
    { staffOnly: 'maybe' },
    { limit: '2x' },
    { search: 'x'.repeat(257) },
    { dateFrom: '2026-02-30' },
    { dateTo: '2026-02-30T00:00:00Z' },
    { dateFrom: '2026-08-02', dateTo: '2026-08-01' },
  ])
    expect((await list(params)).status).toBe(400);
});
it('includes the full microsecond registration range and treats search wildcards literally', async () => {
  const dates = await list({
    dateFrom: '2026-08-01T10:00:00.000002Z',
    dateTo: '2026-08-01T10:00:00.000002Z',
  });
  expect(dates.status).toBe(200);
  expect(((await dates.json()) as CrmUsersResponse).users.map((u) => u.userId)).toEqual([ids[3]]);
  for (const search of [prefix + '%', prefix + '_', prefix + '\\']) {
    const r = await list({ search });
    expect(r.status).toBe(200);
    expect(((await r.json()) as CrmUsersResponse).users).toEqual([]);
  }
});
it('requires current CRM read permission and never accepts customer session access', async () => {
  const session = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
    [session, ids[0], randomUUID(), randomUUID()]
  );
  expect((await list({}, '')).status).toBe(401);
  expect((await list({}, 'barghsa_session=' + session)).status).toBe(403);
  await http.pool.query(
    "INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('list-reader','List reader','Fixture','[\"crm:read\"]')"
  );
  await http.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES ($1,'list-reader')", [
    ids[0],
  ]);
  expect((await list({}, 'barghsa_session=' + session)).status).toBe(200);
  await http.pool.query("UPDATE staff_roles SET permissions='[]' WHERE role_id='list-reader'");
  expect((await list({}, 'barghsa_session=' + session)).status).toBe(403);
});
