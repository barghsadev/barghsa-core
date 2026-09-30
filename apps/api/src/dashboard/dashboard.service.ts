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

interface UpcomingInvoiceRow {
  id: string;
  due_at: Date | null;
  payable_from: Date | null;
  remaining_amount: string;
  total_unpaid: string;
}

interface RecentOrderRow {
  kind: 'electricity' | 'saving';
  order_id: string;
  status: string;
  submitted_at: Date;
  amount: string | null;
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
    const [profileResult, quickStatus, wallet, upcomingResult, recentOrdersResult] =
      await Promise.all([
        pool.query<{ name: string }>(
          `SELECT COALESCE(NULLIF(l.legal_name,''),NULLIF(TRIM(CONCAT_WS(' ',p.title,p.first_name,p.last_name)),''),'') AS name
         FROM profiles p LEFT JOIN legal_profiles l ON l.id=p.id WHERE p.id=$1`,
          [context.id]
        ),
        this.getCountsForContext(context, userId),
        allowed('wallet:view') ? this.walletService.getWallet(context.id) : Promise.resolve(null),
        allowed('invoices:view')
          ? pool.query<UpcomingInvoiceRow>(
              `SELECT id,due_at,payable_from,
                      GREATEST(total_amount-paid_amount,0)::text AS remaining_amount,
                      (SUM(GREATEST(total_amount-paid_amount,0)) OVER ())::text AS total_unpaid
               FROM invoices WHERE profile_id=$1 AND ${UNPAID_CUSTOMER_INVOICE_PREDICATE}
               ORDER BY due_at ASC NULLS LAST,created_at ASC,id ASC LIMIT 3`,
              [context.id]
            )
          : Promise.resolve({ rows: [] as UpcomingInvoiceRow[] }),
        allowed('orders:view')
          ? pool.query<RecentOrderRow>(
              `SELECT recent.kind,recent.order_id,recent.status,recent.submitted_at,recent.amount
             FROM (
               (SELECT 'electricity'::text AS kind,e.id AS order_id,
                       e.status,e.submitted_at,i.total_amount::text AS amount
                FROM electricity_orders e
                JOIN electricity_contracts ec ON ec.order_id=e.id
                JOIN contracts c ON c.id=ec.contract_id
                JOIN contract_activation_requirements ar ON ar.version_id=c.current_version_id
                JOIN invoices i ON i.id=ar.initial_invoice_id
                WHERE e.profile_id=$1 AND e.submitted_at IS NOT NULL
                ORDER BY e.submitted_at DESC,e.id DESC LIMIT 5)
               UNION ALL
               (SELECT 'saving'::text AS kind,s.id AS order_id,
                       s.status,s.submitted_at,
                       (SELECT i.total_amount::text FROM invoices i
                        WHERE i.order_id=s.order_id AND i.type='auto'
                        ORDER BY i.created_at DESC,i.id DESC LIMIT 1) AS amount
                FROM saving_orders s
                WHERE s.profile_id=$1
                ORDER BY s.submitted_at DESC,s.id DESC LIMIT 5)
             ) recent
             ORDER BY recent.submitted_at DESC,recent.order_id DESC LIMIT 5`,
              [context.id]
            )
          : Promise.resolve({ rows: [] as RecentOrderRow[] }),
      ]);
    if (!profileResult.rows[0]) throw new NotFoundException('Active profile no longer exists');
    const balance = wallet?.availableBalance ?? 0n;
    return {
      profile: { id: context.id, name: profileResult.rows[0].name },
      access: {
        wallet: allowed('wallet:view'),
        invoices: allowed('invoices:view'),
        orders: allowed('orders:view'),
      },
      wallet: allowed('wallet:view')
        ? {
            balance: balance.toString(),
            postedBalance: (wallet?.postedBalance ?? 0n).toString(),
            reservedBalance: (wallet?.reservedBalance ?? 0n).toString(),
            currency: 'IRR',
            lowBalanceWarning: balance < BigInt(upcomingResult.rows[0]?.total_unpaid ?? '0'),
          }
        : null,
      activeOrders: quickStatus.pendingOrders,
      pendingInvoices: quickStatus.unpaidInvoices,
      upcomingInvoices: upcomingResult.rows.map((invoice) => ({
        invoiceId: invoice.id,
        dueAt: invoice.due_at?.toISOString() ?? null,
        payableFrom: invoice.payable_from?.toISOString() ?? null,
        remainingAmount: invoice.remaining_amount,
      })),
      recentOrders: recentOrdersResult.rows.map((order) => ({
        kind: order.kind,
        orderId: order.order_id,
        status: order.status,
        submittedAt: order.submitted_at.toISOString(),
        amountIrR: order.amount,
      })),
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
   * Selection is resolved against current membership. Contract, order, and
   * invoice counts respect the selected profile's applicable permission;
   * tickets are counted only for the signed-in user on that profile.
   *
   * Active contracts use the contract lifecycle. Pending orders use each
   * business workflow's current state, retaining legacy orders that have no
   * electricity or saving record. The union prevents double counting.
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

    return this.getCountsForContext(context, userId);
  }

  private async getCountsForContext(
    context: {
      id: string;
      is_owner: boolean;
      roles: AgentRole[];
    },
    userId: string
  ): Promise<QuickStatusCounts> {
    const profileId = context.id;
    const pool = getDbPool();

    const allowed = (permission: AgentPermission) =>
      context?.is_owner === true || hasAnyRolePermission(context?.roles ?? [], permission);
    const [contractsResult, ordersResult, ticketsResult, invoicesResult] = await Promise.all([
      allowed('contracts:view')
        ? pool.query<{ cnt: number }>(
            `SELECT COUNT(*)::int AS cnt FROM contracts
             WHERE profile_id=$1 AND state='Active'
               AND EXISTS (SELECT 1 FROM contract_publications p WHERE p.contract_id=contracts.id)`,
            [profileId]
          )
        : Promise.resolve({ rows: [{ cnt: 0 }] }),
      allowed('orders:view')
        ? pool.query<{ cnt: number }>(
            `SELECT COUNT(*)::int AS cnt FROM (
               SELECT o.id FROM orders o
               WHERE o.profile_id=$1 AND o.status='PENDING'
                 AND NOT EXISTS (SELECT 1 FROM electricity_orders e WHERE e.id=o.id)
                 AND NOT EXISTS (SELECT 1 FROM saving_orders s WHERE s.order_id=o.id)
               UNION
               SELECT e.id FROM electricity_orders e
               WHERE e.profile_id=$1
                 AND e.status IN ('submitted','awaiting_staff_review','changes_requested','approved')
               UNION
               SELECT s.order_id FROM saving_orders s
               WHERE s.profile_id=$1
                 AND s.status IN ('submitted','awaiting_staff_review','approved','in_progress')
             ) pending`,
            [profileId]
          )
        : Promise.resolve({ rows: [{ cnt: 0 }] }),
      pool.query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt
         FROM tickets
         WHERE profile_id=$1 AND user_id=$2
           AND status IN ('open', 'in_progress', 'waiting_customer', 'waiting_staff')`,
        [profileId, userId]
      ),
      allowed('invoices:view')
        ? pool.query<{ cnt: number }>(
            `SELECT COUNT(*)::int AS cnt
         FROM invoices
         WHERE profile_id = $1 AND ${UNPAID_CUSTOMER_INVOICE_PREDICATE}`,
            [profileId]
          )
        : Promise.resolve({ rows: [{ cnt: 0 }] }),
    ]);

    return {
      activeContracts: contractsResult.rows[0]?.cnt ?? 0,
      pendingOrders: ordersResult.rows[0]?.cnt ?? 0,
      openTickets: ticketsResult.rows[0]?.cnt ?? 0,
      unpaidInvoices: invoicesResult.rows[0]?.cnt ?? 0,
    };
  }
}
