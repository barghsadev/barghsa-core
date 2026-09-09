import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { SERVICE_DUE_PERIOD_TYPES } from '@barghsa/shared/finance';
const periodId = '11111111-1111-7111-8111-111111111111';
for (const locale of ['fa', 'en'] as const)
  for (const darkMode of [false, true])
    test(`admin configures a versioned due period (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
      const fa = locale === 'fa';
      await page.addInitScript((locale) => {
        const apply = () => {
          document.documentElement.lang = locale;
          document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
        };
        if (document.documentElement) apply();
        new MutationObserver(apply).observe(document, { childList: true });
      }, locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            appTitle: 'Finance',
            slogan: '',
            primaryColor: '#2563eb',
            secondaryColor: '#64748b',
            accentColor: '#f59e0b',
            logoUrl: null,
            faviconUrl: null,
            darkMode,
          },
        })
      );
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'Asia/Tehran' } })
      );
      let defaults = SERVICE_DUE_PERIOD_TYPES.map((serviceType) => ({
        serviceType,
        defaultDays: 7,
        periodId: null as string | null,
        effectiveFrom: null as string | null,
        effectiveUntil: null,
      }));
      const attempts: unknown[] = [];
      await page.route('**/api/admin/config/invoice-due-periods', (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: defaults });
        expect(route.request().headers()['x-csrf-token']).toBe('period-csrf');
        const body = route.request().postDataJSON() as {
          serviceType: string;
          defaultDays: number;
          expectedPeriodId: string | null;
        };
        attempts.push(body);
        if (attempts.length === 1)
          return route.fulfill({
            status: 403,
            json: { error: { code: 'AUTHZ:STEP_UP_REQUIRED' } },
          });
        if (attempts.length === 2) {
          defaults = defaults.map((row) =>
            row.serviceType === body.serviceType
              ? {
                  ...row,
                  defaultDays: body.defaultDays,
                  periodId,
                  effectiveFrom: '2026-09-09T09:00:00Z',
                }
              : row
          );
          return route.fulfill({ json: defaults });
        }
        if (attempts.length === 3) return route.fulfill({ json: defaults });
        return route.fulfill({ status: 409, json: { error: { code: 'CONFLICT:STATE' } } });
      });
      await page.route('**/api/auth/step-up', (route) => {
        expect(route.request().headers()['x-csrf-token']).toBe('period-csrf');
        return route.fulfill({ json: { success: true } });
      });
      await page.goto('/admin/invoices');
      await page
        .context()
        .addCookies([
          { name: 'barghsa_csrf', value: 'period-csrf', url: new URL(page.url()).origin },
        ]);
      const panel = page.locator('#invoice-due-periods');
      const service = panel.getByLabel(fa ? 'نوع خدمت' : 'Service type');
      const days = panel.getByLabel(fa ? 'تعداد روز پس از صدور' : 'Days after issue');
      await expect(days).toHaveValue('7');
      await service.selectOption('manual');
      const save = panel.getByRole('button', {
        name: fa ? 'ذخیره مهلت پرداخت' : 'Save due period',
        exact: true,
      });
      await days.fill('0');
      await save.click();
      await expect(panel.getByRole('alert')).toBeVisible();
      expect(attempts).toHaveLength(0);
      await days.fill(fa ? '۱۴' : '14');
      await save.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(service).toBeDisabled();
      await expect(days).toBeDisabled();
      const password = dialog.getByLabel(
        fa ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password'
      );
      await expect(password).toBeFocused();
      await password.fill('test-only');
      await dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(save).toBeFocused();
      await expect(panel.getByRole('status')).toHaveText(
        fa ? 'مهلت پیش‌فرض پرداخت ذخیره شد.' : 'Default due period saved.'
      );
      expect(attempts).toEqual([
        { serviceType: 'manual', defaultDays: 14, expectedPeriodId: null },
        { serviceType: 'manual', defaultDays: 14, expectedPeriodId: null },
      ]);
      await service.selectOption('electricity');
      await expect(days).toHaveValue('7');
      await service.selectOption('manual');
      await expect(days).toHaveValue('14');
      await save.hover();
      await panel.evaluate(async (element) => {
        await Promise.all(
          element.getAnimations({ subtree: true }).map((animation) => animation.finished)
        );
      });
      expect(
        (await new AxeBuilder({ page }).include('#invoice-due-periods').analyze()).violations
      ).toEqual([]);
      await days.fill('15');
      await save.click();
      await expect(panel.getByRole('alert')).toBeVisible();
      await expect(panel.getByRole('status')).toHaveCount(0);
      expect(attempts[2]).toEqual({
        serviceType: 'manual',
        defaultDays: 15,
        expectedPeriodId: periodId,
      });
      await save.click();
      await expect(panel.getByRole('alert')).toHaveText(
        fa
          ? 'مدیر دیگری این تنظیم را تغییر داده است. پیش از ذخیره، تنظیمات را دوباره دریافت کنید.'
          : 'Another administrator changed this setting. Reload settings before saving.'
      );
      await panel
        .getByRole('button', { name: fa ? 'دریافت مجدد تنظیمات' : 'Reload settings' })
        .click();
      await expect(days).toHaveValue('14');
    });
