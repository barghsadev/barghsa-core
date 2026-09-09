import { test, expect } from './coverage-fixture';

for (const locale of ['en', 'fa']) {
  const fa = locale === 'fa';
  test(`verification draft requires exact confirmation and recovers activation conflicts (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((lang) => {
      const apply = () => {
        if (document.documentElement) {
          document.documentElement.lang = lang;
          document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
        }
      };
      apply();
      new MutationObserver(apply).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', (r) => r.fulfill({ status: 404, json: {} }));
    await page.route('**/api/admin/config/otp', (r) =>
      r.fulfill({ json: { ttlSeconds: 300, version: 0 } })
    );
    await page.route('**/api/auth/step-up', (r) => {
      expect(r.request().postDataJSON()).toEqual({ password: 'Settings-password-123!' });
      return r.fulfill({
        json: { verified: true },
        headers: { 'Set-Cookie': 'barghsa_csrf=verification-fresh; Path=/; SameSite=Lax' },
      });
    });
    let config: { mode: string; draft: string | null; version: number } = {
      mode: 'DISABLED',
      draft: null,
      version: 0,
    };
    let activations = 0;
    await page.route('**/api/admin/config/profile-verification-mode', (r) => {
      if (r.request().method() === 'GET') return r.fulfill({ json: config });
      const change = r.request().postDataJSON();
      if (change.action === 'draft') {
        expect(change).toEqual({ action: 'draft', mode: 'MANUAL', expectedVersion: 0 });
        config = { mode: 'DISABLED', draft: 'MANUAL', version: 1 };
      } else {
        activations++;
        expect(r.request().headers()['x-csrf-token']).toBe('verification-fresh');
        expect(change).toEqual({
          action: 'activate',
          mode: 'MANUAL',
          expectedVersion: activations === 1 ? 1 : 2,
        });
        if (activations === 1) {
          config = { ...config, version: 2 };
          return r.fulfill({ status: 409, json: {} });
        }
        config = { mode: 'MANUAL', draft: null, version: 3 };
      }
      return r.fulfill({ json: config });
    });
    await page.goto('/admin/verification');
    await page.locator('#verification-mode-MANUAL').check();
    await page
      .getByRole('button', { name: fa ? 'ذخیره پیش‌نویس' : 'Save draft', exact: true })
      .click();
    await expect(page.locator('#admin-content').getByRole('status')).toContainText(
      fa ? 'روش فعال احراز هویت تغییر نکرده' : 'Active verification mode is unchanged'
    );
    expect(config.mode).toBe('DISABLED');
    await page.reload();
    await expect(page.locator('#verification-mode-MANUAL')).toBeChecked();
    const activate = page.getByRole('button', {
      name: fa ? 'فعال‌سازی پیش‌نویس' : 'Activate draft',
      exact: true,
    });
    await activate.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(fa ? 'بر همه پروفایل‌ها اثر' : 'will affect all profiles');
    const confirm = dialog.locator('button[type=submit]');
    await expect(confirm).toBeDisabled();
    expect(activations).toBe(0);
    await page.keyboard.press('Escape');
    expect(activations).toBe(0);
    await activate.click();
    await dialog
      .getByLabel(fa ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password')
      .fill('Settings-password-123!');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toContainText(
      fa ? 'تنظیمات تغییر کرده' : 'Settings changed'
    );
    expect(config.mode).toBe('DISABLED');
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', {
        name: fa ? 'بارگذاری دوباره تنظیمات احراز هویت' : 'Reload verification settings',
        exact: true,
      })
      .click();
    await expect(activate).toBeEnabled();
    await activate.click();
    await dialog
      .getByLabel(fa ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password')
      .fill('Settings-password-123!');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#admin-content').getByRole('status')).toContainText(
      fa ? 'روش احراز هویت فعال شد' : 'Verification mode activated'
    );
    await page.reload();
    await expect(page.locator('#verification-mode-MANUAL')).toBeChecked();
    await expect(activate).toHaveCount(0);
  });
}
