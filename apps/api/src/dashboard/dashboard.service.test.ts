import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardService } from './dashboard.service.js';

const mockQuery = vi.fn();

vi.mock('@barghsa/db', () => ({
  getDbPool: () => ({ query: mockQuery }),
}));

function queryFor(fragment: string) {
  return mockQuery.mock.calls.find((call) => (call[0] as string).includes(fragment));
}

describe('DashboardService quick status', () => {
  let service: DashboardService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DashboardService({ getWallet: vi.fn() } as never);
  });

  it('reports exact available, posted and reserved balances against all unpaid invoices', async () => {
    const wallet = {
      availableBalance: 20n,
      postedBalance: 120n,
      reservedBalance: 100n,
    };
    service = new DashboardService({ getWallet: vi.fn().mockResolvedValue(wallet) } as never);
    mockQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM profiles p') && query.includes('JOIN users u'))
        return { rows: [{ id: 'profile-1', is_owner: true, roles: [] }] };
      if (query.includes('FROM profiles p')) return { rows: [{ name: 'Customer' }] };
      if (query.includes('OVER ()'))
        return {
          rows: [
            {
              id: 'invoice-1',
              due_at: new Date('2026-10-03T12:00:00.000Z'),
              payable_from: new Date('2026-09-30T12:00:00.000Z'),
              remaining_amount: '50',
              total_unpaid: '50',
            },
          ],
        };
      if (query.includes('SELECT recent.kind'))
        return {
          rows: [
            {
              kind: 'saving',
              order_id: 'saving-1',
              status: 'in_progress',
              submitted_at: new Date('2026-09-29T12:00:00.000Z'),
              amount: '250000',
            },
            {
              kind: 'electricity',
              order_id: 'electricity-1',
              status: 'submitted',
              submitted_at: new Date('2026-09-28T12:00:00.000Z'),
              amount: '100000',
            },
          ],
        };
      if (query.includes('SELECT c.id,c.contract_number::text'))
        return {
          rows: [
            {
              id: 'contract-1',
              contract_number: '42',
              service_type: 'electricity',
              state: 'Active',
              service_starts_at: new Date('2026-01-01T00:00:00.000Z'),
              service_ends_at: new Date('2027-01-01T00:00:00.000Z'),
            },
          ],
        };
      return { rows: [{ cnt: 0 }] };
    });
    const overview = await service.getOverview('customer-1');
    expect(overview.wallet).toEqual({
      balance: '20',
      postedBalance: '120',
      reservedBalance: '100',
      currency: 'IRR',
      lowBalanceWarning: true,
    });
    expect(overview.access).toEqual({
      wallet: true,
      invoices: true,
      orders: true,
      contracts: true,
    });
    expect(overview.activeContracts).toEqual([
      {
        contractId: 'contract-1',
        contractNumber: '42',
        serviceType: 'electricity',
        status: 'Active',
        serviceStartsAt: '2026-01-01T00:00:00.000Z',
        serviceEndsAt: '2027-01-01T00:00:00.000Z',
      },
    ]);
    const activeContractQuery = queryFor('SELECT c.id,c.contract_number::text');
    expect(activeContractQuery?.[0]).toContain("c.state='Active'");
    expect(activeContractQuery?.[0]).toContain('p.version_id=c.current_version_id');
    expect(activeContractQuery?.[0]).toContain('LIMIT 3');
    expect(activeContractQuery?.[1]).toEqual(['profile-1']);
    expect(overview.recentOrders).toEqual([
      {
        kind: 'saving',
        orderId: 'saving-1',
        status: 'in_progress',
        submittedAt: '2026-09-29T12:00:00.000Z',
        amountIrR: '250000',
      },
      {
        kind: 'electricity',
        orderId: 'electricity-1',
        status: 'submitted',
        submittedAt: '2026-09-28T12:00:00.000Z',
        amountIrR: '100000',
      },
    ]);
    const recentQuery = queryFor('SELECT recent.kind');
    expect(recentQuery?.[0]).toContain('FROM electricity_orders e');
    expect(recentQuery?.[0]).toContain('JOIN contract_activation_requirements ar');
    expect(recentQuery?.[0]).toContain('JOIN invoices i ON i.id=ar.initial_invoice_id');
    expect(recentQuery?.[0]).toContain('FROM saving_orders s');
    expect(recentQuery?.[0]).toContain(
      'ORDER BY recent.submitted_at DESC,recent.order_id DESC LIMIT 5'
    );
    expect(recentQuery?.[1]).toEqual(['profile-1']);
    expect(overview.upcomingInvoices).toEqual([
      {
        invoiceId: 'invoice-1',
        dueAt: '2026-10-03T12:00:00.000Z',
        payableFrom: '2026-09-30T12:00:00.000Z',
        remainingAmount: '50',
      },
    ]);
    const outstandingQuery = queryFor('OVER ()');
    expect(outstandingQuery?.[0]).toContain("state IN ('Unpaid', 'Overdue')");
    expect(outstandingQuery?.[0]).toContain('ORDER BY due_at ASC NULLS LAST');
    expect(outstandingQuery?.[0]).toContain('LIMIT 3');
    expect(outstandingQuery?.[1]).toEqual(['profile-1']);
  });

  it('does not query business data without an active profile', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await expect(service.getQuickStatusCounts('missing')).resolves.toEqual({
      activeContracts: 0,
      pendingOrders: 0,
      openTickets: 0,
      unpaidInvoices: 0,
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable account sections without reading them for a legal-only agent', async () => {
    const getWallet = vi.fn();
    service = new DashboardService({ getWallet } as never);
    mockQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM profiles p') && query.includes('JOIN users u'))
        return { rows: [{ id: 'profile-legal', is_owner: false, roles: ['Legal'] }] };
      if (query.includes('FROM profiles p')) return { rows: [{ name: 'Legal profile' }] };
      if (query.includes('SELECT c.id,c.contract_number::text')) return { rows: [] };
      if (query.includes('FROM contracts') || query.includes('FROM tickets'))
        return { rows: [{ cnt: 0 }] };
      throw new Error('Unauthorized query');
    });

    const overview = await service.getOverview('legal-user');
    expect(overview.access).toEqual({
      wallet: false,
      invoices: false,
      orders: false,
      contracts: true,
    });
    expect(overview.wallet).toBeNull();
    expect(overview.upcomingInvoices).toEqual([]);
    expect(overview.recentOrders).toEqual([]);
    expect(overview.activeContracts).toEqual([]);
    expect(getWallet).not.toHaveBeenCalled();
    expect(queryFor('FROM invoices')).toBeUndefined();
    expect(queryFor('SELECT recent.kind')).toBeUndefined();
  });

  it('counts active contracts and pending workflow orders without duplicate legacy rows', async () => {
    mockQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM profiles p'))
        return { rows: [{ id: 'profile-1', is_owner: true, roles: [] }] };
      if (query.includes('FROM contracts')) return { rows: [{ cnt: 3 }] };
      if (query.includes(') pending')) return { rows: [{ cnt: 4 }] };
      if (query.includes('FROM tickets')) return { rows: [{ cnt: 1 }] };
      if (query.includes('FROM invoices')) return { rows: [{ cnt: 2 }] };
      throw new Error('Unexpected query');
    });
    await expect(service.getQuickStatusCounts('user-1')).resolves.toEqual({
      activeContracts: 3,
      pendingOrders: 4,
      openTickets: 1,
      unpaidInvoices: 2,
    });

    const contractQuery = queryFor('FROM contracts');
    expect(contractQuery?.[0]).toContain("state='Active'");
    expect(contractQuery?.[0]).toContain('FROM contract_publications p');
    expect(contractQuery?.[1]).toEqual(['profile-1']);
    const orderQuery = queryFor(') pending');
    expect(orderQuery?.[0]).toContain('UNION');
    expect(orderQuery?.[0]).toContain('FROM electricity_orders e');
    expect(orderQuery?.[0]).toContain('FROM saving_orders s');
    expect(orderQuery?.[0]).toContain('NOT EXISTS (SELECT 1 FROM electricity_orders e');
    expect(orderQuery?.[0]).toContain('NOT EXISTS (SELECT 1 FROM saving_orders s');
    expect(orderQuery?.[0]).toContain(
      "e.status IN ('submitted','awaiting_staff_review','changes_requested','approved')"
    );
    expect(orderQuery?.[0]).toContain(
      "s.status IN ('submitted','awaiting_staff_review','approved','in_progress')"
    );
    expect(orderQuery?.[1]).toEqual(['profile-1']);
    expect(queryFor('FROM invoices')?.[0]).toContain("adjustment_kind IS DISTINCT FROM 'credit'");
    expect(queryFor('FROM tickets')?.[0]).toContain('user_id=$2');
    expect(queryFor('FROM tickets')?.[1]).toEqual(['profile-1', 'user-1']);
  });

  it('keeps counts at zero when no matching records exist', async () => {
    mockQuery.mockImplementation(async (query: string) =>
      query.includes('FROM profiles p')
        ? { rows: [{ id: 'profile-1', is_owner: true, roles: [] }] }
        : { rows: [{ cnt: 0 }] }
    );
    await expect(service.getQuickStatusCounts('user-1')).resolves.toEqual({
      activeContracts: 0,
      pendingOrders: 0,
      openTickets: 0,
      unpaidInvoices: 0,
    });
  });

  it('does not query orders or invoices for a legal-only agent', async () => {
    mockQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM profiles p'))
        return { rows: [{ id: 'profile-legal', is_owner: false, roles: ['Legal'] }] };
      if (query.includes('FROM contracts')) return { rows: [{ cnt: 2 }] };
      if (query.includes('FROM tickets')) return { rows: [{ cnt: 0 }] };
      throw new Error('Unauthorized query');
    });
    await expect(service.getQuickStatusCounts('legal-user')).resolves.toEqual({
      activeContracts: 2,
      pendingOrders: 0,
      openTickets: 0,
      unpaidInvoices: 0,
    });
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it('scopes every aggregation to the selected profile', async () => {
    mockQuery.mockImplementation(async (query: string, args: string[]) => {
      if (query.includes('FROM profiles p'))
        return { rows: [{ id: `profile-${args[0]}`, is_owner: true, roles: [] }] };
      return { rows: [{ cnt: args[0] === 'profile-first' ? 5 : 0 }] };
    });
    expect((await service.getQuickStatusCounts('first')).activeContracts).toBe(5);
    expect((await service.getQuickStatusCounts('second')).activeContracts).toBe(0);
    const businessCalls = mockQuery.mock.calls.filter(
      (call) => !(call[0] as string).includes('FROM profiles p')
    );
    expect(businessCalls).toHaveLength(8);
    expect(
      businessCalls.slice(0, 4).every((call) => (call[1] as string[])[0] === 'profile-first')
    ).toBe(true);
    expect(
      businessCalls.slice(4).every((call) => (call[1] as string[])[0] === 'profile-second')
    ).toBe(true);
  });
});
