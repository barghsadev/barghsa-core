import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import type { CrmUsersResponse } from './crm.service.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let cookie: string;
const people = ['reader', 'employee', 'admin', 'customer', 'archived'] as const;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  for (const [n, name] of people.entries()) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff,is_admin,created_at) VALUES ($1,$2,'fixture',$3,$4,'2026-08-01T12:00:00Z')",
      [name, 'search-' + name + '@example.test', name === 'employee', name === 'admin']
    );
    const id = randomUUID();
    await http.pool.query(
      "INSERT INTO profiles(id,user_id,profile_type,status,first_name,last_name,archived) VALUES ($1,$2,'INDIVIDUAL',$3,$4,$5,$6)",
      [
        id,
        name,
        name === 'reader' ? 'PENDING_VERIFICATION' : name === 'employee' ? 'SUSPENDED' : 'ACTIVE',
        name === 'customer' ? 'مریم' : 'Samira',
        name === 'customer' ? 'احمدی' : 'Farah',
        name === 'archived',
      ]
    );
    const legal = randomUUID();
    await http.pool.query(
      "INSERT INTO profiles(id,user_id,profile_type,status,archived) VALUES ($1,$2,'LEGAL','ACTIVE',$3)",
      [legal, name, name === 'archived']
    );
    await http.pool.query(
      "INSERT INTO legal_profiles(id,legal_name,national_identifier,registration_number,representative_title,representative_relationship) VALUES ($1,$2,$3,'fixture','Director','Owner')",
      [
        legal,
        name === 'customer' ? 'شرکت انرژی آفتاب' : 'North Solar Company',
        'search-fixture-' + n,
      ]
    );
  }
  await http.pool.query(
    "INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('search-role','Search reader','Fixture','[\"crm:read\"]')"
  );
  await http.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES ('reader','search-role')");
  const session = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,'admin',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
    [session, randomUUID(), randomUUID()]
  );
  cookie = 'barghsa_session=' + session;
}, 40000);
afterAll(async () => {
  await http?.close();
});
async function list(params: Record<string, string>) {
  const r = await fetch(
    http.base + '/api/crm/users?' + new URLSearchParams({ order: 'asc', ...params }),
    { headers: { Cookie: cookie } }
  );
  expect(r.status, http.logs()).toBe(200);
  return (await r.json()) as CrmUsersResponse;
}
it('matches complete individual names and reordered legal-name tokens in both languages', async () => {
  for (const [search, expected] of [
    ['Samira Farah', ['admin', 'employee', 'reader']],
    ['Farah Samira', ['admin', 'employee', 'reader']],
    ['مریم احمدی', ['customer']],
    ['Solar North', ['admin', 'employee', 'reader']],
    ['آفتاب شرکت', ['customer']],
    ['amir', ['admin', 'employee', 'reader']],
    ['search-customer@example.test', ['customer']],
  ] as const) {
    const page = await list({ search });
    expect(page.users.map((u) => u.userId)).toEqual(expected);
    expect(page.users.every((u) => u.profileCount === 2 && u.profiles.length === 2)).toBe(true);
  }
});
it('staff-only includes assigned staff roles and admins as well as explicit staff flags', async () => {
  expect((await list({ staffOnly: 'true' })).users.map((u) => u.userId)).toEqual([
    'admin',
    'employee',
    'reader',
  ]);
  expect((await list({ staffOnly: 'false' })).users.map((u) => u.userId)).toEqual([
    'admin',
    'archived',
    'customer',
    'employee',
    'reader',
  ]);
});
it('combines names, dates, type, status and staff filters without losing profile summaries', async () => {
  const filters = {
    search: 'Solar North',
    type: 'LEGAL',
    staffOnly: 'true',
    dateFrom: '2026-08-01T00:00:00Z',
    dateTo: '2026-08-01T23:59:59.999999Z',
  };
  for (const [verification, expected] of [
    ['PENDING', ['reader']],
    ['DISABLED', ['employee']],
    ['VERIFIED', []],
    ['UNVERIFIED', ['admin', 'employee']],
  ] as const) {
    expect((await list({ ...filters, verification })).users.map((u) => u.userId)).toEqual(expected);
  }
  expect((await list({ ...filters, dateFrom: '2026-08-01T12:00:00.000001Z' })).users).toEqual([]);
  const first = await list({ ...filters, limit: '2' });
  expect(first.users.map((u) => u.userId)).toEqual(['admin', 'employee']);
  expect(first.hasMore).toBe(true);
  const second = await list({ ...filters, limit: '2', cursor: first.cursor! });
  expect(second.users.map((u) => u.userId)).toEqual(['reader']);
  expect(second.users[0]).toMatchObject({
    profileCount: 2,
    hasIndividualProfile: true,
    hasLegalProfile: true,
  });
  expect(second.cursor).toBeNull();
});
