import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';

async function shell(page: Page, locale: string) {
  await page.addInitScript((lang) => {
    const apply = () => {
      if (!document.documentElement) return;
      document.documentElement.lang = lang;
      document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
    };
    apply();
    new MutationObserver(apply).observe(document, { childList: true });
  }, locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/admin/config/profile-verification-mode', (route) =>
    route.fulfill({ json: { mode: 'MANUAL' } })
  );
  await page.route('**/api/auth/step-up', (route) => {
    expect(route.request().postDataJSON()).toEqual({ password: 'Settings-password-123!' });
    return route.fulfill({
      json: { verified: true },
      headers: { 'Set-Cookie': 'barghsa_csrf=otp-fresh-csrf; Path=/; SameSite=Lax' },
    });
  });
}

for (const locale of ['en', 'fa']) {
  const fa = locale === 'fa';
  const title = fa ? 'زمان اعتبار کد یک‌بارمصرف' : 'One-time code expiry';
  const saveName = fa ? 'ذخیره زمان اعتبار کد' : 'Save code expiry';
  const reloadName = fa ? 'بارگذاری دوباره تنظیمات کد' : 'Reload code settings';
  const savedText = fa ? 'زمان اعتبار کد به‌روزرسانی شد.' : 'Code expiry updated.';

  test(`OTP settings validate bounds and save once with password and fresh CSRF (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    let config = { ttlSeconds: 300, version: 0 };
    const writes: unknown[] = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/admin/config/otp', async (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: config });
      writes.push(route.request().postDataJSON());
      expect(route.request().headers()['x-csrf-token']).toBe('otp-fresh-csrf');
      await pending;
      config = { ttlSeconds: 120, version: 1 };
      return route.fulfill({ json: config });
    });
    await page.goto('/admin/verification');
    const panel = page.getByRole('region', { name: title, exact: true, includeHidden: true });
    const input = panel.getByRole('spinbutton', { includeHidden: true });
    const save = panel.getByRole('button', { name: saveName, exact: true });
    await expect(input).toHaveValue('300');
    await expect(save).toBeDisabled();
    for (const invalid of ['', '59', '901', '60.5']) {
      await input.fill(invalid);
      await expect(save).toBeDisabled();
    }
    await input.fill('120');
    await save.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(input).toBeDisabled();
    await dialog
      .getByLabel(fa ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password')
      .fill('Settings-password-123!');
    const confirm = dialog.locator('button[type=submit]');
    try {
      await confirm.evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
      await expect.poll(() => writes.length).toBe(1);
      await expect(confirm).toBeDisabled();
      await expect(
        panel.getByRole('button', { name: reloadName, includeHidden: true })
      ).toBeDisabled();
    } finally {
      release();
    }
    await expect(dialog).toHaveCount(0);
    await expect(panel.getByRole('status')).toHaveText(savedText);
    expect(writes).toEqual([{ ttlSeconds: 120, expectedVersion: 0 }]);
    await page.reload();
    await expect(input).toHaveValue('120');
    await expect(save).toBeDisabled();
  });

  test(`OTP settings preserve draft on uncertain success and reload version conflicts (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    let config = { ttlSeconds: 300, version: 0 };
    let writes = 0;
    await page.route('**/api/admin/config/otp', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: config });
      writes++;
      if (writes === 1) return route.fulfill({ json: {} });
      if (writes === 2) return route.fulfill({ json: { ttlSeconds: 120, version: 7 } });
      config = { ttlSeconds: 180, version: 1 };
      return route.fulfill({ status: 409, json: { error: 'CONFIG:VERSION_CONFLICT' } });
    });
    await page.goto('/admin/verification');
    const panel = page.getByRole('region', { name: title, exact: true, includeHidden: true });
    const input = panel.getByRole('spinbutton', { includeHidden: true });
    await input.fill('120');
    await panel.getByRole('button', { name: saveName, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByLabel(fa ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password')
      .fill('Settings-password-123!');
    const confirm = dialog.locator('button[type=submit]');
    for (let attempt = 1; attempt <= 3; attempt++) {
      await dialog
        .getByLabel(fa ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password')
        .fill('Settings-password-123!');
      await confirm.click();
      await expect.poll(() => writes).toBe(attempt);
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(
        dialog.getByLabel(fa ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password')
      ).toBeEnabled();
      await expect(input).toHaveValue('120');
      await expect(panel.getByText(savedText, { exact: true })).toHaveCount(0);
    }
    await expect(dialog.getByRole('alert')).toContainText(
      fa ? 'تنظیمات تغییر کرده است' : 'Settings changed'
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(input).toHaveValue('120');
    await panel.getByRole('button', { name: reloadName, includeHidden: true }).click();
    await expect(input).toHaveValue('180');
    await input.fill('240');
    const request = page.waitForRequest(
      (req) => req.url().endsWith('/api/admin/config/otp') && req.method() === 'PUT'
    );
    await panel.getByRole('button', { name: saveName, exact: true }).click();
    await dialog
      .getByLabel(fa ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password')
      .fill('Settings-password-123!');
    await confirm.click();
    expect((await request).postDataJSON()).toEqual({ ttlSeconds: 240, expectedVersion: 1 });
  });

  for (const dark of [false, true]) {
    test(`OTP settings retry invalid reads and remain accessible (${locale}, dark=${dark})`, async ({
      page,
    }) => {
      await shell(page, locale);
      let reads = 0;
      await page.route('**/api/admin/config/otp', (route) => {
        reads++;
        return route.fulfill(
          reads === 1
            ? { status: 503, json: {} }
            : {
                json:
                  reads === 2 ? { ttlSeconds: 300, version: -1 } : { ttlSeconds: 300, version: 0 },
              }
        );
      });
      await page.goto('/admin/verification');
      const panel = page.getByRole('region', { name: title, exact: true, includeHidden: true });
      const input = panel.getByRole('spinbutton', { includeHidden: true });
      await page
        .locator('html')
        .evaluate((node, enabled) => node.classList.toggle('dark', enabled), dark);
      for (let attempt = 1; attempt <= 2; attempt++) {
        await expect(panel.getByRole('alert')).toBeVisible();
        await expect(input).toBeDisabled();
        await panel.getByRole('button', { name: reloadName, includeHidden: true }).click();
        await expect.poll(() => reads).toBe(attempt + 1);
      }
      await expect(input).toHaveValue('300');
      await expect(input).toBeEnabled();
      await expect(input).toHaveAccessibleName(
        fa ? 'مدت اعتبار کد به ثانیه' : 'Code lifetime in seconds'
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      const results = await new AxeBuilder({ page })
        .include('section[aria-labelledby="otp-config-title"]')
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
}
