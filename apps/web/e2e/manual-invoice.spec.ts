import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';
import { ErrorCodes } from '@barghsa/shared/errors';

const profileId = '11111111-1111-7111-8111-111111111111';
const invoiceId = '22222222-2222-7222-8222-222222222222';
for (const locale of ['fa', 'en'] as const)
  for (const darkMode of [false, true])
    test(`manual invoice preview, verification and safe retry (${locale}, dark=${darkMode})`, async ({
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
            numberStyle: fa ? 'persian' : 'western',
          },
        })
      );
      await page.route('**/api/admin/invoices/manual/profiles?*', (route) =>
        route.fulfill({
          json: {
            items: [
              { id: profileId, title: fa ? 'شرکت نمونه' : 'Example company', profileType: 'LEGAL' },
            ],
          },
        })
      );
      const requests: Array<Record<string, unknown>> = [];
      await page.route('**/api/admin/invoices/manual', (route) => {
        expect(route.request().headers()['x-csrf-token']).toBe('manual-csrf');
        requests.push(route.request().postDataJSON() as Record<string, unknown>);
        if (requests.length === 1)
          return route.fulfill({
            status: 403,
            json: { error: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code },
          });
        if (requests.length === 2)
          return darkMode
            ? route.fulfill({ json: { invoiceId, profileId, totalAmount: 'invalid' } })
            : route.fulfill({ status: 503, json: {} });
        return route.fulfill({
          status: 201,
          json: { invoiceId, profileId, totalAmount: '60761', state: 'Unpaid' },
        });
      });
      let verificationRequests = 0;
      await page.route('**/api/auth/step-up', (route) => {
        verificationRequests++;
        expect(route.request().headers()['x-csrf-token']).toBe('manual-csrf');
        return route.fulfill({ json: { success: true } });
      });
      await page.goto('/admin/invoices');
      await page
        .context()
        .addCookies([
          { name: 'barghsa_csrf', value: 'manual-csrf', url: new URL(page.url()).origin },
        ]);
      const panel = page.locator('#manual-invoice-panel');
      await panel
        .getByRole('button', { name: fa ? 'فاکتور دستی جدید' : 'New manual invoice', exact: true })
        .click();
      const issue = panel.getByRole('button', {
        name: fa ? 'صدور فاکتور' : 'Issue invoice',
        exact: true,
      });
      await expect(issue).toBeDisabled();
      await panel
        .getByRole('combobox', { name: fa ? 'پروفایل مشتری' : 'Customer profile' })
        .selectOption(profileId);
      const description = panel.getByRole('textbox', {
        name: fa ? 'شرح ردیف' : 'Description',
        exact: true,
      });
      const quantity = panel.getByRole('textbox', { name: fa ? 'تعداد' : 'Quantity', exact: true });
      const price = panel.getByRole('textbox', {
        name: fa ? 'قیمت واحد (ریال)' : 'Unit price (IRR)',
        exact: true,
      });
      const vat = panel.getByRole('textbox', {
        name: fa ? 'مالیات بر ارزش افزوده (%)' : 'VAT (%)',
        exact: true,
      });
      await description.fill(fa ? 'برق مصرفی' : 'Electricity');
      await price.fill(fa ? '۵۵۰۵۵' : '55055');
      await vat.fill('100.01');
      await expect(issue).toBeDisabled();
      await vat.fill(fa ? '۱۰' : '10');
      await panel
        .getByRole('button', { name: fa ? 'افزودن ردیف' : 'Add line', exact: true })
        .click();
      await description.nth(1).fill(fa ? 'خدمات بدون مالیات' : 'Untaxed service');
      await quantity.nth(1).fill(fa ? '۲' : '2');
      await price.nth(1).fill(fa ? '۱۰۰' : '100');
      const total = formatCurrencyIrr(60761n, locale, { numberStyle: fa ? 'persian' : 'western' });
      await expect(panel).toContainText(total);
      const scan = await new AxeBuilder({ page })
        .include('#manual-invoice-panel')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(scan.violations).toEqual([]);
      expect(scan.incomplete.filter((item) => item.id === 'color-contrast')).toEqual([]);
      await issue.click();
      const dialog = page.getByRole('dialog', {
        name: fa ? 'تأیید هویت برای صدور فاکتور' : 'Verify before issuing',
      });
      await expect(dialog).toBeVisible();
      const password = dialog.getByLabel(fa ? 'رمز عبور' : 'Password', { exact: true });
      await expect(password).toBeFocused();
      await password.fill('test-only');
      await dialog
        .getByRole('button', { name: fa ? 'تأیید و صدور' : 'Verify and issue', exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
      await expect(panel.getByRole('alert')).toContainText(
        fa ? 'نتیجه صدور مشخص نیست' : 'The result is unknown'
      );
      await expect(price.first()).toBeDisabled();
      await expect(panel.getByRole('combobox')).toBeDisabled();
      await panel
        .getByRole('button', {
          name: fa ? 'تلاش مجدد برای همین فاکتور' : 'Retry this invoice',
          exact: true,
        })
        .click();
      await expect(panel.getByRole('status')).toContainText(invoiceId);
      await expect(panel.getByRole('status')).toContainText(total);
      expect(verificationRequests).toBe(1);
      expect(requests).toHaveLength(3);
      expect(requests[1]).toEqual(requests[0]);
      expect(requests[2]).toEqual(requests[0]);
      expect(requests[0]).toMatchObject({
        profileId,
        lines: [
          { quantity: 1, unitPrice: '55055', vatRate: 1000, isTaxable: true },
          { quantity: 2, unitPrice: '100', vatRate: 0, isTaxable: false },
        ],
      });
      expect(await panel.evaluate((element) => getComputedStyle(element).direction)).toBe(
        fa ? 'rtl' : 'ltr'
      );
    });
