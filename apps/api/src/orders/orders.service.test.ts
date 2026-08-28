import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OrdersService, type CreateOrderDto } from './orders.service.js'

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
}
const mockPool = {
  query: vi.fn(),
  connect: vi.fn().mockResolvedValue(mockClient),
}

vi.mock('@barghsa/db', () => ({
  getDbPool: () => mockPool,
}))

const mockGiftCodeService = {
  redeem: vi.fn(),
  releaseByOrder: vi.fn(),
}

/** Queue of responses for the NEXT non-transaction-control client query. */
const responses: unknown[] = []

function queueResponse(response: unknown): void {
  responses.push(response)
}

beforeEach(() => {
  responses.length = 0
  mockClient.query.mockReset()
  mockClient.query.mockImplementation(async (text: string) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return { rows: [], rowCount: 0 }
    }
    const next = responses.shift() ?? { rows: [], rowCount: 0 }
    return next
  })
  mockClient.release.mockReset()
  mockPool.query.mockReset()
  mockPool.connect.mockClear()
  mockGiftCodeService.redeem.mockReset()
  mockGiftCodeService.releaseByOrder.mockReset()
})

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
    gift_code_id: null,
    gift_discount_amount: null,
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
    service = new OrdersService(mockGiftCodeService as never)
  })

  describe('createOrder', () => {
    it('creates an order with address snapshot in one transaction', async () => {
      queueResponse({ rows: [{ id: 'prof-1' }] }) // profile exists
      queueResponse({ rows: [{ id: 'prod-1', type: 'electricity', price: '2000000' }] }) // product
      queueResponse({ rows: [makeRow()] }) // insert order

      const result = await service.createOrder('user-1', validDto)

      expect(result.id).toBe('ord-001')
      expect(result.status).toBe('DRAFT')
      expect(result.snapshotProvinceId).toBe('prov-1')
      expect(result.giftCodeId).toBeNull()
      expect(result.giftDiscountAmount).toBeNull()

      // One transaction: BEGIN, insert, COMMIT
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN')
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
      expect(mockClient.release).toHaveBeenCalledTimes(1)

      // Verify the INSERT query used snapshot values (not FK)
      const insertCall = mockClient.query.mock.calls.find((call) =>
        String(call[0]).includes('INSERT INTO orders'),
      )!
      expect(insertCall[1]).toContain('user-1')
      expect(insertCall[1]).toContain('prov-1')
      expect(insertCall[1]).toContain('city-1')
      expect(insertCall[1]).toContain('123 Test St, Tehran')
      expect(insertCall[1]).toContain('1234567890')
    })

    it('rolls back and rethrows when a query fails', async () => {
      queueResponse({ rows: [{ id: 'prof-1' }] })
      queueResponse({ rows: [] }) // product missing -> HttpException

      await expect(
        service.createOrder('user-1', validDto),
      ).rejects.toThrow(/Product not found or not active/)

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
      expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT')
      expect(mockClient.release).toHaveBeenCalledTimes(1)
    })

    it('redeems a gift code atomically and stores the discount on the order', async () => {
      queueResponse({ rows: [{ id: 'prof-1' }] })
      queueResponse({ rows: [{ id: 'prod-1', type: 'electricity', price: '2000000' }] })
      queueResponse({ rows: [makeRow()] }) // insert order
      // gift code service returns the redemption…
      mockGiftCodeService.redeem.mockResolvedValue({
        id: 'red-1',
        giftCodeId: 'gc-1',
        profileId: 'prof-1',
        orderId: 'ord-001',
        discountAmount: '500000',
        status: 'consumed',
        createdAt: '2026-01-01T00:00:00Z',
      })
      queueResponse({ rows: [makeRow({ gift_code_id: 'gc-1', gift_discount_amount: '500000' })] }) // update order

      const result = await service.createOrder('user-1', {
        ...validDto,
        giftCode: 'sale10',
      })

      expect(result.giftCodeId).toBe('gc-1')
      expect(result.giftDiscountAmount).toBe('500000')
      // redeem executed INSIDE the same transaction (client passed as executor)
      expect(mockGiftCodeService.redeem).toHaveBeenCalledWith(
        {
          giftCode: 'sale10',
          profileId: 'prof-1',
          orderId: 'ord-001',
          orderAmount: '2000000',
          category: 'electricity',
          actorUserId: 'user-1',
          ip: 'unknown',
        },
        mockClient,
      )
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
    })

    it('rejects a gift code on a product without a price (no redemption)', async () => {
      queueResponse({ rows: [{ id: 'prof-1' }] })
      queueResponse({ rows: [{ id: 'prod-1', type: 'electricity', price: null }] })
      queueResponse({ rows: [makeRow()] }) // insert order

      await expect(
        service.createOrder('user-1', { ...validDto, giftCode: 'sale10' }),
      ).rejects.toThrow(/without a price/)

      expect(mockGiftCodeService.redeem).not.toHaveBeenCalled()
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rolls back when redemption fails — failed orders never consume', async () => {
      queueResponse({ rows: [{ id: 'prof-1' }] })
      queueResponse({ rows: [{ id: 'prod-1', type: 'electricity', price: '100000' }] })
      queueResponse({ rows: [makeRow()] }) // insert order
      mockGiftCodeService.redeem.mockRejectedValue(
        Object.assign(new Error('Gift code SALE10 usage limit reached'), { status: 400 }),
      )

      await expect(
        service.createOrder('user-1', { ...validDto, giftCode: 'sale10' }),
      ).rejects.toThrow(/usage limit reached/)

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
      expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT')
    })

    it('throws 404 when profile does not belong to user', async () => {
      queueResponse({ rows: [] })

      await expect(
        service.createOrder('user-1', validDto),
      ).rejects.toThrow(/Profile not found/)
    })

    it('throws 400 when address province is missing', async () => {
      const dto = {
        ...validDto,
        address: { ...validDto.address, provinceId: '' },
      }

      await expect(
        service.createOrder('user-1', dto),
      ).rejects.toThrow(/Province is required/)
      expect(mockPool.connect).not.toHaveBeenCalled()
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

    it('throws 400 when giftCode is empty', async () => {
      await expect(
        service.createOrder('user-1', { ...validDto, giftCode: '   ' }),
      ).rejects.toThrow(/Gift code cannot be empty/)
      expect(mockPool.connect).not.toHaveBeenCalled()
    })
  })

  describe('cancelOrder', () => {
    it('cancels a DRAFT order and releases its gift-code slot in one transaction', async () => {
      // cancelOrder runs on a client: BEGIN + conditional UPDATE (+ release)
      queueResponse({
        rows: [makeRow({ status: 'CANCELLED', gift_code_id: 'gc-1', gift_discount_amount: '500000' })],
      })
      mockGiftCodeService.releaseByOrder.mockResolvedValue({ released: 1 })

      const result = await service.cancelOrder('user-1', 'ord-001')

      expect(result?.status).toBe('CANCELLED')
      // release ran inside the SAME transaction (client passed as executor)
      expect(mockGiftCodeService.releaseByOrder).toHaveBeenCalledWith(
        'ord-001',
        mockClient,
        { actorUserId: 'user-1', ip: 'unknown' },
      )
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
      expect(mockClient.query).not.toHaveBeenCalledWith('ROLLBACK')
    })

    it('cancels an order without a gift code without touching the redemption service', async () => {
      queueResponse({ rows: [makeRow({ status: 'CANCELLED' })] })

      const result = await service.cancelOrder('user-1', 'ord-001')

      expect(result?.status).toBe('CANCELLED')
      expect(mockGiftCodeService.releaseByOrder).not.toHaveBeenCalled()
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
    })

    it('rolls back the cancellation when the slot release fails (no leaked state)', async () => {
      queueResponse({
        rows: [makeRow({ status: 'CANCELLED', gift_code_id: 'gc-1', gift_discount_amount: '500000' })],
      })
      mockGiftCodeService.releaseByOrder.mockRejectedValue(new Error('release failed'))

      await expect(
        service.cancelOrder('user-1', 'ord-001'),
      ).rejects.toThrow(/release failed/)

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
      expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT')
    })

    it('is a no-op for an already-cancelled order (no release)', async () => {
      // Conditional UPDATE matches nothing
      queueResponse({ rows: [], rowCount: 0 })
      // Re-read: order exists and is already CANCELLED
      mockPool.query.mockResolvedValueOnce({
        rows: [makeRow({ status: 'CANCELLED' })],
      })

      const result = await service.cancelOrder('user-1', 'ord-001')

      expect(result?.status).toBe('CANCELLED')
      expect(mockGiftCodeService.releaseByOrder).not.toHaveBeenCalled()
    })

    it('rejects a CONFIRMED order with 409 instead of fake success', async () => {
      queueResponse({ rows: [], rowCount: 0 })
      mockPool.query.mockResolvedValueOnce({
        rows: [makeRow({ status: 'CONFIRMED' })],
      })

      const err = await service
        .cancelOrder('user-1', 'ord-001')
        .catch((e: unknown) => e)
      expect((err as { status?: number }).status).toBe(409)
      expect(mockGiftCodeService.releaseByOrder).not.toHaveBeenCalled()
    })

    it('returns null when the order is not found', async () => {
      queueResponse({ rows: [], rowCount: 0 })
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      const result = await service.cancelOrder('user-1', 'ord-001')

      expect(result).toBeNull()
      expect(mockGiftCodeService.releaseByOrder).not.toHaveBeenCalled()
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
