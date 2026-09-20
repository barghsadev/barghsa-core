import AxeBuilder from '@axe-core/playwright';
import { ErrorCodes } from '@barghsa/shared/errors';
import { test, expect } from './coverage-fixture';

const invoiceId = '11111111-1111-7111-8111-111111111111';
const otherId = '22222222-2222-7222-8222-222222222222';
const initial = {
  invoiceId,
  state: 'Unpaid',
  issuedAt: '2026-09-01T10:00:00.000Z',
  payableFrom: '2026-09-01T10:00:00.000Z',
  dueAt: '2026-09-12T10:00:00.000Z',
  canOverride: true,
  dueAtOverride: null,
};

for (const locale of ['fa', 'en'] as const)
  for (const darkMode of [false, true])
    test(`deadline change retains its target through step-up (${locale}, dark=${darkMode})`, async ({
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
      await page.route('**/api/admin/config/invoice-reminder-offsets', (route) =>
        route.fulfill({ json: [] })
      );
      const attempts: Array<{ dueAt: string; reason: string }> = [];
      await page.route(`**/api/admin/invoices/${invoiceId}/due-at`, (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: initial });
        expect(route.request().headers()['x-csrf-token']).toBe('deadline-csrf');
        const body = route.request().postDataJSON() as { dueAt: string; reason: string };
        attempts.push(body);
        if (attempts.length === 1)
          return route.fulfill({
            status: 403,
            json: { error: { code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code } },
          });
        return route.fulfill({
          json: {
            ...initial,
            dueAt: body.dueAt,
            dueAtOverride: { dueAt: body.dueAt, reason: body.reason, customerVisible: true },
          },
        });
      });
      await page.route('**/api/auth/step-up', (route) => {
        expect(route.request().headers()['x-csrf-token']).toBe('deadline-csrf');
        return route.fulfill({ json: { success: true } });
      });
      await page.goto('/admin/invoices');
      await page
        .context()
        .addCookies([
          { name: 'barghsa_csrf', value: 'deadline-csrf', url: new URL(page.url()).origin },
        ]);
      const panel = page.locator('#invoice-deadline-panel');
      await panel.locator('#invoice-id').fill(invoiceId);
      await panel.getByRole('button', { name: fa ? 'بارگذاری' : 'Load', exact: true }).click();
      await expect(panel.locator('#due-at')).toHaveValue('2026-09-12T13:30');
      await panel.locator('#due-at').fill('2026-09-25T12:30');
      const reason = fa ? 'تمدید مهلت به درخواست مشتری' : 'Customer requested more time';
      await panel.locator('#override-reason').fill(reason);
      expect(
        (await new AxeBuilder({ page }).include('#invoice-deadline-panel').analyze()).violations
      ).toEqual([]);
      const submit = panel.getByRole('button', {
        name: fa ? 'اعمال تغییر سررسید' : 'Apply due-date override',
        exact: true,
      });
      await submit.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(panel.locator('#invoice-id')).toBeDisabled();
      await expect(panel.locator('#due-at')).toBeDisabled();
      await expect(panel.locator('#override-reason')).toBeDisabled();
      const password = dialog.getByLabel(
        fa ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password'
      );
      await expect(password).toBeFocused();
      await password.fill('test-only');
      await expect(
        dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      ).toBeEnabled();
      await dialog.evaluate(async (element) => {
        await Promise.all(
          element.getAnimations({ subtree: true }).map((animation) => animation.finished)
        );
      });
      expect(
        (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations
      ).toEqual([]);
      await dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(
        panel.getByText(fa ? 'سررسید با موفقیت تغییر کرد' : 'Due date overridden', { exact: true })
      ).toBeVisible();
      await expect(submit).toBeFocused();
      expect(attempts).toEqual([
        { dueAt: '2026-09-25T09:00:00.000Z', reason },
        { dueAt: '2026-09-25T09:00:00.000Z', reason },
      ]);
      await expect(panel.locator('[data-testid="loaded-invoice-id"]')).toHaveText(invoiceId);

      // A mismatched successful lookup cannot expose a form for another invoice.
      await page.route(`**/api/admin/invoices/${otherId}/due-at`, (route) =>
        route.fulfill({ json: initial })
      );
      await panel.locator('#invoice-id').fill(otherId);
      await panel.getByRole('button', { name: fa ? 'بارگذاری' : 'Load', exact: true }).click();
      await expect(panel.getByRole('alert')).toBeVisible();
      await expect(panel.locator('#due-at')).toHaveCount(0);
    });
