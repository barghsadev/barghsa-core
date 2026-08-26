import { Injectable, Logger } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'

export interface QuickStatusCounts {
  activeContracts: number
  pendingOrders: number
  openTickets: number
  unpaidInvoices: number
}

/**
 * Dashboard service (T-08.01.03).
 *
 * Aggregates quick-status counts across modules for the user's default
 * (active) profile. Each query is a lightweight count aggregation so
 * the dashboard loads fast even when underlying modules have complex
 * schemas.
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name)

  /**
   * Resolve the user's default profile ID, or null if they have none.
   */
  private async getDefaultProfileId(userId: string): Promise<string | null> {
    const pool = getDbPool()
    const result = await pool.query<{ id: string }>(
      `SELECT id FROM profiles WHERE user_id = $1 AND is_default = true LIMIT 1`,
      [userId],
    )
    return result.rows[0]?.id ?? null
  }

  /**
   * Return the four quick-status counts for a given user's default profile.
   *
   * - **Active contracts:** orders with `status = 'CONFIRMED'` (electricity
   *   subscription contracts).  Once a dedicated `contracts` table is
   *   added, this query should switch to it.
   * - **Pending orders:** orders with `status = 'PENDING'`.
   * - **Open tickets:** tickets with a non-terminal status (open,
   *   in_progress, waiting_customer, waiting_staff).
   * - **Unpaid invoices:** invoices in state `'Unpaid'` or `'Overdue'`.
   */
  async getQuickStatusCounts(userId: string): Promise<QuickStatusCounts> {
    const profileId = await this.getDefaultProfileId(userId)
    if (!profileId) {
      return { activeContracts: 0, pendingOrders: 0, openTickets: 0, unpaidInvoices: 0 }
    }

    const pool = getDbPool()

    const [ordersResult, ticketsResult, invoicesResult] = await Promise.all([
      pool.query<{ status: string; cnt: number }>(
        `SELECT status, COUNT(*)::int AS cnt
         FROM orders
         WHERE profile_id = $1 AND status IN ('CONFIRMED', 'PENDING')
         GROUP BY status`,
        [profileId],
      ),
      pool.query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt
         FROM tickets
         WHERE profile_id = $1 AND status IN ('open', 'in_progress', 'waiting_customer', 'waiting_staff')`,
        [profileId],
      ),
      pool.query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt
         FROM invoices
         WHERE profile_id = $1 AND state IN ('Unpaid', 'Overdue')`,
        [profileId],
      ),
    ])

    const orderCounts: Record<string, number> = {}
    for (const row of ordersResult.rows) {
      orderCounts[row.status] = row.cnt
    }

    return {
      activeContracts: orderCounts['CONFIRMED'] ?? 0,
      pendingOrders: orderCounts['PENDING'] ?? 0,
      openTickets: ticketsResult.rows[0]?.cnt ?? 0,
      unpaidInvoices: invoicesResult.rows[0]?.cnt ?? 0,
    }
  }
}