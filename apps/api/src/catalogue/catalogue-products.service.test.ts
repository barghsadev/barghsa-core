import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CatalogueProductsService as ServiceType } from './catalogue-products.service.js'

/**
 * SQL-routing mock for @barghsa/db.
 *
 * Instead of queuing positional `mockResolvedValueOnce` values (which break
 * because every `withTransaction` fires BEGIN/COMMIT/ROLLBACK through the
 * same query fn, and `Promise.all` reorders reads), this dispatcher returns
 * rows based on which statement each query is. Tests register a handler per
 * SQL fragment via `router.on(fragment, fn)`.
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
    /** Register a handler for any query whose SQL contains `frag`. */
    on: (frag: string, fn: Handler) => handlers.set(frag, fn),
    /** All queries captured, in order (including BEGIN/COMMIT). */
    calls,
    /** Only the queries whose SQL contains `frag`. */
    queries: (frag: string) => calls.filter((c) => c.sql.includes(frag)),
  }

  return { query, pool, router }
}

function productRow(over: Record<string, unknown> = {}) {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    type: 'consultation',
    system_key: null,
    title: { fa: 'مشاوره', en: 'Consultation' },
    description: null,
    price: '1500000',
    status: 'active',
    created_at: '2026-08-28T00:00:00.000Z',
    updated_at: '2026-08-28T00:00:00.000Z',
    ...over,
  }
}

function priceVersionRow(over: Record<string, unknown> = {}) {
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    price: '1500000',
    effective_from: '2026-08-28T00:00:00.000Z',
    effective_until: null,
    created_by: 'user-admin-1',
    created_at: '2026-08-28T00:00:00.000Z',
    ...over,
  }
}

const ACTOR = 'user-admin-1'
const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

/** Load CatalogueProductsService with a mocked @barghsa/db pool. */
async function loadService(pool: { query: ReturnType<typeof vi.fn> }) {
  vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
  const { CatalogueProductsService: Svc } = await import('./catalogue-products.service.js')
  return new Svc() as ServiceType
}

let service: ServiceType

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('CatalogueProductsService (T-09.12.01)', () => {
  describe('list', () => {
    it('returns every product with categories and electricity limits', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      const p1 = productRow()
      const p2 = productRow({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        type: 'electricity',
        system_key: 'thermal_electricity',
        title: { fa: 'برق حرارتی', en: 'Thermal electricity' },
      })
      router.on('FROM products', () => ({ rows: [p1, p2] }))
      router.on('FROM product_categories', () => ({
        rows: [{ product_id: p1.id, category: 'electricity_generation_station_consultation' }],
      }))
      router.on('FROM electricity_product_limits', () => ({
        rows: [{ product_id: p2.id, min_kwh: '100', max_kwh: '500' }],
      }))

      const result = await service.list()

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        id: p1.id,
        type: 'consultation',
        price: '1500000',
        categories: ['electricity_generation_station_consultation'],
        electricityLimits: null,
      })
      expect(result[1]).toMatchObject({
        type: 'electricity',
        systemKey: 'thermal_electricity',
        categories: [],
        electricityLimits: { minKwh: '100', maxKwh: '500' },
      })
    })

    it('filters by type when one is supplied', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      router.on('FROM products', () => ({ rows: [] }))
      await service.list('hardware')
      const q = router.queries('FROM products')[0]
      expect(q!.sql).toContain('WHERE type = $1')
      expect(q!.values).toEqual(['hardware'])
    })
  })

  describe('get', () => {
    it('throws 404 when the product does not exist', async () => {
      const { pool } = makeDb()
      service = await loadService(pool)
      await expect(service.get(PRODUCT_ID)).rejects.toMatchObject({ status: 404 })
    })

    it('returns the product with its versioned price history', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      const p = productRow()
      router.on('FROM products', () => ({ rows: [p] }))
      router.on('FROM product_categories', () => ({ rows: [] }))
      router.on('FROM electricity_product_limits', () => ({ rows: [] }))
      router.on('FROM product_price_versions', () => ({
        rows: [
          priceVersionRow(),
          priceVersionRow({
            id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            price: '1800000',
            effective_from: '2026-09-01T00:00:00.000Z',
            created_at: '2026-08-28T01:00:00.000Z',
          }),
        ],
      }))

      const result = await service.get(PRODUCT_ID)

      expect(result.id).toBe(PRODUCT_ID)
      expect(result.priceHistory).toHaveLength(2)
      expect(result.priceHistory[1]).toMatchObject({ price: '1800000', effectiveUntil: null })
    })
  })

  describe('create', () => {
    const baseInput = {
      type: 'consultation' as const,
      title: { fa: 'مشاوره تخصصی', en: 'Expert consultation' },
      description: null,
      price: '1500000',
      status: 'active' as const,
      categories: ['electricity_generation_station_consultation'] as unknown as never[],
      actorUserId: ACTOR,
      ip: '10.0.0.8',
    }

    it('rejects electricity products (system fixtures only)', async () => {
      const { pool } = makeDb()
      service = await loadService(pool)
      await expect(
        service.create({ ...baseInput, type: 'electricity' as never }),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('rejects categories not allowed for the product type', async () => {
      const { pool } = makeDb()
      service = await loadService(pool)
      await expect(
        service.create({
          ...baseInput,
          categories: ['thermal_electricity'] as unknown as never[],
        }),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('rejects categories for hardware products', async () => {
      const { pool } = makeDb()
      service = await loadService(pool)
      await expect(
        service.create({
          ...baseInput,
          type: 'hardware' as const,
          categories: ['thermal_electricity'] as unknown as never[],
        }),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('inserts the product, categories, initial price version, and audit in one transaction', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      const p = productRow({ price: '1500000' })
      router.on('INSERT INTO products', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO product_price_versions', () => ({ rows: [], rowCount: 1 }))
      router.on('UPDATE products', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO product_categories', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
      // findOpenVersion (call 0) must find NO open version for a brand-new
      // product; the readDetail price-history read (call 1) returns the row.
      router.on('FROM product_price_versions', (_v, i) => ({
        rows: i === 0 ? [] : [priceVersionRow()],
      }))
      router.on('FROM products', () => ({ rows: [p] }))
      router.on('FROM product_categories', () => ({
        rows: [{ product_id: p.id, category: 'electricity_generation_station_consultation' }],
      }))
      router.on('FROM electricity_product_limits', () => ({ rows: [] }))

      const result = await service.create(baseInput as never)

      expect(result.id).toBeDefined()
      expect(result.categories).toEqual(['electricity_generation_station_consultation'])
      expect(result.priceHistory).toHaveLength(1)

      const audit = router.queries('INSERT INTO audit_log')
      expect(audit.length).toBeGreaterThan(0)
      expect(audit[0]!.values).toContain('catalogue_product_created')
      expect(router.queries('INSERT INTO products').length).toBe(1)
      // Initial price creates the first price version + syncs products.price.
      expect(router.queries('INSERT INTO product_price_versions').length).toBe(1)
      expect(router.queries('UPDATE products').length).toBe(1)
    })

    it('does not create a price version when no initial price is given', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      const p = productRow({ price: null })
      router.on('INSERT INTO products', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
      router.on('FROM products', () => ({ rows: [p] }))
      router.on('FROM product_categories', () => ({ rows: [] }))
      router.on('FROM electricity_product_limits', () => ({ rows: [] }))
      router.on('FROM product_price_versions', () => ({ rows: [] }))

      const result = await service.create({ ...baseInput, price: null } as never)

      expect(result.price).toBeNull()
      expect(result.priceHistory).toEqual([])
      expect(router.queries('INSERT INTO product_price_versions').length).toBe(0)
    })
  })

  describe('update', () => {
    function wireUpdateDb(router: ReturnType<typeof makeDb>['router'], current: Record<string, unknown>) {
      router.on('FROM products', () => ({ rows: [current] }))
      router.on('FROM product_categories', () => ({ rows: [] }))
      router.on('FROM electricity_product_limits', () => ({ rows: [] }))
      router.on('UPDATE products', () => ({ rows: [], rowCount: 1 }))
      router.on('DELETE FROM product_categories', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO product_categories', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
      router.on('FROM product_price_versions', () => ({ rows: [priceVersionRow()] }))
    }

    it('throws 404 when the product does not exist', async () => {
      const { pool } = makeDb()
      service = await loadService(pool)
      await expect(
        service.update(PRODUCT_ID, { title: { fa: 'x', en: 'y' }, actorUserId: ACTOR, ip: '10.0.0.8' }),
      ).rejects.toMatchObject({ status: 404 })
    })

    it('rejects an empty update payload', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      router.on('FROM products', () => ({ rows: [productRow()] }))
      await expect(
        service.update(PRODUCT_ID, { actorUserId: ACTOR, ip: '10.0.0.8' }),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('emits no audit when nothing changes (no-op discipline)', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      const p = productRow()
      wireUpdateDb(router, p)

      const result = await service.update(PRODUCT_ID, {
        title: { fa: 'مشاوره', en: 'Consultation' },
        actorUserId: ACTOR,
        ip: '10.0.0.8',
      })

      expect(result.id).toBe(PRODUCT_ID)
      expect(router.queries('INSERT INTO audit_log').length).toBe(0)
      expect(router.queries('UPDATE products').length).toBe(0)
    })

    it('updates title/status and replaces the category set', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      const p = productRow({ status: 'inactive' })
      const updated = productRow({ status: 'active' })
      // findProduct (first read) returns the pre-write row; readDetail re-reads
      // after the update and returns the new status row.
      router.on('FROM products', (_v, i) => ({ rows: [i === 0 ? p : updated] }))
      router.on('FROM product_categories', (_v, i) => ({
        rows:
          i === 0
            ? []
            : [{ product_id: p.id, category: 'electricity_saving_certificate_consultation' }],
      }))
      router.on('FROM electricity_product_limits', () => ({ rows: [] }))
      router.on('UPDATE products', () => ({ rows: [], rowCount: 1 }))
      router.on('DELETE FROM product_categories', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO product_categories', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
      router.on('FROM product_price_versions', () => ({ rows: [priceVersionRow()] }))

      const result = await service.update(PRODUCT_ID, {
        title: { fa: 'مشاوره ویژه', en: 'Premium consultation' },
        status: 'active',
        categories: ['electricity_saving_certificate_consultation'] as unknown as never[],
        actorUserId: ACTOR,
        ip: '10.0.0.8',
      })

      expect(result.status).toBe('active')
      expect(result.categories).toEqual(['electricity_saving_certificate_consultation'])
      const audit = router.queries('INSERT INTO audit_log')[0]
      const auditMeta = JSON.parse(audit!.values![3] as string)
      expect(auditMeta.statusBefore).toBe('inactive')
      expect(auditMeta.statusAfter).toBe('active')
    })

    it('rejects electricity limits on non-electricity products', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      router.on('FROM products', () => ({ rows: [productRow()] }))
      await expect(
        service.update(PRODUCT_ID, { minKwh: '100', actorUserId: ACTOR, ip: '10.0.0.8' }),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('requires both bounds when the product has no limits row yet', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      const p = productRow({ type: 'electricity', system_key: 'thermal_electricity' })
      router.on('FROM products', () => ({ rows: [p] }))
      router.on('FROM product_categories', () => ({ rows: [] }))
      router.on('FROM electricity_product_limits', () => ({ rows: [] }))
      await expect(
        service.update(PRODUCT_ID, { minKwh: '100', actorUserId: ACTOR, ip: '10.0.0.8' }),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('rejects a merged limits pair where min exceeds max', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      const p = productRow({ type: 'electricity', system_key: 'thermal_electricity' })
      router.on('FROM products', () => ({ rows: [p] }))
      router.on('FROM product_categories', () => ({ rows: [] }))
      // Existing row: max 100. Requested: min 500 -> merged min 500 > 100.
      router.on('FROM electricity_product_limits', () => ({
        rows: [{ product_id: p.id, min_kwh: '50', max_kwh: '100' }],
      }))
      await expect(
        service.update(PRODUCT_ID, {
          minKwh: '500',
          actorUserId: ACTOR,
          ip: '10.0.0.8',
        }),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('upserts limits for electricity products', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      const p = productRow({ type: 'electricity', system_key: 'thermal_electricity' })
      // findLimits (during update) finds none yet; readDetail (after upsert)
      // re-reads and finds the just-inserted row.
      router.on('FROM products', (_v, i) => ({ rows: [i === 0 ? p : p] }))
      router.on('FROM product_categories', () => ({ rows: [] }))
      // findLimits (during update) counts reads in order:
      //   0 = loadAggregates limits, 1 = no-op-diff findLimits,
      //   2 = upsert's findLimits (must find NONE so it INSERTs),
      //   3 = readDetail loadAggregates (finds the just-inserted row).
      router.on('FROM electricity_product_limits', (_v, i) => ({
        rows: i === 3 ? [{ product_id: p.id, min_kwh: '100', max_kwh: '500' }] : [],
      }))
      router.on('INSERT INTO electricity_product_limits', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
      router.on('FROM product_price_versions', () => ({ rows: [priceVersionRow()] }))

      const result = await service.update(PRODUCT_ID, {
        minKwh: '100',
        maxKwh: '500',
        actorUserId: ACTOR,
        ip: '10.0.0.8',
      })

      expect(result.electricityLimits).toEqual({ minKwh: '100', maxKwh: '500' })
      expect(router.queries('INSERT INTO electricity_product_limits').length).toBe(1)
    })
  })

  describe('archive', () => {
    it('throws 404 when the product does not exist', async () => {
      const { pool } = makeDb()
      service = await loadService(pool)
      await expect(service.archive(PRODUCT_ID, ACTOR, '10.0.0.8')).rejects.toMatchObject({
        status: 404,
      })
    })

    it('rejects archiving a system product', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      router.on('FROM products', () => ({
        rows: [productRow({ type: 'electricity', system_key: 'thermal_electricity' })],
      }))
      await expect(service.archive(PRODUCT_ID, ACTOR, '10.0.0.8')).rejects.toMatchObject({
        status: 400,
      })
    })

    it('archives a product and audits the change', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      router.on('FROM products', () => ({ rows: [productRow()] }))
      router.on('UPDATE products', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))

      await service.archive(PRODUCT_ID, ACTOR, '10.0.0.8')

      const update = router.queries('UPDATE products')[0]
      expect(update!.values).toEqual(['archived', PRODUCT_ID])
      expect(router.queries('INSERT INTO audit_log')[0]!.values).toContain(
        'catalogue_product_archived',
      )
    })

    it('is a no-op (no audit) when already archived', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      router.on('FROM products', () => ({ rows: [productRow({ status: 'archived' })] }))

      await service.archive(PRODUCT_ID, ACTOR, '10.0.0.8')

      expect(router.queries('INSERT INTO audit_log').length).toBe(0)
      expect(router.queries('UPDATE products').length).toBe(0)
    })
  })

  describe('addPrice', () => {
    const priceInput = (over: Record<string, unknown> = {}) => ({
      productId: PRODUCT_ID,
      price: '1800000',
      effectiveFrom: '2026-09-01T00:00:00.000Z',
      actorUserId: ACTOR,
      ip: '10.0.0.8',
      ...over,
    })

    function wireAddPriceDb(
      router: ReturnType<typeof makeDb>['router'],
      p: Record<string, unknown>,
      open: Record<string, unknown> | null,
    ) {
      router.on('FROM products', () => ({ rows: [p] }))
      router.on('UPDATE product_price_versions', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO product_price_versions', () => ({ rows: [], rowCount: 1 }))
      router.on('UPDATE products', () => ({ rows: [], rowCount: 1 }))
      router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
      router.on('FROM product_categories', () => ({ rows: [] }))
      router.on('FROM electricity_product_limits', () => ({ rows: [] }))
      router.on('FROM product_price_versions', () => ({
        rows: open ? [open] : [],
      }))
    }

    it('throws 404 when the product does not exist', async () => {
      const { pool } = makeDb()
      service = await loadService(pool)
      await expect(service.addPrice(priceInput())).rejects.toMatchObject({ status: 404 })
    })

    it('rejects a price that does not start after the active version', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      router.on('FROM products', () => ({ rows: [productRow()] }))
      router.on('FROM product_price_versions', () => ({
        rows: [priceVersionRow({ effective_from: '2026-08-28T00:00:00.000Z' })],
      }))
      await expect(
        service.addPrice(priceInput({ effectiveFrom: '2026-08-20T00:00:00.000Z' })),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('closes the previous open version, inserts the new one, and syncs the current price', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      const open = priceVersionRow()
      const p = productRow({ price: '1800000' })
      wireAddPriceDb(router, p, open)
      // The price-history read (FROM product_price_versions) is consumed by the
      // findOpenVersion handler overlapping with the readDetail history read —
      // both match 'FROM product_price_versions'. findOpenVersion limits to
      // effective_until IS NULL, so give it the full two-row history and have
      // insertPriceVersion operate on the open row by its handler below.

      const result = await service.addPrice(priceInput())

      expect(result.price).toBe('1800000')
      expect(router.queries('UPDATE product_price_versions').length).toBe(1)
      const close = router.queries('UPDATE product_price_versions')[0]!
      expect(close.values[0]).toEqual(new Date('2026-09-01T00:00:00.000Z'))
      const priceSync = router.queries('UPDATE products')[0]
      expect(priceSync!.values).toEqual(['1800000', PRODUCT_ID])
      expect(router.queries('INSERT INTO audit_log')[0]!.values).toContain(
        'catalogue_product_price_changed',
      )
    })

    it('is a no-op (no audit) when re-submitting the active price', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      const p = productRow({ price: '1500000' })
      router.on('FROM products', () => ({ rows: [p] }))
      router.on('FROM product_categories', () => ({ rows: [] }))
      router.on('FROM electricity_product_limits', () => ({ rows: [] }))
      // The open version started a month earlier; a same-price submission via
      // the HTTP surface (effectiveFrom defaults to "now", not the open
      // version's start) must still be a no-op.
      router.on('FROM product_price_versions', () => ({
        rows: [
          priceVersionRow({
            price: '1500000',
            effective_from: '2026-07-28T00:00:00.000Z',
          }),
        ],
      }))

      const result = await service.addPrice(priceInput({ price: '1500000' }))

      expect(result.price).toBe('1500000')
      expect(router.queries('INSERT INTO audit_log').length).toBe(0)
      expect(router.queries('INSERT INTO product_price_versions').length).toBe(0)
      expect(router.queries('UPDATE product_price_versions').length).toBe(0)
      expect(router.queries('UPDATE products').length).toBe(0)
    })

    it('maps a concurrent FK violation to 409', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      router.on('FROM products', () => ({ rows: [productRow()] }))
      router.on('FROM product_price_versions', () => ({ rows: [] }))
      router.on(
        'INSERT INTO product_price_versions',
        () => {
          throw Object.assign(new Error('fk'), { code: '23503' })
        },
      )
      await expect(service.addPrice(priceInput())).rejects.toMatchObject({ status: 409 })
    })

    it('maps an EXCLUDE overlap violation to 409', async () => {
      const { pool, router } = makeDb()
      service = await loadService(pool)
      router.on('FROM products', () => ({ rows: [productRow()] }))
      router.on('FROM product_price_versions', () => ({ rows: [] }))
      router.on(
        'INSERT INTO product_price_versions',
        () => {
          throw Object.assign(new Error('exclude'), { code: '23P01' })
        },
      )
      await expect(service.addPrice(priceInput())).rejects.toMatchObject({ status: 409 })
    })
  })
})
