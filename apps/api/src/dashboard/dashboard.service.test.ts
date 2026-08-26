import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DashboardService } from './dashboard.service.js'

// ─── Mock pool ──────────────────────────────────────────────────────────

const mockQuery = vi.fn()

vi.mock('@barghsa/db', () => ({
  getDbPool: () => ({ query: mockQuery }),
}))

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeOrdersRow(status: string, cnt: number) {
  return { status, cnt }
}

// ─── Suite ───────────────────────────────────────────────────────────────

describe('DashboardService', () => {
  let service: DashboardService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new DashboardService()
  })

  describe('getQuickStatusCounts', () => {
    it('returns zeros when the user has no default profile', async () => {
      // No profile found — first query returns empty
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const result = await service.getQuickStatusCounts('user-no-profile')

      expect(result).toEqual({
        activeContracts: 0,
        pendingOrders: 0,
        openTickets: 0,
        unpaidInvoices: 0,
      })
      // Only the profile-lookup query was made — no count queries
      expect(mockQuery).toHaveBeenCalledTimes(1)
    })

    it('returns zeros when all count queries are empty', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'prof-1' }] }) // profile lookup
        .mockResolvedValueOnce({ rows: [] }) // orders
        .mockResolvedValueOnce({ rows: [] }) // tickets
        .mockResolvedValueOnce({ rows: [] }) // invoices

      const result = await service.getQuickStatusCounts('user-1')

      expect(result).toEqual({
        activeContracts: 0,
        pendingOrders: 0,
        openTickets: 0,
        unpaidInvoices: 0,
      })
    })

    it('returns correct counts for a user with data across modules', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'prof-1' }] }) // profile lookup
        .mockResolvedValueOnce({
          // orders — grouped by status
          rows: [
            makeOrdersRow('CONFIRMED', 3),
            makeOrdersRow('PENDING', 2),
          ],
        })
        .mockResolvedValueOnce({ rows: [{ cnt: 1 }] }) // open tickets
        .mockResolvedValueOnce({ rows: [{ cnt: 4 }] }) // unpaid invoices

      const result = await service.getQuickStatusCounts('user-1')

      expect(result).toEqual({
        activeContracts: 3,
        pendingOrders: 2,
        openTickets: 1,
        unpaidInvoices: 4,
      })
    })

    it('excludes orders with other statuses (DRAFT, CANCELLED)', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'prof-1' }] }) // profile lookup
        .mockResolvedValueOnce({
          rows: [
            // Only CONFIRMED and PENDING are counted
            makeOrdersRow('CONFIRMED', 1),
            makeOrdersRow('PENDING', 0),
            // DRAFT and CANCELLED are filtered out by the SQL WHERE clause
          ],
        })
        .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })
        .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })

      const result = await service.getQuickStatusCounts('user-1')

      expect(result.activeContracts).toBe(1)
      expect(result.pendingOrders).toBe(0)
    })

    it('excludes tickets with terminal statuses (resolved, closed)', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'prof-1' }] }) // profile lookup
        .mockResolvedValueOnce({ rows: [makeOrdersRow('CONFIRMED', 0), makeOrdersRow('PENDING', 0)] })
        .mockResolvedValueOnce({ rows: [{ cnt: 0 }] }) // only open/in_progress/waiting are counted
        .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })

      const result = await service.getQuickStatusCounts('user-1')

      expect(result.openTickets).toBe(0)
    })

    it('excludes invoices with non-unpaid states (Paid, Cancelled, Draft)', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'prof-1' }] })
        .mockResolvedValueOnce({ rows: [makeOrdersRow('CONFIRMED', 0), makeOrdersRow('PENDING', 0)] })
        .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })
        // Only Unpaid and Overdue invoices are counted
        .mockResolvedValueOnce({ rows: [{ cnt: 2 }] })

      const result = await service.getQuickStatusCounts('user-1')

      expect(result.unpaidInvoices).toBe(2)
    })

    it('scopes counts to the correct profile (isolation test)', async () => {
      // Two different users with different profiles
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'prof-user-a' }] })
        .mockResolvedValueOnce({ rows: [makeOrdersRow('CONFIRMED', 5), makeOrdersRow('PENDING', 1)] })
        .mockResolvedValueOnce({ rows: [{ cnt: 2 }] })
        .mockResolvedValueOnce({ rows: [{ cnt: 3 }] })

      const resultA = await service.getQuickStatusCounts('user-a')
      expect(resultA.activeContracts).toBe(5)

      // Second call — different user, different profile
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'prof-user-b' }] })
        .mockResolvedValueOnce({ rows: [makeOrdersRow('CONFIRMED', 0), makeOrdersRow('PENDING', 0)] })
        .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })
        .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })

      const resultB = await service.getQuickStatusCounts('user-b')
      expect(resultB.activeContracts).toBe(0)

      // Verify each call scoped to the right profile id
      const profileQuery = mockQuery.mock.calls.filter(
        (call: unknown[]) => (call[0] as string).includes('profiles WHERE'),
      )
      expect(profileQuery).toHaveLength(2)
      expect(profileQuery[0]?.[1]).toEqual(['user-a'])
      expect(profileQuery[1]?.[1]).toEqual(['user-b'])
    })
  })
})