import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { tWalletLimit } from '@barghsa/i18n/wallet-limit';

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
    await setupCatalogueForms(page, locale, false);
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
    const draft = locale === 'fa' ? '۵۰۰۰۰۰۰۰۰' : '500000000';
    const save = panel.getByTestId('wallet-top-up-limit-save');
    const reload = panel.getByRole('button', { name: labels.reload, exact: true });
    const reloadUnchangedLimit = async () => {
      await expect(save).toBeDisabled();
      const [response] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().endsWith('/api/admin/config/wallet-top-up-limit') &&
            response.request().method() === 'GET'
        ),
        reload.click(),
      ]);
      expect(response.ok()).toBe(true);
      expect(await response.json()).toEqual({ limitIrR: 2000000000, version: 0 });
      await expect(save).toBeEnabled();
      await expect(input).toHaveValue(draft);
    };
    await input.fill(draft);
    await save.click();
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: labels.cancel, exact: true }).click();
    expect(attempts).toEqual([]);
    await save.click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: labels.confirm, exact: true }).click();
    await dialog.getByLabel(labels.password, { exact: true }).fill('Test-password');
    await dialog.getByRole('button', { name: labels.confirm, exact: true }).click();
    await expect(
      dialog.getByRole('alert').filter({
        hasText: confirmationText('unconfirmed', locale),
      })
    ).toBeVisible();
    await expect(
      dialog.getByRole('alert').filter({
        hasText: tWalletLimit('admin.walletLimit.unverified', locale),
      })
    ).toBeVisible();
    expect(value.limitIrR).toBe(2000000000);
    await expect(dialog.getByRole('button', { name: labels.confirm, exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: labels.cancel, exact: true }).click();
    await reloadUnchangedLimit();
    fail = false;
    mismatch = true;
    await save.click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: labels.confirm, exact: true }).click();
    await expect(dialog.getByRole('button', { name: labels.confirm, exact: true })).toBeDisabled();
    await expect(panel.getByText(labels.saved, { exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: labels.cancel, exact: true }).click();
    await reloadUnchangedLimit();
    mismatch = false;
    await save.click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: labels.confirm, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toEqual(Array(4).fill({ limit_irr: 500000000, expected_version: 0 }));
    await expect(panel.getByText(labels.saved, { exact: true })).toBeVisible();
    await input.fill('600000000');
    conflict = true;
    await save.click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: labels.confirm, exact: true })
      .click();
    await expect(
      page
        .getByRole('dialog')
        .getByRole('alert')
        .filter({
          hasText: tWalletLimit('admin.walletLimit.conflict', locale),
        })
    ).toBeVisible();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: labels.cancel, exact: true })
      .click();
    value = { limitIrR: 75000, version: 3 };
    await reload.click();
    await expect(input).toHaveValue('75000');
    conflict = false;
    await input.fill('90000');
    await save.click();
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
    await setupCatalogueForms(page, locale, false);
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
      await expect(panel.getByTestId('wallet-top-up-limit-save')).toHaveCount(0);
      await expect(panel.getByTestId('wallet-top-up-limit-input')).toHaveCount(0);
      await panel.getByRole('button', { name: labels.reload, exact: true }).click();
    }
    await expect(panel.getByTestId('wallet-top-up-limit-save')).toBeEnabled();
    expect(reads).toBe(3);
  });
}
