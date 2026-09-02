/**
 * Unit tests for IdempotencyKeysRepository (T-04.2.03.03).
 *
 * Mocks the transaction client. Real unique-index + retry cache
 * behaviour is covered by the PostgreSQL integration suite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { INVOICE_WALLET_PAYMENT_ENTITY_TYPE } from '@barghsa/shared/finance'
import { IdempotencyKeysRepository } from './idempotency-keys.repository.js'

const NOW = new Date('2026-09-02T08:00:00.000Z')
const EXPIRES = new Date('2026-09-03T08:00:00.000Z')
const KEY = 'pay-1'
const ENTITY_ID = '11111111-1111-7111-8111-111111111111'

describe('IdempotencyKeysRepository (T-04.2.03.03)', () => {
  const client = { query: vi.fn() }
  const repo = new IdempotencyKeysRepository()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function claim() {
    return repo.claimOrLoad(client, {
      key: KEY,
      entityType: INVOICE_WALLET_PAYMENT_ENTITY_TYPE,
      entityId: ENTITY_ID,
      expiresAt: EXPIRES,
      now: NOW,
    })
  }

  it('claims a new (idempotencyKey, entityType) row', async () => {
    client.query.mockResolvedValueOnce({ rows: [{ id: 'claim-1' }] })

    await expect(claim()).resolves.toEqual({ kind: 'claimed' })
    expect(client.query.mock.calls[0]?.[0]).toContain('ON CONFLICT (idempotency_key, entity_type)')
    expect(client.query.mock.calls[0]?.[1]).toEqual([
      KEY,
      INVOICE_WALLET_PAYMENT_ENTITY_TYPE,
      ENTITY_ID,
      EXPIRES,
    ])
  })

  it('returns the cached JSON on retry', async () => {
    const cached = { ok: true, invoiceId: ENTITY_ID }
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ entity_id: ENTITY_ID, response: cached, expires_at: EXPIRES }],
      })

    await expect(claim()).resolves.toEqual({
      kind: 'cached',
      response: cached,
      entityId: ENTITY_ID,
    })
    expect(client.query.mock.calls[1]?.[0]).toContain('FOR UPDATE')
  })

  it('reports in-flight when response is still NULL and not expired', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ entity_id: ENTITY_ID, response: null, expires_at: EXPIRES }],
      })

    await expect(claim()).resolves.toEqual({ kind: 'in_flight' })
  })

  it('reclaims an expired in-flight row instead of 409ing', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            entity_id: ENTITY_ID,
            response: null,
            expires_at: new Date('2026-09-01T08:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'reclaim-1' }] })

    await expect(claim()).resolves.toEqual({ kind: 'claimed' })
    expect(client.query.mock.calls[2]?.[0]).toContain('response IS NULL')
  })

  it('persists the cached JSONB response onto the claimed row', async () => {
    client.query.mockResolvedValueOnce({ rows: [] })
    const response = { invoiceId: ENTITY_ID, toState: 'Paid' }

    await repo.persistResponse(client, {
      key: KEY,
      entityType: INVOICE_WALLET_PAYMENT_ENTITY_TYPE,
      entityId: ENTITY_ID,
      response,
    })

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('SET response = $3::jsonb'),
      [KEY, INVOICE_WALLET_PAYMENT_ENTITY_TYPE, JSON.stringify(response), ENTITY_ID],
    )
  })
})
