import {hasAnyRolePermission,type AgentRole,type AgentPermission} from '@barghsa/shared/agent-permissions'
import { activeProfileSql } from '../profiles/profile-context.js'
import { Injectable } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { UNPAID_CUSTOMER_INVOICE_PREDICATE } from '@barghsa/shared/finance'

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

  /**
   * Resolve the user's default profile ID, or null if they have none.
   */
  private async getDefaultProfileId(userId: string): Promise<{id:string;is_owner:boolean;roles:AgentRole[]} | null> {
    const pool = getDbPool()
    const result = await pool.query<{id:string;is_owner:boolean;roles:AgentRole[]}>(
      activeProfileSql('profile:view'),
      [userId],
    )
    return result.rows[0] ?? null
  }

  /**
   * Return the four quick-status counts for a given user's default profile.
   *
   * Selection is resolved against current membership. Each count also respects
   * the selected profile's applicable operational or financial permission.
   *
   * The orders query returns both the active-contract and pending-order
   * counts in a single `GROUP BY status` pass; `activeContracts` is derived
   * from the `CONFIRMED` row and `pendingOrders` from the `PENDING` row.
   *
   * - **Active contracts:** orders with `status = 'CONFIRMED'` (electricity
   *   subscription contracts).  Once a dedicated `contracts` table is
   *   added, this query should switch to it.
   * - **Pending orders:** orders with `status = 'PENDING'`.
   * - **Open tickets:** tickets with a non-terminal status (open,
   *   in_progress, waiting_customer, waiting_staff).
   * - **Unpaid invoices:** customer-payable invoices in state `'Unpaid'`
   *   or `'Overdue'`. Credit-note adjustments (`adjustment_kind = 'credit'`)
   *   are excluded — they reduce liability rather than adding a bill.
   */
  async getQuickStatusCounts(userId: string): Promise<QuickStatusCounts> {
    const context = await this.getDefaultProfileId(userId)
    const profileId=context?.id
    if (!profileId) {
      return { activeContracts: 0, pendingOrders: 0, openTickets: 0, unpaidInvoices: 0 }
    }

    const pool = getDbPool()

    const allowed=(permission:AgentPermission)=>context?.is_owner===true || hasAnyRolePermission(context?.roles ?? [],permission)
    const [ordersResult, ticketsResult, invoicesResult] = await Promise.all([
      allowed('orders:view') ? pool.query<{ status: string; cnt: number }>(
        `SELECT status, COUNT(*)::int AS cnt
         FROM orders
         WHERE profile_id = $1 AND status IN ('CONFIRMED', 'PENDING')
         GROUP BY status`,
        [profileId],
      ) : Promise.resolve({rows:[]}),
      allowed('orders:view') ? pool.query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt
         FROM tickets
         WHERE profile_id = $1 AND status IN ('open', 'in_progress', 'waiting_customer', 'waiting_staff')`,
        [profileId],
      ) : Promise.resolve({rows:[{cnt:0}]}),
      allowed('invoices:view') ? pool.query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt
         FROM invoices
         WHERE profile_id = $1 AND ${UNPAID_CUSTOMER_INVOICE_PREDICATE}`,
        [profileId],
      ) : Promise.resolve({rows:[{cnt:0}]}),
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