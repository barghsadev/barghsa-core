import { test, expect } from './coverage-fixture';

test('dashboard shows the next due invoice and clears it after switching profiles', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('barghsa.locale', 'en'));
  let activeProfileId = 'profile-1';
  const invoiceId = '01900000-0000-7000-8000-000000000001';
  const futureInvoiceId = '01900000-0000-7000-8000-000000000002';
  const overdueInvoiceId = '01900000-0000-7000-8000-000000000003';
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
  await page.route('**/api/dashboard', (route) =>
    route.fulfill({
      json: {
        profile: {
          id: activeProfileId,
          name: activeProfileId === 'profile-1' ? 'Ari Buyer' : 'Nova Energy',
        },
        access: { wallet: true, invoices: true },
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

  await page.getByRole('button', { name: 'Switch language to Persian' }).click();
  const persianInvoices = page.getByRole('region', { name: 'فاکتورهای پیش‌رو' });
  await expect(persianInvoices).toBeVisible();
  await expect(persianInvoices).toHaveCSS('direction', 'rtl');
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();

  await page.getByLabel('Switch active profile').selectOption('profile-2');
  await expect(page.getByRole('heading', { name: 'Welcome, Nova Energy' })).toBeVisible();
  await expect(invoices.getByText('No unpaid invoices for this profile.')).toBeVisible();
  await expect(invoices.getByRole('link', { name: `Pay now · ${invoiceId}` })).toHaveCount(0);
});
