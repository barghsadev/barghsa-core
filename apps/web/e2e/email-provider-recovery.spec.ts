import { test, expect } from './coverage-fixture';

for (const locale of ['en', 'fa'] as const) {
  test(`provider list rejects malformed data and recovers (${locale})`, async ({ page }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    let valid = false;
    await page.route('**/api/admin/email-providers', (route) =>
      route.fulfill({ json: valid ? [] : null })
    );
    await page.goto('/admin/providers');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    await expect(
      page.getByRole('alert').filter({
        hasText: locale === 'fa' ? 'خطا در بارگذاری ارائه‌دهنده‌ها' : 'Failed to load providers',
      })
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: locale === 'fa' ? 'ارائه‌دهنده جدید' : 'New provider',
        exact: true,
      })
    ).toBeDisabled();
    valid = true;
    await page
      .getByRole('button', { name: locale === 'fa' ? 'تلاش مجدد' : 'Retry', exact: true })
      .click();
    await expect(
      page.getByRole('button', {
        name: locale === 'fa' ? 'ارائه‌دهنده جدید' : 'New provider',
        exact: true,
      })
    ).toBeEnabled();
  });
  test(`provider save requires acknowledgement and preserves secret for retry (${locale})`, async ({
    page,
  }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    let saves = 0;
    await page.route('**/api/admin/email-providers', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: [] });
      saves++;
      return route.fulfill({
        json:
          saves === 1
            ? {}
            : {
                id: 'new-provider',
                transport: 'resend',
                label: 'Recovery',
                status: 'draft',
                lastTestStatus: 'pending',
              },
      });
    });
    await page.goto('/admin/providers');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'ارائه‌دهنده جدید' : 'New provider',
        exact: true,
      })
      .click();
    await page.locator('#email-provider-label').fill('Recovery');
    await page.locator('#email-provider-transport').selectOption('resend');
    await page
      .getByLabel(locale === 'fa' ? 'کلید API' : 'API key', { exact: false })
      .fill('test-provider-secret');
    await page
      .getByLabel(locale === 'fa' ? 'ایمیل فرستنده' : 'From email', { exact: false })
      .fill('sender@example.test');
    await page.locator('button[type="submit"]').click();
    await expect(
      page.getByRole('alert').filter({
        hasText: locale === 'fa' ? 'خطا در ذخیره ارائه‌دهنده' : 'Failed to save provider',
      })
    ).toBeVisible();
    await expect(
      page.getByLabel(locale === 'fa' ? 'کلید API' : 'API key', { exact: false })
    ).toHaveValue('test-provider-secret');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('#email-provider-label')).toHaveCount(0);
    expect(saves).toBe(2);
  });
}

for (const locale of ['en', 'fa'] as const) {
  test(`provider lifecycle requires verified state acknowledgements (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    let provider = {
      id: 'provider-1',
      transport: 'smtp',
      label: 'Lifecycle provider',
      status: 'draft',
      lastTestStatus: 'pending',
    };
    let testCalls = 0;
    let activateCalls = 0;
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/admin/email-providers**', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: [provider] });
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/test-connection')) {
        testCalls++;
        if (testCalls === 1)
          return route.fulfill({ json: { ...provider, test: { ok: 'true', error: null } } });
        provider = { ...provider, lastTestStatus: 'passed' };
        return route.fulfill({ json: { ...provider, test: { ok: true, error: null } } });
      }
      if (path.endsWith('/activate')) {
        activateCalls++;
        if (activateCalls === 1) return route.fulfill({ json: provider });
        provider = { ...provider, status: 'active' };
      }
      if (path.endsWith('/disable')) provider = { ...provider, status: 'disabled' };
      if (path.endsWith('/rollback'))
        provider = { ...provider, id: 'new-version', status: 'active' };
      return route.fulfill({ json: provider });
    });
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto('/admin/providers');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    const row = page.getByRole('row').filter({ hasText: 'Lifecycle provider' });
    const activate = row.getByRole('button', { name: fa ? 'فعال‌سازی' : 'Activate', exact: true });
    const connection = row.getByRole('button', {
      name: fa ? 'تست اتصال' : 'Test connection',
      exact: true,
    });
    await expect(activate).toBeDisabled();
    await connection.click();
    await expect(row).toContainText(fa ? 'خطا در تست اتصال' : 'Failed to run connection test');
    await expect(activate).toBeDisabled();
    await connection.click();
    await expect(activate).toBeEnabled();
    await activate.click();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: fa ? 'خطا در فعال‌سازی' : 'Failed to activate provider' })
    ).toBeVisible();
    await activate.click();
    await row.getByRole('button', { name: fa ? 'غیرفعال‌سازی' : 'Disable', exact: true }).click();
    await row
      .getByRole('button', {
        name: fa ? 'بازگشت به این نسخه' : 'Rollback to this version',
        exact: true,
      })
      .click();
    await expect(
      row.getByRole('button', { name: fa ? 'غیرفعال‌سازی' : 'Disable', exact: true })
    ).toBeVisible();
    expect(provider.id).toBe('new-version');
    expect(testCalls).toBe(2);
    expect(activateCalls).toBe(2);
  });
}
