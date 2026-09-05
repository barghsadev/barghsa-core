import { afterAll, beforeAll, expect, it } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { startHttpFixture } from '../test/http-fixture.js'

let http: Awaited<ReturnType<typeof startHttpFixture>>
let headers: Record<string, string>

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run')
  http = await startHttpFixture(process.env.TEST_DATABASE_URL)
  await http.pool.query("INSERT INTO users(user_id,username,email,password_hash) VALUES ('otp-user','otp-old@example.test','otp-old@example.test','test-only')")
  const sessionId = randomUUID(), token = randomUUID()
  await http.pool.query(`INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES ($1,'otp-user',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`, [sessionId, token, randomUUID()])
  headers = { Cookie: `barghsa_session=${sessionId}`, 'X-CSRF-Token': token, 'Content-Type': 'application/json' }
}, 40000)

afterAll(async () => { await http?.close() }, 15000)

async function challenge(destination: string) {
  const id = randomUUID()
  // Tests transaction behavior independently of provider delivery.
  await http.pool.query(`INSERT INTO otp_challenges(challenge_id,destination,otp_hash,expires_at)
    VALUES ($1,$2,$3,NOW()+INTERVAL '5 minutes')`, [id, destination, createHash('sha256').update('123456').digest('hex')])
  return id
}

async function post(path: string, body: unknown) {
  return fetch(`${http.base}/api/auth/${path}`, {
    method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
  })
}

it('consumes username OTP in the account transaction and persists failed attempts without hanging', async () => {
  const id = await challenge('otp-new@example.test')
  const body = { newUsername: 'otp-new@example.test', otpChallengeId: id, otp: '123456' }
  expect((await post('change-username', { ...body, otp: '654321' })).status).toBe(401)
  expect((await http.pool.query('SELECT attempts_remaining,consumed_at FROM otp_challenges WHERE challenge_id=$1', [id])).rows[0])
    .toEqual({ attempts_remaining: 4, consumed_at: null })
  await http.pool.query(`CREATE FUNCTION reject_test_username() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.username='otp-new@example.test' THEN RAISE EXCEPTION 'Injected account write failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_test_username BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION reject_test_username();`)
  expect((await post('change-username', body)).status).toBe(500)
  expect((await http.pool.query('SELECT consumed_at FROM otp_challenges WHERE challenge_id=$1', [id])).rows[0].consumed_at).toBeNull()
  await http.pool.query('DROP TRIGGER reject_test_username ON users')
  const completed = await post('change-username', body)
  expect(completed.status, await completed.text() + http.logs()).toBe(200)
  expect((await http.pool.query("SELECT username FROM users WHERE user_id='otp-user'")).rows[0].username).toBe(body.newUsername)
  expect((await http.pool.query('SELECT consumed_at FROM otp_challenges WHERE challenge_id=$1', [id])).rows[0].consumed_at).not.toBeNull()
  expect((await post('change-username', body)).status).toBe(409)
  expect((await http.pool.query("SELECT count(*)::int AS count FROM audit_log WHERE event='username_changed'")).rows[0].count).toBe(1)
}, 15000)

it('allows exactly one concurrent contact verification and rejects reuse', async () => {
  const id = await challenge('+989121234567')
  const body = { contactType: 'mobile', contactValue: '+989121234567', otpChallengeId: id, otp: '123456' }
  const results = await Promise.all([post('add-contact', body), post('add-contact', body)])
  expect(results.map(result => result.status).sort()).toEqual([200, 409])
  expect((await http.pool.query("SELECT mobile FROM users WHERE user_id='otp-user'")).rows[0].mobile).toBe(body.contactValue)
  expect((await http.pool.query("SELECT count(*)::int AS count FROM audit_log WHERE event='contact_added'")).rows[0].count).toBe(1)
}, 10000)

it('does not overwrite or resend a challenge consumed while its update waits', async () => {
  const id = await challenge('resend-race@example.test')
  const client = await http.pool.connect()
  let resend: Promise<Response> | undefined
  try {
    await client.query('BEGIN')
    await client.query('SELECT challenge_id FROM otp_challenges WHERE challenge_id=$1 FOR UPDATE', [id])
    resend = post('register/resend', { challengeId: id })
    await expect.poll(async () => (await http.pool.query(`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%UPDATE otp_challenges%'`)).rows[0].count).toBe(1)
    await client.query('UPDATE otp_challenges SET consumed_at=NOW(),attempts_remaining=0 WHERE challenge_id=$1', [id])
    await client.query('COMMIT')
    const response = await resend
    expect(response.status, await response.text()).toBe(409)
    expect((await http.pool.query('SELECT otp_hash,resend_count FROM otp_challenges WHERE challenge_id=$1', [id])).rows[0])
      .toEqual({ otp_hash: createHash('sha256').update('123456').digest('hex'), resend_count: 0 })
  } finally {
    await client.query('ROLLBACK')
    client.release()
    await resend
  }
}, 10000)
