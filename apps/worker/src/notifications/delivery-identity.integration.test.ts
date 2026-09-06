import { afterAll, beforeAll, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { InAppNotificationTransport } from './in-app-transport.js'
import { runOutboxPoll } from './outbox-runner.js'
import { enqueueOutbox } from './outbox-writer.js'
import { dispatchOutbox, type OutboxRow } from './outbox-reader.js'

const name = `test_delivery_${randomUUID().replaceAll('-', '')}`
const folder = resolve(__dirname, '../../../../packages/db/drizzle/production')
let management: Pool, pool: Pool, profileId: string
const proven = randomUUID(), ambiguous = randomUUID(), untouched = randomUUID(), inbox = randomUUID()

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run')
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await management.query(`CREATE DATABASE "${name}"`)
  const url = new URL(process.env.TEST_DATABASE_URL); url.pathname = `/${name}`
  pool = new Pool({ connectionString: url.toString(), max: 5 })
  const journal = JSON.parse(readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] }
  for (const entry of journal.entries) {
    if (entry.tag === '0092_notification_delivery_identity') break
    await pool.query(readFileSync(resolve(folder, `${entry.tag}.sql`), 'utf8'))
  }
  await pool.query("INSERT INTO users(user_id,username,password_hash) VALUES ('delivery-owner','delivery@example.test','test-only')")
  profileId = (await pool.query("INSERT INTO profiles(user_id) VALUES ('delivery-owner') RETURNING id")).rows[0].id
  for (const [id, attempts] of [[proven, 1], [ambiguous, 1], [untouched, 0]] as const) {
    await pool.query(`INSERT INTO notification_outbox(id,profile_id,event_key,payload,channels,idempotency_key,attempts,status)
      VALUES ($1::uuid,$2,'wallet.topup_completed','{}',ARRAY['in_app','email'],$1::text,$3,'queued')`, [id, profileId, attempts])
    await pool.query("INSERT INTO notification_job(outbox_id,channel) VALUES ($1,'in_app'),($1,'email')", [id])
  }
  await pool.query(`INSERT INTO in_app_notifications(id,profile_id,type,title_i18n_key,body_i18n_key,is_read,read_at)
    VALUES ($1::uuid,$2,'wallet.topup_completed','title','body',true,NOW())`, [inbox, profileId])
  await pool.query(`INSERT INTO notification_delivery_log(notification_id,channel,status,attempt_number,provider_ref)
    VALUES ($1,'in_app','delivered',1,$2)`, [proven, inbox])
  await pool.query(readFileSync(resolve(folder, '0092_notification_delivery_identity.sql'), 'utf8'))
}, 30000)
afterAll(async () => {
  await pool?.end()
  if (management) { await management.query(`DROP DATABASE IF EXISTS "${name}"`); await management.end() }
})

function row(id: string, version = 2): OutboxRow {
  return { id, profileId, userId: 'delivery-owner', eventKey: 'wallet.topup_completed', payload: { amount: '5000' },
    channels: ['in_app', 'email'], idempotencyKey: `event:${id}`, idempotencyVersion: version,
    attempts: 0, maxAttempts: 5, scheduledAt: null, lastError: null }
}

it('preserves proven legacy delivery and read state while holding ambiguous retries', async () => {
  const transport = new InAppNotificationTransport(pool)
  const outcomes = await dispatchOutbox(row(proven, 1), { in_app: transport })
  expect(outcomes[0]?.result).toEqual({ status: 'delivered', providerRef: inbox })
  expect((await pool.query('SELECT is_read,delivery_key FROM in_app_notifications WHERE id=$1', [inbox])).rows[0])
    .toEqual({ is_read: true, delivery_key: `outbox:${proven}` })
  const states = (await pool.query('SELECT id,status,last_error,idempotency_version FROM notification_outbox WHERE id=ANY($1::uuid[])', [[proven, ambiguous, untouched]])).rows
  expect(states.find(r => r.id === proven)).toMatchObject({ status: 'queued', idempotency_version: 1 })
  expect(states.find(r => r.id === ambiguous)).toMatchObject({ status: 'failed', last_error: 'legacy_delivery_requires_reconciliation', idempotency_version: 1 })
  expect(states.find(r => r.id === untouched)).toMatchObject({ status: 'queued', idempotency_version: 2 })
})

it('retries one top-up without duplicate inbox rows and gives a second top-up a distinct provider key', async () => {
  const first = row(randomUUID()), second = row(randomUUID())
  const transport = new InAppNotificationTransport(pool)
  const emailKeys: string[] = []
  const email = { channel: 'email' as const, async send(payload: { idempotencyKey: string }) {
    emailKeys.push(payload.idempotencyKey)
    if (emailKeys.length < 3) throw new Error('provider timeout')
    return { status: 'delivered' as const, providerRef: 'accepted-message' }
  } }
  const references = []
  for (let attempt = 0; attempt < 3; attempt++) {
    const outcomes = await dispatchOutbox(first, { in_app: transport, email })
    references.push(outcomes[0]?.result.providerRef)
    expect(outcomes[1]?.result.status).toBe(attempt < 2 ? 'failed' : 'delivered')
  }
  await dispatchOutbox(second, { in_app: transport, email })
  expect(new Set(references).size).toBe(1)
  expect(new Set(emailKeys.slice(0, 3)).size).toBe(1)
  expect(emailKeys[3]).not.toBe(emailKeys[0])
  expect((await pool.query('SELECT count(*)::int AS count FROM in_app_notifications WHERE delivery_key=ANY($1::text[])', [[`outbox:${first.id}`, `outbox:${second.id}`]])).rows[0].count).toBe(2)
})

it('concurrent retries insert once and cannot reset read state or overwrite the payload', async () => {
  const id = randomUUID(), transport = new InAppNotificationTransport(pool)
  const outcomes = await Promise.all(Array.from({ length: 8 }, () => dispatchOutbox({ ...row(id), channels: ['in_app'] }, { in_app: transport })))
  const ids = outcomes.map(result => result[0]?.result.providerRef)
  expect(new Set(ids).size).toBe(1)
  await pool.query('UPDATE in_app_notifications SET is_read=true,read_at=NOW() WHERE id=$1', [ids[0]])
  await dispatchOutbox({ ...row(id), channels: ['in_app'], payload: { amount: 'changed' } }, { in_app: transport })
  expect((await pool.query('SELECT is_read,params FROM in_app_notifications WHERE id=$1', [ids[0]])).rows[0])
    .toEqual({ is_read: true, params: { amount: '5000' } })
})

it('enqueues two occurrences while a repeated business key inserts no second job set', async () => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const input = { profileId, eventKey: 'wallet.topup_completed', channels: ['in_app', 'email'] as const }
    const first = await enqueueOutbox(client, { ...input, channels: [...input.channels], idempotencyKey: 'topup:first' })
    const duplicate = await enqueueOutbox(client, { ...input, channels: [...input.channels], idempotencyKey: 'topup:first' })
    const second = await enqueueOutbox(client, { ...input, channels: [...input.channels], idempotencyKey: 'topup:second' })
    expect(first.inserted).toBe(true)
    expect(duplicate.inserted).toBe(false)
    expect(second.inserted).toBe(true)
    const saved = await client.query('SELECT id,idempotency_version FROM notification_outbox WHERE id=ANY($1::uuid[])', [[first.outboxId, second.outboxId]])
    expect(saved.rows).toHaveLength(2)
    expect(saved.rows.every(r => r.idempotency_version === 2)).toBe(true)
    expect((await client.query('SELECT count(*)::int AS count FROM notification_job WHERE outbox_id=ANY($1::uuid[])', [[first.outboxId, second.outboxId]])).rows[0].count).toBe(4)
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
})

it('the real runner reuses delivered channel outcomes after an email failure', async () => {
  await pool.query("UPDATE notification_outbox SET status='cancelled' WHERE status IN ('queued','scheduled','sending')")
  const client = await pool.connect()
  let id: string | null
  try {
    await client.query('BEGIN')
    id = (await enqueueOutbox(client, { profileId, eventKey: 'wallet.topup_completed', channels: ['in_app', 'email'], idempotencyKey: 'runner:retry' })).outboxId
    await client.query('COMMIT')
  } finally { client.release() }
  let inAppCalls = 0, emailCalls = 0
  const inApp = new InAppNotificationTransport(pool)
  const transports = {
    in_app: { channel: 'in_app' as const, async send(payload: Parameters<InAppNotificationTransport['send']>[0]) { inAppCalls++; return inApp.send(payload) } },
    email: { channel: 'email' as const, async send() { emailCalls++; if (emailCalls === 1) throw new Error('email timeout'); return { status: 'delivered' as const, providerRef: 'email-retry-ref' } } },
  }
  const options = { pool, transports, availability: () => ({ verifiedEmail: true, verifiedPhone: false, marketingOptedIn: {} }), deliveryWindow: { timezone: 'UTC', startHour: 0, endHour: 24 } }
  expect(await runOutboxPoll(options)).toMatchObject({ leased: 1, failed: 1 })
  expect((await pool.query("SELECT status,provider_ref FROM notification_job WHERE outbox_id=$1 AND channel='in_app'", [id])).rows[0].status).toBe('done')
  await pool.query('UPDATE notification_outbox SET locked_until=NULL WHERE id=$1', [id])
  expect(await runOutboxPoll(options)).toMatchObject({ leased: 1, delivered: 1 })
  expect(inAppCalls).toBe(1)
  expect(emailCalls).toBe(2)
  expect((await pool.query('SELECT status FROM notification_outbox WHERE id=$1', [id])).rows[0].status).toBe('delivered')
  expect((await pool.query("SELECT count(*)::int AS count FROM notification_delivery_log WHERE notification_id=$1 AND channel='in_app'", [id])).rows[0].count).toBe(1)
})
