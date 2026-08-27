import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { EmailWebhookService } from './email-webhook.service'
import type { ResendWebhookHeaders } from './email-webhook.types'
import { ProviderSecretsService } from '../provider-config/provider-secrets.service'
import type { ProviderPool } from '../provider-config/provider-config.di'

/**
 * In-memory harness backing the four tables the receiver touches
 * (email_provider_configs, notification_outbox, email_webhook_events,
 * notification_delivery_log, email_suppressions), driven from raw SQL in the
 * same order the service issues it.
 */

const SECRET = 'whsec_MzJiZTYwYmYyZjYwNGQ3OTk4ZmI2NDJmNTc1ZWI2ZDM'

function sign(secret: string, id: string, timestamp: string, payload: string): string {
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64')
  const hmac = createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`, 'utf8').digest('base64')
  return `v1,${hmac}`
}

interface OutboxRow {
  id: string
  profileId: string | null
  providerRef: string | null
  status: string
}
interface SuppressionRow {
  address: string
  reason: string
  profileId: string | null
  sourceEventId: string | null
}
interface DeliveryLogRow {
  notificationId: string
  status: string
  attemptNumber: number
  providerRef: string | null
  errorCategory: string | null
  errorDetail: string | null
}

interface EventRow {
  id: string
  eventType: string
  messageId: string | null
  toAddress: string | null
  outboxId: string | null
  status: string | null
}

interface Harness {
  pool: ProviderPool
  queries: string[]
  eventsByToken: Map<string, EventRow>
  outboxRows: Map<string, OutboxRow>
  suppressions: SuppressionRow[]
  deliveryLogs: DeliveryLogRow[]
  failOnDeliveredUpdate: { value: boolean }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildHarness(overrides: { activeConfig?: boolean; failOnDeliveredUpdate?: boolean } = {}): Harness {
  const eventsByToken = new Map<string, EventRow>()
  const outboxRows = new Map<string, OutboxRow>()
  const suppressions: SuppressionRow[] = []
  const deliveryLogs: DeliveryLogRow[] = []
  const queries: string[] = []
  const activeConfig = overrides.activeConfig ?? true
  const failFlag = { value: overrides.failOnDeliveredUpdate ?? false }

  let txSnapshot: {
    events: Map<string, EventRow>
    suppressions: SuppressionRow[]
    logs: DeliveryLogRow[]
    outbox: Map<string, OutboxRow>
  } | null = null

  const outboxByRef = (ref: string): OutboxRow | undefined =>
    [...outboxRows.values()].find((r) => r.providerRef === ref)

  const takeSnapshot = () => ({
    events: new Map(eventsByToken),
    suppressions: [...suppressions],
    logs: [...deliveryLogs],
    outbox: new Map([...outboxRows].map(([k, v]) => [k, { ...v }])),
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exec = async (text: string, params?: unknown[]): Promise<any> => {
    queries.push(text.replace(/\s+/g, ' ').trim())
    const lower = text.toLowerCase()
    const q = text.replace(/\s+/g, ' ').trim().toLowerCase()

    if (lower.startsWith('begin')) {
      txSnapshot = takeSnapshot()
      return { rows: [] }
    }
    if (lower.startsWith('commit')) {
      txSnapshot = null
      return { rows: [] }
    }
    if (lower.startsWith('rollback')) {
      if (txSnapshot) {
        eventsByToken.clear()
        for (const [k, v] of txSnapshot.events) eventsByToken.set(k, v)
        suppressions.length = 0
        suppressions.push(...txSnapshot.suppressions)
        deliveryLogs.length = 0
        deliveryLogs.push(...txSnapshot.logs)
        outboxRows.clear()
        for (const [k, v] of txSnapshot.outbox) outboxRows.set(k, v)
        txSnapshot = null
      }
      return { rows: [] }
    }

    if (lower.includes('select config from email_provider_configs')) {
      return activeConfig
        ? {
            rows: [
              {
                config: {
                  api_key: 're_test',
                  from_email: 'no-reply@barghsa.ir',
                  webhook_secret: SECRET,
                },
              },
            ],
          }
        : { rows: [] }
    }

    // lookupOutbox (in-tx): SELECT id, profile_id AS "profileId" FROM ...
    if (q.startsWith('select id, profile_id')) {
      const outbox = outboxByRef(String(params![0]))
      return outbox ? { rows: [{ id: outbox.id, profileId: outbox.profileId }] } : { rows: [] }
    }

    if (lower.includes('insert into email_webhook_events')) {
      const token = String(params![1])
      if (eventsByToken.has(token)) return { rows: [], rowCount: 0 }
      eventsByToken.set(token, {
        id: String(params![0]),
        eventType: String(params![2]),
        messageId: (params![3] as string | null) ?? null,
        toAddress: (params![4] as string | null) ?? null,
        outboxId: (params![6] as string | null) ?? null,
        status: (params![7] as string | null) ?? null,
      })
      return { rows: [], rowCount: 1 }
    }

    if (lower.includes('update email_webhook_events set outbox_id')) {
      const eventId = String(params![1])
      const outboxId = String(params![0])
      for (const e of eventsByToken.values()) if (e.id === eventId) e.outboxId = outboxId
      return { rows: [], rowCount: 1 }
    }

    if (lower.includes("set status = 'delivered'") && lower.includes('notification_outbox')) {
      // Simulate a transient DB failure mid-processing (ledger insert already
      // happened inside the transaction — it must be rolled back with it).
      if (failFlag.value) throw new Error('simulated db failure')
      const row = outboxRows.get(String(params![0]))
      if (row) row.status = 'delivered'
      return { rows: [], rowCount: row ? 1 : 0 }
    }

    if (lower.includes("set status = 'failed'") && lower.includes('notification_outbox')) {
      // UPDATE ... SET status='failed', last_error=$1 ... WHERE id=$2
      const row = outboxRows.get(String(params![1]))
      if (row) {
        row.status = 'failed'
        row.providerRef = null
      }
      return { rows: [], rowCount: row ? 1 : 0 }
    }

    if (lower.includes('coalesce(max(attempt_number), 0)')) {
      const notificationId = String(params![0])
      const max = deliveryLogs
        .filter((l) => l.notificationId === notificationId)
        .reduce((acc, l) => Math.max(acc, l.attemptNumber), 0)
      return { rows: [{ n: String(max) }] }
    }

    if (lower.includes('insert into notification_delivery_log')) {
      deliveryLogs.push({
        notificationId: String(params![0]),
        status: String(params![1]),
        attemptNumber: Number(params![2]),
        providerRef: (params![3] as string | null) ?? null,
        errorCategory: (params![4] as string | null) ?? null,
        errorDetail: (params![5] as string | null) ?? null,
      })
      return { rows: [], rowCount: 1 }
    }

    if (lower.includes('insert into email_suppressions')) {
      suppressions.push({
        address: String(params![1]),
        reason: String(params![2]),
        profileId: (params![3] as string | null) ?? null,
        sourceEventId: (params![4] as string | null) ?? null,
      })
      return { rows: [], rowCount: 1 }
    }

    return { rows: [] }
  }

  const client = {
    query: exec,
    release: () => {},
  }
  const pool: ProviderPool = {
    query: exec,
    connect: async () => client,
  }

  return {
    pool,
    queries,
    eventsByToken,
    outboxRows,
    suppressions,
    deliveryLogs,
    failOnDeliveredUpdate: failFlag,
  }
}

function makeHeaders(
  id: string,
  payload: string,
  secret = SECRET,
  ts?: number,
): ResendWebhookHeaders {
  const timestamp = String(ts ?? Math.floor(Date.now() / 1000))
  return {
    id,
    timestamp,
    signature: sign(secret, id, timestamp, payload),
  }
}

const OUTBOX_ID = '0190a1b2-0000-7000-8000-000000cafe01'
const PROFILE_ID = '0190a1b2-0000-7000-8000-000000face01'

describe('EmailWebhookService (T-05.06.07)', () => {
  it('records and applies an email.delivered event (outbox → delivered + delivery log)', async () => {
    const h = buildHarness()
    h.outboxRows.set(OUTBOX_ID, {
      id: OUTBOX_ID,
      profileId: PROFILE_ID,
      providerRef: 'msg_resend_1',
      status: 'sending',
    })
    const svc = new EmailWebhookService(h.pool, new ProviderSecretsService())

    const payload = JSON.stringify({
      type: 'email.delivered',
      data: { email_id: 'msg_resend_1', to: 'a@example.com', from: 'no-reply@barghsa.ir' },
    })
    const outcome = await svc.handle(makeHeaders('msg_svix_1', payload), payload)

    expect(outcome.processed).toBe(true)
    expect(h.outboxRows.get(OUTBOX_ID)!.status).toBe('delivered')
    expect(h.deliveryLogs).toHaveLength(1)
    expect(h.deliveryLogs[0]).toMatchObject({
      notificationId: OUTBOX_ID,
      status: 'delivered',
      providerRef: 'msg_resend_1',
    })
    // Ledger row carries the provider message id + normalized status (column order).
    expect([...h.eventsByToken.values()][0]).toMatchObject({
      eventType: 'email.delivered',
      messageId: 'msg_resend_1',
      toAddress: 'a@example.com',
      status: 'delivered',
    })
    expect(h.suppressions).toHaveLength(0)
  })

  it('hard bounce suppresses the normalized address and fails the outbox', async () => {
    const h = buildHarness()
    h.outboxRows.set(OUTBOX_ID, {
      id: OUTBOX_ID,
      profileId: PROFILE_ID,
      providerRef: 'msg_resend_2',
      status: 'sending',
    })
    const svc = new EmailWebhookService(h.pool, new ProviderSecretsService())

    const payload = JSON.stringify({
      type: 'email.bounced',
      data: {
        email_id: 'msg_resend_2',
        to: 'NOBODY@EXAMPLE.COM',
        category: 'hard_bounce',
      },
    })
    const outcome = await svc.handle(makeHeaders('msg_svix_2', payload), payload)

    expect(outcome.processed).toBe(true)
    expect(h.suppressions).toEqual([
      {
        address: 'nobody@example.com',
        reason: 'hard_bounce',
        profileId: PROFILE_ID,
        sourceEventId: expect.any(String) as unknown as string,
      },
    ])
    expect(h.outboxRows.get(OUTBOX_ID)!.status).toBe('failed')
    expect(h.deliveryLogs).toHaveLength(1)
    expect(h.deliveryLogs[0]).toMatchObject({ status: 'failed', errorCategory: 'permanent' })
  })

  it('soft bounce fails the outbox WITHOUT suppressing the address', async () => {
    const h = buildHarness()
    h.outboxRows.set(OUTBOX_ID, {
      id: OUTBOX_ID,
      profileId: null,
      providerRef: 'msg_resend_3',
      status: 'sending',
    })
    const svc = new EmailWebhookService(h.pool, new ProviderSecretsService())

    const payload = JSON.stringify({
      type: 'email.bounced',
      data: { email_id: 'msg_resend_3', to: 'b@example.com', category: 'soft_bounce' },
    })
    const outcome = await svc.handle(makeHeaders('msg_svix_3', payload), payload)

    expect(outcome.processed).toBe(true)
    expect(h.suppressions).toHaveLength(0)
    expect(h.outboxRows.get(OUTBOX_ID)!.status).toBe('failed')
    // Soft bounces are transient/retryable — never classified as permanent.
    expect(h.deliveryLogs[0]).toMatchObject({ status: 'failed', errorCategory: 'transient' })
  })

  it('complaint suppresses the address as a corrective record', async () => {
    const h = buildHarness()
    h.outboxRows.set(OUTBOX_ID, {
      id: OUTBOX_ID,
      profileId: PROFILE_ID,
      providerRef: 'msg_resend_4',
      status: 'delivered',
    })
    const svc = new EmailWebhookService(h.pool, new ProviderSecretsService())

    const payload = JSON.stringify({
      type: 'email.complained',
      data: { email_id: 'msg_resend_4', to: 'Complainer@Example.COM' },
    })
    const outcome = await svc.handle(makeHeaders('msg_svix_4', payload), payload)

    expect(outcome.processed).toBe(true)
    expect(h.suppressions).toEqual([
      {
        address: 'complainer@example.com',
        reason: 'complaint',
        profileId: PROFILE_ID,
        sourceEventId: expect.any(String) as unknown as string,
      },
    ])
    // A complaint does not rewrite the transport outcome.
    expect(h.outboxRows.get(OUTBOX_ID)!.status).toBe('delivered')
  })

  it('replayed / re-delivered svix-id is a no-op (idempotent)', async () => {
    const h = buildHarness()
    h.outboxRows.set(OUTBOX_ID, {
      id: OUTBOX_ID,
      profileId: PROFILE_ID,
      providerRef: 'msg_resend_5',
      status: 'sending',
    })
    const svc = new EmailWebhookService(h.pool, new ProviderSecretsService())

    const payload = JSON.stringify({
      type: 'email.delivered',
      data: { email_id: 'msg_resend_5', to: 'a2@example.com' },
    })
    const headers = makeHeaders('msg_svix_replay', payload)

    const first = await svc.handle(headers, payload)
    const second = await svc.handle(headers, payload)

    expect(first.processed).toBe(true)
    expect(second.processed).toBe(false)
    expect(h.deliveryLogs).toHaveLength(1) // side effects ran exactly once
  })

  it('rolls back the ledger row when side effects fail so the retry re-runs', async () => {
    const h = buildHarness({ failOnDeliveredUpdate: true })
    h.outboxRows.set(OUTBOX_ID, {
      id: OUTBOX_ID,
      profileId: PROFILE_ID,
      providerRef: 'msg_resend_6',
      status: 'sending',
    })
    const svc = new EmailWebhookService(h.pool, new ProviderSecretsService())

    const payload = JSON.stringify({
      type: 'email.delivered',
      data: { email_id: 'msg_resend_6', to: 'a3@example.com' },
    })
    const headers = makeHeaders('msg_svix_fail_then_retry', payload)

    // First delivery: apply() fails mid-transaction → 500, and the ledger
    // insert must roll back with the side effects (no half-applied state).
    const err = (await svc.handle(headers, payload).catch((e: unknown) => e)) as {
      getStatus?: () => number
    }
    expect(err.getStatus?.()).toBe(500)
    expect(h.eventsByToken.size).toBe(0)
    expect(h.deliveryLogs).toHaveLength(0)
    expect(h.outboxRows.get(OUTBOX_ID)!.status).toBe('sending')

    // Resend retries the same svix-id: the event must now process fully.
    h.failOnDeliveredUpdate.value = false
    const retry = await svc.handle(headers, payload)
    expect(retry.processed).toBe(true)
    expect(h.outboxRows.get(OUTBOX_ID)!.status).toBe('delivered')
    expect(h.deliveryLogs).toHaveLength(1)
  })

  it('rejects an invalid signature with 401', async () => {
    const h = buildHarness()
    const svc = new EmailWebhookService(h.pool, new ProviderSecretsService())

    const payload = JSON.stringify({ type: 'email.delivered', data: {} })
    const headers = makeHeaders('msg_svix_bad', payload, SECRET)
    headers.signature = 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

    const err = (await svc.handle(headers, payload).catch((e: unknown) => e)) as {
      getStatus?: () => number
    }
    expect(err.getStatus?.()).toBe(401)
    expect(h.eventsByToken.size).toBe(0)
  })

  it('refuses processing when no active Resend config exists (503)', async () => {
    const h = buildHarness({ activeConfig: false })
    const svc = new EmailWebhookService(h.pool, new ProviderSecretsService())

    const payload = JSON.stringify({ type: 'email.delivered', data: {} })
    const err = (await svc
      .handle(makeHeaders('msg_svix_nocfg', payload), payload)
      .catch((e: unknown) => e)) as { getStatus?: () => number }
    expect(err.getStatus?.()).toBe(503)
  })
})