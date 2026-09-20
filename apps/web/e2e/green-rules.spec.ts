import { test, expect } from './coverage-fixture';
for (const locale of ['en', 'fa'])
  test(`green rule editor recovers from unavailable config and step-up (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      if (document.documentElement) document.documentElement.lang = value;
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    let failed = true,
      verified = false,
      denied = false;
    const attempts: unknown[] = [];
    const config = {
      simpleOrder: {
        mandatoryGreenEnabled: true,
        averagePowerThresholdKw: 1000,
        mandatoryGreenSharePercent: 4,
      },
      advancedOrder: {
        mandatoryGreenEnabled: false,
        averagePowerThresholdKw: 1000,
        mandatoryGreenSharePercent: 4,
      },
    };
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/admin/config/green-electricity-rules', (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill(
          denied
            ? { status: 403, json: {} }
            : failed
              ? { status: 503, json: { error: 'CONFIG:STORED_VALUE_INVALID' } }
              : { json: config }
        );
      attempts.push(route.request().postDataJSON());
      if (!verified)
        return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
      denied = true;
      return route.fulfill({ json: config });
    });
    await page.route('**/api/admin/config/green-electricity-rules/safety-status', (route) =>
      route.fulfill({
        json: {
          simpleOrder: { blocked: false, reasons: [] },
          advancedOrder: { blocked: false, reasons: [] },
        },
      })
    );
    await page.route('**/api/auth/step-up', (route) => {
      verified = route.request().postDataJSON().password === 'correct';
      return route.fulfill({ status: verified ? 200 : 401, json: {} });
    });
    await page.goto('/admin/electricity-rules');
    await expect(page.getByRole('alert')).toBeVisible();
    failed = false;
    await page.getByRole('button', { name: fa ? 'تلاش مجدد' : 'Retry', exact: true }).click();
    const simple = page.getByRole('group', {
      name: fa ? 'سفارش ساده' : 'Simple orders',
      exact: true,
    });
    await simple.getByRole('spinbutton').fill('1750');
    await page
      .getByRole('button', { name: fa ? 'ذخیره قواعد' : 'Save rules', exact: true })
      .click();
    const dialog = page.getByRole('dialog'),
      confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    await confirm.click();
    const password = dialog.locator('input[type="password"]');
    await password.fill('wrong');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await password.fill('correct');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(attempts[1]);
    expect(attempts[0]).toMatchObject({ simpleOrder: { averagePowerThresholdKw: 1750 } });
    await expect(page.getByRole('alert')).toContainText(
      fa ? 'اجازه مدیریت' : 'permission to manage'
    );
    await expect(page.getByRole('group')).toHaveCount(0);
  });
