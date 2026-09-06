import { SmsNotificationTransport } from './sms-transport.js'
import { createAuthSender } from '../auth-delivery/providers.js'
import { createServer } from 'node:http'
import { EmailNotificationTransport } from './email-transport.js'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadNotificationRecipient, loadChannelAvailabilityContext } from './channel-availability-loader.js'
import { resolveChannelAvailability } from './channel-availability.js'
import { InAppNotificationTransport } from './in-app-transport.js'
import { runOutboxPoll } from './outbox-runner.js'
import { enqueueOutbox } from './outbox-writer.js'
import { dispatchOutbox, type OutboxRow } from './outbox-reader.js'
import { scanServiceBreaches } from '../service-targets/breach-scanner.js'
import { scanServiceEscalations } from '../service-targets/escalation-scanner.js'
import { reconcileChannelWindows } from './channel-scheduling.js'

const name = `test_delivery_${randomUUID().replaceAll('-', '')}`
const folder = resolve(__dirname, '../../../../packages/db/drizzle/production')
let management: Pool, pool: Pool, profileId: string
const legacyNotice = randomUUID()
const legacyEmail = randomUUID()
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
    await pool.query(`INSERT INTO notification_outbox(id,profile_id,user_id,event_key,payload,channels,idempotency_key,attempts,status)
      VALUES ($1::uuid,$2,'delivery-owner','wallet.topup_completed','{}',ARRAY['in_app','email'],$1::text,$3,'queued')`, [id, profileId, attempts])
    await pool.query("INSERT INTO notification_job(outbox_id,channel) VALUES ($1,'in_app'),($1,'email')", [id])
  }
  await pool.query(`INSERT INTO in_app_notifications(id,profile_id,type,title_i18n_key,body_i18n_key,is_read,read_at)
    VALUES ($1::uuid,$2,'wallet.topup_completed','title','body',true,NOW())`, [inbox, profileId])
  await pool.query(`INSERT INTO notification_delivery_log(notification_id,channel,status,attempt_number,provider_ref)
    VALUES ($1,'in_app','delivered',1,$2)`, [proven, inbox])
  await pool.query(readFileSync(resolve(folder, '0092_notification_delivery_identity.sql'), 'utf8'))
  for (const entry of journal.entries.filter(entry => entry.tag > '0092_notification_delivery_identity')) {
    if (entry.tag === '0095_notification_message_snapshot') {
      await pool.query(`INSERT INTO notification_outbox(id,profile_id,event_key,payload,channels,idempotency_key,status)
        VALUES ($1::uuid,$2,'wallet.topup_completed','{}',ARRAY['email'],$1::text,'queued')`, [legacyEmail, profileId])
      await pool.query("INSERT INTO notification_job(outbox_id,channel,status,attempts,last_error) VALUES ($1,'email','retrying',1,'historical-timeout')", [legacyEmail])
    }
    if (entry.tag === '0096_unified_notification_inbox') {
      await pool.query(`INSERT INTO notifications(id,user_id,profile_id,type,title,body,link,read,read_at,created_at)
        VALUES ($1,'delivery-owner',$2,'profile_verified','Legacy verified','Original body','/app/settings/profile',true,'2026-01-02','2026-01-01')`, [legacyNotice,profileId])
    }
    await pool.query(readFileSync(resolve(folder, `${entry.tag}.sql`), 'utf8'))
  }
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
  await pool.query("UPDATE notification_job SET run_after=NOW()-INTERVAL '1 second' WHERE outbox_id=$1", [id])
  await pool.query("UPDATE notification_outbox SET locked_until=NULL,scheduled_for=NOW()-INTERVAL '1 second' WHERE id=$1", [id])
  expect(await runOutboxPoll(options)).toMatchObject({ leased: 1, delivered: 1 })
  expect(inAppCalls).toBe(1)
  expect(emailCalls).toBe(2)
  expect((await pool.query('SELECT status FROM notification_outbox WHERE id=$1', [id])).rows[0].status).toBe('delivered')
  expect((await pool.query("SELECT count(*)::int AS count FROM notification_delivery_log WHERE notification_id=$1 AND channel='in_app'", [id])).rows[0].count).toBe(1)
})

it('delivers mixed-channel inboxes immediately in each recipient timezone and preserves scheduled window snapshots', async () => {
  await pool.query("UPDATE notification_outbox SET status='cancelled' WHERE status IN ('queued','scheduled','sending')")
  await pool.query("INSERT INTO users(user_id,username,password_hash,timezone) VALUES ('ny-owner','ny@example.test','test-only','America/New_York')")
  const nyProfile = (await pool.query("INSERT INTO profiles(user_id) VALUES ('ny-owner') RETURNING id")).rows[0].id
  const client = await pool.connect()
  let tehranId: string | null, nyId: string | null
  try {
    await client.query('BEGIN')
    tehranId = (await enqueueOutbox(client, { profileId, eventKey: 'contract.created', channels: ['in_app', 'email'], idempotencyKey: 'quiet:tehran' })).outboxId
    nyId = (await enqueueOutbox(client, { profileId: nyProfile, eventKey: 'contract.created', channels: ['in_app', 'email'], idempotencyKey: 'quiet:ny' })).outboxId
    await client.query('COMMIT')
  } finally { client.release() }
  const emailed: string[] = []
  const options = { pool, transports: {
    in_app: new InAppNotificationTransport(pool),
    email: { channel: 'email' as const, async send(payload: { profileId: string | null }) { emailed.push(payload.profileId!); return { status: 'delivered' as const, providerRef: `email:${payload.profileId}` } } },
  }, availability: () => ({ verifiedEmail: true, verifiedPhone: false, marketingOptedIn: {} }),
    deliveryWindow: { timezone: 'UTC', startHour: 9, endHour: 21 } }
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    vi.setSystemTime(new Date('2026-09-06T22:00:00Z'))
    expect(await runOutboxPoll(options)).toMatchObject({ leased: 2, delivered: 1, failed: 0 })
    expect(emailed).toEqual([nyProfile])
    expect((await pool.query("SELECT count(*)::int AS count FROM notification_job WHERE outbox_id=ANY($1::uuid[]) AND channel='in_app' AND status='done'", [[tehranId, nyId]])).rows[0].count).toBe(2)
    const scheduled = (await pool.query("SELECT run_after,delivery_window FROM notification_job WHERE outbox_id=$1 AND channel='email'", [tehranId])).rows[0]
    expect(scheduled.run_after.toISOString()).toBe('2026-09-07T05:30:00.000Z')
    expect(scheduled.delivery_window).toEqual({ timezone: 'Asia/Tehran', startHour: 9, endHour: 21 })
    vi.setSystemTime(new Date('2026-09-07T05:00:00Z'))
    const newConfig = { ...options, deliveryWindow: { timezone: 'UTC', startHour: 12, endHour: 20 } }
    expect((await runOutboxPoll(newConfig)).leased).toBe(0)
    vi.setSystemTime(new Date('2026-09-07T05:30:00Z'))
    expect(await runOutboxPoll(newConfig)).toMatchObject({ leased: 1, delivered: 1, failed: 0 })
    expect(emailed).toEqual([nyProfile, profileId])
    expect((await pool.query('SELECT status FROM notification_outbox WHERE id=$1', [tehranId])).rows[0].status).toBe('delivered')
  } finally { vi.useRealTimers() }
})

it('exhausts one channel without exhausting a different channel or repeating the terminal job', async () => {
  await pool.query("UPDATE notification_outbox SET status='cancelled' WHERE status IN ('queued','scheduled','sending')")
  const client = await pool.connect()
  let id: string | null
  try {
    await client.query('BEGIN')
    id = (await enqueueOutbox(client, { profileId, eventKey: 'wallet.topup_completed', channels: ['in_app', 'email'], idempotencyKey: 'runner:independent-budget' })).outboxId
    await client.query("UPDATE notification_job SET attempts=4 WHERE outbox_id=$1 AND channel='in_app'", [id])
    await client.query("UPDATE notification_job SET max_attempts=2 WHERE outbox_id=$1 AND channel='email'", [id])
    await client.query('COMMIT')
  } finally { client.release() }
  let inAppCalls = 0, emailCalls = 0
  const options = { pool, transports: {
    in_app: { channel: 'in_app' as const, async send() { inAppCalls++; return { status: 'failed' as const, providerRef: '' } } },
    email: { channel: 'email' as const, async send() { emailCalls++; return emailCalls === 1 ? { status: 'failed' as const, providerRef: '' } : { status: 'delivered' as const, providerRef: 'email-budget-ref' } } },
  }, availability: () => ({ verifiedEmail: true, verifiedPhone: false, marketingOptedIn: {} }), deliveryWindow: { timezone: 'UTC', startHour: 0, endHour: 24 } }
  expect((await runOutboxPoll(options)).failed).toBe(1)
  expect((await pool.query('SELECT channel,status,attempts FROM notification_job WHERE outbox_id=$1 ORDER BY channel', [id])).rows)
    .toEqual([{ channel: 'email', status: 'retrying', attempts: 1 }, { channel: 'in_app', status: 'dead_letter', attempts: 5 }])
  await pool.query("UPDATE notification_job SET run_after=NOW()-INTERVAL '1 second' WHERE outbox_id=$1 AND channel='email'", [id])
  await pool.query("UPDATE notification_outbox SET locked_until=NULL,scheduled_for=NOW()-INTERVAL '1 second' WHERE id=$1", [id])
  await runOutboxPoll(options)
  expect(inAppCalls).toBe(1)
  expect(emailCalls).toBe(2)
  expect((await pool.query('SELECT status FROM notification_outbox WHERE id=$1', [id])).rows[0].status).toBe('failed')
  expect((await pool.query('SELECT channel,attempts FROM notification_dead_letter WHERE outbox_id=$1', [id])).rows).toEqual([{ channel: 'in_app', attempts: 5 }])
})

it('renews a slow delivery claim so another poll cannot take it', async () => {
  await pool.query("UPDATE notification_outbox SET status='cancelled' WHERE status IN ('queued','scheduled','sending')")
  const client = await pool.connect()
  let id: string | null
  try {
    await client.query('BEGIN')
    id = (await enqueueOutbox(client, { profileId, eventKey: 'wallet.topup_completed', channels: ['in_app', 'email'], idempotencyKey: 'runner:slow-renewal' })).outboxId
    await client.query('COMMIT')
  } finally { client.release() }
  let release!: () => void, started = false
  const gate = new Promise<void>(resolve => { release = resolve })
  const options = { pool, leaseDurationMs: 150, transports: {
    in_app: new InAppNotificationTransport(pool), email: { channel: 'email' as const, async send() { started = true; await gate; return { status: 'delivered' as const, providerRef: 'slow-ref' } } },
  }, availability: () => ({ verifiedEmail: true, verifiedPhone: false, marketingOptedIn: {} }), deliveryWindow: { timezone: 'UTC', startHour: 0, endHour: 24 } }
  const running = runOutboxPoll(options)
  try {
    await expect.poll(() => started).toBe(true)
    const firstDeadline = (await pool.query('SELECT locked_until FROM notification_outbox WHERE id=$1', [id])).rows[0].locked_until.getTime()
    await expect.poll(async () => (await pool.query('SELECT locked_until FROM notification_outbox WHERE id=$1', [id])).rows[0].locked_until.getTime()).toBeGreaterThan(firstDeadline + 250)
    expect((await runOutboxPoll(options)).leased).toBe(0)
  } finally { release() }
  expect(await running).toMatchObject({ delivered: 1, failed: 0 })
})

it('a replaced claim cannot send the next channel or overwrite its successor', async () => {
  await pool.query("UPDATE notification_outbox SET status='cancelled' WHERE status IN ('queued','scheduled','sending')")
  const client = await pool.connect()
  let id: string | null
  try {
    await client.query('BEGIN')
    id = (await enqueueOutbox(client, { profileId, eventKey: 'wallet.topup_completed', channels: ['in_app', 'email', 'sms'], idempotencyKey: 'runner:takeover' })).outboxId
    await client.query('COMMIT')
  } finally { client.release() }
  let release!: () => void, started = false, smsCalls = 0
  const gate = new Promise<void>(resolve => { release = resolve })
  const keys: string[] = []
  const options = { pool, transports: {
    in_app: new InAppNotificationTransport(pool),
    email: { channel: 'email' as const, async send(payload: { idempotencyKey: string }) { keys.push(payload.idempotencyKey); started = true; await gate; return { status: 'delivered' as const, providerRef: 'takeover-ref' } } },
    sms: { channel: 'sms' as const, async send() { smsCalls++; return { status: 'delivered' as const, providerRef: 'sms-ref' } } },
  }, availability: () => ({ verifiedEmail: true, verifiedPhone: true, marketingOptedIn: {} }), deliveryWindow: { timezone: 'UTC', startHour: 0, endHour: 24 } }
  const running = runOutboxPoll(options)
  try {
    await expect.poll(() => started).toBe(true)
    await pool.query("UPDATE notification_outbox SET lease_token='successor-claim',locked_until=NOW()+INTERVAL '1 day',last_error='successor-owned' WHERE id=$1", [id])
  } finally { release() }
  expect(await running).toMatchObject({ delivered: 0, failed: 1 })
  expect(smsCalls).toBe(0)
  expect((await pool.query('SELECT lease_token,last_error,status FROM notification_outbox WHERE id=$1', [id])).rows[0])
    .toEqual({ lease_token: 'successor-claim', last_error: 'successor-owned', status: 'sending' })
  expect((await pool.query('SELECT count(*)::int AS count FROM notification_delivery_log WHERE notification_id=$1', [id])).rows[0].count).toBe(0)
  await pool.query("UPDATE notification_outbox SET locked_until=NOW()-INTERVAL '1 second' WHERE id=$1", [id])
  expect(await runOutboxPoll(options)).toMatchObject({ delivered: 1, failed: 0 })
  expect(keys).toHaveLength(2)
  expect(keys[0]).toBe(keys[1])
  expect(smsCalls).toBe(1)
  expect((await pool.query('SELECT count(*)::int AS count FROM in_app_notifications WHERE delivery_key=$1', [`outbox:${id}`])).rows[0].count).toBe(1)
})


it('uses the explicit recipient, applies address suppression, and refuses disabled or unactivated recipients', async () => {
  const id = randomUUID()
  await pool.query("INSERT INTO users(user_id,username,password_hash,locale) VALUES ('delivery-recipient','Recipient@example.test','test-only','en')")
  await pool.query(`INSERT INTO notification_outbox(id,profile_id,user_id,event_key,payload,channels,idempotency_key)
    VALUES ($1::uuid,$2,'delivery-recipient','wallet.topup_completed','{}',ARRAY['email'],$1::text)`, [id, profileId])
  expect(await loadNotificationRecipient(pool, id)).toMatchObject({ userId: 'delivery-recipient', email: 'Recipient@example.test', locale: 'en', emailSuppressed: false })
  await pool.query("INSERT INTO email_suppressions(address,reason,profile_id,source_event_id) VALUES ('recipient@example.test','complaint',$1,NULL)", [profileId])
  const availability = await loadChannelAvailabilityContext(pool, id)
  expect(resolveChannelAvailability('wallet.topup_completed', ['in_app', 'email'], availability))
    .toEqual({ allowed: ['in_app'], skipped: [{ channel: 'email', reason: 'email_suppressed' }] })
  await pool.query("UPDATE users SET disabled_at=NOW() WHERE user_id='delivery-recipient'")
  expect(await loadNotificationRecipient(pool, id)).toBeNull()
  await pool.query("UPDATE users SET disabled_at=NULL,activation_token='pending' WHERE user_id='delivery-recipient'")
  expect(await loadNotificationRecipient(pool, id)).toBeNull()
  await pool.query('UPDATE notification_outbox SET user_id=NULL WHERE id=$1', [id])
  expect(await loadNotificationRecipient(pool, id)).toMatchObject({ userId: 'delivery-owner', email: 'delivery@example.test', emailSuppressed: false })
})


it('delivers a queued email with the recipient locale, template and durable receipt through a controlled HTTP provider', async () => {
  await pool.query("UPDATE notification_outbox SET status='cancelled' WHERE status IN ('queued','scheduled','sending')")
  await pool.query("UPDATE users SET activation_token=NULL,disabled_at=NULL WHERE user_id='delivery-recipient'")
  await pool.query("DELETE FROM email_suppressions WHERE lower(address)='recipient@example.test'")
  await pool.query(`INSERT INTO email_provider_configs(transport,label,status,config,created_by,last_test_status,supersedes_id)
    VALUES ('resend','Local test','active',$1,'delivery-owner','passed',NULL)`, [JSON.stringify({ api_key: 'local-test-only', from_email: 'sender@example.test' })])
  await pool.query(`INSERT INTO notification_templates(event_key,channel,locale,subject,body_template,variables,status,is_active,created_by)
    VALUES ('wallet.topup_completed','email','en','Top-up {{amount}}','<p>{{name}}: {{amount}}</p>','["name","amount"]','active',true,'delivery-owner')`)
  const received: Array<{ key: string; content: Record<string, unknown> }> = []
  let responseCode = 503
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    received.push({ key: String(req.headers['idempotency-key']), content: JSON.parse(Buffer.concat(chunks).toString()) })
    res.writeHead(responseCode, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: 'queued-email-receipt' }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No local provider endpoint')
  const email = new EmailNotificationTransport(pool, async (_url, options) => fetch(`http://127.0.0.1:${address.port}`, options))
  const client = await pool.connect()
  let id: string | null
  try {
    await client.query('BEGIN')
    id = (await enqueueOutbox(client, { profileId, userId: 'delivery-recipient', eventKey: 'wallet.topup_completed', channels: ['in_app', 'email'],
      payload: { name: 'A&B <customer>', amount: '5000' }, idempotencyKey: 'real-email:test' })).outboxId
    await client.query('COMMIT')
  } finally { client.release() }
  const options = { pool, transports: { email, in_app: new InAppNotificationTransport(pool) }, deliveryWindow: { timezone: 'UTC', startHour: 0, endHour: 24 } }
  try {
    expect(await runOutboxPoll(options)).toMatchObject({ leased: 1, failed: 1 })
    responseCode = 200
    await pool.query("UPDATE notification_templates SET body_template='<p>Changed template</p>' WHERE event_key='wallet.topup_completed' AND channel='email'")
    await pool.query("UPDATE notification_outbox SET payload='{\"name\":\"Changed person\",\"amount\":\"9000\"}' WHERE id=$1", [id])
    await pool.query("UPDATE notification_job SET run_after=NOW()-INTERVAL '1 second' WHERE outbox_id=$1 AND channel='email'", [id])
    await pool.query("UPDATE notification_outbox SET scheduled_for=NOW()-INTERVAL '1 second' WHERE id=$1", [id])
    expect(await runOutboxPoll(options)).toMatchObject({ leased: 1, delivered: 1, failed: 0 })
    expect(received).toHaveLength(2)
    expect(received[0]!.key).toBe(received[1]!.key)
    expect(received[1]!.content).toMatchObject({ to: ['Recipient@example.test'], subject: 'Top-up 5000', html: '<p>A&amp;B &lt;customer&gt;: 5000</p>' })
    expect((await pool.query("SELECT status,provider_ref FROM notification_job WHERE outbox_id=$1 AND channel='email'", [id])).rows[0])
      .toEqual({ status: 'done', provider_ref: 'queued-email-receipt' })
    expect((await pool.query('SELECT count(*)::int AS count FROM in_app_notifications WHERE delivery_key=$1', [`outbox:${id}`])).rows[0].count).toBe(1)
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
})


it('refuses to retarget a snapshotted email after the recipient changes', async () => {
  const saved = (await pool.query("SELECT o.id,o.profile_id,j.delivery_payload FROM notification_outbox o JOIN notification_job j ON j.outbox_id=o.id WHERE o.idempotency_key='real-email:test' AND j.channel='email'")).rows[0]
  const request = vi.fn<typeof fetch>()
  await pool.query("UPDATE users SET email='new-recipient@example.test' WHERE user_id='delivery-recipient'")
  try {
    await expect(new EmailNotificationTransport(pool, request).send({ outboxId: saved.id, profileId: saved.profile_id,
      eventKey: 'wallet.topup_completed', channel: 'email', recipientId: 'delivery-recipient', payload: {}, idempotencyKey: saved.delivery_payload.idempotencyKey })).rejects.toThrow('requires reconciliation')
    expect(request).not.toHaveBeenCalled()
  } finally { await pool.query("UPDATE users SET email=NULL WHERE user_id='delivery-recipient'") }
})

it('holds an attempted legacy email without deleting its job or retry evidence', async () => {
  expect((await pool.query('SELECT status,last_error FROM notification_outbox WHERE id=$1', [legacyEmail])).rows[0])
    .toEqual({ status: 'failed', last_error: 'legacy_email_snapshot_requires_reconciliation' })
  expect((await pool.query('SELECT status,attempts,last_error,delivery_payload FROM notification_job WHERE outbox_id=$1', [legacyEmail])).rows[0])
    .toEqual({ status: 'retrying', attempts: 1, last_error: 'historical-timeout', delivery_payload: null })
})


it('sends stable mapped SMS parameters across a retry and shares the provider quota with authentication', async () => {
  await pool.query("UPDATE notification_outbox SET status='cancelled' WHERE status IN ('queued','scheduled','sending')")
  await pool.query("UPDATE users SET mobile='+989121234567' WHERE user_id='delivery-recipient'")
  const config = { api_key: 'local-test-only', sender: '3000', throughput_limit: 2, template_mappings: [
    { event_key: 'wallet.topup_completed', template_id: '42', variables: { amount: 'AMOUNT' } },
    { event_key: 'otp:login', template_id: '43', variables: { code: 'CODE' } },
  ] }
  await pool.query(`INSERT INTO sms_provider_configs(transport,label,status,config,created_by,last_test_status,supersedes_id)
    VALUES ('smsir','Local test','active',$1,'delivery-owner','passed',NULL)`, [JSON.stringify(config)])
  await pool.query(`INSERT INTO notification_templates(event_key,channel,locale,body_template,variables,status,is_active,created_by)
    VALUES ('wallet.topup_completed','sms','en','Amount {{amount}}','["amount"]','active',true,'delivery-owner')`)
  let code = 503
  const received: unknown[] = []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk))
    received.push(JSON.parse(Buffer.concat(chunks).toString()))
    res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: 1, data: { messageId: 987 } }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No local endpoint')
  const request = vi.fn<typeof fetch>(async (_url, options) => fetch(`http://127.0.0.1:${address.port}`, options))
  const client = await pool.connect(); let id: string | null
  try {
    await client.query('BEGIN')
    id = (await enqueueOutbox(client, { profileId, userId: 'delivery-recipient', eventKey: 'wallet.topup_completed', channels: ['in_app', 'sms'], payload: { amount: '5000' }, idempotencyKey: 'real-sms:test' })).outboxId
    await client.query('COMMIT')
  } finally { client.release() }
  const options = { pool, transports: { sms: new SmsNotificationTransport(pool, request), in_app: new InAppNotificationTransport(pool) }, deliveryWindow: { timezone: 'UTC', startHour: 0, endHour: 24 } }
  try {
    expect(await runOutboxPoll(options)).toMatchObject({ leased: 1, failed: 1 })
    code = 200
    await pool.query("UPDATE notification_outbox SET payload='{\"amount\":\"9000\"}',scheduled_for=NOW()-INTERVAL '1 second' WHERE id=$1", [id])
    await pool.query("UPDATE notification_job SET run_after=NOW()-INTERVAL '1 second' WHERE outbox_id=$1", [id])
    expect(await runOutboxPoll(options)).toMatchObject({ delivered: 1, failed: 0 })
    expect(received).toEqual(Array(2).fill({ Mobile: '09121234567', TemplateId: 42, Parameters: [{ Name: 'AMOUNT', Value: '5000' }] }))
    expect((await pool.query("SELECT status,provider_ref FROM notification_job WHERE outbox_id=$1 AND channel='sms'", [id])).rows[0]).toEqual({ status: 'done', provider_ref: '987' })
    await expect(createAuthSender(pool, request)({ id: 'quota-check', destination: '+989121234567', code: '123456', purpose: 'login' })).rejects.toThrow('quota')
    expect(request).toHaveBeenCalledTimes(2)
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
})

it('migrates legacy inbox text and read history without deleting its source', async()=>{
  expect((await pool.query('SELECT recipient_user_id,localized_content,is_read,read_at,created_at,link_route,delivery_key FROM in_app_notifications WHERE id=$1',[legacyNotice])).rows[0])
    .toEqual({recipient_user_id:'delivery-owner',localized_content:{original:{title:'Legacy verified',body:'Original body'}},is_read:true,
      read_at:new Date('2026-01-02T00:00:00Z'),created_at:new Date('2026-01-01T00:00:00Z'),link_route:'/settings/profile',delivery_key:`legacy:${legacyNotice}`})
  expect((await pool.query('SELECT count(*)::int AS count FROM notifications WHERE id=$1',[legacyNotice])).rows[0].count).toBe(1)
})

it('saves active bilingual inbox templates and keeps original content/read state on retry', async()=>{
  await pool.query(`INSERT INTO notification_templates(event_key,channel,locale,subject,body_template,variables,status,is_active,created_by)
    VALUES ('wallet.topup_completed','in_app','fa','شارژ کیف پول','مبلغ {{amount}} ریال','["amount"]','active',true,'delivery-owner'),
    ('wallet.topup_completed','in_app','en','Wallet credited','Amount {{amount}} IRR','["amount"]','active',true,'delivery-owner')`)
  const event=row(randomUUID()),transport=new InAppNotificationTransport(pool)
  const first=await dispatchOutbox({...event,channels:['in_app']},{in_app:transport})
  const id=first[0]!.result.providerRef
  expect((await pool.query('SELECT localized_content,recipient_user_id FROM in_app_notifications WHERE id=$1',[id])).rows[0])
    .toEqual({recipient_user_id:'delivery-owner',localized_content:{fa:{title:'شارژ کیف پول',body:'مبلغ 5000 ریال'},en:{title:'Wallet credited',body:'Amount 5000 IRR'}}})
  await pool.query("UPDATE in_app_notifications SET is_read=true,read_at='2026-01-01' WHERE id=$1",[id])
  await pool.query("UPDATE notification_templates SET body_template='{{missing}}' WHERE event_key='wallet.topup_completed' AND channel='in_app'")
  expect((await dispatchOutbox({...event,channels:['in_app'],payload:{amount:'9999'}},{in_app:transport}))[0]!.result.providerRef).toBe(id)
  expect((await pool.query('SELECT is_read,read_at FROM in_app_notifications WHERE id=$1',[id])).rows[0])
    .toEqual({is_read:true,read_at:new Date('2026-01-01T00:00:00Z')})
  expect((await dispatchOutbox({...row(randomUUID()),channels:['in_app']},{in_app:transport}))[0]!.result.status).toBe('failed')
  expect((await pool.query('SELECT recipient_user_id FROM in_app_notifications WHERE id=$1',[inbox])).rows[0].recipient_user_id).toBe('delivery-owner')
})


it('delivers and escalates profileless staff alerts privately with retry and rollback safety', async () => {
  await pool.query(`INSERT INTO users(user_id,username,password_hash,is_staff,is_admin,disabled_at) VALUES
    ('alert-staff','staff-alert@example.test','test',true,false,NULL),
    ('alert-admin','admin-alert@example.test','test',true,true,NULL),
    ('alert-disabled','disabled-alert@example.test','test',true,true,NOW())`)
  await pool.query(`INSERT INTO app_config(key,value) VALUES
    ('admin.service_response_targets','{"ticket":1}'),
    ('admin.escalation_policy','{"ticket":{"level2":{"delayHours":1,"channels":["in_app","email"]},"level3":{"delayHours":1,"channels":["in_app"]}}}')`)
  const ticket=(await pool.query(`INSERT INTO tickets(user_id,assigned_to,subject,body,status,updated_at)
    VALUES ('delivery-owner','alert-staff','Overdue','Private conversation','in_progress',NOW()-INTERVAL '4 hours') RETURNING id`)).rows[0].id
  const logger={warn:vi.fn(),info:vi.fn()}
  // Failure after a real outbox write must also roll back its breach ledger.
  const failed=await scanServiceBreaches({pool,logger,enqueue:async(client,input)=>{
    await enqueueOutbox(client,input);throw new Error('injected queue failure')
  }})
  expect(failed.errors).toHaveLength(1)
  expect(failed.alerted).toBe(0)
  expect((await pool.query('SELECT id FROM service_breach_alerts WHERE item_id=$1',[ticket])).rows).toEqual([])
  expect((await pool.query("SELECT id FROM notification_outbox WHERE user_id='alert-staff'")).rows).toEqual([])
  expect((await scanServiceBreaches({pool,logger})).errors).toEqual([])
  await scanServiceBreaches({pool,logger})
  const alerts=(await pool.query("SELECT * FROM notification_outbox WHERE user_id='alert-staff'")).rows
  expect(alerts).toHaveLength(1)
  expect(alerts[0].profile_id).toBeNull()
  const notice={...row(alerts[0].id),profileId:null,userId:'alert-staff',eventKey:alerts[0].event_key,payload:alerts[0].payload,channels:['in_app'] as const}
  const transport=new InAppNotificationTransport(pool)
  const outcomes=await Promise.all(Array.from({length:4},()=>dispatchOutbox({...notice,channels:[...notice.channels]},{in_app:transport})))
  expect(outcomes.every(result=>result[0]?.result.status==='delivered')).toBe(true)
  expect(new Set(outcomes.map(result=>result[0]?.result.providerRef)).size).toBe(1)
  expect((await pool.query('SELECT profile_id,recipient_user_id,localized_content FROM in_app_notifications WHERE delivery_key=$1',[`outbox:${alerts[0].id}`])).rows[0])
    .toMatchObject({profile_id:null,recipient_user_id:'alert-staff',localized_content:{fa:expect.any(Object),en:expect.any(Object)}})
  await pool.query("UPDATE service_breach_alerts SET alerted_at=NOW()-INTERVAL '2 hours' WHERE item_id=$1",[ticket])
  const escalationFailure=await scanServiceEscalations({pool,logger,enqueue:async(client,input)=>{await enqueueOutbox(client,input);throw new Error('injected escalation queue failure')}})
  expect(escalationFailure.errors).toHaveLength(1)
  expect((await pool.query('SELECT escalation_level FROM service_breach_alerts WHERE item_id=$1',[ticket])).rows[0].escalation_level).toBe(1)
  expect((await scanServiceEscalations({pool,logger})).errors).toEqual([])
  await scanServiceEscalations({pool,logger})
  const escalations=(await pool.query("SELECT * FROM notification_outbox WHERE event_key='admin.service_escalated' AND payload->>'item_id'=$1",[ticket])).rows
  expect(escalations).toHaveLength(1)
  expect(escalations[0]).toMatchObject({profile_id:null,user_id:'alert-admin',channels:['in_app','email']})
  expect(await loadNotificationRecipient(pool,escalations[0].id)).toMatchObject({userId:'alert-admin',profileId:null,email:'admin-alert@example.test'})
  // Urgent escalations stay immediate; ordinary account-only events respect windows.
  const queueClient=await pool.connect()
  let scheduledId: string | null
  try { scheduledId=(await enqueueOutbox(queueClient,{profileId:null,userId:'alert-admin',eventKey:'staff.daytime_notice',channels:['in_app','email'],idempotencyKey:randomUUID()})).outboxId }
  finally { queueClient.release() }
  await reconcileChannelWindows(pool,{startHour:23,endHour:24,timezone:'UTC'},new Date('2026-09-06T12:00:00Z'))
  const jobs=(await pool.query('SELECT channel,run_after FROM notification_job WHERE outbox_id=$1',[scheduledId])).rows
  expect(jobs.find(job=>job.channel==='email').run_after).not.toBeNull()
  expect(jobs.find(job=>job.channel==='in_app').run_after).toBeNull()
  await expect(pool.query(`INSERT INTO notification_outbox(profile_id,event_key,channels,idempotency_key)
    VALUES (NULL,'invalid',ARRAY['in_app'],'missing-recipient')`)).rejects.toMatchObject({code:'23514'})
})

it('escalates to the configured lead, excludes teammates, and falls back when the lead is disabled',async()=>{
  await pool.query(`INSERT INTO users(user_id,username,password_hash,is_staff) VALUES
    ('lead-owner','lead-owner@example.test','test',true),('lead-target','lead-target@example.test','test',true),
    ('lead-other','lead-other@example.test','test',true)`)
  const team=(await pool.query("INSERT INTO staff_teams(name,lead_user_id) VALUES ('Lead routing','lead-target') RETURNING id")).rows[0].id
  await pool.query("INSERT INTO staff_team_members(team_id,user_id) VALUES ($1,'lead-owner'),($1,'lead-target'),($1,'lead-other')",[team])
  const logger={warn:vi.fn(),info:vi.fn()}
  async function createAndEscalate(){
    const ticket=(await pool.query(`INSERT INTO tickets(user_id,assigned_to,subject,body,status,updated_at)
      VALUES ('delivery-owner','lead-owner','Lead test','Private','in_progress',NOW()-INTERVAL '4 hours') RETURNING id`)).rows[0].id
    expect((await scanServiceBreaches({pool,logger})).errors).toEqual([])
    await pool.query("UPDATE service_breach_alerts SET alerted_at=NOW()-INTERVAL '2 hours' WHERE item_id=$1",[ticket])
    const results=await Promise.all([scanServiceEscalations({pool,logger}),scanServiceEscalations({pool,logger})])
    expect(results.flatMap(result=>result.errors)).toEqual([])
    return (await pool.query("SELECT user_id FROM notification_outbox WHERE event_key='admin.service_escalated' AND payload->>'item_id'=$1",[ticket])).rows.map(row=>row.user_id)
  }
  expect(await createAndEscalate()).toEqual(['lead-target'])
  await pool.query("UPDATE users SET disabled_at=NOW() WHERE user_id='lead-target'")
  const fallback=await createAndEscalate()
  expect(fallback).toContain('alert-admin')
  expect(fallback).not.toContain('lead-target')
  expect(fallback).not.toContain('lead-other')
  await expect(pool.query("INSERT INTO staff_team_members(team_id,user_id) VALUES ($1,'lead-owner')",[team])).rejects.toMatchObject({code:'23505'})
})
