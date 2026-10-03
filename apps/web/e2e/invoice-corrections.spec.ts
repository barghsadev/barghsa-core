import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';
import { ErrorCodes } from '@barghsa/shared/errors';
import { tInvoiceCorrections as correctionText } from '../../../packages/i18n/src/invoice-corrections';

const profileId = '11111111-1111-7111-8111-111111111111';
const originalId = '22222222-2222-7222-8222-222222222222';
const correctionId = '33333333-3333-7333-8333-333333333333';
for (const locale of ['fa', 'en'] as const)
  for (const darkMode of [false, true])
    for (const kind of ['replacement', 'adjustment'] as const)
      for (const outcome of kind === 'adjustment' ? ['issued', 'pending'] : ['issued'])
        test(`invoice ${kind} ${outcome}: captured verification and safe retry (${locale}, dark=${darkMode})`, async ({
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
              json: { isStaff: true, operatingContext: 'staff', canSwitchContext: true },
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
          const requests: Array<Record<string, unknown>> = [];
          if (kind === 'adjustment')
            await page.route(`**/api/admin/invoices/${originalId}/corrections/review`, (route) => {
              const body = route.request().postDataJSON() as { reason: string; amount: string };
              expect(body).toEqual({
                kind: 'adjustment',
                reason: fa ? 'اصلاح مصرف' : 'Usage correction',
                amount: '-25000',
              });
              return route.fulfill({
                json: {
                  schemaVersion: 1,
                  scope: {
                    action: 'invoice.adjustment.submit',
                    profileId,
                    resourceId: originalId,
                  },
                  hash: 'c'.repeat(64),
                  data: {
                    currency: 'IRR',
                    profile: { id: profileId, title: 'Fixture customer', type: 'individual' },
                    invoice: {
                      id: originalId,
                      state: 'Overdue',
                      orderId: null,
                      serviceType: null,
                      issuedAt: null,
                      payableFrom: null,
                      dueAt: null,
                      totalAmount: '100000',
                      paidAmount: '50000',
                      remainingAmount: '50000',
                    },
                    lines: [
                      {
                        id: correctionId,
                        description: 'Original usage',
                        quantity: 1,
                        unitPrice: '100000',
                        discount: '0',
                        subtotal: '100000',
                        vatRate: 0,
                        vatAmount: '0',
                        taxable: false,
                      },
                    ],
                    totals: { subtotal: '100000', discount: '0', vat: '0' },
                    contracts: [],
                    cancellation: 'separate_review_required',
                    adjustment: {
                      direction: 'credit',
                      amount: body.amount,
                      absoluteAmount: '25000',
                      reason: body.reason,
                      initiatorId: 'correction-finance',
                      approvalRequired: outcome === 'pending',
                      approvalThreshold: outcome === 'pending' ? '20000' : null,
                    },
                  },
                },
              });
            });
          else
            await page.route(`**/api/admin/invoices/${originalId}/corrections/review`, (route) => {
              const body = route.request().postDataJSON() as {
                kind: string;
                reason: string;
                lines: Array<{ unitPrice: string; vatRate: number }>;
              };
              expect(body).toMatchObject({
                kind: 'replacement',
                reason: fa ? 'اصلاح مصرف' : 'Usage correction',
                lines: [{ unitPrice: '5005', vatRate: 1000 }],
              });
              return route.fulfill({
                json: {
                  schemaVersion: 1,
                  scope: {
                    action: 'invoice.replacement.submit',
                    profileId,
                    resourceId: originalId,
                  },
                  hash: 'd'.repeat(64),
                  data: {
                    currency: 'IRR',
                    profile: { id: profileId, title: 'Fixture customer', type: 'individual' },
                    invoice: {
                      id: originalId,
                      state: 'Unpaid',
                      orderId: null,
                      serviceType: null,
                      issuedAt: null,
                      payableFrom: null,
                      dueAt: null,
                      totalAmount: '100000',
                      paidAmount: '0',
                      remainingAmount: '100000',
                    },
                    lines: [
                      {
                        id: correctionId,
                        description: 'Original usage',
                        quantity: 1,
                        unitPrice: '100000',
                        discount: '0',
                        subtotal: '100000',
                        vatRate: 0,
                        vatAmount: '0',
                        taxable: false,
                      },
                    ],
                    totals: { subtotal: '100000', discount: '0', vat: '0' },
                    contracts: [],
                    cancellation: 'separate_review_required',
                    replacement: {
                      reason: body.reason,
                      initiatorId: 'correction-finance',
                      lines: [
                        {
                          description: 'Original usage',
                          quantity: 1,
                          unitPrice: '5005',
                          vatRate: 1000,
                          taxable: true,
                          subtotal: '5005',
                          vatAmount: '501',
                        },
                      ],
                      totals: { subtotal: '5005', vat: '501', total: '5506' },
                      dueRule: {
                        source: 'fallback',
                        configDays: 7,
                        periodId: null,
                        serviceType: 'manual',
                      },
                      outcome: 'cancel_original_issue_replacement',
                    },
                  },
                },
              });
            });
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
            if (outcome === 'pending')
              return route.fulfill({
                status: 202,
                json: {
                  ...body,
                  status: 'pending_approval',
                  originalInvoiceId: originalId,
                  approvalRequestId: correctionId,
                  amount: requests.length === 2 ? '999' : '-25000',
                },
              });
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
          await expect(page.locator('html')).toHaveClass(darkMode ? /dark/ : /^(?!.*\bdark\b)/);
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
          await expect(issue).toBeEnabled();
          await issue.click();
          await expect(reason).toHaveAttribute('aria-invalid', 'true');
          expect(requests).toHaveLength(0);
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
            await issue.click();
            await expect(amount).toHaveAttribute('aria-invalid', 'true');
            expect(requests).toHaveLength(0);
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
          if (kind === 'adjustment') {
            const review = page.getByRole('dialog', {
              name: correctionText('reviewTitle', locale),
            });
            await expect(review).toContainText(
              formatCurrencyIrr(25000n, locale, { numberStyle: fa ? 'persian' : 'western' })
            );
            await review
              .getByRole('button', { name: correctionText('reviewConfirm', locale) })
              .click();
          } else {
            const review = page.getByRole('dialog', {
              name: correctionText('replacementReviewTitle', locale),
            });
            await expect(review).toContainText(
              formatCurrencyIrr(5506n, locale, { numberStyle: fa ? 'persian' : 'western' })
            );
            await review
              .getByRole('button', { name: correctionText('replacementReviewConfirm', locale) })
              .click();
          }
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
          if (outcome === 'pending') {
            await expect(panel.getByRole('status')).toContainText(
              fa ? 'هنوز فاکتور اصلاحی صادر نشده' : 'No correction invoice has been issued'
            );
            await expect(
              panel.getByRole('link', {
                name: fa ? 'مشاهده تأییدهای مالی' : 'Open financial approvals',
              })
            ).toHaveAttribute('href', '/admin/approval-requests');
            expect(
              (
                await new AxeBuilder({ page })
                  .include('#invoice-corrections-panel')
                  .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
                  .analyze()
              ).violations
            ).toEqual([]);
          }
          expect(verifications).toBe(1);
          expect(requests).toHaveLength(3);
          expect(requests[1]).toEqual(requests[0]);
          expect(requests[2]).toEqual(requests[0]);
          expect(requests[0]).toMatchObject({
            kind,
            reason: fa ? 'اصلاح مصرف' : 'Usage correction',
          });
          expect(requests[0]).not.toHaveProperty('profileId');
          expect(requests[0]).not.toHaveProperty('actorUserId');
          if (kind === 'replacement') {
            expect(requests[0]).toHaveProperty('lines', [
              {
                description: 'Original usage',
                quantity: 1,
                unitPrice: '5005',
                vatRate: 1000,
                isTaxable: true,
              },
            ]);
            expect(requests[0]).toHaveProperty('expectedReviewHash', 'd'.repeat(64));
          } else {
            expect(requests[0]).toHaveProperty('amount', '-25000');
            expect(requests[0]).toHaveProperty('expectedReviewHash', 'c'.repeat(64));
          }
          await expect(lookup).toBeEnabled();
          await lookup.fill(correctionId);
          await expect(panel.getByRole('status')).not.toBeVisible();
        });
