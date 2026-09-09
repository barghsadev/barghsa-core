import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as argon2 from 'argon2';
import { startHttpFixture } from '../test/http-fixture.js';
import type { StaffAuditResult } from './admin.service.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let adminHeaders: Record<string, string>;

async function session(userId: string) {
  const sessionId = randomUUID(),
    token = randomUUID(),
    refresh = randomUUID(),
    family = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [sessionId, userId, token, family]
  );
  await http.pool.query(
    'INSERT INTO refresh_tokens(id,family_id,token_hash,user_id,session_id) VALUES ($1,$2,$3,$4,$5)',
    [randomUUID(), family, createHash('sha256').update(refresh).digest('hex'), userId, sessionId]
  );
  return {
    Cookie: `barghsa_session=${sessionId}; barghsa_refresh=${refresh}`,
    'X-CSRF-Token': token,
    'Content-Type': 'application/json',
  };
}

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_admin) VALUES ('bootstrap','admin@example.test','test-only',true)"
  );
  adminHeaders = await session('bootstrap');
}, 40000);

afterAll(async () => {
  await http?.close();
}, 15000);

it('lets staff creators select initial roles without granting role-management access', async () => {
  const userId = randomUUID();
  const roleId = `creator-${randomUUID()}`;
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,'fixture-only',true)",
    [userId, `${userId}@example.test`]
  );
  await http.pool.query(
    'INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ($1,$2,$3,$4)',
    [roleId, 'Creator only', 'Creates staff', JSON.stringify(['admin:users:create'])]
  );
  await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)', [userId, roleId]);
  const headers = await session(userId);
  const response = await fetch(`${http.base}/api/admin/staff-role-options`, { headers });
  expect(response.status).toBe(200);
  const options = (await response.json()) as {
    roleId: string;
    name: string;
    description: string;
  }[];
  expect(options.map((role) => role.roleId).sort()).toEqual([
    'role-admin',
    'role-crm-verification',
    'role-customer-support',
    'role-finance',
    'role-legal-contracts',
    'role-operations',
  ]);
  for (const option of options) {
    expect(Object.keys(option).sort()).toEqual(['description', 'name', 'roleId']);
    expect(option.description.length).toBeGreaterThan(0);
  }
  expect((await fetch(`${http.base}/api/admin/roles`, { headers })).status).toBe(403);
  const created = await fetch(`${http.base}/api/admin/users/create-staff`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      username: `${randomUUID()}@example.test`,
      firstName: 'Initial',
      lastName: 'Roles',
      activationMethod: 'tempPassword',
      roleIds: ['role-finance', 'role-operations'],
    }),
  });
  expect(created.status, await created.clone().text()).toBe(201);
  const target = (await created.json()) as { userId: string };
  expect(
    (
      await http.pool.query('SELECT role_id FROM user_roles WHERE user_id=$1 ORDER BY role_id', [
        target.userId,
      ])
    ).rows
  ).toEqual([{ role_id: 'role-finance' }, { role_id: 'role-operations' }]);
  expect(
    (
      await fetch(`${http.base}/api/admin/users/${target.userId}/roles`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ roleIds: [] }),
      })
    ).status
  ).toBe(403);
  await http.pool.query('DELETE FROM user_roles WHERE user_id=$1', [userId]);
  expect((await fetch(`${http.base}/api/admin/staff-role-options`, { headers })).status).toBe(403);
  expect((await fetch(`${http.base}/api/admin/staff-role-options`)).status).toBe(401);
});

it('reads persisted role additions and removals with target and date filters', async () => {
  const userId = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,'fixture-only',true)",
    [userId, `${userId}@example.test`]
  );
  for (const roleIds of [['role-finance'], ['role-customer-support']]) {
    const response = await fetch(`${http.base}/api/admin/users/${userId}/roles`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ roleIds, reason: 'Timeline review' }),
    });
    expect(response.status, await response.text()).toBe(200);
  }
  const rows = await http.pool.query<{ id: string }>(
    "SELECT id FROM audit_log WHERE event='role_change' AND metadata::jsonb->>'targetUserId'=$1 ORDER BY created_at,id",
    [userId]
  );
  expect(rows.rows).toHaveLength(2);
  for (const [index, row] of rows.rows.entries())
    await http.pool.query('UPDATE audit_log SET created_at=$2 WHERE id=$1', [
      row.id,
      `2026-03-${20 + index}T12:00:00Z`,
    ]);
  const read = async (query: string) => {
    const response = await fetch(`${http.base}/api/admin/staff/audit?userId=${userId}&${query}`, {
      headers: adminHeaders,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return response.json() as Promise<StaffAuditResult>;
  };
  const all = await read('limit=1');
  expect(all).toMatchObject({ total: 2, limit: 1, offset: 0 });
  expect(all.items).toEqual([
    expect.objectContaining({
      targetUserId: userId,
      targetUsername: `${userId}@example.test`,
      actorUsername: 'admin@example.test',
      addedRoles: [{ roleId: 'role-customer-support', roleName: 'Customer Support' }],
      removedRoles: [{ roleId: 'role-finance', roleName: 'Finance' }],
      reason: 'Timeline review',
      createdAt: '2026-03-21T12:00:00.000Z',
    }),
  ]);
  const older = await read('limit=1&offset=1');
  expect(older.items[0]).toMatchObject({
    addedRoles: [{ roleId: 'role-finance', roleName: 'Finance' }],
    removedRoles: [],
  });
  const filtered = await read('from=2026-03-21T00:00:00Z&to=2026-03-21T23:59:59.999Z');
  expect(filtered.total).toBe(1);
  expect(filtered.items).toEqual(all.items);
  expect(await read('from=2026-03-22T00:00:00Z')).toMatchObject({ items: [], total: 0 });
  for (const query of [
    'userId=invalid',
    'from=invalid',
    'to=invalid',
    'from=2026-03-22&to=2026-03-21',
  ])
    expect(
      (await fetch(`${http.base}/api/admin/staff/audit?${query}`, { headers: adminHeaders })).status
    ).toBe(400);
});

it('restricts staff permission history to current authorized viewers', async () => {
  const userId = randomUUID(),
    roleId = `audit-viewer-${randomUUID()}`;
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,'fixture-only',true)",
    [userId, `${userId}@example.test`]
  );
  const headers = await session(userId);
  const url = `${http.base}/api/admin/staff/audit`;
  expect((await fetch(url)).status).toBe(401);
  expect((await fetch(url, { headers })).status).toBe(403);
  await http.pool.query(
    'INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ($1,$2,$3,$4)',
    [roleId, 'Audit viewer', 'Fixture', '["admin:staff:view"]']
  );
  await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)', [userId, roleId]);
  expect((await fetch(url, { headers })).status).toBe(200);
  await http.pool.query("UPDATE staff_roles SET permissions='[]' WHERE role_id=$1", [roleId]);
  expect((await fetch(url, { headers })).status).toBe(403);
});

it('lets current role administrators read the catalogue and effective permissions under one grant', async () => {
  const userId = randomUUID(),
    roleId = `role-catalogue-${randomUUID()}`,
    target = randomUUID();
  for (const id of [userId, target])
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,'fixture-only',true)",
      [id, `${id}@example.test`]
    );
  await http.pool.query(
    'INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ($1,$2,$3,$4)',
    [roleId, 'Role catalogue', 'Fixture', '["admin:roles:edit"]']
  );
  await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)', [userId, roleId]);
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ($1,'role-customer-support'),($1,'role-crm-verification')",
    [target]
  );
  const headers = await session(userId);
  const catalogue = `${http.base}/api/admin/roles`,
    lookup = `${http.base}/api/admin/users/${target}/effective-permissions`;
  expect((await fetch(catalogue, { headers })).status).toBe(200);
  const effective = await fetch(lookup, { headers });
  expect(effective.status, await effective.clone().text()).toBe(200);
  const body = (await effective.json()) as {
    permissions: { permission: string }[];
    isWildcard: boolean;
  };
  const permissions = body.permissions.map((item) => item.permission);
  expect(body.isWildcard).toBe(false);
  expect(permissions).toContain('tickets:read');
  expect(permissions).toContain('crm:verify');
  expect(permissions.filter((item) => item === 'profiles:read')).toHaveLength(1);
  expect(permissions).not.toContain('payments:write');
  await http.pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [target]);
  expect(await (await fetch(lookup, { headers })).json()).toMatchObject({
    permissions: [],
    isWildcard: false,
  });
  await http.pool.query(
    'UPDATE staff_roles SET permissions=\'["staff:roles:view"]\' WHERE role_id=$1',
    [roleId]
  );
  for (const url of [catalogue, lookup]) {
    expect((await fetch(url, { headers })).status).toBe(403);
    expect((await fetch(url)).status).toBe(401);
  }
});

it('creates staff with named roles without granting platform administration, including staff without roles', async () => {
  for (const roles of [[], ['role-customer-support'], ['role-finance'], ['role-legal-contracts']]) {
    const response = await fetch(`${http.base}/api/admin/users/create-staff`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        username: `${randomUUID()}@example.test`,
        firstName: 'Test',
        lastName: 'Staff',
        roleIds: roles,
        activationMethod: 'tempPassword',
      }),
    });
    const body = (await response.json()) as { userId: string; temporaryPassword: string };
    expect(response.status, JSON.stringify(body) + http.logs()).toBe(201);
    expect(body.temporaryPassword).toBeTruthy();
    const hash = (
      await http.pool.query('SELECT password_hash FROM users WHERE user_id=$1', [body.userId])
    ).rows[0].password_hash;
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=37888,(?:t=3,p=1|p=1,t=3)\$/);
    expect(await argon2.verify(hash, body.temporaryPassword)).toBe(true);
    const user = (
      await http.pool.query(
        'SELECT is_admin,is_staff,must_change_password FROM users WHERE user_id=$1',
        [body.userId]
      )
    ).rows[0];
    expect(user).toEqual({ is_admin: false, is_staff: true, must_change_password: true });
    const staffHeaders = await session(body.userId);
    expect(
      (
        await fetch(`${http.base}/api/admin/config/profile-verification-mode`, {
          headers: staffHeaders,
        })
      ).status
    ).toBe(403);
    const effectiveResponse = await fetch(
      `${http.base}/api/admin/users/${body.userId}/effective-permissions`,
      { headers: adminHeaders }
    );
    expect(effectiveResponse.status).toBe(200);
    const effective = (await effectiveResponse.json()) as {
      roleIds: string[];
      isWildcard: boolean;
      permissions: { permission: string }[];
    };
    expect(effective.roleIds).toEqual(roles);
    expect(effective.isWildcard).toBe(false);
    expect(effective.permissions.map((permission) => permission.permission)).not.toContain('*');
    if (!roles.length) expect(effective.permissions).toEqual([]);
    const staffList = await fetch(`${http.base}/api/admin/staff`, { headers: adminHeaders });
    expect(staffList.status).toBe(200);
    expect(
      ((await staffList.json()) as { items: { userId: string }[] }).items.some(
        (item) => item.userId === body.userId
      )
    ).toBe(true);
  }
  const unknown = await fetch(`${http.base}/api/admin/users/create-staff`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      username: 'unknown-role@example.test',
      firstName: 'Test',
      lastName: 'Staff',
      roleIds: ['unknown-role'],
      activationMethod: 'tempPassword',
    }),
  });
  expect(unknown.status).toBe(400);
  expect(
    (await http.pool.query("SELECT * FROM users WHERE username='unknown-role@example.test'")).rows
  ).toEqual([]);
}, 20000);

it('replaces roles through HTTP, revokes old sessions, and rejects disabled accounts immediately', async () => {
  const userId = randomUUID();
  await http.pool.query(
    'INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,$3,true)',
    [userId, 'role-change@example.test', 'test-only']
  );
  const oldSession = await session(userId);
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NOW()+INTERVAL '1 hour' WHERE user_id='bootstrap'"
  );
  try {
    const denied = await fetch(`${http.base}/api/admin/users/${userId}/roles`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ roleIds: ['role-finance'] }),
    });
    expect(denied.status, await denied.clone().text()).toBe(403);
    expect(await denied.json()).toMatchObject({
      error: { code: 'AUTHZ:STEP_UP_REQUIRED' },
      requiresStepUp: true,
    });
    expect(
      (await http.pool.query('SELECT role_id FROM user_roles WHERE user_id=$1', [userId])).rows
    ).toEqual([]);
    expect((await fetch(`${http.base}/api/auth/sessions`, { headers: oldSession })).status).toBe(
      200
    );
  } finally {
    await http.pool.query(
      "UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='bootstrap'"
    );
  }
  const response = await fetch(`${http.base}/api/admin/users/${userId}/roles`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({
      roleIds: ['role-finance', 'role-finance'],
      reason: 'Integration test assignment',
    }),
  });
  expect(response.status, await response.text()).toBe(200);
  expect(
    (await http.pool.query('SELECT role_id FROM user_roles WHERE user_id=$1', [userId])).rows
  ).toEqual([{ role_id: 'role-finance' }]);
  expect((await fetch(`${http.base}/api/auth/sessions`, { headers: oldSession })).status).toBe(401);
  expect(
    (await http.pool.query('SELECT consumed_at FROM refresh_tokens WHERE user_id=$1', [userId]))
      .rows[0].consumed_at
  ).not.toBeNull();
  const newSession = await session(userId);
  const unchanged = await fetch(`${http.base}/api/admin/users/${userId}/roles`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({ roleIds: ['role-finance'] }),
  });
  expect(unchanged.status).toBe(200);
  expect((await fetch(`${http.base}/api/auth/sessions`, { headers: newSession })).status).toBe(200);
  const removed = await fetch(`${http.base}/api/admin/users/${userId}/roles`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({ roleIds: [] }),
  });
  expect(removed.status).toBe(200);
  expect((await fetch(`${http.base}/api/auth/sessions`, { headers: newSession })).status).toBe(401);
  const disabledSession = await session(userId);
  await http.pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [userId]);
  expect((await fetch(`${http.base}/api/auth/sessions`, { headers: disabledSession })).status).toBe(
    401
  );
  expect((await fetch(`${http.base}/api/admin/staff`, { headers: adminHeaders })).status).toBe(200);
});

it.each(['commit', 'audit-failure'])(
  'staff disablement keeps account, sessions and refresh credentials atomic on %s',
  async (mode) => {
    const userId = randomUUID();
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,'test-only',true)",
      [userId, `${userId}@example.test`]
    );
    const credentials = await Promise.all([session(userId), session(userId)]);
    if (mode === 'audit-failure') {
      await http.pool
        .query(`CREATE FUNCTION deny_staff_disable_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.event='staff_user_disabled' THEN RAISE EXCEPTION 'controlled disable audit failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER deny_staff_disable_audit BEFORE INSERT ON audit_log
        FOR EACH ROW EXECUTE FUNCTION deny_staff_disable_audit()`);
    }
    try {
      const response = await fetch(`${http.base}/api/admin/staff/${userId}/disable`, {
        method: 'POST',
        headers: adminHeaders,
        body: '{}',
      });
      const committed = mode === 'commit';
      expect(response.status, await response.clone().text()).toBe(committed ? 200 : 500);
      expect(
        (
          await http.pool.query(
            'SELECT disabled_at IS NOT NULL AS disabled FROM users WHERE user_id=$1',
            [userId]
          )
        ).rows[0].disabled
      ).toBe(committed);
      expect(
        (
          await http.pool.query(
            'SELECT revoked_at IS NOT NULL AS revoked FROM sessions WHERE user_id=$1',
            [userId]
          )
        ).rows
      ).toEqual([{ revoked: committed }, { revoked: committed }]);
      expect(
        (
          await http.pool.query(
            'SELECT consumed_at IS NOT NULL AS consumed FROM refresh_tokens WHERE user_id=$1',
            [userId]
          )
        ).rows
      ).toEqual([{ consumed: committed }, { consumed: committed }]);
      for (const headers of credentials)
        expect((await fetch(`${http.base}/api/auth/sessions`, { headers })).status).toBe(
          committed ? 401 : 200
        );
      expect(
        (
          await http.pool.query(
            "SELECT id FROM audit_log WHERE event='staff_user_disabled' AND user_id=$1",
            [userId]
          )
        ).rows
      ).toHaveLength(committed ? 1 : 0);
      expect(
        (await fetch(`${http.base}/api/auth/sessions`, { headers: adminHeaders })).status
      ).toBe(200);
      if (committed) {
        const repeated = await fetch(`${http.base}/api/admin/staff/${userId}/disable`, {
          method: 'POST',
          headers: adminHeaders,
          body: '{}',
        });
        expect(repeated.status).toBe(200);
        expect(await repeated.json()).toMatchObject({ alreadyDisabled: true });
        expect(
          (
            await http.pool.query(
              "SELECT id FROM audit_log WHERE event='staff_user_disabled' AND user_id=$1",
              [userId]
            )
          ).rows
        ).toHaveLength(1);
      }
    } finally {
      if (mode === 'audit-failure')
        await http.pool.query(
          'DROP TRIGGER deny_staff_disable_audit ON audit_log; DROP FUNCTION deny_staff_disable_audit()'
        );
    }
  }
);

it('enforces the role matrix through real staff, finance, CRM, legal and administration routes', async () => {
  const routes = [
    '/api/staff/tickets',
    '/api/crm/users',
    '/api/admin/wallet/bank-receipt-top-ups',
    '/api/admin/contract-templates',
    '/api/admin/roles',
  ];
  const matrix: [string | null, number[]][] = [
    [null, [403, 403, 403, 403, 403]],
    ['role-customer-support', [200, 403, 403, 403, 403]],
    ['role-crm-verification', [403, 200, 403, 403, 403]],
    ['role-finance', [403, 403, 200, 403, 403]],
    ['role-legal-contracts', [403, 403, 403, 200, 403]],
    ['role-admin', [200, 200, 200, 200, 200]],
  ];
  for (const [role, expected] of matrix) {
    const userId = randomUUID();
    await http.pool.query(
      'INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,$3,true)',
      [userId, `${userId}@example.test`, 'test-only']
    );
    if (role)
      await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)', [
        userId,
        role,
      ]);
    const headers = await session(userId);
    for (const [index, route] of routes.entries()) {
      const response = await fetch(`${http.base}${route}`, { headers });
      expect(response.status, `${role} ${route}: ${await response.text()}\n${http.logs()}`).toBe(
        expected[index]
      );
    }
    if (role !== 'role-admin') {
      const escalated = await fetch(`${http.base}/api/admin/users/create-staff`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          username: `${randomUUID()}@example.test`,
          firstName: 'Blocked',
          lastName: 'Escalation',
          roleIds: ['role-admin'],
          activationMethod: 'tempPassword',
        }),
      });
      expect(escalated.status).toBe(403);
    } else {
      const response = await fetch(`${http.base}/api/admin/users/${userId}/effective-permissions`, {
        headers,
      });
      expect(await response.json()).toMatchObject({ isAdmin: false, isWildcard: true });
    }
  }
  const review = await http.pool.query(
    readFileSync(resolve(__dirname, '../../../../audit/staff-administrator-review.sql'), 'utf8')
  );
  expect(review.rows.map((row) => row.user_id)).toEqual(['bootstrap']);
});

it('reads permission changes on the next request without trusting a cached session grant', async () => {
  const userId = randomUUID(),
    roleId = 'test-custom-support';
  await http.pool.query(
    'INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ($1,$2,$3,$4)',
    [roleId, 'Test custom support', 'Test fixture', '["tickets:read"]']
  );
  await http.pool.query(
    'INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,$3,true)',
    [userId, `${userId}@example.test`, 'test-only']
  );
  await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)', [userId, roleId]);
  const headers = await session(userId);
  expect((await fetch(`${http.base}/api/staff/tickets`, { headers })).status).toBe(200);
  await http.pool.query("UPDATE staff_roles SET permissions='[]' WHERE role_id=$1", [roleId]);
  expect((await fetch(`${http.base}/api/staff/tickets`, { headers })).status).toBe(403);
  await http.pool.query("UPDATE staff_roles SET permissions='invalid JSON' WHERE role_id=$1", [
    roleId,
  ]);
  expect((await fetch(`${http.base}/api/staff/tickets`, { headers })).status).toBe(403);
});

it('reports current staff management capabilities without trusting cached session roles', async () => {
  expect((await fetch(`${http.base}/api/admin/staff-access`)).status).toBe(401);
  const admin = await fetch(`${http.base}/api/admin/staff-access`, { headers: adminHeaders });
  expect(await admin.json()).toEqual({
    userId: 'bootstrap',
    canView: true,
    canCreate: true,
    canEditRoles: true,
    canDisable: true,
  });
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ('capability-reader','capability-reader@example.test','test-only',true)"
  );
  const headers = await session('capability-reader');
  const read = async () => (await fetch(`${http.base}/api/admin/staff-access`, { headers })).json();
  const denied = {
    userId: 'capability-reader',
    canView: false,
    canCreate: false,
    canEditRoles: false,
    canDisable: false,
  };
  expect(await read()).toEqual(denied);
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('capability-reader','role-admin')"
  );
  expect(await read()).toEqual({
    ...denied,
    canView: true,
    canCreate: true,
    canEditRoles: true,
    canDisable: true,
  });
  await http.pool.query("DELETE FROM user_roles WHERE user_id='capability-reader'");
  expect(await read()).toEqual(denied);
});

it('does not expose temporary credentials on staff readback and rejects secondary identifier collisions', async () => {
  await http.pool.query(
    "INSERT INTO users(user_id,username,email,password_hash) VALUES ('alias-owner','alias-owner@example.test','reserved-staff@example.test','test-only')"
  );
  await http.pool.query(
    "INSERT INTO account_login_identifiers(destination,user_id,kind,verified_at) VALUES ('reserved-staff@example.test','alias-owner','email',NOW())"
  );
  const response = await fetch(`${http.base}/api/admin/users/create-staff`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      username: 'reserved-staff@example.test',
      firstName: 'Test',
      lastName: 'Staff',
      activationMethod: 'tempPassword',
    }),
  });
  expect(response.status).toBe(409);
  const list = await (
    await fetch(`${http.base}/api/admin/staff`, { headers: adminHeaders })
  ).json();
  expect(JSON.stringify(list)).not.toMatch(/temporaryPassword|password_hash|activation_token/);
});
