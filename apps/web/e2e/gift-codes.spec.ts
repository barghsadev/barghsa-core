import { test, expect } from '@playwright/test';
for (const locale of ['en', 'fa'])
  test(`gift-code editor retries captured settings (${locale})`, async ({ page }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    let failed = true,
      verified = false,
      denied = false;
    const attempts: unknown[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/admin/promotions/gift-codes', (route) => {
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
    await page.goto('/admin/gift-codes');
    await expect(page.getByRole('alert')).toBeVisible();
    failed = false;
    await page.getByRole('button', { name: fa ? 'جست‌وجو' : 'Search', exact: true }).click();
    await page.getByRole('button', { name: fa ? 'افزودن کد' : 'Add code', exact: true }).click();
    await page.getByLabel(fa ? 'کد' : 'Code', { exact: true }).fill('  local-code  ');
    await page
      .getByLabel(fa ? 'مبلغ تخفیف (ریال)' : 'Discount amount (IRR)', { exact: true })
      .fill('1000');
    await page.getByRole('button', { name: fa ? 'ذخیره کد' : 'Save code', exact: true }).click();
    const dialog = page.getByRole('dialog'),
      confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    await confirm.click();
    await dialog.locator('input[type="password"]').fill('wrong');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.locator('input[type="password"]').fill('correct');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toEqual(
      Array(2).fill({
        code: 'local-code',
        discountType: 'fixed_irr',
        discountValue: '1000',
        maxCapIrr: null,
        eligibility: 'public',
        profileIds: [],
        totalLimit: null,
        perProfileLimit: null,
        minOrderAmount: '0',
        categories: [],
        validUntil: null,
      })
    );
    await expect(page.getByRole('alert')).toContainText(
      fa ? 'اجازه مدیریت' : 'permission to manage'
    );
    await expect(
      page.getByRole('form', { name: fa ? 'تنظیمات کد تخفیف' : 'Gift-code settings' })
    ).toHaveCount(0);
  });
