import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import type { NavigationConfiguration } from './navigation.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let session: string, owned: string, legal: string, role: string;
beforeEach(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  for (const user of ['viewer', 'owner'])
    await http.pool.query('INSERT INTO users(user_id,username,password_hash) VALUES ($1,$2,$3)', [
      user,
      `${user}@example.test`,
      'test-only',
    ]);
  session = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,operating_context) VALUES ($1,'viewer',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes','customer')`,
    [session, randomUUID(), randomUUID()]
  );
  owned = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,is_default,status) VALUES ('viewer',true,'ACTIVE') RETURNING id"
    )
  ).rows[0].id;
  legal = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,is_default,status) VALUES ('owner','LEGAL',true,'ACTIVE') RETURNING id"
    )
  ).rows[0].id;
  role = randomUUID();
}, 40000);
afterEach(async () => {
  await http?.close();
}, 15000);
const read = () =>
  fetch(`${http.base}/api/auth/user`, { headers: { Cookie: `barghsa_session=${session}` } });
async function sessionBody(response: Response): Promise<{ navigation: NavigationConfiguration }> {
  return (await response.json()) as { navigation: NavigationConfiguration };
}
async function selectLegal(roles: string[]) {
  await http.pool.query(
    "INSERT INTO user_profile_contexts(user_id,profile_id) VALUES ('viewer',$1)",
    [legal]
  );
  for (const value of roles)
    await http.pool.query(
      "INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,'viewer',$2)",
      [legal, value]
    );
}
async function staff(permissions: unknown, admin = false) {
  await http.pool.query("UPDATE users SET is_staff=true,is_admin=$1 WHERE user_id='viewer'", [
    admin,
  ]);
  await http.pool.query("UPDATE sessions SET operating_context='staff' WHERE session_id=$1", [
    session,
  ]);
  await http.pool.query(
    "INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ($1,$2,'Navigation test role',$3)",
    [role, 'Admin-looking name', JSON.stringify(permissions)]
  );
  await http.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES ('viewer',$1)", [role]);
}

it('returns private session-bound navigation with the current individual profile, without exposing role data', async () => {
  const response = await read();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe(
    'private, no-cache, no-store, must-revalidate'
  );
  const value = await sessionBody(response);
  expect(value.navigation).toMatchObject({
    version: 1,
    area: 'customer',
    profileId: owned,
    profileType: 'INDIVIDUAL',
  });
  expect(value.navigation.paths).toContain('/savings');
  expect(value.navigation.paths).not.toContain('/settings/team');
  expect(Object.keys(value.navigation).sort()).toEqual([
    'area',
    'paths',
    'profileId',
    'profileType',
    'version',
  ]);
});
it('resolves Finance and Legal membership additively and refreshes it after a role change', async () => {
  await selectLegal(['Finance']);
  const finance = (await sessionBody(await read())).navigation;
  expect(finance.paths).toContain('/wallet');
  expect(finance.paths).not.toContain('/contracts');
  expect(finance.paths).not.toContain('/electricity');
  expect(finance.paths).not.toContain('/settings/team');
  await http.pool.query(
    "INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,'viewer','Legal')",
    [legal]
  );
  expect((await sessionBody(await read())).navigation.paths).toContain('/contracts');
  await http.pool.query(
    "DELETE FROM profile_agents WHERE profile_id=$1 AND user_id='viewer' AND role='Finance'",
    [legal]
  );
  const legalOnly = (await sessionBody(await read())).navigation;
  expect(legalOnly.paths).toContain('/contracts');
  expect(legalOnly.paths).not.toContain('/wallet');
  expect(legalOnly.paths).not.toContain('/invoices');
});
it('offers legal team and company-profile links to a Manager and omits individual savings', async () => {
  await selectLegal(['Manager']);
  const navigation = (await sessionBody(await read())).navigation;
  expect(navigation).toMatchObject({ profileId: legal, profileType: 'LEGAL' });
  expect(navigation.paths).toContain('/settings/team');
  expect(navigation.paths).toContain('/settings/profile');
  expect(navigation.paths).toContain('/documents');
  expect(navigation.paths).not.toContain('/savings');
});
it('does not reuse profile grants after membership removal, an inaccessible selection or archive', async () => {
  await selectLegal(['Finance']);
  expect((await sessionBody(await read())).navigation.paths).toContain('/wallet');
  await http.pool.query("DELETE FROM profile_agents WHERE profile_id=$1 AND user_id='viewer'", [
    legal,
  ]);
  expect((await sessionBody(await read())).navigation).toEqual({
    version: 1,
    area: 'customer',
    profileId: null,
    profileType: null,
    paths: ['/app', '/notifications', '/settings'],
  });
  await http.pool.query(
    "INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,'viewer','Manager')",
    [legal]
  );
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [legal]);
  expect((await sessionBody(await read())).navigation.profileId).toBeNull();
});
it('projects assigned-ticket and invoice read permissions independently of a role name', async () => {
  await staff(['tickets:assigned', 'invoices:read']);
  const navigation = (await sessionBody(await read())).navigation;
  expect(navigation).toEqual({
    version: 1,
    area: 'staff',
    profileId: null,
    profileType: null,
    paths: ['/app', '/admin/inbox', '/admin/tickets', '/admin/invoices'],
  });
  await http.pool.query('UPDATE staff_roles SET permissions=$1 WHERE role_id=$2', [
    JSON.stringify(['admin:roles:edit']),
    role,
  ]);
  expect((await sessionBody(await read())).navigation.paths).toEqual([
    '/app',
    '/admin/inbox',
    '/admin/roles',
  ]);
  await http.pool.query('UPDATE staff_roles SET permissions=$1 WHERE role_id=$2', [
    JSON.stringify([123]),
    role,
  ]);
  expect((await sessionBody(await read())).navigation.paths).toEqual(['/app', '/admin/inbox']);
});
it('gives administrators configuration destinations but uses customer authority in customer mode', async () => {
  await staff([], true);
  expect((await sessionBody(await read())).navigation.paths).toContain('/admin/storage');
  await http.pool.query("UPDATE sessions SET operating_context='customer' WHERE session_id=$1", [
    session,
  ]);
  const navigation = (await sessionBody(await read())).navigation;
  expect(navigation.area).toBe('customer');
  expect(navigation.paths).toContain('/wallet');
  expect(navigation.paths.some((path: string) => path.startsWith('/admin'))).toBe(false);
});
it('matches electricity, saving and bank-receipt queue read guards for narrowly scoped staff', async () => {
  await staff(['contracts:write']);
  let navigation = (await sessionBody(await read())).navigation;
  expect(navigation.paths).toContain('/admin/electricity-orders');
  expect(navigation.paths).toContain('/admin/saving-orders');
  for (const path of ['/api/staff/electricity/orders', '/api/staff/saving/orders']) {
    const response = await fetch(`${http.base}${path}`, {
      headers: { Cookie: `barghsa_session=${session}` },
    });
    expect(response.status).toBe(200);
  }
  await http.pool.query('UPDATE staff_roles SET permissions=$1 WHERE role_id=$2', [
    JSON.stringify(['admin:finance:wallet:bank-receipt-confirm']),
    role,
  ]);
  navigation = (await sessionBody(await read())).navigation;
  expect(navigation.paths).toContain('/admin/wallet-receipts');
  expect(navigation.paths).not.toContain('/admin/approval-requests');
  expect(
    (
      await fetch(`${http.base}/api/admin/wallet/bank-receipt-top-ups`, {
        headers: { Cookie: `barghsa_session=${session}` },
      })
    ).status
  ).toBe(200);
});
it('returns no navigation for unauthenticated, disabled or revoked sessions', async () => {
  expect((await fetch(`${http.base}/api/auth/user`)).status).toBe(401);
  await http.pool.query("UPDATE users SET disabled_at=NOW() WHERE user_id='viewer'");
  expect((await read()).status).toBe(401);
  await http.pool.query("UPDATE users SET disabled_at=NULL WHERE user_id='viewer'");
  await http.pool.query('UPDATE sessions SET revoked_at=NOW() WHERE session_id=$1', [session]);
  expect((await read()).status).toBe(401);
});
