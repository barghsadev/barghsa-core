import AxeBuilder from '@axe-core/playwright';
import { tVat } from '@barghsa/i18n/vat';
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

for (const locale of ['en', 'fa'] as const) {
  test(`VAT tables retain history and manage product overrides (${locale})`, async ({ page }) => {
    const label = (key: string) => tVat(`admin.vat.${key}`, locale);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((value) => {
      localStorage.setItem('theme', 'dark');
      const apply = () => {
        document.documentElement.classList.add('dark');
        document.documentElement.lang = value;
      };
      if (document.documentElement) apply();
      new MutationObserver(apply).observe(document, { childList: true });
    }, locale);
    const from = '2020-01-01T00:00:00.000Z',
      until = '2021-01-01T00:00:00.000Z';
    const rates = [
      {
        id: 'old',
        category: 'hardware',
        rateBasisPoints: 700,
        effectiveFrom: from,
        effectiveUntil: until,
        status: 'expired',
      },
      {
        id: 'current',
        category: 'hardware',
        rateBasisPoints: 900,
        effectiveFrom: until,
        effectiveUntil: null,
        status: 'current',
      },
      {
        id: 'future',
        category: 'consultation',
        rateBasisPoints: 1000,
        effectiveFrom: '2099-01-01T00:00:00.000Z',
        effectiveUntil: null,
        status: 'scheduled',
      },
    ];
    const overrides: Array<{
      id: string;
      productId: string;
      vatConfigId: string;
      rateBasisPoints: number;
      effectiveFrom: string;
      effectiveUntil: string | null;
    }> = [
      {
        id: 'old-override',
        productId: 'old-product',
        vatConfigId: 'old',
        rateBasisPoints: 700,
        effectiveFrom: from,
        effectiveUntil: null,
      },
    ];
    const writes: unknown[] = [];
    const product = locale === 'fa' ? 'تجهیزات آزمایشی' : 'Test hardware';
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'Asia/Tehran' } })
    );
    await page.route('**/api/admin/finance/vat**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === 'POST') {
        writes.push({ path, body: route.request().postDataJSON() });
        if (path.endsWith('/overrides'))
          overrides.push({
            id: 'override',
            productId: 'product',
            vatConfigId: 'current',
            rateBasisPoints: 900,
            effectiveFrom: until,
            effectiveUntil: null,
          });
        else if (path.endsWith('/overrides/override/end'))
          overrides.find((row) => row.id === 'override')!.effectiveUntil = until;
        else rates[1]!.effectiveUntil = until;
        return route.fulfill({ json: {} });
      }
      return route.fulfill({
        json: path.endsWith('/products')
          ? [{ id: 'product', title: { [locale]: product }, type: 'hardware' }]
          : path.endsWith('/overrides')
            ? overrides
            : rates,
      });
    });
    await page.goto('/admin/vat');
    const history = page.getByRole('table', { name: label('rates'), exact: true });
    await expect(history.getByRole('row')).toHaveCount(4);
    for (const key of ['category', 'percent', 'from', 'until', 'status', 'actions'])
      await expect(
        history.getByRole('columnheader', { name: label(key), exact: true })
      ).toBeVisible();
    for (const key of ['expired', 'current', 'scheduled'])
      await expect(
        history.getByRole('cell', { name: label(`status.${key}`), exact: true })
      ).toBeVisible();
    await expect(history.locator('time').first()).toHaveAttribute('datetime', from);
    await expect(page.getByRole('heading', { level: 1 }).locator('..')).toHaveAttribute(
      'dir',
      locale === 'fa' ? 'rtl' : 'ltr'
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    const scrollRegion = page.getByRole('region', { name: label('rates'), exact: true });
    await scrollRegion.focus();
    await expect(scrollRegion).toBeFocused();
    await page.keyboard.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
    await expect
      .poll(() => scrollRegion.evaluate((element) => Math.abs(element.scrollLeft)))
      .toBeGreaterThan(0);
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: label('addOverride'), exact: true }).click();
    await page.getByLabel(label('product'), { exact: true }).selectOption('product');
    await page.getByLabel(label('rate'), { exact: true }).selectOption('current');
    await page.getByRole('button', { name: label('save'), exact: true }).click();
    const confirm = () =>
      page
        .getByRole('dialog')
        .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
        .click();
    await confirm();
    const table = page.getByRole('table', { name: label('overrides'), exact: true });
    await expect(table.getByRole('rowheader', { name: product })).toBeVisible();
    await expect(
      table
        .getByRole('row')
        .filter({ hasText: label('product') })
        .getByRole('cell', { name: label('status.expired'), exact: true })
    ).toBeVisible();
    expect(writes[0]).toEqual({
      path: '/api/admin/finance/vat/overrides',
      body: { productId: 'product', vatConfigId: 'current' },
    });
    await table
      .getByRole('button', { name: `${label('endOverride')} ${product}`, exact: true })
      .click();
    await page
      .getByRole('form')
      .getByRole('button', { name: label('end'), exact: true })
      .click();
    await confirm();
    await expect(
      table.getByRole('cell', { name: label('status.expired'), exact: true })
    ).toHaveCount(2);
    expect(writes[1]).toEqual({ path: '/api/admin/finance/vat/overrides/override/end', body: {} });
    await history
      .getByRole('button', { name: `${label('end')} ${label('category.hardware')}`, exact: true })
      .click();
    await page
      .getByRole('form')
      .getByRole('button', { name: label('end'), exact: true })
      .click();
    await confirm();
    await expect(history.getByRole('row')).toHaveCount(4);
    await expect(
      history.getByRole('button', {
        name: `${label('end')} ${label('category.hardware')}`,
        exact: true,
      })
    ).toHaveCount(0);
    expect(writes[2]).toEqual({ path: '/api/admin/finance/vat/current/end', body: {} });
  });
}
