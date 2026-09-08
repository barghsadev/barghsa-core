import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';

const records = [
  {
    id: 'trusted-current',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/145',
    ip: '192.0.2.1',
    trustedAt: '2030-01-01T12:00:00Z',
    expiresAt: '2030-01-31T12:00:00Z',
    isCurrentDevice: true,
  },
  {
    id: 'trusted-legacy',
    userAgent: null,
    ip: null,
    trustedAt: '2030-01-01T12:00:00Z',
    expiresAt: '2030-01-31T12:00:00Z',
    isCurrentDevice: false,
  },
];
async function shell(page: Page, locale: string, darkMode: boolean) {
  await page.addInitScript((value) => {
    const apply = () => {
      document.documentElement.lang = value;
      document.documentElement.dir = value === 'fa' ? 'rtl' : 'ltr';
    };
    if (document.documentElement) apply();
    new MutationObserver(apply).observe(document, { childList: true });
  }, locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [
          {
            id: 'profile-one',
            profileType: 'LEGAL',
            status: 'ACTIVE',
            title: 'Profile',
            isDefault: true,
          },
        ],
        activeProfileId: 'profile-one',
        hasDefault: true,
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/auth/sessions', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
      json: {
        appTitle: 'Barghsa',
        slogan: 'Account access',
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        logoUrl: null,
        faviconUrl: null,
        darkMode,
      },
    })
  );
}

for (const locale of ['fa', 'en'])
  for (const darkMode of [false, true]) {
    test(`trusted devices confirm, step up, reject false success and preserve focus (${locale}, dark=${darkMode})`, async ({
      page,
      baseURL,
    }, testInfo) => {
      await shell(page, locale, darkMode);
      await page
        .context()
        .addCookies([{ url: baseURL!, name: 'barghsa_csrf', value: 'trusted-ui-csrf' }]);
      await page.route('**/api/auth/trusted-devices', (route) => route.fulfill({ json: records }));
      const verifications: string[] = [];
      let currentCsrf = 'trusted-ui-csrf';
      await page.route('**/api/auth/step-up', (route) => {
        expect(route.request().headers()['x-csrf-token']).toBe(currentCsrf);
        const password = route.request().postDataJSON().password;
        verifications.push(password);
        if (password !== 'right-password') return route.fulfill({ status: 422, json: {} });
        currentCsrf = `rotated-${verifications.length}`;
        return route.fulfill({
          headers: { 'set-cookie': `barghsa_csrf=${currentCsrf}; Path=/; SameSite=Strict` },
          json: {
            message: 'Step-up authentication successful.',
            stepUpVerifiedAt: new Date().toISOString(),
          },
        });
      });
      let writes = 0;
      let release: (() => void) | undefined;
      await page.route('**/api/auth/trusted-devices/trusted-current', async (route) => {
        expect(route.request().method()).toBe('DELETE');
        expect(route.request().headers()['x-csrf-token']).toBe(currentCsrf);
        writes++;
        if (writes === 1)
          return route.fulfill({
            status: 403,
            json: { error: { code: 'AUTHZ:STEP_UP_REQUIRED' } },
          });
        if (writes === 2) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return route.fulfill({ status: 503, json: {} });
        }
        return route.fulfill({ json: { revoked: writes >= 4 } });
      });
      await page.goto('/settings/security');
      const title = locale === 'fa' ? 'دستگاه‌های مورد اعتماد' : 'Trusted devices';
      const remove = locale === 'fa' ? 'حذف اعتماد' : 'Remove trust';
      const region = page.getByRole('region', { name: title });
      await expect(region.getByRole('button', { name: remove, exact: true })).toHaveCount(2);
      await expect(region).toContainText(locale === 'fa' ? 'این دستگاه' : 'This device');
      await expect(region.locator('bdi').first()).toHaveAttribute('dir', 'ltr');
      await expect(region.locator('time').first()).toHaveAttribute(
        'dateTime',
        records[0]!.trustedAt
      );
      await expect(page.locator('html')).toHaveClass(darkMode ? /dark/ : /^(?!.*\bdark\b)/);
      expect(
        (
          await new AxeBuilder({ page })
            .include('section[aria-labelledby="trusted-devices-heading"]')
            .analyze()
        ).violations
      ).toEqual([]);
      await expect(region).not.toContainText('settings.security.');
      const trigger = region.getByRole('button', { name: remove, exact: true }).first();
      await trigger.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: remove, exact: true });
      const cancel = dialog.getByRole('button', {
        name: locale === 'fa' ? 'انصراف' : 'Cancel',
        exact: true,
      });
      await expect(cancel).toBeFocused();
      await expect(dialog).toContainText(
        locale === 'fa' ? 'نشست‌های فعلی همچنان فعال' : 'Existing sessions will stay signed in'
      );
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect(writes).toBe(0);
      await trigger.click();
      const submit = dialog.getByRole('button', { name: remove, exact: true });
      await submit.click();
      const password = dialog.getByLabel(locale === 'fa' ? 'رمز عبور' : 'Password', {
        exact: true,
      });
      await expect(password).toBeFocused();
      await expect(submit).toBeDisabled();
      await password.fill('wrong-password');
      await submit.click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(password).toHaveValue('');
      expect(writes).toBe(1);
      await password.fill('right-password');
      try {
        await submit.evaluate((button: HTMLButtonElement) => {
          button.click();
          button.click();
        });
        await expect.poll(() => release !== undefined).toBe(true);
        await expect(password).toBeDisabled();
        await expect(cancel).toBeDisabled();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeVisible();
        expect(writes).toBe(2);
      } finally {
        release?.();
      }
      await expect(password).toBeEnabled();
      await expect(dialog.getByRole('alert')).toContainText(
        locale === 'fa' ? 'حذف اعتماد تأیید نشد' : 'Trust removal was not confirmed'
      );
      await password.fill('right-password');
      await submit.click();
      await expect.poll(() => writes).toBe(3);
      await expect(password).toBeEnabled();
      await expect(dialog).toBeVisible();
      await expect(password).toHaveValue('');
      expect(
        (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations
      ).toEqual([]);
      await page.screenshot({
        path: `/tmp/barghsa-trusted-devices-${locale}-${darkMode}-${testInfo.project.name}.png`,
        fullPage: true,
      });
      await password.fill('right-password');
      await submit.click();
      await expect(dialog).toHaveCount(0);
      await expect(region.getByRole('heading', { name: title, exact: true })).toBeFocused();
      await expect(region.getByRole('button', { name: remove, exact: true })).toHaveCount(1);
      await expect(region.getByRole('status')).toHaveText(
        locale === 'fa' ? 'اعتماد به دستگاه حذف شد.' : 'Device trust removed.'
      );
      expect(verifications).toEqual([
        'wrong-password',
        'right-password',
        'right-password',
        'right-password',
      ]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
    });

    test(`trusted-device load failures and malformed data remain retryable (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
      await shell(page, locale, darkMode);
      let result: { status?: number; json: unknown } = { json: records };
      await page.route('**/api/auth/trusted-devices', (route) => route.fulfill(result));
      await page.goto('/settings/security');
      const region = page.getByRole('region', {
        name: locale === 'fa' ? 'دستگاه‌های مورد اعتماد' : 'Trusted devices',
      });
      const refresh = region.getByRole('button', {
        name: locale === 'fa' ? 'تازه‌سازی' : 'Refresh',
        exact: true,
      });
      const remove = region.getByRole('button', {
        name: locale === 'fa' ? 'حذف اعتماد' : 'Remove trust',
        exact: true,
      });
      await expect(remove).toHaveCount(2);
      for (const response of [
        { status: 401, json: {} },
        { status: 403, json: {} },
        { status: 503, json: {} },
        { json: [{ ...records[0], expiresAt: 'invalid' }] },
        { json: [records[0], records[0]] },
      ]) {
        result = response;
        await refresh.click();
        await expect(region.getByRole('alert')).toBeVisible();
        await expect(refresh).toBeEnabled();
        await expect(remove).toHaveCount(0);
        expect(
          (
            await new AxeBuilder({ page })
              .include('section[aria-labelledby="trusted-devices-heading"]')
              .analyze()
          ).violations
        ).toEqual([]);
      }
      result = { json: [] };
      await refresh.click();
      await expect(region.getByRole('alert')).toHaveCount(0);
      await expect(region).toContainText(
        locale === 'fa' ? 'دستگاه مورد اعتمادی ثبت نشده' : 'No trusted devices'
      );
    });
  }
