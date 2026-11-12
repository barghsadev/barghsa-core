import { crmShell } from './crm-shell-fixture';
import { cookieResponse } from './cookie-response';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';
import { verificationConfigText } from '@barghsa/i18n/verification-config';
import { securityRateLimitPolicies, securityRateLimitPolicyKeys } from '@barghsa/shared/rate-limit';

async function shell(page: Page, locale: string) {
  await crmShell(page, locale);
  await page.route('**/api/admin/config/profile-verification-mode', (route) =>
    route.fulfill({ json: { mode: 'MANUAL', draft: null, version: 0 } })
  );
  await page.route('**/api/auth/step-up', (route) => {
    expect(route.request().postDataJSON()).toEqual({ password: 'Settings-password-123!' });
    return cookieResponse(route, {
      json: { verified: true },
      headers: { 'Set-Cookie': 'barghsa_csrf=otp-fresh-csrf; Path=/; SameSite=Lax' },
    });
  });
}

for (const locale of ['en', 'fa'] as const) {
  test(`security rate limits review and save a bounded emergency rule (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    await page.route('**/api/admin/config/otp', (route) =>
      route.fulfill({ json: { ttlSeconds: 300, version: 0 } })
    );
    const text = (key: Parameters<typeof verificationConfigText>[0]) =>
      verificationConfigText(key, locale);
    const reason =
      locale === 'fa'
        ? 'تمرین کنترل‌شده برای محدودیت ورود'
        : 'Controlled sign-in incident exercise';
    const expiresAt = '2099-11-10T15:00:00.000Z';
    const writes: unknown[] = [];
    let reads = 0;
    let changed = false;
    function policySnapshot(policy: (typeof securityRateLimitPolicyKeys)[number]) {
      const { ceiling, windowMs } = securityRateLimitPolicies[policy];
      return changed && policy === 'login'
        ? {
            policy,
            ceiling,
            windowMs,
            limit: 12,
            version: 1,
            emergency: { limit: 2, owner: 'staff-operator', reason, expiresAt, active: true },
          }
        : { policy, ceiling, windowMs, limit: ceiling, version: 0, emergency: null };
    }
    await page.route('**/api/admin/config/security-rate-limits', async (route) => {
      if (route.request().method() === 'GET') {
        reads++;
        return route.fulfill({
          json: { policies: securityRateLimitPolicyKeys.map(policySnapshot) },
        });
      }
      expect(route.request().method()).toBe('PUT');
      expect(route.request().headers()['x-csrf-token']).toBe('otp-fresh-csrf');
      writes.push(route.request().postDataJSON());
      changed = true;
      return route.fulfill({ json: policySnapshot('login') });
    });
    await page.goto('/admin/verification');
    const disclosure = page.locator('summary').filter({ hasText: text('rateLimitTitle') });
    await expect(disclosure).toBeVisible();
    expect(reads).toBe(0);
    await disclosure.focus();
    await disclosure.press('Enter');
    const panel = page.getByRole('region', { name: text('rateLimitTitle'), exact: true });
    const action = panel.getByLabel(text('rateLimitAction'), { exact: true });
    await action.selectOption('login');
    const limit = panel.getByLabel(text('rateLimitValue'), { exact: true });
    await expect(limit).toHaveValue('50');
    await expect(limit).toHaveAttribute('max', '50');
    await limit.fill('12');
    await panel.getByLabel(text('rateLimitEmergency'), { exact: true }).selectOption('set');
    await panel.getByLabel(text('rateLimitEmergencyValue'), { exact: true }).fill('2');
    await panel.getByLabel(text('rateLimitMinutes'), { exact: true }).fill('15');
    await panel.getByLabel(text('rateLimitReason'), { exact: true }).fill(reason);
    const review = panel.getByRole('button', { name: text('rateLimitSave'), exact: true });
    await review.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(reason);
    await expect(dialog).toContainText(text('login'));
    expect(writes).toEqual([]);
    await dialog
      .getByLabel(locale === 'fa' ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password')
      .fill('Settings-password-123!');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await expect(
      panel.getByRole('status').filter({ hasText: text('rateLimitSaved') })
    ).toBeVisible();
    await expect(panel.getByText('staff-operator', { exact: true })).toBeVisible();
    await expect(panel.locator('time')).toHaveAttribute('datetime', expiresAt);
    expect(writes).toEqual([
      {
        policy: 'login',
        limit: 12,
        expectedVersion: 0,
        emergency: { operation: 'set', limit: 2, minutes: 15, reason },
      },
    ]);
  });
}

for (const locale of ['en', 'fa'] as const) {
  test(`security rate limits recover a regular limit through a persisted draft (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    const text = (key: Parameters<typeof verificationConfigText>[0]) =>
      verificationConfigText(key, locale);
    const path = '/api/admin/config/security-rate-limits';
    const source = { id: '11111111-1111-4111-8111-111111111111', version: 1, limit: 12 };
    const recovery = {
      id: '22222222-2222-4222-8222-222222222222',
      baseVersion: 2,
      sourceId: source.id,
      sourceVersion: 1,
      limit: 12,
    };
    const emergency = {
      limit: 2,
      owner: 'staff-operator',
      reason: 'Controlled temporary restriction',
      expiresAt: '2099-11-10T15:00:00.000Z',
      active: true,
    };
    const { ceiling, windowMs } = securityRateLimitPolicies.login;
    let active = { policy: 'login', ceiling, windowMs, limit: 8, version: 2, emergency };
    let draft: typeof recovery | null = null;
    const staged: unknown[] = [],
      activated: unknown[] = [];
    await page.route('**/api/admin/config/otp', (route) =>
      route.fulfill({ json: { ttlSeconds: 300, version: 0 } })
    );
    await page.route(`**${path}`, (route) => {
      expect(route.request().method()).toBe('GET');
      return route.fulfill({
        json: {
          policies: securityRateLimitPolicyKeys.map((policy) => {
            const limits = securityRateLimitPolicies[policy];
            return policy === 'login'
              ? active
              : { policy, ...limits, limit: limits.ceiling, version: 0, emergency: null };
          }),
        },
      });
    });
    await page.route(`**${path}/rollback-history?policy=login`, (route) =>
      route.fulfill({
        json: {
          policy: 'login',
          baseVersion: active.version,
          items: [source],
          nextBeforeVersion: null,
          draft,
        },
      })
    );
    await page.route(`**${path}/rollback-draft`, (route) => {
      expect(route.request().method()).toBe('POST');
      expect(route.request().headers()['x-csrf-token']).toBe('otp-fresh-csrf');
      staged.push(route.request().postDataJSON());
      draft = recovery;
      return route.fulfill({ status: 201, json: draft });
    });
    await page.route(`**${path}/rollback-activate`, (route) => {
      expect(route.request().method()).toBe('POST');
      expect(route.request().headers()['x-csrf-token']).toBe('otp-fresh-csrf');
      activated.push(route.request().postDataJSON());
      active = { ...active, limit: recovery.limit, version: 3 };
      draft = null;
      return route.fulfill({ json: { draftId: recovery.id, current: active } });
    });
    const disclosure = page.locator('summary').filter({ hasText: text('rateLimitTitle') });
    const panel = page.getByRole('region', { name: text('rateLimitTitle'), exact: true });
    const limit = panel.getByLabel(text('rateLimitValue'), { exact: true });
    const history = panel.getByRole('region', { name: text('rateRecoveryHistory'), exact: true });
    const dialog = page.getByRole('dialog');
    const open = async () => {
      await disclosure.click();
      await panel.getByLabel(text('rateLimitAction'), { exact: true }).selectOption('login');
      await panel.getByRole('button', { name: text('rateRecoveryHistory'), exact: true }).click();
    };
    const confirm = async () => {
      await dialog
        .getByLabel(locale === 'fa' ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password')
        .fill('Settings-password-123!');
      await dialog.locator('button[type=submit]').click();
      await expect(dialog).toHaveCount(0);
    };
    await page.goto('/admin/verification');
    await open();
    await expect(limit).toHaveValue('8');
    await history.getByRole('button', { name: text('rateRecoveryStage'), exact: true }).click();
    await expect(dialog).toContainText(text('rateRecoveryStageReview'));
    expect(staged).toEqual([]);
    await confirm();
    const activate = history.getByRole('button', {
      name: text('rateRecoveryActivate'),
      exact: true,
    });
    await expect(activate).toBeVisible();
    expect(staged).toEqual([{ policy: 'login', expectedVersion: 2, sourceId: source.id }]);
    expect(activated).toEqual([]);
    await expect(limit).toHaveValue('8');
    await page.reload();
    await open();
    await expect(activate).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).include('#security-rate-limit-recovery').analyze()).violations
    ).toEqual([]);
    await activate.click();
    await expect(dialog).toContainText(text('rateRecoveryActivateReview'));
    await confirm();
    await expect(limit).toHaveValue('12');
    await expect(panel.getByText(emergency.reason, { exact: true })).toBeVisible();
    await expect(panel.locator('time')).toHaveAttribute('datetime', emergency.expiresAt);
    expect(activated).toEqual([{ policy: 'login', expectedVersion: 2, draftId: recovery.id }]);
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
    await expect(input).toHaveAttribute('aria-required', 'true');
    await expect(input).toHaveAccessibleDescription(/\S/);
    await expect(save).toBeDisabled();
    for (const invalid of ['', '59', '901', '60.5']) {
      await input.fill(invalid);
      await save.click();
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      await expect(input).toBeFocused();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(writes).toHaveLength(0);
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
    await expect(panel.getByRole('status').filter({ hasText: savedText })).toHaveText(savedText);
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
    const resetName = fa ? 'بازنشانی به تنظیمات ذخیره‌شده' : 'Reset to saved settings';
    for (let attempt = 1; attempt <= 2; attempt++) {
      await dialog
        .getByLabel(fa ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password')
        .fill('Settings-password-123!');
      await confirm.click();
      await expect.poll(() => writes).toBe(attempt);
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(input).toHaveValue('120');
      await expect(panel.getByText(savedText, { exact: true })).toHaveCount(0);
      await expect(confirm).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await panel.getByRole('button', { name: reloadName, includeHidden: true }).click();
      await expect(input).toHaveValue('120');
      await panel.getByRole('button', { name: resetName, exact: true }).click();
      await expect(input).toHaveValue('300');
      await input.fill('120');
      await panel.getByRole('button', { name: saveName, exact: true }).click();
    }
    await dialog
      .getByLabel(fa ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password')
      .fill('Settings-password-123!');
    await confirm.click();
    await expect.poll(() => writes).toBe(3);
    await expect(dialog.getByRole('alert')).toContainText(
      fa ? 'تنظیمات تغییر کرده است' : 'Settings changed'
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(input).toHaveValue('120');
    await panel.getByRole('button', { name: reloadName, includeHidden: true }).click();
    await expect(input).toHaveValue('120');
    await panel.getByRole('button', { name: resetName, exact: true }).click();
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
