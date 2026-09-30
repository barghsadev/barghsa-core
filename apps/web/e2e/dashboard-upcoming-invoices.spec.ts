import { fulfillDashboard } from './dashboard-fixture';
import { test, expect } from './coverage-fixture';

test('dashboard shows invoices, orders and contracts, then clears them after switching profiles', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('barghsa.locale', 'en'));
  let activeProfileId = 'profile-1';
  const invoiceId = '01900000-0000-7000-8000-000000000001';
  const futureInvoiceId = '01900000-0000-7000-8000-000000000002';
  const overdueInvoiceId = '01900000-0000-7000-8000-000000000003';
  const savingOrderId = '01900000-0000-7000-8000-000000000004';
  const electricityOrderId = '01900000-0000-7000-8000-000000000005';
  const contractId = '01900000-0000-7000-8000-000000000006';
  const undatedContractId = '01900000-0000-7000-8000-000000000007';
  const serviceStartsAt = new Date(Date.now() - 10 * 86_400_000).toISOString();
  const serviceEndsAt = new Date(Date.now() + 10 * 86_400_000).toISOString();
  const dueAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const payableFrom = new Date(Date.now() + 2 * 86_400_000).toISOString();
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({ json: { userId: 'viewer', isStaff: false, requiresTosAcceptance: false } })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [
          {
            id: 'profile-1',
            profileType: 'INDIVIDUAL',
            status: 'ACTIVE',
            firstName: 'Ari',
            lastName: 'Buyer',
          },
          {
            id: 'profile-2',
            profileType: 'LEGAL',
            status: 'ACTIVE',
            firstName: 'Nova',
            lastName: 'Energy',
          },
        ],
        hasDefault: true,
        activeProfileId,
      },
    })
  );
  await page.route('**/api/profiles/switch/profile-2', (route) => {
    activeProfileId = 'profile-2';
    return route.fulfill({ json: { activeProfileId } });
  });
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/dashboard{,/**}', (route) =>
    fulfillDashboard(route, {
      json: {
        profile: {
          id: activeProfileId,
          name: activeProfileId === 'profile-1' ? 'Ari Buyer' : 'Nova Energy',
        },
        access: { wallet: true, invoices: true, orders: true, contracts: true },
        wallet: {
          balance: '500000',
          postedBalance: '500000',
          reservedBalance: '0',
          currency: 'IRR',
          lowBalanceWarning: false,
        },
        activeOrders: 0,
        pendingInvoices: activeProfileId === 'profile-1' ? 3 : 0,
        openTickets: 0,
        contracts: { active: 0, total: 0 },
        quickStatus: {
          activeContracts: 0,
          pendingOrders: 0,
          openTickets: 0,
          unpaidInvoices: activeProfileId === 'profile-1' ? 3 : 0,
        },
        upcomingInvoices:
          activeProfileId === 'profile-1'
            ? [
                {
                  invoiceId: overdueInvoiceId,
                  dueAt: new Date(Date.now() - 86_400_000).toISOString(),
                  payableFrom: null,
                  remainingAmount: '50000',
                },
                { invoiceId, dueAt, payableFrom: null, remainingAmount: '250000' },
                {
                  invoiceId: futureInvoiceId,
                  dueAt: new Date(Date.now() + 4 * 86_400_000).toISOString(),
                  payableFrom,
                  remainingAmount: '100000',
                },
              ]
            : [],
        recentOrders:
          activeProfileId === 'profile-1'
            ? [
                {
                  kind: 'saving',
                  orderId: savingOrderId,
                  status: 'in_progress',
                  submittedAt: '2026-09-29T12:00:00.000Z',
                  amountIrR: '250000',
                },
                {
                  kind: 'electricity',
                  orderId: electricityOrderId,
                  status: 'submitted',
                  submittedAt: '2026-09-28T12:00:00.000Z',
                  amountIrR: null,
                },
              ]
            : [],
        activeContracts:
          activeProfileId === 'profile-1'
            ? [
                {
                  contractId,
                  contractNumber: '42',
                  serviceType: 'electricity',
                  status: 'Active',
                  serviceStartsAt,
                  serviceEndsAt,
                },
                {
                  contractId: undatedContractId,
                  contractNumber: '43',
                  serviceType: 'savings',
                  status: 'Active',
                  serviceStartsAt: null,
                  serviceEndsAt: null,
                },
              ]
            : [],
      },
    })
  );

  await page.goto('/app');
  const invoices = page.getByRole('region', { name: 'Upcoming invoices' });
  await expect(invoices).toBeVisible();
  await expect(invoices.getByText('3 days remaining')).toBeVisible();
  await expect(invoices.getByText('Overdue')).toHaveClass(/text-destructive/);
  await expect(invoices.getByRole('link', { name: `Pay now · ${invoiceId}` })).toHaveAttribute(
    'href',
    `/invoices/${invoiceId}`
  );
  await expect(
    invoices.getByRole('link', { name: `View invoice · ${futureInvoiceId}` })
  ).toHaveAttribute('href', `/invoices/${futureInvoiceId}`);
  await expect(invoices.getByRole('link', { name: 'View all' })).toHaveAttribute(
    'href',
    '/invoices?status=unpaid'
  );
  const orders = page.getByRole('region', { name: 'Recent orders' });
  await expect(orders).toBeVisible();
  await expect(orders.getByText('In progress')).toBeVisible();
  await expect(orders.getByText('Amount not available yet')).toBeVisible();
  await expect(orders.getByText(/250,000/)).toBeVisible();
  await expect(orders.getByRole('link', { name: `View order · ${savingOrderId}` })).toHaveAttribute(
    'href',
    `/savings/orders/${savingOrderId}`
  );
  await expect(
    orders.getByRole('link', { name: `View order · ${electricityOrderId}` })
  ).toHaveAttribute('href', `/electricity/orders/${electricityOrderId}`);
  await expect(orders.getByRole('link', { name: 'View all electricity orders' })).toHaveAttribute(
    'href',
    '/electricity/orders'
  );
  await expect(orders.getByRole('link', { name: 'View all saving orders' })).toHaveAttribute(
    'href',
    '/savings/orders'
  );
  const contracts = page.getByRole('region', { name: 'Active contracts' });
  await expect(contracts).toBeVisible();
  await expect(contracts.getByText('50% of term elapsed')).toBeVisible();
  await expect(contracts.getByText('Term progress is not available yet.')).toBeVisible();
  await expect(contracts.getByRole('progressbar', { name: '50% of term elapsed' })).toHaveAttribute(
    'aria-valuenow',
    '50'
  );
  const contractHref = await contracts
    .getByRole('link', { name: 'View contract · 42' })
    .getAttribute('href');
  const contractSearch = new URL(contractHref!, 'http://localhost').searchParams;
  expect(contractSearch.get('state')).toBe('Active');
  expect(contractSearch.get('contractId')).toBe(contractId);
  await expect(contracts.getByRole('link', { name: 'View all' })).toHaveAttribute(
    'href',
    /\/contracts\?state=Active/
  );

  await page.getByRole('button', { name: 'Switch language to Persian' }).click();
  const persianInvoices = page.getByRole('region', { name: 'فاکتورهای پیش‌رو' });
  await expect(persianInvoices).toBeVisible();
  await expect(persianInvoices).toHaveCSS('direction', 'rtl');
  await expect(page.getByRole('region', { name: 'آخرین سفارش‌ها' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'قراردادهای فعال' })).toBeVisible();
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();

  const menu = page.locator('button[aria-controls="dashboard-navigation"]');
  if ((await menu.isVisible()) && (await menu.getAttribute('aria-expanded')) === 'false')
    await menu.click();
  await page.getByLabel('Switch active profile').selectOption('profile-2');
  await expect(page.getByRole('heading', { name: 'Welcome, Nova Energy' })).toBeVisible();
  await expect(invoices.getByText('No unpaid invoices for this profile.')).toBeVisible();
  await expect(invoices.getByRole('link', { name: `Pay now · ${invoiceId}` })).toHaveCount(0);
  await expect(orders.getByText('No orders for this profile yet.')).toBeVisible();
  await expect(orders.getByRole('link', { name: `View order · ${savingOrderId}` })).toHaveCount(0);
  await expect(contracts.getByText('No active contracts for this profile.')).toBeVisible();
  await expect(contracts.getByRole('link', { name: 'View contract · 42' })).toHaveCount(0);
});
