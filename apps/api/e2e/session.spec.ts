import { test as baseTest, expect } from '@playwright/test'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as argon2 from 'argon2'
import ts from 'typescript'
import { startHttpFixture } from '../src/test/http-fixture'

const test = baseTest.extend<{ http: Awaited<ReturnType<typeof startHttpFixture>> }>({
  http: async ({}, use) => {
    const container = await new PostgreSqlContainer('postgres:17-alpine').start()
    try {
      const http = await startHttpFixture(container.getConnectionUri())
      try { await use(http) } finally { await http.close() }
    } finally { await container.stop() }
  },
})

test('browser cookies enforce CSRF across login, refresh, step-up, another tab, and logout', async ({ page, context, http }) => {
  const password = 'Browser-test-only-password-123!'
  const fingerprint = 'browser-test-device'
  await http.pool.query('INSERT INTO users(user_id,username,password_hash) VALUES ($1,$2,$3)',
    ['browser-user', 'browser@example.test', await argon2.hash(password)])
  await http.pool.query("INSERT INTO device_trusts(id,user_id,device_fingerprint,expires_at) VALUES ($1,$2,$3,NOW()+INTERVAL '1 day')",
    [randomUUID(), 'browser-user', createHash('sha256').update(fingerprint).digest('hex')])

  // Use the API's real origin and the web application's actual header helper.
  // No API response, cookie, authentication guard, or database is mocked.
  await page.goto(`${http.base}/api/docs`)
  const helper = ts.transpile(readFileSync(resolve(__dirname, '../../web/src/lib/csrf.ts'), 'utf8'),
    { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }).replace(/^export /gm, '')
  await page.addScriptTag({ content: helper })
  const loginBody = { username: 'browser@example.test', password, deviceInfo: { fingerprint } }
  const login = await page.evaluate(async (body) => {
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { status: res.status, body: await res.json() }
  }, loginBody)
  expect(login.status, JSON.stringify(login.body) + http.logs()).toBe(200)
  expect(login.body.requiresOtp).toBe(false)
  const cookies = await context.cookies()
  expect(cookies.find((cookie) => cookie.name === 'barghsa_session')?.httpOnly).toBe(true)
  expect(cookies.find((cookie) => cookie.name === 'barghsa_refresh')?.path).toBe('/api/auth/refresh')
  const csrfCookie = cookies.find((cookie) => cookie.name === 'barghsa_csrf')!
  expect(csrfCookie.httpOnly).toBe(false)
  expect(csrfCookie.expires - Date.now() / 1000).toBeGreaterThan(86000)
  expect(await page.evaluate(() => document.cookie)).not.toContain('barghsa_session=')

  const statuses = await page.evaluate(async ({ password, csrfToken }) => {
    const result: number[] = []
    result.push((await fetch('/api/auth/sessions')).status)
    for (const path of ['/api/auth/step-up', '/api/auth/refresh', '/api/auth/logout']) {
      result.push((await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })).status)
      result.push((await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'wrong' }, body: JSON.stringify({ password }) })).status)
    }
    result.push((await fetch('/api/auth/step-up', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ password }) })).status)
    result.push((await fetch('/api/auth/refresh', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } })).status)
    return result
  }, { password, csrfToken: login.body.csrfToken })
  expect(statuses).toEqual([200, 403, 403, 403, 403, 403, 403, 200, 200])

  const otherTab = await context.newPage()
  await otherTab.goto(`${http.base}/api/docs`)
  const nextLogin = await otherTab.evaluate(async (body) => {
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return res.json()
  }, loginBody)
  expect(nextLogin.csrfToken).not.toBe(login.body.csrfToken)
  const afterChange = await page.evaluate(async ({ password, oldToken }) => {
    // withCsrf is loaded from the production client module above.
    const withCsrf = (globalThis as unknown as { withCsrf: (headers?: HeadersInit) => Headers }).withCsrf
    const stale = await fetch('/api/auth/step-up', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': oldToken }, body: JSON.stringify({ password }) })
    const valid = await fetch('/api/auth/step-up', { method: 'POST', headers: withCsrf({ 'Content-Type': 'application/json' }), body: JSON.stringify({ password }) })
    const logout = await fetch('/api/auth/logout', { method: 'POST', headers: withCsrf() })
    const loggedOut = await fetch('/api/auth/sessions')
    return [stale.status, valid.status, logout.status, loggedOut.status, withCsrf().has('X-CSRF-Token')]
  }, { password, oldToken: login.body.csrfToken })
  expect(afterChange).toEqual([403, 200, 200, 401, false])
})
