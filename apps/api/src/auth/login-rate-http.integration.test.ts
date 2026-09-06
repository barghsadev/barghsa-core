import { afterEach, beforeEach, expect, it } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import * as argon2 from 'argon2'
import { startHttpFixture } from '../test/http-fixture.js'

let http: Awaited<ReturnType<typeof startHttpFixture>>
const password = 'Local-login-fixture-123!'
const username = 'login-limit@example.test'
const deviceToken = 'a'.repeat(64)
const failureKey = (name: string) => 'login:failures:' + createHash('sha256')
  .update(JSON.stringify([name, '127.0.0.1'])).digest('hex')

beforeEach(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run')
  http = await startHttpFixture(process.env.TEST_DATABASE_URL)
  await http.pool.query(`INSERT INTO users(user_id,username,password_hash)
    VALUES ('login-limit-user',$1,$2)`, [username, await argon2.hash(password)])
  await http.pool.query(`INSERT INTO device_trusts(id,user_id,device_fingerprint,expires_at)
    VALUES (gen_random_uuid(),'login-limit-user',$1,NOW()+INTERVAL '1 day')`,
    [createHash('sha256').update(deviceToken).digest('hex')])
}, 40000)
afterEach(async () => { await http?.close() }, 15000)

async function login(name = username, secret = 'wrong-password') {
  return fetch(`${http.base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `barghsa_device=${deviceToken}` },
    body: JSON.stringify({ username: name, password: secret, deviceInfo: { fingerprint: 'known-device' } }),
    signal: AbortSignal.timeout(12000),
  })
}
async function count(key: string) {
  return Number((await http.pool.query('SELECT COALESCE(SUM(count),0) AS count FROM security_rate_limit_counters WHERE key=$1', [key])).rows[0].count)
}

it('delays the sixth credential failure, isolates normalized accounts, and preserves the IP limit on success', async () => {
  for (let index = 0; index < 5; index++) expect((await login()).status).toBe(401)
  expect(await count(failureKey(username))).toBe(5)
  const started = performance.now()
  expect((await login('  LOGIN-LIMIT@EXAMPLE.TEST  ')).status).toBe(401)
  expect(performance.now() - started).toBeGreaterThanOrEqual(480)
  expect(await count(failureKey(username))).toBe(6)
  expect((await login('other-account@example.test')).status).toBe(401)
  expect(await count(failureKey('other-account@example.test'))).toBe(1)
  expect(await count(failureKey(username))).toBe(6)
  const successful = await login(username, password)
  expect(successful.status, await successful.clone().text() + http.logs()).toBe(200)
  expect(((await successful.json()) as { requiresOtp: boolean }).requiresOtp).toBe(false)
  expect(await count(failureKey(username))).toBe(0)
  expect(await count('login:ip:127.0.0.1')).toBe(8)
}, 20000)

it('atomically counts concurrent failures and expires the account delay window', async () => {
  const responses = await Promise.all(Array.from({ length: 6 }, () => login()))
  expect(responses.map(response => response.status)).toEqual(Array(6).fill(401))
  expect(await count(failureKey(username))).toBe(6)
  await http.pool.query('UPDATE security_rate_limit_counters SET window_start=window_start-1800000 WHERE key=$1', [failureKey(username)])
  expect((await login()).status).toBe(401)
  const current = await http.pool.query('SELECT count FROM security_rate_limit_counters WHERE key=$1 ORDER BY window_start DESC LIMIT 1', [failureKey(username)])
  expect(Number(current.rows[0].count)).toBe(1)
}, 20000)

it('limits broad password spraying in PostgreSQL and returns Retry-After without counting a credential failure', async () => {
  const windowStart = Math.floor(Date.now() / 900000) * 900000
  await http.pool.query(`INSERT INTO security_rate_limit_counters(key,window_start,window_ms,count)
    VALUES ('login:ip:127.0.0.1',$1,900000,50)`, [windowStart])
  const response = await login(`spray-${randomUUID()}@example.test`)
  expect(response.status).toBe(429)
  expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0)
  const body = await response.json() as { error: { retryAfterSeconds: number; message: string } }
  expect(body.error.retryAfterSeconds).toBe(Number(response.headers.get('retry-after')))
  expect(body.error.message).toContain('seconds')
  expect(body.error.message).not.toContain('{seconds}')
  expect((await http.pool.query("SELECT count(*)::int AS count FROM security_rate_limit_counters WHERE key LIKE 'login:failures:%'")).rows[0].count).toBe(0)
})

it('preserves service-level OTP retry timing and localizes it for Persian clients', async () => {
  await http.pool.query(`INSERT INTO security_rate_limit_counters(key,window_start,window_ms,count)
    VALUES ($1,$2,60000,1)`, [`otp:dest:${username}:60s`, Math.floor(Date.now() / 60000) * 60000])
  const response = await fetch(`${http.base}/api/auth/forgot-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept-Language': 'fa' },
    body: JSON.stringify({ username }),
  })
  expect(response.status).toBe(429)
  const body = await response.json() as { error: { retryAfterSeconds: number; message: string } }
  expect(body.error.retryAfterSeconds).toBe(Number(response.headers.get('retry-after')))
  expect(body.error.retryAfterSeconds).toBeGreaterThan(0)
  expect(body.error.message).toContain('ثانیه')
  expect(body.error.message).not.toContain('{seconds}')
})

it('enforces destination starts and device spraying independently of the IP counter', async () => {
  const hourly = Math.floor(Date.now()/3600000)*3600000
  const destination = createHash('sha256').update(username).digest('hex')
  await http.pool.query(`INSERT INTO security_rate_limit_counters(key,window_start,window_ms,count)
    VALUES ($1,$3,3600000,5),($2,$3,3600000,10)`,
    [`password-reset:destination:${destination}`,`registration:destination:${destination}`,hourly])
  for (const [route,body] of [
    ['forgot-password',{username}],
    ['register',{username,password,tosVersionId:'unpublished-test-terms'}],
  ] as const) {
    const response=await fetch(`${http.base}/api/auth/${route}`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
    })
    expect(response.status,await response.clone().text()).toBe(429)
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0)
  }
  expect((await http.pool.query('SELECT count(*)::int AS count FROM otp_challenges')).rows[0].count).toBe(0)
  await http.pool.query(`INSERT INTO security_rate_limit_counters(key,window_start,window_ms,count)
    VALUES ($1,$2,900000,50)`, ['login:device:'+createHash('sha256').update(deviceToken).digest('hex'),Math.floor(Date.now()/900000)*900000])
  expect((await login()).status).toBe(429)
  expect(await count('login:ip:127.0.0.1')).toBe(1)
  expect(await count(failureKey(username))).toBe(0)
})
