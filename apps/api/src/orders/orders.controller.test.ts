import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OrdersController } from './orders.controller.js'
import { OrdersService, type OrderRow } from './orders.service.js'

function mockOrder(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: 'ord-001',
    userId: 'user-1',
    profileId: 'prof-1',
    productId: 'prod-1',
    orderType: 'electricity',
    status: 'DRAFT',
    snapshotProvinceId: 'prov-1',
    snapshotCityId: 'city-1',
    snapshotFullAddress: '123 Test St',
    snapshotPostalCode: '1234567890',
    giftCodeId: null,
    giftDiscountAmount: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('OrdersController', () => {
  let controller: OrdersController
  let service: OrdersService

  beforeEach(() => {
    service = {
      createOrder: vi.fn(),
      listOrders: vi.fn(),
      getOrder: vi.fn(),
      cancelOrder: vi.fn(),
    } as unknown as OrdersService

    controller = new OrdersController(service)
  })

  describe('createOrder', () => {
    it('delegates to service and returns order', async () => {
      const order = mockOrder()
      vi.mocked(service.createOrder).mockResolvedValue(order)

      const req = { session: { userId: 'user-1' } } as any

      const body = {
        profileId: 'prof-1',
        productId: 'prod-1',
        orderType: 'electricity' as const,
        address: {
          provinceId: 'prov-1',
          cityId: 'city-1',
          fullAddress: '123 Test St',
          postalCode: '1234567890',
        },
      }

      const result = await controller.createOrder(body, req)

      expect(result).toEqual(order)
      expect(service.createOrder).toHaveBeenCalledWith('user-1', body, 'unknown')
    })

    it('forwards an optional giftCode to the service', async () => {
      const order = mockOrder({ giftCodeId: 'gc-1', giftDiscountAmount: '500000' })
      vi.mocked(service.createOrder).mockResolvedValue(order)

      const req = { session: { userId: 'user-1' } } as any
      const body = {
        profileId: 'prof-1',
        productId: 'prod-1',
        orderType: 'electricity' as const,
        address: {
          provinceId: 'prov-1',
          cityId: 'city-1',
          fullAddress: '123 Test St',
          postalCode: '1234567890',
        },
        giftCode: ' SALE10 ',
      }

      const result = await controller.createOrder(body, req)

      expect(result.giftDiscountAmount).toBe('500000')
      expect(service.createOrder).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ giftCode: ' SALE10 ' }),
        'unknown',
      )
    })
  })

  describe('listOrders', () => {
    it('returns orders list', async () => {
      const mockOrders = [mockOrder()]
      vi.mocked(service.listOrders).mockResolvedValue(mockOrders)

      const req = { session: { userId: 'user-1' } } as any
      const result = await controller.listOrders(req)

      expect(result).toEqual({ orders: mockOrders })
      expect(service.listOrders).toHaveBeenCalledWith('user-1')
    })
  })

  describe('getOrder', () => {
    it('returns order when found', async () => {
      const mockOrderRow = mockOrder()
      vi.mocked(service.getOrder).mockResolvedValue(mockOrderRow)

      const req = { session: { userId: 'user-1' } } as any
      const result = await controller.getOrder('ord-001', req)

      expect(result).toEqual(mockOrderRow)
      expect(service.getOrder).toHaveBeenCalledWith('user-1', 'ord-001')
    })

    it('throws 404 when order not found', async () => {
      vi.mocked(service.getOrder).mockResolvedValue(null)

      const req = { session: { userId: 'user-1' } } as any

      await expect(
        controller.getOrder('ord-001', req),
      ).rejects.toThrow()
    })
  })

  describe('cancelOrder', () => {
    it('delegates to service and returns the cancelled order', async () => {
      const order = mockOrder({ status: 'CANCELLED' })
      vi.mocked(service.cancelOrder).mockResolvedValue(order)

      const req = { session: { userId: 'user-1' } } as any
      const result = await controller.cancelOrder('ord-001', req)

      expect(result.status).toBe('CANCELLED')
      expect(service.cancelOrder).toHaveBeenCalledWith('user-1', 'ord-001', 'unknown')
    })

    it('throws 404 when order not found', async () => {
      vi.mocked(service.cancelOrder).mockResolvedValue(null)

      const req = { session: { userId: 'user-1' } } as any
      await expect(controller.cancelOrder('ord-001', req)).rejects.toThrow()
    })
  })
})