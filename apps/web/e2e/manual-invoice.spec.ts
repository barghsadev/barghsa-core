import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';
import { ErrorCodes } from '@barghsa/shared/errors';
import { fullNavigation } from './navigation-fixture';

const profileId = '11111111-1111-7111-8111-111111111111';
const invoiceId = '22222222-2222-7222-8222-222222222222';
for (const locale of ['fa', 'en'] as const)
  for (const darkMode of [false, true])
    test(`manual invoice preview, verification and safe retry (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
      const fa = locale === 'fa';
      await page.addInitScript((locale) => {
        localStorage.setItem('barghsa.locale', locale);
        const apply = () => {
          document.documentElement.lang = locale;
          document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
        };
        if (document.documentElement) apply();
        new MutationObserver(apply).observe(document, { childList: true });
      }, locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/auth/user', (route) =>
        route.fulfill({
          json: {
            userId: 'manual-invoice-staff',
            isStaff: true,
            operatingContext: 'staff',
            canSwitchContext: true,
            requiresTosAcceptance: false,
            navigation: fullNavigation('staff'),
          },
        })
      );
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            appTitle: 'Finance',
            appTitleFa: 'امور مالی',
            supportEmail: 'support@example.test',
            supportPhone: '+982112345678',
            supportMobile: '+989121234567',
            backgroundColor: '#f6f7f4',
            darkBackgroundColor: '#15201c',
            fontFamily: 'vazirmatn',
            borderRadiusRem: 0.75,
            spacingScale: 1,
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
      const reviewHash = 'a'.repeat(64);
      const previews: Array<Record<string, unknown>> = [];
      await page.route('**/api/admin/invoices/manual/review', (route) => {
        expect(route.request().headers()['x-csrf-token']).toBe('manual-csrf');
        const draft = route.request().postDataJSON() as {
          profileId: string;
          idempotencyKey: string;
          lines: Array<{
            description: string;
            quantity: number;
            unitPrice: string;
            vatRate: number;
            isTaxable: boolean;
          }>;
        };
        previews.push(draft);
        return route.fulfill({
          status: 201,
          json: {
            schemaVersion: 1,
            hash: reviewHash,
            scope: {
              action: 'invoice.manual-issue',
              profileId,
              resourceId: draft.idempotencyKey,
            },
            data: {
              currency: 'IRR',
              profile: {
                id: profileId,
                title: fa ? 'شرکت نمونه' : 'Example company',
                profileType: 'LEGAL',
              },
              contractId: null,
              lines: draft.lines.map((line) => ({
                ...line,
                lineTotal: (BigInt(line.quantity) * BigInt(line.unitPrice)).toString(),
                vatAmount: (
                  (BigInt(line.quantity) * BigInt(line.unitPrice) * BigInt(line.vatRate) + 5000n) /
                  10000n
                ).toString(),
              })),
              totals: { subtotal: '55255', vat: '5506', discount: '0', total: '60761' },
              dueRule: {
                source: 'config',
                configDays: 7,
                periodId: invoiceId,
                serviceType: 'manual',
              },
              outcome: 'issue_unpaid_invoice',
            },
          },
        });
      });
      const requests: Array<Record<string, unknown>> = [];
      await page.route('**/api/admin/invoices/manual', (route) => {
        expect(route.request().headers()['x-csrf-token']).toBe('manual-csrf');
        requests.push(route.request().postDataJSON() as Record<string, unknown>);
        if (requests.length === 1)
          return route.fulfill({
            status: 403,
            json: {
              error: {
                code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code,
                message: 'Re-verify your identity to continue',
              },
            },
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
      await expect(page.locator('html')).toHaveClass(darkMode ? /dark/ : /^(?!.*\bdark\b)/);
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
      await expect(issue).toBeEnabled();
      await issue.click();
      await expect(panel.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
      expect(previews).toHaveLength(0);
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
      await issue.click();
      await expect(vat).toHaveAttribute('aria-invalid', 'true');
      expect(previews).toHaveLength(0);
      await vat.fill(fa ? '۱۰' : '10');
      await panel
        .getByRole('button', { name: fa ? 'افزودن ردیف' : 'Add line', exact: true })
        .click();
      await description.nth(1).fill(fa ? 'خدمات بدون مالیات' : 'Untaxed service');
      await quantity.nth(1).fill(fa ? '۲' : '2');
      await price.nth(1).fill(fa ? '۱۰۰' : '100');
      const firstDescription = fa ? 'برق مصرفی' : 'Electricity';
      const secondDescription = fa ? 'خدمات بدون مالیات' : 'Untaxed service';
      await panel.locator('[data-array-action=up]').nth(1).click();
      await expect(description.first()).toHaveValue(secondDescription);
      await expect(description.nth(1)).toHaveValue(firstDescription);
      await expect(panel.locator('[data-array-action=down]').first()).toBeFocused();
      await panel
        .getByRole('button', { name: fa ? 'افزودن ردیف' : 'Add line', exact: true })
        .click();
      await issue.click();
      await expect(description.nth(2)).toHaveAttribute('aria-invalid', 'true');
      expect(previews).toHaveLength(0);
      await panel.locator('[data-array-action=remove]').nth(2).click();
      await expect(issue).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      const total = formatCurrencyIrr(60761n, locale, { numberStyle: fa ? 'persian' : 'western' });
      await expect(panel).toContainText(total);
      const scan = await new AxeBuilder({ page })
        .include('#manual-invoice-panel')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(scan.violations).toEqual([]);
      expect(scan.incomplete.filter((item) => item.id === 'color-contrast')).toEqual([]);
      await issue.click();
      const reviewDialog = page.getByRole('dialog', {
        name: fa ? 'بررسی مالی پیش از صدور فاکتور' : 'Financial review before issuing',
      });
      await expect(reviewDialog).toBeVisible();
      await expect(reviewDialog).toContainText(fa ? 'شرکت نمونه' : 'Example company');
      await expect(reviewDialog).toContainText(total);
      await expect(panel.locator('[data-array-action=up]').last()).toBeDisabled();
      await expect(panel.locator('[data-array-action=remove]').first()).toBeDisabled();
      await reviewDialog
        .getByRole('button', {
          name: fa ? 'تأیید و صدور فاکتور' : 'Confirm and issue invoice',
          exact: true,
        })
        .click();
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
      expect(previews).toHaveLength(1);
      expect(requests).toHaveLength(3);
      expect(requests[1]).toEqual(requests[0]);
      expect(requests[2]).toEqual(requests[0]);
      expect(requests[0]).toMatchObject({
        profileId,
        expectedReviewHash: reviewHash,
        lines: [
          { quantity: 2, unitPrice: '100', vatRate: 0, isTaxable: false },
          { quantity: 1, unitPrice: '55055', vatRate: 1000, isTaxable: true },
        ],
      });
      expect(await panel.evaluate((element) => getComputedStyle(element).direction)).toBe(
        fa ? 'rtl' : 'ltr'
      );
    });
