import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import type { GiftCodeService as ServiceType } from './gift-code.service.js'

/**
 * SQL-routing mock for @barghsa/db (same pattern as the VAT/catalogue
 * service tests): router.on(fragment, fn) dispatches by SQL content so
 * BEGIN/COMMIT and Promise.all reordering never break the queue.
 */
function makeDb() {
  type Handler = (values: unknown[], callIndex: number) => { rows: unknown[]; rowCount?: number | null }
  const handlers = new Map<string, Handler>()
  const callCounts = new Map<string, number>()
  const calls: Array<{ sql: string; values: unknown[]; executor: 'pool' | 'client' }> = []

  const route = async (
    sql: string,
    values: unknown[],
  ): Promise<{ rows: unknown[]; rowCount?: number | null }> => {
    for (const [frag, fn] of handlers) {
      if (sql.includes(frag)) {
        const idx = callCounts.get(frag) ?? 0
        callCounts.set(frag, idx + 1)
        return fn(values, idx)
      }
    }
    return { rows: [], rowCount: null }
  }

  // DISTINCT spies for pool and client: a test asserting a query ran on
  // the transaction executor (not a fresh pool connection) can tell them
  // apart — this is exactly how the in-tx profile-scope visibility bug
  // was caught.
  const client = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values, executor: 'client' })
      return route(sql, values)
    }),
    release: vi.fn(),
  }
  const pool = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values, executor: 'pool' })
      return route(sql, values)
    }),
    connect: async () => client,
  }

  const router = {
    on: (frag: string, fn: Handler) => handlers.set(frag, fn),
    calls,
    queries: (frag: string) => calls.filter((c) => c.sql.includes(frag)),
  }

  return { query: pool.query, pool, router }
}

function giftRow(over: Record<string, unknown> = {}) {
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    code: 'SALE10',
    discount_type: 'fixed_irr',
    discount_value: '500000',
    max_cap_irr: null,
    eligibility: 'public',
    total_limit: null,
    per_profile_limit: null,
    valid_from: '2026-01-01T00:00:00.000Z',
    valid_until: null,
    min_order_amount: '0',
    categories: [],
    status: 'active',
    created_by: 'user-admin-1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    consumed: 0,
    released: 0,
    total_discount: '0',
    ...over,
  }
}

function redemptionRow(over: Record<string, unknown> = {}) {
  return {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    gift_code_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    profile_id: 'prof-1',
    order_id: 'ord-1',
    discount_amount: '500000',
    status: 'consumed',
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

const ACTOR = 'user-admin-1'
const CODE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PROFILE_ID = '11111111-1111-4111-8111-111111111111'

/** Load GiftCodeService with a mocked @barghsa/db pool. */
async function loadService(pool: { query: ReturnType<typeof vi.fn> }) {
  vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
  const { GiftCodeService: Svc } = await import('./gift-code.service.js')
  const correlationIdProvider = { getCorrelationId: () => 'corr-gift-test-1' }
  return new Svc(correlationIdProvider as never) as ServiceType
}

let service: ServiceType

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

const createInput = {
  code: ' sale10 ',
  discountType: 'fixed_irr' as const,
  discountValue: '500000',
  maxCapIrr: null,
  eligibility: 'public' as const,
  profileIds: [],
  totalLimit: null,
  perProfileLimit: null,
  validUntil: null,
  minOrderAmount: '0',
  categories: [],
  actorUserId: ACTOR,
  ip: '127.0.0.1',
}

describe('GiftCodeService (T-09.12.03)', () => {
  describe('list', () => {
    it('returns codes with usage aggregates and profile scopes', async () => {
      const { pool, router } = makeDb()
      router.on('ANY($1::uuid[])', () => ({
        rows: [{ gift_code_id: CODE_ID, profile_id: PROFILE_ID }],
      }))
      router.on('FROM gift_codes gc', () => ({
        rows: [giftRow({ eligibility: 'profile', consumed: 3, released: 1, total_discount: '1500000' })],
      }))
      service = await loadService(pool)

      const result = await service.list({})

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        code: 'SALE10',
        discountType: 'fixed_irr',
        discountValue: '500000',
        profileIds: [PROFILE_ID],
        usage: { consumed: 3, released: 1, totalDiscountIrr: '1500000' },
      })
    })

    it('applies search/status/discountType filters', async () => {
      const { pool, router } = makeDb()
      const seen: unknown[][] = []
      router.on('FROM gift_codes gc', (values) => {
        seen.push(values)
        return { rows: [] }
      })
      service = await loadService(pool)

      await service.list({ search: 'sale', status: 'active', discountType: 'percentage' })

      expect(seen[0]).toEqual(['SALE', 'active', 'percentage'])
    })
  })

  describe('stats', () => {
    it('returns per-profile usage and recent redemptions', async () => {
      const { pool, router } = makeDb()
      router.on('GROUP BY gc.id', () => ({ rows: [giftRow()] }))
      router.on('ANY($1::uuid[])', () => ({ rows: [] }))
      router.on('GROUP BY profile_id', () => ({
        rows: [{ profile_id: PROFILE_ID, consumed: 2, released: 0, discount_irr: '1000000' }],
      }))
      router.on('FROM gift_code_redemptions', () => ({ rows: [redemptionRow()] }))
      service = await loadService(pool)

      const result = await service.stats(CODE_ID)

      expect(result.code.id).toBe(CODE_ID)
      expect(result.perProfile).toEqual([
        { profileId: PROFILE_ID, consumed: 2, released: 0, discountIrr: '1000000' },
      ])
      expect(result.recentRedemptions[0]).toMatchObject({
        orderId: 'ord-1',
        discountAmount: '500000',
        status: 'consumed',
      })
    })

    it('throws 404 for an unknown code', async () => {
      const { pool, router } = makeDb()
      router.on('GROUP BY gc.id', () => ({ rows: [] }))
      service = await loadService(pool)

      await expect(service.stats(CODE_ID)).rejects.toThrow(/not found/)
    })
  })

  describe('create', () => {
    it('normalizes the code and persists + audits in one transaction', async () => {
      const { pool, router } = makeDb()
      router.on('SELECT 1 FROM gift_codes WHERE code = $1', () => ({ rows: [] }))
      router.on('INSERT INTO gift_codes', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
      router.on('GROUP BY gc.id', () => ({ rows: [giftRow()] }))
      router.on('ANY($1::uuid[])', () => ({ rows: [] }))
      service = await loadService(pool)

      const result = await service.create(createInput)

      expect(result.code).toBe('SALE10') // trimmed + uppercased
      expect(result.status).toBe('active')
      const insert = router.queries('INSERT INTO gift_codes')[0]!
      expect(insert.values).toContain('SALE10')
      expect(insert.values).toContain('500000')
      const audit = router.queries('INSERT INTO audit_log')[0]!
      expect(JSON.parse(String(audit.values[2]))).toMatchObject({
        entity: 'gift_code',
        action: 'created',
        code: 'SALE10',
      })
    })

    it('rejects a duplicate normalized code with 409', async () => {
      const { pool, router } = makeDb()
      router.on('SELECT 1 FROM gift_codes WHERE code = $1', () => ({ rows: [{ id: CODE_ID }] }))
      service = await loadService(pool)

      await expect(service.create(createInput)).rejects.toThrow(/already exists/)
      const err = await service.create(createInput).catch((e: { status: number }) => e)
      expect(err.status).toBe(409)
    })

    it('rejects a percentage code without a required max cap', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)

      const err = await service
        .create({
          ...createInput,
          discountType: 'percentage',
          discountValue: '2500',
          maxCapIrr: null,
        })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(HttpException)
      const body = (err as HttpException).getResponse() as {
        details: Array<{ path: string; message: string }>
      }
      expect(body.details.some((d) => d.path === 'maxCapIrr')).toBe(true)
    })

    it('rejects maxCapIrr on a fixed_irr code', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)

      const err = await service
        .create({ ...createInput, maxCapIrr: '100000' })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(HttpException)
      const body = (err as HttpException).getResponse() as {
        details: Array<{ path: string; message: string }>
      }
      expect(body.details.some((d) => d.path === 'maxCapIrr')).toBe(true)
    })

    it('requires profile scopes for profile-restricted codes', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)

      await expect(
        service.create({ ...createInput, eligibility: 'profile', profileIds: [] }),
      ).rejects.toThrow(/require at least one profile/)
    })

    it('persists profile scopes for profile-restricted codes', async () => {
      const { pool, router } = makeDb()
      router.on('SELECT 1 FROM gift_codes WHERE code = $1', () => ({ rows: [] }))
      router.on('INSERT INTO gift_codes', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO gift_code_profiles', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
      router.on('GROUP BY gc.id', () => ({
        rows: [giftRow({ eligibility: 'profile', profile_ids: [PROFILE_ID] })],
      }))
      router.on('ANY($1::uuid[])', () => ({
        rows: [{ gift_code_id: CODE_ID, profile_id: PROFILE_ID }],
      }))
      service = await loadService(pool)

      const result = await service.create({
        ...createInput,
        eligibility: 'profile',
        profileIds: [PROFILE_ID, PROFILE_ID],
      })

      expect(result.profileIds).toEqual([PROFILE_ID])
      expect(router.queries('INSERT INTO gift_code_profiles')).toHaveLength(1) // deduped
    })

    it('creates a percentage code with string basis points and a required cap', async () => {
      const { pool, router } = makeDb()
      router.on('SELECT 1 FROM gift_codes WHERE code = $1', () => ({ rows: [] }))
      router.on('INSERT INTO gift_codes', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
      router.on('GROUP BY gc.id', () => ({
        rows: [giftRow({ discount_type: 'percentage', discount_value: '2500', max_cap_irr: '1000000' })],
      }))
      router.on('ANY($1::uuid[])', () => ({ rows: [] }))
      service = await loadService(pool)

      const result = await service.create({
        ...createInput,
        code: 'PCT25',
        discountType: 'percentage',
        discountValue: '2500',
        maxCapIrr: '1000000',
      })

      expect(result.discountType).toBe('percentage')
      expect(result.discountValue).toBe('2500')
      expect(result.maxCapIrr).toBe('1000000')
      const insert = router.queries('INSERT INTO gift_codes')[0]!
      expect(insert.values).toContain('percentage')
      expect(insert.values).toContain('2500')
      expect(insert.values).toContain('1000000') // required cap persisted
    })

    it('reads profile scopes INSIDE the write transaction (not a fresh pool connection)', async () => {
      const { pool, router } = makeDb()
      router.on('SELECT 1 FROM gift_codes WHERE code = $1', () => ({ rows: [] }))
      router.on('INSERT INTO gift_codes', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO gift_code_profiles', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
      router.on('GROUP BY gc.id', () => ({
        rows: [giftRow({ eligibility: 'profile' })],
      }))
      router.on('ANY($1::uuid[])', () => ({
        rows: [{ gift_code_id: CODE_ID, profile_id: PROFILE_ID }],
      }))
      service = await loadService(pool)

      const result = await service.create({
        ...createInput,
        eligibility: 'profile',
        profileIds: [PROFILE_ID],
      })

      expect(result.profileIds).toEqual([PROFILE_ID])
      // The scope SELECT must have run on the transaction CLIENT (the
      // uncommitted join rows are invisible to a fresh pool connection).
      const attach = router.queries('ANY($1::uuid[])')
      expect(attach).toHaveLength(1)
      expect(attach[0]!.executor).toBe('client')
    })

    it('rejects invalid code charset', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)

      await expect(
        service.create({ ...createInput, code: 'bad code!' }),
      ).rejects.toThrow(/3-64 characters/)
    })
  })

  describe('update', () => {
    it('re-normalizes a changed code and checks uniqueness excluding self', async () => {
      const { pool, router } = makeDb()
      router.on('WHERE id = $1', () => ({ rows: [giftRow()] })) // findById
      router.on('WHERE code = $1 AND id <> $2', () => ({ rows: [] })) // dup check
      router.on('UPDATE gift_codes', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
      router.on('GROUP BY gc.id', () => ({ rows: [giftRow({ code: 'SALE20' })] }))
      router.on('ANY($1::uuid[])', () => ({ rows: [] }))
      service = await loadService(pool)

      const result = await service.update(CODE_ID, {
        code: ' sale20 ',
        actorUserId: ACTOR,
        ip: '127.0.0.1',
      })

      expect(result.code).toBe('SALE20')
      const update = router.queries('UPDATE gift_codes')[0]!
      expect(update.values[0]).toBe('SALE20')
      expect(update.values[12]).toBe(CODE_ID)
    })

    it('rejects a rename onto an existing code', async () => {
      const { pool, router } = makeDb()
      router.on('WHERE id = $1', () => ({ rows: [giftRow()] }))
      router.on('WHERE code = $1 AND id <> $2', () => ({ rows: [{ id: 'other' }] }))
      service = await loadService(pool)

      await expect(
        service.update(CODE_ID, { code: 'OTHER', actorUserId: ACTOR, ip: 'x' }),
      ).rejects.toThrow(/already exists/)
    })

    it('converts a percentage code to fixed_irr by dropping the stale cap', async () => {
      const { pool, router } = makeDb()
      const current = giftRow({
        discount_type: 'percentage',
        discount_value: '2500',
        max_cap_irr: '1000000',
      })
      router.on('WHERE id = $1', () => ({ rows: [current] }))
      router.on('UPDATE gift_codes', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
      router.on('GROUP BY gc.id', () => ({
        rows: [giftRow({ discount_type: 'fixed_irr', discount_value: '100000', max_cap_irr: null })],
      }))
      router.on('ANY($1::uuid[])', () => ({ rows: [] }))
      service = await loadService(pool)

      const result = await service.update(CODE_ID, {
        discountType: 'fixed_irr',
        discountValue: '100000',
        actorUserId: ACTOR,
        ip: 'x',
      })

      expect(result.discountType).toBe('fixed_irr')
      expect(result.maxCapIrr).toBeNull()
      const update = router.queries('UPDATE gift_codes')[0]!
      // max_cap_irr column index 3 is forced to NULL on conversion
      expect(update.values[3]).toBeNull()
      expect(update.values[0]).toBe(current.code)
    })

    it('replaces profile scopes when switching eligibility', async () => {
      const { pool, router } = makeDb()
      router.on('WHERE id = $1', () => ({ rows: [giftRow()] }))
      router.on('UPDATE gift_codes', () => ({ rows: [], rowCount: 1 }))
      router.on('DELETE FROM gift_code_profiles', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO gift_code_profiles', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
      router.on('GROUP BY gc.id', () => ({
        rows: [giftRow({ eligibility: 'profile', profile_ids: [PROFILE_ID] })],
      }))
      router.on('ANY($1::uuid[])', () => ({
        rows: [{ gift_code_id: CODE_ID, profile_id: PROFILE_ID }],
      }))
      service = await loadService(pool)

      await service.update(CODE_ID, {
        eligibility: 'profile',
        profileIds: [PROFILE_ID],
        actorUserId: ACTOR,
        ip: 'x',
      })

      expect(router.queries('DELETE FROM gift_code_profiles')).toHaveLength(1)
      expect(router.queries('INSERT INTO gift_code_profiles')).toHaveLength(1)
    })
  })

  describe('setStatus', () => {
    it('toggles status and audits the change', async () => {
      const { pool, router } = makeDb()
      router.on('WHERE id = $1', () => ({ rows: [giftRow()] }))
      router.on('UPDATE gift_codes', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
      router.on('GROUP BY gc.id', () => ({ rows: [giftRow({ status: 'inactive' })] }))
      router.on('ANY($1::uuid[])', () => ({ rows: [] }))
      service = await loadService(pool)

      const result = await service.setStatus(CODE_ID, 'inactive', ACTOR, '127.0.0.1')

      expect(result.status).toBe('inactive')
      const audit = router.queries('INSERT INTO audit_log')[0]!
      expect(JSON.parse(String(audit.values[2]))).toMatchObject({ action: 'deactivated' })
    })

    it('is a no-op when the status is unchanged (no audit)', async () => {
      const { pool, router } = makeDb()
      router.on('WHERE id = $1', () => ({ rows: [giftRow()] }))
      router.on('GROUP BY gc.id', () => ({ rows: [giftRow()] }))
      router.on('ANY($1::uuid[])', () => ({ rows: [] }))
      service = await loadService(pool)

      await service.setStatus(CODE_ID, 'active', ACTOR, '127.0.0.1')

      expect(router.queries('UPDATE gift_codes')).toHaveLength(0)
      expect(router.queries('INSERT INTO audit_log')).toHaveLength(0)
    })
  })

  describe('redeem', () => {
    it('redeems a public fixed_irr code inside its own transaction', async () => {
      const { pool, router } = makeDb()
      router.on('FOR UPDATE', () => ({ rows: [giftRow()] }))
      router.on('INSERT INTO gift_code_redemptions', () => ({
        rows: [redemptionRow()],
        rowCount: 1,
      }))
      service = await loadService(pool)

      const result = await service.redeem({
        giftCode: ' sale10 ',
        profileId: 'prof-1',
        orderId: 'ord-1',
        orderAmount: '2000000',
        category: 'electricity',
      })

      expect(result.discountAmount).toBe('500000')
      expect(result.status).toBe('consumed')
      // Locked read + insert happened inside BEGIN/COMMIT
      expect(router.queries('FOR UPDATE')).toHaveLength(1)
      const begin = router.calls.filter((c) => c.sql === 'BEGIN')
      const commit = router.calls.filter((c) => c.sql === 'COMMIT')
      expect(begin.length).toBe(1)
      expect(commit.length).toBe(1)
      // The stored code is normalized
      expect(router.queries('FOR UPDATE')[0]!.values[0]).toBe('SALE10')
    })

    it('caps a percentage discount at maxCapIrr', async () => {
      const { pool, router } = makeDb()
      router.on('FOR UPDATE', () => ({
        rows: [giftRow({ discount_type: 'percentage', discount_value: '2500', max_cap_irr: '300000' })],
      }))
      router.on('INSERT INTO gift_code_redemptions', () => ({
        rows: [redemptionRow({ discount_amount: '300000' })],
        rowCount: 1,
      }))
      service = await loadService(pool)

      const result = await service.redeem({
        giftCode: 'PCT25',
        profileId: 'prof-1',
        orderId: 'ord-1',
        orderAmount: '2000000',
        category: 'electricity',
      })

      expect(result.discountAmount).toBe('300000') // 25% of 2M = 500k, capped at 300k
    })

    it('rejects an unknown code with 404', async () => {
      const { pool, router } = makeDb()
      router.on('FOR UPDATE', () => ({ rows: [] }))
      service = await loadService(pool)

      const err = await service.redeem({
        giftCode: 'NOPE',
        profileId: 'prof-1',
        orderId: 'ord-1',
        orderAmount: '1000000',
        category: 'electricity',
      }).catch((e: { status: number }) => e)
      expect(err.status).toBe(404)
    })

    it('rejects an inactive code', async () => {
      const { pool, router } = makeDb()
      router.on('FOR UPDATE', () => ({ rows: [giftRow({ status: 'inactive' })] }))
      service = await loadService(pool)

      await expect(
        service.redeem({ giftCode: 'SALE10', profileId: 'prof-1', orderId: 'ord-1', orderAmount: '1000000', category: 'electricity' }),
      ).rejects.toThrow(/not active/)
    })

    it('rejects a not-yet-valid code', async () => {
      const { pool, router } = makeDb()
      router.on('FOR UPDATE', () => ({
        rows: [giftRow({ valid_from: '2999-01-01T00:00:00.000Z' })],
      }))
      service = await loadService(pool)

      await expect(
        service.redeem({ giftCode: 'SALE10', profileId: 'prof-1', orderId: 'ord-1', orderAmount: '1000000', category: 'electricity' }),
      ).rejects.toThrow(/not valid yet/)
    })

    it('rejects an expired code', async () => {
      const { pool, router } = makeDb()
      router.on('FOR UPDATE', () => ({
        rows: [giftRow({ valid_until: '2020-01-01T00:00:00.000Z' })],
      }))
      service = await loadService(pool)

      await expect(
        service.redeem({ giftCode: 'SALE10', profileId: 'prof-1', orderId: 'ord-1', orderAmount: '1000000', category: 'electricity' }),
      ).rejects.toThrow(/expired/)
    })

    it('rejects a code not eligible for the profile', async () => {
      const { pool, router } = makeDb()
      router.on('FOR UPDATE', () => ({ rows: [giftRow({ eligibility: 'profile' })] }))
      router.on('FROM gift_code_profiles WHERE gift_code_id = $1', () => ({ rows: [] }))
      service = await loadService(pool)

      await expect(
        service.redeem({ giftCode: 'SALE10', profileId: 'prof-1', orderId: 'ord-1', orderAmount: '1000000', category: 'electricity' }),
      ).rejects.toThrow(/not eligible/)
    })

    it('accepts a profile-restricted code for an allowed profile', async () => {
      const { pool, router } = makeDb()
      router.on('FOR UPDATE', () => ({ rows: [giftRow({ eligibility: 'profile' })] }))
      router.on('FROM gift_code_profiles WHERE gift_code_id = $1', () => ({
        rows: [{ gift_code_id: CODE_ID, profile_id: 'prof-1' }],
      }))
      router.on('INSERT INTO gift_code_redemptions', () => ({
        rows: [redemptionRow()],
        rowCount: 1,
      }))
      service = await loadService(pool)

      const result = await service.redeem({
        giftCode: 'SALE10',
        profileId: 'prof-1',
        orderId: 'ord-1',
        orderAmount: '1000000',
        category: 'electricity',
      })
      expect(result.status).toBe('consumed')
    })

    it('enforces the total usage limit', async () => {
      const { pool, router } = makeDb()
      router.on('FOR UPDATE', () => ({ rows: [giftRow({ total_limit: 1 })] }))
      router.on("status = 'consumed'", () => ({ rows: [{ n: 1 }] }))
      service = await loadService(pool)

      await expect(
        service.redeem({ giftCode: 'SALE10', profileId: 'prof-1', orderId: 'ord-1', orderAmount: '1000000', category: 'electricity' }),
      ).rejects.toThrow(/usage limit reached/)
    })

    it('enforces the per-profile usage limit', async () => {
      const { pool, router } = makeDb()
      router.on('FOR UPDATE', () => ({ rows: [giftRow({ per_profile_limit: 1 })] }))
      router.on("status = 'consumed'", () => ({ rows: [{ n: 1 }] }))
      service = await loadService(pool)

      await expect(
        service.redeem({ giftCode: 'SALE10', profileId: 'prof-1', orderId: 'ord-1', orderAmount: '1000000', category: 'electricity' }),
      ).rejects.toThrow(/limit reached for this profile/)
    })

    it('enforces the minimum order amount', async () => {
      const { pool, router } = makeDb()
      router.on('FOR UPDATE', () => ({ rows: [giftRow({ min_order_amount: '2000000' })] }))
      service = await loadService(pool)

      await expect(
        service.redeem({ giftCode: 'SALE10', profileId: 'prof-1', orderId: 'ord-1', orderAmount: '1000000', category: 'electricity' }),
      ).rejects.toThrow(/minimum order of 2000000/)
    })

    it('enforces eligible categories', async () => {
      const { pool, router } = makeDb()
      router.on('FOR UPDATE', () => ({ rows: [giftRow({ categories: ['electricity'] })] }))
      service = await loadService(pool)

      await expect(
        service.redeem({ giftCode: 'SALE10', profileId: 'prof-1', orderId: 'ord-1', orderAmount: '1000000', category: 'hardware' }),
      ).rejects.toThrow(/does not apply to category hardware/)
    })

    it('runs on a caller-provided executor without opening its own transaction', async () => {
      const { pool, router } = makeDb()
      router.on('FOR UPDATE', () => ({ rows: [giftRow()] }))
      router.on('INSERT INTO gift_code_redemptions', () => ({
        rows: [redemptionRow()],
        rowCount: 1,
      }))
      service = await loadService(pool)

      // Caller passes its own transactional client (orders module flow).
      const result = await service.redeem(
        {
          giftCode: 'SALE10',
          profileId: 'prof-1',
          orderId: 'ord-1',
          orderAmount: '2000000',
          category: 'electricity',
        },
        pool as never,
      )

      expect(result.discountAmount).toBe('500000')
      // No BEGIN/COMMIT opened by the service itself
      expect(router.calls.filter((c) => c.sql === 'BEGIN')).toHaveLength(0)
      expect(router.calls.filter((c) => c.sql === 'COMMIT')).toHaveLength(0)
      // Note: the pool and client share the same `query` spy, so all queries
      // are visible; the test proves the service added no transaction control.
    })

    it('locks the code row FOR UPDATE before counting consumed redemptions', async () => {
      const { pool, router } = makeDb()
      const rows: Array<{ sql: string }> = []
      router.on('FOR UPDATE', (values) => {
        rows.push({ sql: 'FOR UPDATE' })
        return { rows: [giftRow({ total_limit: 2 })] }
      })
      router.on("status = 'consumed'", () => {
        rows.push({ sql: "COUNT status = 'consumed'" })
        return { rows: [{ n: 1 }] }
      })
      router.on('INSERT INTO gift_code_redemptions', () => ({
        rows: [redemptionRow()],
        rowCount: 1,
      }))
      service = await loadService(pool)

      await service.redeem({
        giftCode: 'SALE10',
        profileId: 'prof-1',
        orderId: 'ord-1',
        orderAmount: '2000000',
        category: 'electricity',
      })

      // The lock MUST precede the limit counts, or concurrent redemptions
      // could oversell (a reordered implementation fails this test).
      const lockIdx = rows.findIndex((r) => r.sql === 'FOR UPDATE')
      const countIdx = rows.findIndex((r) => r.sql.includes('COUNT'))
      expect(lockIdx).toBeGreaterThanOrEqual(0)
      expect(countIdx).toBeGreaterThan(lockIdx)
    })

    it('records a change_recorded audit entry with the redemption (same executor)', async () => {
      const { pool, router } = makeDb()
      router.on('FOR UPDATE', () => ({ rows: [giftRow()] }))
      router.on('INSERT INTO gift_code_redemptions', () => ({
        rows: [redemptionRow()],
        rowCount: 1,
      }))
      router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
      service = await loadService(pool)

      await service.redeem({
        giftCode: 'SALE10',
        profileId: 'prof-1',
        orderId: 'ord-1',
        orderAmount: '2000000',
        category: 'electricity',
        actorUserId: 'user-1',
        ip: '127.0.0.1',
      })

      const audit = router.queries('INSERT INTO audit_log')[0]!
      expect(JSON.parse(String(audit.values[2]))).toMatchObject({
        entity: 'gift_code',
        action: 'redeemed',
        orderId: 'ord-1',
      })
    })
  })

  describe('releaseByOrder', () => {
    it('flips consumed redemptions to released and reports the count', async () => {
      const { pool, router } = makeDb()
      router.on('UPDATE gift_code_redemptions', () => ({
        rows: [],
        rowCount: 2,
      }))
      service = await loadService(pool)

      const result = await service.releaseByOrder('ord-1')

      expect(result).toEqual({ released: 2 })
      const update = router.queries('UPDATE gift_code_redemptions')[0]!
      expect(update.values[0]).toBe('ord-1')
    })

    it('is idempotent when nothing is consumed', async () => {
      const { pool, router } = makeDb()
      router.on('UPDATE gift_code_redemptions', () => ({
        rows: [],
        rowCount: 0,
      }))
      service = await loadService(pool)

      const result = await service.releaseByOrder('ord-1')

      expect(result).toEqual({ released: 0 })
    })

    it('runs on a caller-provided executor and audits the release', async () => {
      const { pool, router } = makeDb()
      router.on('UPDATE gift_code_redemptions', () => ({
        rows: [],
        rowCount: 1,
      }))
      router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
      service = await loadService(pool)

      const result = await service.releaseByOrder(
        'ord-1',
        pool as never,
        { actorUserId: 'user-1', ip: '127.0.0.1' },
      )

      expect(result).toEqual({ released: 1 })
      // No transaction control opened by the service itself.
      expect(router.calls.filter((c) => c.sql === 'BEGIN')).toHaveLength(0)
      const audit = router.queries('INSERT INTO audit_log')[0]!
      expect(JSON.parse(String(audit.values[2]))).toMatchObject({
        entity: 'gift_code',
        action: 'released',
        orderId: 'ord-1',
      })
    })
  })
})
