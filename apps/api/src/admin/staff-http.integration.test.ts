import { afterAll, beforeAll, expect, it } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { startHttpFixture } from '../test/http-fixture.js'

let http: Awaited<ReturnType<typeof startHttpFixture>>
let adminHeaders: Record<string, string>

async function session(userId: string) {
  const sessionId = randomUUID(), token = randomUUID(), refresh = randomUUID(), family = randomUUID()
  await http.pool.query(`INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`, [sessionId,userId,token,family])
  await http.pool.query('INSERT INTO refresh_tokens(id,family_id,token_hash,user_id,session_id) VALUES ($1,$2,$3,$4,$5)',
    [randomUUID(), family, createHash('sha256').update(refresh).digest('hex'), userId, sessionId])
  return { Cookie: `barghsa_session=${sessionId}; barghsa_refresh=${refresh}`, 'X-CSRF-Token': token, 'Content-Type': 'application/json' }
}

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run')
  http = await startHttpFixture(process.env.TEST_DATABASE_URL)
  await http.pool.query("INSERT INTO users(user_id,username,password_hash,is_admin) VALUES ('bootstrap','admin@example.test','test-only',true)")
  adminHeaders = await session('bootstrap')
}, 40000)

afterAll(async () => { await http?.close() }, 15000)

it('creates staff with named roles without granting platform administration, including staff without roles', async () => {
  for (const roles of [[], ['role-customer-support'], ['role-finance'], ['role-legal-contracts']]) {
    const response = await fetch(`${http.base}/api/admin/users/create-staff`, {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ username: `${randomUUID()}@example.test`, firstName: 'Test', lastName: 'Staff', roleIds: roles, activationMethod: 'tempPassword' }),
    })
    const body = await response.json() as { userId: string; temporaryPassword: string }
    expect(response.status, JSON.stringify(body) + http.logs()).toBe(201)
    expect(body.temporaryPassword).toBeTruthy()
    const user = (await http.pool.query('SELECT is_admin,is_staff,must_change_password FROM users WHERE user_id=$1', [body.userId])).rows[0]
    expect(user).toEqual({ is_admin: false, is_staff: true, must_change_password: true })
    const staffHeaders = await session(body.userId)
    expect((await fetch(`${http.base}/api/admin/config/profile-verification-mode`, { headers: staffHeaders })).status).toBe(403)
    const effectiveResponse = await fetch(`${http.base}/api/admin/users/${body.userId}/effective-permissions`, { headers: adminHeaders })
    expect(effectiveResponse.status).toBe(200)
    const effective = await effectiveResponse.json() as { roleIds: string[]; isWildcard: boolean; permissions: { permission: string }[] }
    expect(effective.roleIds).toEqual(roles)
    expect(effective.isWildcard).toBe(false)
    expect(effective.permissions.map((permission) => permission.permission)).not.toContain('*')
    if (!roles.length) expect(effective.permissions).toEqual([])
    const staffList = await fetch(`${http.base}/api/admin/staff`, { headers: adminHeaders })
    expect(staffList.status).toBe(200)
    expect((await staffList.json() as { items: { userId: string }[] }).items.some((item) => item.userId === body.userId)).toBe(true)
  }
  const unknown = await fetch(`${http.base}/api/admin/users/create-staff`, {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({ username: 'unknown-role@example.test', firstName: 'Test', lastName: 'Staff', roleIds: ['unknown-role'], activationMethod: 'tempPassword' }),
  })
  expect(unknown.status).toBe(400)
  expect((await http.pool.query("SELECT * FROM users WHERE username='unknown-role@example.test'")).rows).toEqual([])
}, 20000)

it('replaces roles through HTTP, revokes old sessions, and rejects disabled accounts immediately', async () => {
  const userId = randomUUID()
  await http.pool.query('INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,$3,true)', [userId,'role-change@example.test','test-only'])
  const oldSession = await session(userId)
  const response = await fetch(`${http.base}/api/admin/users/${userId}/roles`, {
    method: 'PUT', headers: adminHeaders,
    body: JSON.stringify({ roleIds: ['role-finance','role-finance'], reason: 'Integration test assignment' }),
  })
  expect(response.status, await response.text()).toBe(200)
  expect((await http.pool.query('SELECT role_id FROM user_roles WHERE user_id=$1', [userId])).rows).toEqual([{ role_id: 'role-finance' }])
  expect((await fetch(`${http.base}/api/auth/sessions`, { headers: oldSession })).status).toBe(401)
  expect((await http.pool.query('SELECT consumed_at FROM refresh_tokens WHERE user_id=$1', [userId])).rows[0].consumed_at).not.toBeNull()
  const newSession = await session(userId)
  const unchanged = await fetch(`${http.base}/api/admin/users/${userId}/roles`, {
    method: 'PUT', headers: adminHeaders, body: JSON.stringify({ roleIds: ['role-finance'] }),
  })
  expect(unchanged.status).toBe(200)
  expect((await fetch(`${http.base}/api/auth/sessions`, { headers: newSession })).status).toBe(200)
  const removed = await fetch(`${http.base}/api/admin/users/${userId}/roles`, {
    method: 'PUT', headers: adminHeaders, body: JSON.stringify({ roleIds: [] }),
  })
  expect(removed.status).toBe(200)
  expect((await fetch(`${http.base}/api/auth/sessions`, { headers: newSession })).status).toBe(401)
  const disabledSession = await session(userId)
  await http.pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [userId])
  expect((await fetch(`${http.base}/api/auth/sessions`, { headers: disabledSession })).status).toBe(401)
  expect((await fetch(`${http.base}/api/admin/staff`, { headers: adminHeaders })).status).toBe(200)
})

it('enforces the role matrix through real staff, finance, CRM, legal and administration routes', async () => {
  const routes = ['/api/staff/tickets', '/api/crm/users', '/api/admin/wallet/bank-receipt-top-ups', '/api/admin/contract-templates', '/api/admin/roles']
  const matrix: [string | null, number[]][] = [
    [null, [403,403,403,403,403]],
    ['role-customer-support', [200,403,403,403,403]],
    ['role-crm-verification', [403,200,403,403,403]],
    ['role-finance', [403,403,200,403,403]],
    ['role-legal-contracts', [403,403,403,200,403]],
    ['role-admin', [200,200,200,200,200]],
  ]
  for (const [role, expected] of matrix) {
    const userId = randomUUID()
    await http.pool.query('INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,$3,true)', [userId,`${userId}@example.test`,'test-only'])
    if (role) await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)', [userId,role])
    const headers = await session(userId)
    for (const [index, route] of routes.entries()) {
      const response = await fetch(`${http.base}${route}`, { headers })
      expect(response.status, `${role} ${route}: ${await response.text()}\n${http.logs()}`).toBe(expected[index])
    }
    if (role !== 'role-admin') {
      const escalated = await fetch(`${http.base}/api/admin/users/create-staff`, {
        method: 'POST', headers,
        body: JSON.stringify({ username: `${randomUUID()}@example.test`, firstName: 'Blocked', lastName: 'Escalation', roleIds: ['role-admin'], activationMethod: 'tempPassword' }),
      })
      expect(escalated.status).toBe(403)
    } else {
      const response = await fetch(`${http.base}/api/admin/users/${userId}/effective-permissions`, { headers })
      expect(await response.json()).toMatchObject({ isAdmin: false, isWildcard: true })
    }
  }
  const review = await http.pool.query(readFileSync(resolve(__dirname, '../../../../audit/staff-administrator-review.sql'), 'utf8'))
  expect(review.rows.map((row) => row.user_id)).toEqual(['bootstrap'])
})

it('reads permission changes on the next request without trusting a cached session grant', async () => {
  const userId = randomUUID(), roleId = 'test-custom-support'
  await http.pool.query('INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ($1,$2,$3,$4)',
    [roleId,'Test custom support','Test fixture','["tickets:read"]'])
  await http.pool.query('INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,$3,true)', [userId,`${userId}@example.test`,'test-only'])
  await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)', [userId,roleId])
  const headers = await session(userId)
  expect((await fetch(`${http.base}/api/staff/tickets`, { headers })).status).toBe(200)
  await http.pool.query("UPDATE staff_roles SET permissions='[]' WHERE role_id=$1", [roleId])
  expect((await fetch(`${http.base}/api/staff/tickets`, { headers })).status).toBe(403)
  await http.pool.query("UPDATE staff_roles SET permissions='invalid JSON' WHERE role_id=$1", [roleId])
  expect((await fetch(`${http.base}/api/staff/tickets`, { headers })).status).toBe(403)
})
