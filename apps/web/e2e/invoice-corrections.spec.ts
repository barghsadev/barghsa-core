import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';
import { ErrorCodes } from '@barghsa/shared/errors';

const profileId = '11111111-1111-7111-8111-111111111111';
const originalId = '22222222-2222-7222-8222-222222222222';
const correctionId = '33333333-3333-7333-8333-333333333333';
for (const locale of ['fa', 'en'] as const)
  for (const darkMode of [false, true])
    for (const kind of ['replacement', 'adjustment'] as const)
      test(`invoice ${kind}: captured verification and safe retry (${locale}, dark=${darkMode})`, async ({
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
        const requests: Array<Record<string, unknown>> = [];
        await page.route(`**/api/admin/invoices/${originalId}/corrections`, async (route) => {
          if (route.request().method() === 'GET')
            return route.fulfill({
              json: {
                invoiceId: originalId,
                profileId,
                state: kind === 'replacement' ? 'Unpaid' : 'Overdue',
                paidAmount: kind === 'replacement' ? '0' : '50000',
                totalAmount: '100000',
                lines: [
                  {
                    description: 'Original usage',
                    quantity: 1,
                    unitPrice: '100000',
                    vatRate: 0,
                    isTaxable: false,
                  },
                ],
              },
            });
          expect(route.request().headers()['x-csrf-token']).toBe('correction-csrf');
          const body = route.request().postDataJSON() as Record<string, unknown>;
          requests.push(body);
          if (requests.length === 1)
            return route.fulfill({
              status: 403,
              json: { error: { code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code } },
            });
          if (requests.length === 2 && !darkMode) return route.fulfill({ status: 503, json: {} });
          return route.fulfill({
            status: 201,
            json: {
              originalInvoiceId: originalId,
              invoiceId: correctionId,
              profileId,
              kind,
              idempotencyKey: body.idempotencyKey,
              reason: body.reason,
              amount: requests.length === 2 ? '999' : kind === 'replacement' ? '5506' : '-25000',
              totalAmount: kind === 'replacement' ? '5506' : '25000',
            },
          });
        });
        let verifications = 0;
        await page.route('**/api/auth/step-up', (route) => {
          verifications++;
          return route.fulfill({ json: { success: true } });
        });
        await page.goto('/admin/invoices');
        await page
          .context()
          .addCookies([
            { name: 'barghsa_csrf', value: 'correction-csrf', url: new URL(page.url()).origin },
          ]);
        const panel = page.locator('#invoice-corrections-panel');
        const lookup = panel.getByLabel(fa ? 'شناسه فاکتور اصلی' : 'Original invoice ID', {
          exact: true,
        });
        const load = panel.getByRole('button', {
          name: fa ? 'دریافت فاکتور برای اصلاح' : 'Load invoice for correction',
          exact: true,
        });
        await lookup.fill('invalid');
        await load.click();
        await expect(panel.getByRole('alert')).toBeVisible();
        await lookup.fill(originalId);
        await load.click();
        const reason = panel.getByLabel(
          fa ? 'شرح تغییرات برای مشتری' : 'Explanation shown to customer',
          { exact: true }
        );
        await expect(reason).toBeVisible();
        const issue = panel.getByRole('button', {
          name:
            kind === 'replacement'
              ? fa
                ? 'لغو اصل و صدور فاکتور جایگزین'
                : 'Cancel original and issue replacement'
              : fa
                ? 'صدور فاکتور اصلاحی'
                : 'Issue adjustment',
          exact: true,
        });
        await expect(issue).toBeDisabled();
        await reason.fill(fa ? 'اصلاح مصرف' : 'Usage correction');
        if (kind === 'replacement') {
          const price = panel.getByLabel(fa ? 'قیمت واحد (ریال)' : 'Unit price (IRR)', {
            exact: true,
          });
          await expect(price).toHaveValue('100000');
          await price.fill(fa ? '۵۰۰۵' : '5005');
          await panel
            .getByLabel(fa ? 'مالیات بر ارزش افزوده (%)' : 'VAT (%)', { exact: true })
            .fill(fa ? '۱۰' : '10');
        } else {
          const amount = panel.getByLabel(fa ? 'مبلغ اصلاح (ریال)' : 'Adjustment amount (IRR)', {
            exact: true,
          });
          await amount.fill('0');
          await expect(issue).toBeDisabled();
          await amount.fill(fa ? '-۲۵۰۰۰' : '-25000');
        }
        const total = formatCurrencyIrr(kind === 'replacement' ? 5506n : -25000n, locale, {
          numberStyle: fa ? 'persian' : 'western',
        });
        await expect(panel).toContainText(total);
        await issue.hover();
        await issue.evaluate(async (element) => {
          await Promise.all(
            element.getAnimations().map((animation) => animation.finished.catch(() => {}))
          );
        });
        const scan = await new AxeBuilder({ page })
          .include('#invoice-corrections-panel')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        expect(scan.violations).toEqual([]);
        expect(scan.incomplete.filter((item) => item.id === 'color-contrast')).toEqual([]);
        await issue.click();
        const dialog = page.getByRole('dialog', {
          name: fa ? 'تأیید هویت برای اصلاح فاکتور' : 'Verify invoice correction',
          exact: true,
        });
        await expect(dialog).toBeVisible();
        await expect(lookup).toBeDisabled();
        await expect(reason).toBeDisabled();
        const password = dialog.getByLabel(fa ? 'رمز عبور' : 'Password', { exact: true });
        await expect(password).toBeFocused();
        await password.fill('test-only');
        await dialog
          .getByRole('button', { name: fa ? 'تأیید و اصلاح' : 'Verify and correct', exact: true })
          .click();
        await expect(dialog).not.toBeVisible();
        await expect(panel.getByRole('alert')).toContainText(
          fa ? 'نتیجه اصلاح مشخص نیست' : 'The result is unknown'
        );
        await expect(lookup).toBeDisabled();
        await expect(reason).toBeDisabled();
        await panel
          .getByRole('button', {
            name: fa ? 'تلاش مجدد برای همین اصلاح' : 'Retry this correction',
            exact: true,
          })
          .click();
        await expect(panel.getByRole('status')).toContainText(correctionId);
        await expect(panel.getByRole('status')).toContainText(total);
        expect(verifications).toBe(1);
        expect(requests).toHaveLength(3);
        expect(requests[1]).toEqual(requests[0]);
        expect(requests[2]).toEqual(requests[0]);
        expect(requests[0]).toMatchObject({ kind, reason: fa ? 'اصلاح مصرف' : 'Usage correction' });
        expect(requests[0]).not.toHaveProperty('profileId');
        expect(requests[0]).not.toHaveProperty('actorUserId');
        if (kind === 'replacement')
          expect(requests[0]).toHaveProperty('lines', [
            {
              description: 'Original usage',
              quantity: 1,
              unitPrice: '5005',
              vatRate: 1000,
              isTaxable: true,
            },
          ]);
        else expect(requests[0]).toHaveProperty('amount', '-25000');
        await expect(lookup).toBeEnabled();
        await lookup.fill(correctionId);
        await expect(panel.getByRole('status')).not.toBeVisible();
      });
