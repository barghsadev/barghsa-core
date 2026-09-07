import {
  hasAnyRolePermission,
  type AgentRole,
  type AgentPermission,
} from '@barghsa/shared/agent-permissions';
import { activeProfileSql } from '../profiles/profile-context.js';
import { Injectable, NotFoundException } from '@nestjs/common';
import { WalletService } from '../wallet/wallet.service.js';
import { getDbPool } from '@barghsa/db';
import { UNPAID_CUSTOMER_INVOICE_PREDICATE } from '@barghsa/shared/finance';

export interface QuickStatusCounts {
  activeContracts: number;
  pendingOrders: number;
  openTickets: number;
  unpaidInvoices: number;
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
  constructor(private readonly walletService: WalletService) {}

  async getOverview(userId: string) {
    const context = await this.getDefaultProfileId(userId);
    if (!context) throw new NotFoundException('No accessible active profile');
    const pool = getDbPool();
    const allowed = (permission: AgentPermission) =>
      context.is_owner || hasAnyRolePermission(context.roles, permission);
    const [profileResult, quickStatus, wallet, dueResult] = await Promise.all([
      pool.query<{ name: string }>(
        `SELECT COALESCE(NULLIF(l.legal_name,''),NULLIF(TRIM(CONCAT_WS(' ',p.title,p.first_name,p.last_name)),''),'') AS name
         FROM profiles p LEFT JOIN legal_profiles l ON l.id=p.id WHERE p.id=$1`,
        [context.id]
      ),
      this.getCountsForContext(context),
      allowed('wallet:view') ? this.walletService.getWallet(context.id) : Promise.resolve(null),
      allowed('wallet:view') && allowed('invoices:view')
        ? pool.query<{ amount: string }>(
            `SELECT COALESCE(SUM(total_amount-paid_amount),0)::text AS amount FROM invoices
             WHERE profile_id=$1 AND ${UNPAID_CUSTOMER_INVOICE_PREDICATE}
               AND (state='Overdue' OR due_at<=NOW())`,
            [context.id]
          )
        : Promise.resolve({ rows: [{ amount: '0' }] }),
    ]);
    if (!profileResult.rows[0]) throw new NotFoundException('Active profile no longer exists');
    const balance = wallet?.availableBalance ?? 0n;
    return {
      profile: { id: context.id, name: profileResult.rows[0].name },
      wallet: allowed('wallet:view')
        ? {
            balance: balance.toString(),
            currency: 'IRR',
            lowBalanceWarning: balance < BigInt(dueResult.rows[0]!.amount),
          }
        : null,
      activeOrders: quickStatus.pendingOrders,
      pendingInvoices: quickStatus.unpaidInvoices,
      openTickets: quickStatus.openTickets,
      contracts: { active: quickStatus.activeContracts, total: quickStatus.activeContracts },
      quickStatus,
    };
  }

  /**
   * Resolve the user's default profile ID, or null if they have none.
   */
  private async getDefaultProfileId(
    userId: string
  ): Promise<{ id: string; is_owner: boolean; roles: AgentRole[] } | null> {
    const pool = getDbPool();
    const result = await pool.query<{ id: string; is_owner: boolean; roles: AgentRole[] }>(
      activeProfileSql('profile:view'),
      [userId]
    );
    return result.rows[0] ?? null;
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
    const context = await this.getDefaultProfileId(userId);
    const profileId = context?.id;
    if (!profileId) {
      return { activeContracts: 0, pendingOrders: 0, openTickets: 0, unpaidInvoices: 0 };
    }

    return this.getCountsForContext(context);
  }

  private async getCountsForContext(context: {
    id: string;
    is_owner: boolean;
    roles: AgentRole[];
  }): Promise<QuickStatusCounts> {
    const profileId = context.id;
    const pool = getDbPool();

    const allowed = (permission: AgentPermission) =>
      context?.is_owner === true || hasAnyRolePermission(context?.roles ?? [], permission);
    const [ordersResult, ticketsResult, invoicesResult] = await Promise.all([
      allowed('orders:view')
        ? pool.query<{ status: string; cnt: number }>(
            `SELECT status, COUNT(*)::int AS cnt
         FROM orders
         WHERE profile_id = $1 AND status IN ('CONFIRMED', 'PENDING')
         GROUP BY status`,
            [profileId]
          )
        : Promise.resolve({ rows: [] }),
      allowed('orders:view')
        ? pool.query<{ cnt: number }>(
            `SELECT COUNT(*)::int AS cnt
         FROM tickets
         WHERE profile_id = $1 AND status IN ('open', 'in_progress', 'waiting_customer', 'waiting_staff')`,
            [profileId]
          )
        : Promise.resolve({ rows: [{ cnt: 0 }] }),
      allowed('invoices:view')
        ? pool.query<{ cnt: number }>(
            `SELECT COUNT(*)::int AS cnt
         FROM invoices
         WHERE profile_id = $1 AND ${UNPAID_CUSTOMER_INVOICE_PREDICATE}`,
            [profileId]
          )
        : Promise.resolve({ rows: [{ cnt: 0 }] }),
    ]);

    const orderCounts: Record<string, number> = {};
    for (const row of ordersResult.rows) {
      orderCounts[row.status] = row.cnt;
    }

    return {
      activeContracts: orderCounts['CONFIRMED'] ?? 0,
      pendingOrders: orderCounts['PENDING'] ?? 0,
      openTickets: ticketsResult.rows[0]?.cnt ?? 0,
      unpaidInvoices: invoicesResult.rows[0]?.cnt ?? 0,
    };
  }
}
