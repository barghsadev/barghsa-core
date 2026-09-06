import { test, expect } from '@playwright/test';

for (const locale of ['en', 'fa'] as const) {
  const labels =
    locale === 'en'
      ? {
          confirm: 'Confirm',
          cancel: 'Cancel',
          password: 'Confirm your password',
          reload: 'Reload current value',
          saved: 'Saved',
        }
      : {
          confirm: 'تأیید',
          cancel: 'انصراف',
          password: 'رمز عبور خود را تأیید کنید',
          reload: 'بارگذاری دوباره مقدار فعلی',
          saved: 'ذخیره شد',
        };
  test(`${locale}: financial limit confirmation retains the exact amount through password and failed saves`, async ({
    page,
  }) => {
    await page.addInitScript((language) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = language;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    let verified = false;
    let fail = true;
    let mismatch = false;
    let conflict = false;
    let value = { limitIrR: 2000000000, version: 0 };
    const attempts: unknown[] = [];
    await page.route('**/api/admin/config/wallet-top-up-limit', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: value });
      const body = route.request().postDataJSON();
      attempts.push(body);
      if (!verified)
        return route.fulfill({ status: 403, json: { error: { code: 'AUTHZ:STEP_UP_REQUIRED' } } });
      if (fail) return route.fulfill({ status: 500, json: {} });
      if (conflict) return route.fulfill({ status: 409, json: {} });
      if (mismatch) return route.fulfill({ json: { limitIrR: 123, version: 1 } });
      value = { limitIrR: body.limit_irr, version: body.expected_version + 1 };
      return route.fulfill({ json: value });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = true;
      return route.fulfill({ json: { verified: true } });
    });
    await page.goto('/admin/wallet-receipts');
    const panel = page.getByTestId('wallet-top-up-limit-panel');
    const input = panel.getByTestId('wallet-top-up-limit-input');
    await input.fill(locale === 'fa' ? '۵۰۰۰۰۰۰۰۰' : '500000000');
    await panel.getByTestId('wallet-top-up-limit-save').click();
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: labels.cancel, exact: true }).click();
    expect(attempts).toEqual([]);
    await panel.getByTestId('wallet-top-up-limit-save').click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: labels.confirm, exact: true }).click();
    await dialog.getByLabel(labels.password, { exact: true }).fill('Test-password');
    await dialog.getByRole('button', { name: labels.confirm, exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(value.limitIrR).toBe(2000000000);
    fail = false;
    mismatch = true;
    await dialog.getByLabel(labels.password, { exact: true }).fill('Test-password');
    await dialog.getByRole('button', { name: labels.confirm, exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(panel.getByText(labels.saved, { exact: true })).toHaveCount(0);
    mismatch = false;
    await dialog.getByLabel(labels.password, { exact: true }).fill('Test-password');
    await dialog.getByRole('button', { name: labels.confirm, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toEqual(Array(4).fill({ limit_irr: 500000000, expected_version: 0 }));
    await expect(panel.getByText(labels.saved, { exact: true })).toBeVisible();
    await input.fill('600000000');
    conflict = true;
    await panel.getByTestId('wallet-top-up-limit-save').click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: labels.confirm, exact: true })
      .click();
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: labels.cancel, exact: true })
      .click();
    value = { limitIrR: 75000, version: 3 };
    await panel.getByRole('button', { name: labels.reload, exact: true }).click();
    await expect(input).toHaveValue(
      new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(75000)
    );
    conflict = false;
    await input.fill('90000');
    await panel.getByTestId('wallet-top-up-limit-save').click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: labels.confirm, exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(attempts.at(-1)).toEqual({ limit_irr: 90000, expected_version: 3 });
  });
  test(`${locale}: failed or malformed limit reads disable writes until a valid retry`, async ({
    page,
  }) => {
    await page.addInitScript((language) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = language;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    let reads = 0;
    await page.route('**/api/admin/config/wallet-top-up-limit', (route) => {
      expect(route.request().method()).toBe('GET');
      reads++;
      return reads === 1
        ? route.fulfill({ status: 500, json: {} })
        : route.fulfill({
            json: reads === 2 ? { limitIrR: 1, version: 'bad' } : { limitIrR: 100, version: 0 },
          });
    });
    await page.goto('/admin/wallet-receipts');
    const panel = page.getByTestId('wallet-top-up-limit-panel');
    for (let i = 0; i < 2; i++) {
      await expect(panel.getByRole('alert')).toBeVisible();
      await expect(panel.getByTestId('wallet-top-up-limit-save')).toBeDisabled();
      await expect(panel.getByTestId('wallet-top-up-limit-input')).toBeDisabled();
      await panel.getByRole('button', { name: labels.reload, exact: true }).click();
    }
    await expect(panel.getByTestId('wallet-top-up-limit-save')).toBeEnabled();
    expect(reads).toBe(3);
  });
}
