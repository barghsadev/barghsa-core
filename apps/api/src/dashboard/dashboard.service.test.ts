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
      throw new Error('Unauthorized query');
    });
    await expect(service.getQuickStatusCounts('legal-user')).resolves.toEqual({
      activeContracts: 2,
      pendingOrders: 0,
      openTickets: 0,
      unpaidInvoices: 0,
    });
    expect(mockQuery).toHaveBeenCalledTimes(2);
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
