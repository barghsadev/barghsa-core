import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OrdersController } from './orders.controller.js'
import { OrdersService } from './orders.service.js'

describe('OrdersController', () => {
  let controller: OrdersController
  let service: OrdersService

  beforeEach(() => {
    service = {
      createOrder: vi.fn(),
      listOrders: vi.fn(),
      getOrder: vi.fn(),
    } as unknown as OrdersService

    controller = new OrdersController(service)
  })

  describe('createOrder', () => {
    it('delegates to service and returns order', async () => {
      const mockOrder = {
        id: 'ord-001',
        userId: 'user-1',
        profileId: 'prof-1',
        productId: 'prod-1',
        orderType: 'electricity' as const,
        status: 'DRAFT' as const,
        snapshotProvinceId: 'prov-1',
        snapshotCityId: 'city-1',
        snapshotFullAddress: '123 Test St',
        snapshotPostalCode: '1234567890',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      vi.mocked(service.createOrder).mockResolvedValue(mockOrder)

      const req = {
        session: { userId: 'user-1' },
      } as any

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

      expect(result).toEqual(mockOrder)
      expect(service.createOrder).toHaveBeenCalledWith('user-1', body)
    })
  })

  describe('listOrders', () => {
    it('returns orders list', async () => {
      const mockOrders = [
        {
          id: 'ord-001',
          userId: 'user-1',
          profileId: 'prof-1',
          productId: 'prod-1',
          orderType: 'electricity' as const,
          status: 'DRAFT' as const,
          snapshotProvinceId: 'prov-1',
          snapshotCityId: 'city-1',
          snapshotFullAddress: '123 Test St',
          snapshotPostalCode: '1234567890',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]
      vi.mocked(service.listOrders).mockResolvedValue(mockOrders)

      const req = { session: { userId: 'user-1' } } as any
      const result = await controller.listOrders(req)

      expect(result).toEqual({ orders: mockOrders })
      expect(service.listOrders).toHaveBeenCalledWith('user-1')
    })
  })

  describe('getOrder', () => {
    it('returns order when found', async () => {
      const mockOrder = {
        id: 'ord-001',
        userId: 'user-1',
        profileId: 'prof-1',
        productId: 'prod-1',
        orderType: 'electricity' as const,
        status: 'DRAFT' as const,
        snapshotProvinceId: 'prov-1',
        snapshotCityId: 'city-1',
        snapshotFullAddress: '123 Test St',
        snapshotPostalCode: '1234567890',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      vi.mocked(service.getOrder).mockResolvedValue(mockOrder)

      const req = { session: { userId: 'user-1' } } as any
      const result = await controller.getOrder('ord-001', req)

      expect(result).toEqual(mockOrder)
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
})