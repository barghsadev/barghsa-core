import { test, expect } from './coverage-fixture';
for (const locale of ['en', 'fa'])
  test(`VAT editor retries captured percentage (${locale})`, async ({ page }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      if (document.documentElement) document.documentElement.lang = value;
      new MutationObserver(() => {
        document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    let failed = true,
      verified = false,
      denied = false;
    const attempts: unknown[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill(failed ? { status: 503, json: {} } : { json: { timezone: 'Asia/Tehran' } })
    );
    await page.route('**/api/admin/finance/vat/overrides', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/admin/finance/vat/products', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/admin/finance/vat', (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill(
          denied ? { status: 403, json: {} } : failed ? { status: 503, json: {} } : { json: [] }
        );
      attempts.push(route.request().postDataJSON());
      if (!verified)
        return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
      denied = true;
      return route.fulfill({ status: 201, json: {} });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = route.request().postDataJSON().password === 'correct';
      return route.fulfill({ status: verified ? 200 : 401, json: {} });
    });
    await page.goto('/admin/vat');
    await expect(page.getByRole('alert')).toBeVisible();
    failed = false;
    await page.getByRole('button', { name: fa ? 'تازه‌سازی' : 'Refresh', exact: true }).click();
    await page.getByRole('button', { name: fa ? 'افزودن نرخ' : 'Add rate', exact: true }).click();
    await page.getByLabel(fa ? 'نرخ (درصد)' : 'Rate (%)', { exact: true }).fill('7.25');
    await page.getByRole('button', { name: fa ? 'ذخیره نرخ' : 'Save rate', exact: true }).click();
    const dialog = page.getByRole('dialog'),
      confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    await confirm.click();
    await dialog.locator('input[type="password"]').fill('wrong');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.locator('input[type="password"]').fill('correct');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toEqual(Array(2).fill({ category: 'electricity', rateBasisPoints: 725 }));
    await expect(page.getByRole('alert')).toContainText(
      fa ? 'اجازه مدیریت' : 'permission to manage'
    );
    await expect(page.locator('input,textarea')).toHaveCount(0);
  });

for (const skippedTime of [false, true]) {
  test(`VAT schedules account-zone time and rejects DST gaps: ${skippedTime}`, async ({ page }) => {
    const zone = skippedTime ? 'America/New_York' : 'Asia/Tehran';
    await page.addInitScript(() => {
      if (document.documentElement) document.documentElement.lang = 'en';
      new MutationObserver(() => {
        document.documentElement.lang = 'en';
      }).observe(document, { childList: true });
    });
    const attempts: unknown[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: zone } })
    );
    await page.route('**/api/admin/finance/vat/overrides', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/admin/finance/vat/products', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/admin/finance/vat', (route) => {
      if (route.request().method() === 'POST') attempts.push(route.request().postDataJSON());
      return route.fulfill({ json: [] });
    });
    await page.goto('/admin/vat');
    await page.getByRole('button', { name: 'Add rate', exact: true }).click();
    // Initialize timezone classes before replacing Date.prototype with the fake clock.
    await page.clock.setFixedTime(
      new Date(skippedTime ? '2026-03-08T12:00:00Z' : '2026-03-21T12:00:00Z')
    );
    await page.getByLabel('Rate (%)', { exact: true }).fill('8.5');
    await page.getByRole('checkbox').check();
    await page.locator('#vat-date').click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: skippedTime ? /March 8th/ : /March 21st/ })
      .click();
    await page.locator('#vat-time').fill(skippedTime ? '02:30' : '10:15');
    await page.getByRole('button', { name: 'Save rate', exact: true }).click();
    if (skippedTime) {
      await expect(page.getByRole('alert')).toContainText('Choose a valid date and time');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(attempts).toEqual([]);
    } else {
      await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
      await expect
        .poll(() => attempts)
        .toEqual([
          {
            category: 'electricity',
            rateBasisPoints: 850,
            effectiveFrom: '2026-03-21T06:45:00.000Z',
          },
        ]);
    }
  });
}
