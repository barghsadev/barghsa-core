import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OrdersService, type CreateOrderDto } from './orders.service.js'

const mockPool = {
  query: vi.fn(),
}

vi.mock('@barghsa/db', () => ({
  getDbPool: () => mockPool,
}))

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ord-001',
    user_id: 'user-1',
    profile_id: 'prof-1',
    product_id: 'prod-1',
    order_type: 'electricity',
    status: 'DRAFT',
    snapshot_province_id: 'prov-1',
    snapshot_city_id: 'city-1',
    snapshot_full_address: '123 Test St, Tehran',
    snapshot_postal_code: '1234567890',
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    ...overrides,
  }
}

const validDto: CreateOrderDto = {
  profileId: 'prof-1',
  productId: 'prod-1',
  orderType: 'electricity',
  address: {
    provinceId: 'prov-1',
    cityId: 'city-1',
    fullAddress: '123 Test St, Tehran',
    postalCode: '1234567890',
  },
}

describe('OrdersService', () => {
  let service: OrdersService

  beforeEach(() => {
    service = new OrdersService()
    mockPool.query.mockReset()
  })

  describe('createOrder', () => {
    it('creates an order with address snapshot', async () => {
      // Profile exists
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: 'prof-1' }] })
        // Product exists and active
        .mockResolvedValueOnce({ rows: [{ id: 'prod-1' }] })
        // Insert order
        .mockResolvedValueOnce({ rows: [makeRow()] })

      const result = await service.createOrder('user-1', validDto)

      expect(result.id).toBe('ord-001')
      expect(result.status).toBe('DRAFT')
      expect(result.snapshotProvinceId).toBe('prov-1')
      expect(result.snapshotCityId).toBe('city-1')
      expect(result.snapshotFullAddress).toBe('123 Test St, Tehran')
      expect(result.snapshotPostalCode).toBe('1234567890')
      expect(result.userId).toBe('user-1')

      // Verify the INSERT query used snapshot values (not FK)
      const insertCall = mockPool.query.mock.calls[2]!
      expect(insertCall[1]).toContain('user-1')
      expect(insertCall[1]).toContain('prov-1')
      expect(insertCall[1]).toContain('city-1')
      expect(insertCall[1]).toContain('123 Test St, Tehran')
      expect(insertCall[1]).toContain('1234567890')
    })

    it('throws 404 when profile does not belong to user', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await expect(
        service.createOrder('user-1', validDto),
      ).rejects.toThrow(/Profile not found/)
    })

    it('throws 404 when product is not found or not active', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: 'prof-1' }] })
        .mockResolvedValueOnce({ rows: [] })

      await expect(
        service.createOrder('user-1', validDto),
      ).rejects.toThrow(/Product not found or not active/)
    })

    it('throws 400 when address province is missing', async () => {
      const dto = {
        ...validDto,
        address: { ...validDto.address, provinceId: '' },
      }

      await expect(
        service.createOrder('user-1', dto),
      ).rejects.toThrow(/Province is required/)
    })

    it('throws 400 when address city is missing', async () => {
      const dto = {
        ...validDto,
        address: { ...validDto.address, cityId: '' },
      }

      await expect(
        service.createOrder('user-1', dto),
      ).rejects.toThrow(/City is required/)
    })

    it('throws 400 when address full address is missing', async () => {
      const dto = {
        ...validDto,
        address: { ...validDto.address, fullAddress: '' },
      }

      await expect(
        service.createOrder('user-1', dto),
      ).rejects.toThrow(/Full address is required/)
    })

    it('throws 400 when address postal code is missing', async () => {
      const dto = {
        ...validDto,
        address: { ...validDto.address, postalCode: '' },
      }

      await expect(
        service.createOrder('user-1', dto),
      ).rejects.toThrow(/Postal code is required/)
    })

    it('throws 400 when full address exceeds 500 characters', async () => {
      const dto = {
        ...validDto,
        address: {
          ...validDto.address,
          fullAddress: 'x'.repeat(501),
        },
      }

      await expect(
        service.createOrder('user-1', dto),
      ).rejects.toThrow(/Full address must be 500 characters or fewer/)
    })
  })

  describe('listOrders', () => {
    it('returns orders for the user ordered by created_at desc', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [makeRow({ id: 'ord-002' }), makeRow({ id: 'ord-001' })],
      })

      const result = await service.listOrders('user-1')

      expect(result).toHaveLength(2)
      expect(result[0]!.id).toBe('ord-002')
      expect(result[1]!.id).toBe('ord-001')
    })

    it('returns empty array when user has no orders', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      const result = await service.listOrders('user-1')

      expect(result).toEqual([])
    })
  })

  describe('getOrder', () => {
    it('returns the order scoped to the user', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [makeRow({ id: 'ord-001' })],
      })

      const result = await service.getOrder('user-1', 'ord-001')

      expect(result).not.toBeNull()
      expect(result!.id).toBe('ord-001')
      expect(result!.userId).toBe('user-1')
    })

    it('returns null when order belongs to another user', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      const result = await service.getOrder('user-2', 'ord-001')

      expect(result).toBeNull()
    })
  })
})