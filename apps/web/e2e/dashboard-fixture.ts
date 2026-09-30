import type { Route } from '@playwright/test';

/** Expand one test scenario into the independently requested dashboard resources. */
interface DashboardScenario {
  profile?: { id?: string; name?: string };
  access?: Partial<Record<'wallet' | 'invoices' | 'orders' | 'contracts', boolean>>;
  wallet?: Record<string, unknown> | null;
  activeOrders?: number;
  pendingInvoices?: number;
  openTickets?: number;
  contracts?: { active: number; total: number };
  quickStatus?: Record<string, number>;
  upcomingInvoices?: unknown[];
  recentOrders?: unknown[];
  activeContracts?: unknown[];
}

export function fulfillDashboard(route: Route, options: { json: DashboardScenario }) {
  const scenario = options.json;
  const url = new URL(route.request().url());
  if (url.pathname === '/api/dashboard') return route.fulfill(options);
  const profileId = scenario.profile?.id ?? url.searchParams.get('profileId') ?? 'test-profile';
  const access = {
    wallet: true,
    invoices: true,
    orders: true,
    contracts: true,
    ...scenario.access,
  };
  if (url.pathname === '/api/dashboard/context')
    return route.fulfill({
      json: { profile: { id: profileId, name: scenario.profile?.name ?? '' }, access },
    });
  const values = {
    wallet: { ...scenario.wallet, pendingInvoices: scenario.pendingInvoices ?? 0 },
    status: scenario.quickStatus ?? {
      activeContracts: scenario.contracts?.active ?? 0,
      pendingOrders: scenario.activeOrders ?? 0,
      openTickets: scenario.openTickets ?? 0,
      unpaidInvoices: scenario.pendingInvoices ?? 0,
    },
    invoices: scenario.upcomingInvoices ?? [],
    orders: scenario.recentOrders ?? [],
    contracts: scenario.activeContracts ?? [],
  };
  const widget = url.pathname.split('/').at(-1) as keyof typeof values;
  return route.fulfill({ json: { profileId, data: values[widget] } });
}
