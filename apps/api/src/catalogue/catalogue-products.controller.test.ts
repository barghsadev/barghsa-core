import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CatalogueProductsController } from './catalogue-products.controller.js'
import type { CatalogueProductsService } from './catalogue-products.service.js'

// ─── Mock service ─────────────────────────────────────────────────────────

const mockList = vi.fn()
const mockGet = vi.fn()
const mockCreate = vi.fn()
const mockUpdate = vi.fn()
const mockArchive = vi.fn()
const mockAddPrice = vi.fn()

const mockService = {
  list: mockList,
  get: mockGet,
  create: mockCreate,
  update: mockUpdate,
  archive: mockArchive,
  addPrice: mockAddPrice,
} as unknown as CatalogueProductsService

const adminReq = {
  session: { isAdmin: true, userId: 'admin-1' },
  ip: '10.0.0.8',
  socket: { remoteAddress: '10.0.0.8' },
} as never

const nonAdminReq = {
  session: { isAdmin: false, userId: 'admin-1' },
  ip: '10.0.0.8',
} as never

const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function baseProduct(over: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    type: 'consultation',
    systemKey: null,
    title: { fa: 'مشاوره', en: 'Consultation' },
    description: null,
    price: '1500000',
    status: 'active',
    categories: [],
    electricityLimits: null,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
    priceHistory: [],
    ...over,
  }
}

describe('CatalogueProductsController (T-09.12.01)', () => {
  let controller: CatalogueProductsController

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new CatalogueProductsController(mockService)
  })

  describe('permission gate (admin:catalogue:edit)', () => {
    it('rejects non-admin sessions on every route with 403', async () => {
      await expect(controller.list(nonAdminReq)).rejects.toMatchObject({ status: 403 })
      await expect(controller.get(nonAdminReq, PRODUCT_ID)).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.create(nonAdminReq, { type: 'hardware' } as never),
      ).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.update(nonAdminReq, PRODUCT_ID, { status: 'active' } as never),
      ).rejects.toMatchObject({ status: 403 })
      await expect(controller.archive(nonAdminReq, PRODUCT_ID)).rejects.toMatchObject({
        status: 403,
      })
      await expect(
        controller.addPrice(nonAdminReq, PRODUCT_ID, { price: '1000' } as never),
      ).rejects.toMatchObject({ status: 403 })
      expect(mockList).not.toHaveBeenCalled()
      expect(mockGet).not.toHaveBeenCalled()
      expect(mockCreate).not.toHaveBeenCalled()
      expect(mockUpdate).not.toHaveBeenCalled()
      expect(mockArchive).not.toHaveBeenCalled()
      expect(mockAddPrice).not.toHaveBeenCalled()
    })

    it('allows platform-admin sessions', async () => {
      mockList.mockResolvedValue([])
      await expect(controller.list(adminReq)).resolves.toEqual([])
    })
  })

  describe('GET /api/admin/catalogue/products', () => {
    it('forwards to the service and returns the product list', async () => {
      mockList.mockResolvedValue([baseProduct()])
      const result = await controller.list(adminReq)
      expect(result).toHaveLength(1)
      expect(mockList).toHaveBeenCalledWith(undefined)
    })

    it('passes a valid type filter', async () => {
      mockList.mockResolvedValue([])
      await controller.list(adminReq, 'hardware')
      expect(mockList).toHaveBeenCalledWith('hardware')
    })

    it('rejects an unknown type filter with 400', async () => {
      await expect(controller.list(adminReq, 'bogus')).rejects.toMatchObject({ status: 400 })
      expect(mockList).not.toHaveBeenCalled()
    })
  })

  describe('GET /api/admin/catalogue/products/:id', () => {
    it('rejects a malformed id with 400', async () => {
      await expect(controller.get(adminReq, 'not-a-uuid')).rejects.toMatchObject({ status: 400 })
      expect(mockGet).not.toHaveBeenCalled()
    })

    it('forwards the id to the service', async () => {
      mockGet.mockResolvedValue(baseProduct())
      const result = await controller.get(adminReq, PRODUCT_ID)
      expect(result.id).toBe(PRODUCT_ID)
      expect(mockGet).toHaveBeenCalledWith(PRODUCT_ID)
    })
  })

  describe('POST /api/admin/catalogue/products', () => {
    it('rejects a missing title with 400', async () => {
      await expect(
        controller.create(adminReq, { type: 'hardware' } as never),
      ).rejects.toMatchObject({ status: 400 })
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('rejects electricity type with 400 (system fixtures only)', async () => {
      await expect(
        controller.create(adminReq, {
          type: 'electricity',
          title: { fa: 'برق', en: 'Electricity' },
        } as never),
      ).rejects.toMatchObject({ status: 400 })
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('rejects a malformed price with 400', async () => {
      await expect(
        controller.create(adminReq, {
          type: 'hardware',
          title: { fa: 'دستگاه', en: 'Device' },
          price: '12.5',
        } as never),
      ).rejects.toMatchObject({ status: 400 })
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('creates a product and forwards actor + ip', async () => {
      mockCreate.mockResolvedValue(baseProduct({ type: 'hardware' }))
      const result = await controller.create(adminReq, {
        type: 'hardware',
        title: { fa: 'دستگاه', en: 'Device' },
        price: '2500000',
        status: 'active',
      } as never)
      expect(result.type).toBe('hardware')
      expect(mockCreate).toHaveBeenCalledWith({
        type: 'hardware',
        title: { fa: 'دستگاه', en: 'Device' },
        description: null,
        price: '2500000',
        status: 'active',
        categories: [],
        actorUserId: 'admin-1',
        ip: '10.0.0.8',
      })
    })

    it('defaults an omitted status to inactive', async () => {
      mockCreate.mockResolvedValue(baseProduct({ status: 'inactive' }))
      await controller.create(adminReq, {
        type: 'hardware',
        title: { fa: 'دستگاه', en: 'Device' },
      } as never)
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'inactive', price: null }),
      )
    })
  })

  describe('PUT /api/admin/catalogue/products/:id', () => {
    it('rejects a malformed id with 400', async () => {
      await expect(
        controller.update(adminReq, 'not-a-uuid', { status: 'active' } as never),
      ).rejects.toMatchObject({ status: 400 })
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('rejects an empty body with 400', async () => {
      await expect(
        controller.update(adminReq, PRODUCT_ID, {} as never),
      ).rejects.toMatchObject({ status: 400 })
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('updates a product and forwards the request', async () => {
      mockUpdate.mockResolvedValue(baseProduct({ status: 'inactive' }))
      const result = await controller.update(adminReq, PRODUCT_ID, {
        status: 'inactive',
      } as never)
      expect(result.status).toBe('inactive')
      expect(mockUpdate).toHaveBeenCalledWith(
        PRODUCT_ID,
        expect.objectContaining({ status: 'inactive' }),
      )
    })
  })

  describe('DELETE /api/admin/catalogue/products/:id', () => {
    it('rejects a malformed id with 400', async () => {
      await expect(controller.archive(adminReq, 'not-a-uuid')).rejects.toMatchObject({
        status: 400,
      })
      expect(mockArchive).not.toHaveBeenCalled()
    })

    it('archives the product', async () => {
      mockArchive.mockResolvedValue(undefined)
      await controller.archive(adminReq, PRODUCT_ID)
      expect(mockArchive).toHaveBeenCalledWith(PRODUCT_ID, 'admin-1', '10.0.0.8')
    })
  })

  describe('POST /api/admin/catalogue/products/:id/prices', () => {
    it('rejects a malformed id with 400', async () => {
      await expect(
        controller.addPrice(adminReq, 'not-a-uuid', { price: '1000' } as never),
      ).rejects.toMatchObject({ status: 400 })
      expect(mockAddPrice).not.toHaveBeenCalled()
    })

    it('rejects a malformed price with 400', async () => {
      await expect(
        controller.addPrice(adminReq, PRODUCT_ID, { price: '-5' } as never),
      ).rejects.toMatchObject({ status: 400 })
      expect(mockAddPrice).not.toHaveBeenCalled()
    })

    it('rejects an invalid effectiveFrom with 400', async () => {
      await expect(
        controller.addPrice(adminReq, PRODUCT_ID, { price: '1000', effectiveFrom: 'yesterday' } as never),
      ).rejects.toMatchObject({ status: 400 })
      expect(mockAddPrice).not.toHaveBeenCalled()
    })

    it('adds the price and defaults effectiveFrom to now', async () => {
      mockAddPrice.mockResolvedValue(baseProduct({ price: '2000000' }))
      const result = await controller.addPrice(adminReq, PRODUCT_ID, { price: '2000000' } as never)
      expect(result.price).toBe('2000000')
      const call = mockAddPrice.mock.calls[0]![0] as Record<string, unknown>
      expect(call.productId).toBe(PRODUCT_ID)
      expect(call.price).toBe('2000000')
      expect(typeof call.effectiveFrom).toBe('string')
      expect(call.actorUserId).toBe('admin-1')
    })
  })
})
