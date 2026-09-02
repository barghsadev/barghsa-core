/**
 * Real-PostgreSQL tests for the unique `(idempotencyKey, entityType)`
 * cache (T-04.2.03.03).
 *
 * Proves against actual PostgreSQL that:
 *   1. A first claim inserts the unique row.
 *   2. Persisting JSON and retrying returns that cached result.
 *   3. A second insert of the same pair is rejected (23505).
 *   4. The same key is allowed under a different entityType.
 *   5. An in-flight NULL response is reported until expires_at.
 *   6. An expired in-flight row is reclaimed and can cache a new result.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import { INVOICE_WALLET_PAYMENT_ENTITY_TYPE } from '@barghsa/shared/finance'
import { IdempotencyKeysRepository } from './idempotency-keys.repository.js'

const UUIDV7_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0000_init_uuidv7_function.sql',
)
const IDEMPOTENCY_KEYS_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0073_create_idempotency_keys.sql',
)

const NOW = new Date('2026-09-02T08:00:00.000Z')
const EXPIRES = new Date('2026-09-03T08:00:00.000Z')
const ENTITY_ID = '11111111-1111-7111-8111-111111111111'

describe('IdempotencyKeysRepository — real PostgreSQL (T-04.2.03.03)', () => {
  let ctx: IsolatedTestDb
  const repo = new IdempotencyKeysRepository()

  beforeAll(async () => {
    ctx = await createIsolatedTestDb()
    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(IDEMPOTENCY_KEYS_MIGRATION, 'utf-8').trim())
  }, 60_000)

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  it('caches the JSON result so a retry never inserts a second row', async () => {
    const key = 'pay-retry-cache'
    const cached = { invoiceId: ENTITY_ID, toState: 'Paid', remainingPaid: '1000000' }
    const client = await ctx.pool.connect()
    try {
      await client.query('BEGIN')
      const first = await repo.claimOrLoad(client, {
        key,
        entityType: INVOICE_WALLET_PAYMENT_ENTITY_TYPE,
        entityId: ENTITY_ID,
        expiresAt: EXPIRES,
        now: NOW,
      })
      expect(first).toEqual({ kind: 'claimed' })
      await repo.persistResponse(client, {
        key,
        entityType: INVOICE_WALLET_PAYMENT_ENTITY_TYPE,
        entityId: ENTITY_ID,
        response: cached,
      })
      await client.query('COMMIT')
    } finally {
      client.release()
    }

    const retryClient = await ctx.pool.connect()
    try {
      await retryClient.query('BEGIN')
      const retry = await repo.claimOrLoad(retryClient, {
        key,
        entityType: INVOICE_WALLET_PAYMENT_ENTITY_TYPE,
        entityId: ENTITY_ID,
        expiresAt: EXPIRES,
        now: NOW,
      })
      expect(retry).toEqual({
        kind: 'cached',
        response: cached,
        entityId: ENTITY_ID,
      })
      await retryClient.query('COMMIT')
    } finally {
      retryClient.release()
    }

    const count = await ctx.pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM idempotency_keys WHERE idempotency_key = $1`,
      [key],
    )
    expect(Number(count.rows[0]?.n)).toBe(1)
  })

  it('refuses a second row with the same (idempotency_key, entity_type)', async () => {
    await ctx.pool.query(
      `INSERT INTO idempotency_keys (idempotency_key, entity_type, entity_id, response)
       VALUES ('pay-unique', $1, $2, '{"ok":true}'::jsonb)`,
      [INVOICE_WALLET_PAYMENT_ENTITY_TYPE, ENTITY_ID],
    )
    await expect(
      ctx.pool.query(
        `INSERT INTO idempotency_keys (idempotency_key, entity_type, entity_id)
         VALUES ('pay-unique', $1, $2)`,
        [INVOICE_WALLET_PAYMENT_ENTITY_TYPE, '22222222-2222-7222-8222-222222222222'],
      ),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('allows the same idempotency key under a different entity_type', async () => {
    const key = 'pay-shared-type'
    await ctx.pool.query(
      `INSERT INTO idempotency_keys (idempotency_key, entity_type)
       VALUES ($1, $2)`,
      [key, INVOICE_WALLET_PAYMENT_ENTITY_TYPE],
    )
    await ctx.pool.query(
      `INSERT INTO idempotency_keys (idempotency_key, entity_type)
       VALUES ($1, 'wallet_topup')`,
      [key],
    )
    const count = await ctx.pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM idempotency_keys WHERE idempotency_key = $1`,
      [key],
    )
    expect(Number(count.rows[0]?.n)).toBe(2)
  })

  it('reports in-flight while response is NULL and expires_at is in the future', async () => {
    const key = 'pay-in-flight'
    await ctx.pool.query(
      `INSERT INTO idempotency_keys (idempotency_key, entity_type, entity_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [key, INVOICE_WALLET_PAYMENT_ENTITY_TYPE, ENTITY_ID, EXPIRES],
    )
    const client = await ctx.pool.connect()
    try {
      await client.query('BEGIN')
      const claim = await repo.claimOrLoad(client, {
        key,
        entityType: INVOICE_WALLET_PAYMENT_ENTITY_TYPE,
        entityId: ENTITY_ID,
        expiresAt: EXPIRES,
        now: NOW,
      })
      expect(claim).toEqual({ kind: 'in_flight' })
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
  })

  it('reclaims an expired in-flight row and then caches the retry result', async () => {
    const key = 'pay-expired-reclaim'
    await ctx.pool.query(
      `INSERT INTO idempotency_keys (idempotency_key, entity_type, entity_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [key, INVOICE_WALLET_PAYMENT_ENTITY_TYPE, ENTITY_ID, new Date('2026-09-01T08:00:00.000Z')],
    )
    const cached = { invoiceId: ENTITY_ID, toState: 'Paid' }
    const client = await ctx.pool.connect()
    try {
      await client.query('BEGIN')
      const claim = await repo.claimOrLoad(client, {
        key,
        entityType: INVOICE_WALLET_PAYMENT_ENTITY_TYPE,
        entityId: ENTITY_ID,
        expiresAt: EXPIRES,
        now: NOW,
      })
      expect(claim).toEqual({ kind: 'claimed' })
      await repo.persistResponse(client, {
        key,
        entityType: INVOICE_WALLET_PAYMENT_ENTITY_TYPE,
        entityId: ENTITY_ID,
        response: cached,
      })
      await client.query('COMMIT')
    } finally {
      client.release()
    }

    const retryClient = await ctx.pool.connect()
    try {
      await retryClient.query('BEGIN')
      const retry = await repo.claimOrLoad(retryClient, {
        key,
        entityType: INVOICE_WALLET_PAYMENT_ENTITY_TYPE,
        entityId: ENTITY_ID,
        expiresAt: EXPIRES,
        now: NOW,
      })
      expect(retry.kind).toBe('cached')
      if (retry.kind === 'cached') {
        expect(retry.response).toEqual(cached)
      }
      await retryClient.query('COMMIT')
    } finally {
      retryClient.release()
    }
  })
})
