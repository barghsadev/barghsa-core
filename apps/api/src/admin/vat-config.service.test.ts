import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { VatConfigService as ServiceType } from './vat-config.service.js'

/**
 * SQL-routing mock for @barghsa/db (same pattern as the catalogue
 * service tests): router.on(fragment, fn) dispatches by SQL content so
 * BEGIN/COMMIT and Promise.all reordering never break the queue.
 */
function makeDb() {
  type Handler = (values: unknown[], callIndex: number) => { rows: unknown[]; rowCount?: number | null }
  const handlers = new Map<string, Handler>()
  const callCounts = new Map<string, number>()
  const calls: Array<{ sql: string; values: unknown[] }> = []

  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values })
    for (const [frag, fn] of handlers) {
      if (sql.includes(frag)) {
        const idx = callCounts.get(frag) ?? 0
        callCounts.set(frag, idx + 1)
        return fn(values, idx)
      }
    }
    return { rows: [], rowCount: null }
  })

  const client = { query, release: vi.fn() }
  const pool = { query, connect: async () => client }

  const router = {
    on: (frag: string, fn: Handler) => handlers.set(frag, fn),
    calls,
    queries: (frag: string) => calls.filter((c) => c.sql.includes(frag)),
  }

  return { query, pool, router }
}

function configRow(over: Record<string, unknown> = {}) {
  return {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    category: 'electricity',
    rate: 900,
    effective_from: '2026-01-01T00:00:00.000Z',
    effective_until: null,
    created_by: 'user-admin-1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function overrideRow(over: Record<string, unknown> = {}) {
  return {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    product_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    vat_config_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    rate: 500,
    category: 'product_override',
    effective_from: '2026-01-01T00:00:00.000Z',
    effective_until: null,
    created_by: 'user-admin-1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

const ACTOR = 'user-admin-1'
const CONFIG_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OVERRIDE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

/** Load VatConfigService with a mocked @barghsa/db pool. */
async function loadService(pool: { query: ReturnType<typeof vi.fn> }) {
  vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
  const { VatConfigService: Svc } = await import('./vat-config.service.js')
  return new Svc() as ServiceType
}

let service: ServiceType

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('VatConfigService (T-09.12.02)', () => {
  describe('list', () => {
    it('returns rates with derived status and optional category filter', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      router.on('FROM vat_configurations', () => ({
        rows: [
          configRow(),
          configRow({
            id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            category: 'consultation',
            rate: 0,
            effective_from: '2026-12-01T00:00:00.000Z',
          }),
          configRow({
            id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
            category: 'hardware',
            rate: 1000,
            effective_from: '2025-01-01T00:00:00.000Z',
            effective_until: '2025-06-01T00:00:00.000Z',
          }),
        ],
      }))

      const result = await service.list()

      expect(result).toHaveLength(3)
      expect(result[0]).toMatchObject({
        category: 'electricity',
        rateBasisPoints: 900,
        status: 'current',
      })
      expect(result[1]).toMatchObject({ category: 'consultation', status: 'scheduled' })
      expect(result[2]).toMatchObject({ category: 'hardware', status: 'expired' })
    })

    it('rejects an unknown category filter', async () => {
      const { pool } = makeDb()
      service = await loadService(pool)
      await expect(service.list('vat_on_moon_shuttles')).rejects.toMatchObject({ status: 400 })
    })
  })

  describe('createRate', () => {
    it('creates a rate when no open rate exists for the category', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      router.on('WHERE category = $1 AND effective_until IS NULL', () => ({
        rows: [],
      }))
      router.on('INSERT INTO vat_configurations', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
      // readConfig re-read after insert
      router.on('FROM vat_configurations\n        WHERE id = $1', () => ({ rows: [configRow()] }))

      const result = await service.createRate({
        category: 'electricity',
        rateBasisPoints: 900,
        actorUserId: ACTOR,
        ip: '127.0.0.1',
      })

      expect(result).toMatchObject({ rateBasisPoints: 900, status: 'current' })
      const audit = router.queries('INSERT INTO audit_log')[0]
      expect(audit!.values[2]).toContain('"entity":"vat_configuration"')
      expect(audit!.values[2]).toContain('"action":"created"')
    })

    it('rejects invalid category and out-of-range rates', async () => {
      const { pool } = makeDb()
      service = await loadService(pool)
      await expect(
        service.createRate({ category: 'bogus', rateBasisPoints: 900, actorUserId: ACTOR, ip: '' }),
      ).rejects.toMatchObject({ status: 400 })
      await expect(
        service.createRate({ category: 'electricity', rateBasisPoints: 10_001, actorUserId: ACTOR, ip: '' }),
      ).rejects.toMatchObject({ status: 400 })
      await expect(
        service.createRate({ category: 'electricity', rateBasisPoints: -1, actorUserId: ACTOR, ip: '' }),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('closes the previous open rate at the new effective_from (versioning)', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      router.on('WHERE category = $1 AND effective_until IS NULL', () => ({
        rows: [configRow({ effective_from: '2026-01-01T00:00:00.000Z', rate: 900 })],
      }))
      router.on('UPDATE vat_configurations', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO vat_configurations', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
      router.on('FROM vat_configurations\n        WHERE id = $1', () => ({
        rows: [configRow({ id: 'new-id', rate: 1000, effective_from: '2026-09-01T00:00:00.000Z' })],
      }))

      const result = await service.createRate({
        category: 'electricity',
        rateBasisPoints: 1000,
        effectiveFrom: '2026-09-01T00:00:00.000Z',
        actorUserId: ACTOR,
        ip: '127.0.0.1',
      })

      expect(result).toMatchObject({ rateBasisPoints: 1000 })
      const close = router.queries('UPDATE vat_configurations')[0]
      expect(close!.sql).toContain('SET effective_until = $1')
      expect(close!.values[0]).toBeInstanceOf(Date)
    })

    it('is a no-op when re-submitting the currently-open rate (no audit)', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      router.on('WHERE category = $1 AND effective_until IS NULL', () => ({
        rows: [configRow({ rate: 900 })],
      }))
      router.on('FROM vat_configurations\n        WHERE id = $1', () => ({ rows: [configRow()] }))

      const result = await service.createRate({
        category: 'electricity',
        rateBasisPoints: 900,
        actorUserId: ACTOR,
        ip: '127.0.0.1',
      })

      expect(result).toMatchObject({ rateBasisPoints: 900 })
      expect(router.queries('INSERT INTO audit_log')).toHaveLength(0)
    })

    it('rejects an effective_from not strictly after the open rate', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      router.on('WHERE category = $1 AND effective_until IS NULL', () => ({
        rows: [configRow({ effective_from: '2026-09-01T00:00:00.000Z' })],
      }))

      await expect(
        service.createRate({
          category: 'electricity',
          rateBasisPoints: 1000,
          effectiveFrom: '2026-08-01T00:00:00.000Z', // before open rate
          actorUserId: ACTOR,
          ip: '',
        }),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('translates DB FK/exclusion races into 409s', async () => {
      const { pool } = makeDb()
      service = await loadService(pool)
      pool.query.mockImplementationOnce(async () => {
        throw Object.assign(new Error('FK race'), { code: '23503' })
      })
      // connect() returns client whose query throw must also propagate:
      vi.spyOn(pool, 'connect').mockImplementation(async () => {
        const client = {
          query: async () => {
            throw Object.assign(new Error('FK race'), { code: '23503' })
          },
          release: () => {},
        }
        return client as never
      })

      await expect(
        service.createProductOverride({
          productId: PRODUCT_ID,
          vatConfigId: CONFIG_ID,
          actorUserId: ACTOR,
          ip: '',
        }),
      ).rejects.toMatchObject({ status: 409 })
    })
  })

  describe('endRate', () => {
    it('closes an open rate and audits the change', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      // The same lookup query runs twice (pre-read + re-read): use the
      // call index to serve the open row first, then the ended row.
      router.on('FROM vat_configurations\n        WHERE id = $1', (_values, idx) => ({
        rows:
          idx === 0
            ? [configRow({ id: CONFIG_ID, effective_until: null })]
            : [configRow({ id: CONFIG_ID, effective_until: '2026-08-28T00:00:00.000Z' })],
      }))
      router.on('UPDATE vat_configurations', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))

      const result = await service.endRate({
        id: CONFIG_ID,
        actorUserId: ACTOR,
        ip: '127.0.0.1',
      })

      expect(result).toMatchObject({ id: CONFIG_ID })
      const audit = router.queries('INSERT INTO audit_log')[0]
      expect(audit!.values[2]).toContain('"action":"ended"')
    })

    it('is a no-op when the rate is already ended', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      router.on('FROM vat_configurations\n        WHERE id', () => ({
        rows: [configRow({ id: CONFIG_ID, effective_until: '2026-06-01T00:00:00.000Z' })],
      }))
      router.on('FROM vat_configurations\n        WHERE id = $1', () => ({
        rows: [configRow({ id: CONFIG_ID, effective_until: '2026-06-01T00:00:00.000Z' })],
      }))

      const result = await service.endRate({ id: CONFIG_ID, actorUserId: ACTOR, ip: '' })

      expect(result.effectiveUntil).toBe('2026-06-01T00:00:00.000Z')
      expect(router.queries('UPDATE vat_configurations')).toHaveLength(0)
      expect(router.queries('INSERT INTO audit_log')).toHaveLength(0)
    })

    it('throws 404 for a missing config', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      router.on('FROM vat_configurations\n        WHERE id', () => ({ rows: [] }))
      await expect(service.endRate({ id: CONFIG_ID, actorUserId: ACTOR, ip: '' })).rejects.toMatchObject({
        status: 404,
      })
    })
  })

  describe('product overrides', () => {
    it('creates an override linked to a config', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      router.on('FROM vat_configurations\n        WHERE id', () => ({
        rows: [configRow({ category: 'product_override', rate: 500 })],
      }))
      router.on(
        'FROM product_vat_overrides pvo\n         JOIN vat_configurations vc ON vc.id = pvo.vat_config_id\n        WHERE pvo.product_id = $1 AND pvo.effective_until IS NULL',
        () => ({ rows: [] }),
      )
      router.on('INSERT INTO product_vat_overrides', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
      router.on('FROM product_vat_overrides pvo\n         JOIN vat_configurations vc ON vc.id = pvo.vat_config_id\n        WHERE pvo.id = $1', () => ({
        rows: [overrideRow()],
      }))

      const result = await service.createProductOverride({
        productId: PRODUCT_ID,
        vatConfigId: CONFIG_ID,
        actorUserId: ACTOR,
        ip: '127.0.0.1',
      })

      expect(result).toMatchObject({
        productId: PRODUCT_ID,
        vatConfigId: CONFIG_ID,
        rateBasisPoints: 500,
      })
      const audit = router.queries('INSERT INTO audit_log')[0]
      expect(audit!.values[2]).toContain('"entity":"vat_product_override"')
    })

    it('ends an override and audits the change', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      // The same lookup query runs twice (pre-read + re-read): use the
      // call index to serve the open row first, then the ended row.
      router.on(
        'FROM product_vat_overrides pvo\n         JOIN vat_configurations vc ON vc.id = pvo.vat_config_id\n        WHERE pvo.id = $1',
        (_values, idx) => ({
          rows:
            idx === 0
              ? [overrideRow({ id: OVERRIDE_ID, effective_until: null })]
              : [overrideRow({ id: OVERRIDE_ID, effective_until: '2026-08-28T00:00:00.000Z' })],
        }),
      )
      router.on('UPDATE product_vat_overrides', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))

      const result = await service.endProductOverride({
        id: OVERRIDE_ID,
        actorUserId: ACTOR,
        ip: '127.0.0.1',
      })

      expect(result.id).toBe(OVERRIDE_ID)
      const audit = router.queries('INSERT INTO audit_log')[0]
      expect(audit!.values[2]).toContain('"action":"ended"')
    })
  })

  describe('resolve', () => {
    it('product override wins over the category default', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      router.on('FROM product_vat_overrides pvo', () => ({ rows: [{ rate: 500 }] }))
      router.on('FROM vat_configurations\n          WHERE category', () => ({
        rows: [{ rate: 900 }],
      }))

      const result = await service.resolve({ productId: PRODUCT_ID, category: 'electricity' })
      expect(result).toEqual({ rateBasisPoints: 500, source: 'product_override' })
    })

    it('falls back to the category rate when no override is active', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      router.on('FROM product_vat_overrides pvo', () => ({ rows: [] }))
      router.on('FROM vat_configurations\n          WHERE category', () => ({
        rows: [{ rate: 900 }],
      }))

      const result = await service.resolve({ productId: PRODUCT_ID, category: 'electricity' })
      expect(result).toEqual({ rateBasisPoints: 900, source: 'category' })
    })

    it('resolves to 0% when nothing is active', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      router.on('FROM product_vat_overrides pvo', () => ({ rows: [] }))
      router.on('FROM vat_configurations\n          WHERE category', () => ({ rows: [] }))

      const result = await service.resolve({ category: 'consultation' })
      expect(result).toEqual({ rateBasisPoints: 0, source: 'fallback_zero' })
    })

    it('rejects an unknown category', async () => {
      const { pool } = makeDb()
      service = await loadService(pool)
      await expect(service.resolve({ category: 'bogus' })).rejects.toMatchObject({ status: 400 })
    })

    it('passes the at timestamp through to both queries', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      router.on('FROM product_vat_overrides pvo', () => ({ rows: [] }))
      router.on('FROM vat_configurations\n          WHERE category', () => ({ rows: [] }))

      await service.resolve({ productId: PRODUCT_ID, category: 'electricity', at: '2026-06-01T00:00:00.000Z' })

      const overrideQ = router.queries('FROM product_vat_overrides pvo')[0]
      expect(overrideQ!.values[1]).toBeInstanceOf(Date)
      expect((overrideQ!.values[1] as Date).toISOString()).toBe('2026-06-01T00:00:00.000Z')
    })
  })
})