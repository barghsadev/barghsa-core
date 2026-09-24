import { test, expect } from './coverage-fixture';

const settings = [
  {
    capability: 'electricity_checkout',
    active: true,
    reason: { fa: 'تا پایان بررسی', en: 'Checkout is being checked' },
    estimatedUntil: '2099-01-01T00:00:00.000Z',
    owner: 'Operations',
    version: 1,
    updatedAt: '2026-09-24T00:00:00.000Z',
  },
  ...(['saving_orders', 'solar_requests', 'wallet_topup', 'ai_chat'] as const).map(
    (capability) => ({
      capability,
      active: false,
      reason: null,
      estimatedUntil: null,
      owner: null,
      version: 0,
      updatedAt: null,
    })
  ),
];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({ json: { userId: 'customer', requiresTosAcceptance: false } })
  );
  await page.route('**/api/maintenance', (route) =>
    route.fulfill({ json: { capabilities: settings } })
  );
});

test('paused checkout shows a bilingual reason and support while other intake stays open', async ({
  page,
}) => {
  await page.goto('/electricity/order');
  await expect(page.getByRole('heading', { name: 'این خدمت موقتاً در دسترس نیست' })).toBeVisible();
  await expect(page.getByText('تا پایان بررسی', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'تماس با پشتیبانی' })).toHaveAttribute(
    'href',
    '/tickets'
  );
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
  await expect(page.getByText('Checkout is being checked')).toBeVisible();
  await page.goto('/solar/requests/new');
  await expect(page.getByRole('heading', { name: 'Service temporarily unavailable' })).toHaveCount(
    0
  );
});

test('staff can prepare a versioned maintenance change', async ({ page }) => {
  let submitted: Record<string, unknown> | null = null;
  await page.route('**/api/admin/maintenance', (route) => route.fulfill({ json: settings }));
  await page.route('**/api/admin/maintenance/electricity_checkout', (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ json: { ...settings[0], active: false, version: 2 } });
  });
  await page.goto('/admin/maintenance');
  await expect(page.getByRole('heading', { name: 'توقف موقت خدمات' })).toBeVisible();
  await expect(page.getByText('Operations')).toBeVisible();
  await expect(page.locator('time[datetime="2099-01-01T00:00:00.000Z"]')).toBeVisible();
  await page.getByRole('button', { name: 'مدیریت' }).first().click();
  await page.getByRole('checkbox', { name: 'متوقف‌شده' }).uncheck();
  await page.getByRole('button', { name: 'ذخیره تغییر' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'تأیید' }).click();
  await expect.poll(() => submitted).toMatchObject({ active: false, expectedVersion: 1 });
});
