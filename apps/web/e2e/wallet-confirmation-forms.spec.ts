import AxeBuilder from '@axe-core/playwright';
import { ErrorCodes } from '@barghsa/shared/errors';
import { tWalletReceipts as text } from '@barghsa/i18n/wallet-receipts';
import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { bankReceiptReview } from '../src/test/bank-receipt-review-fixture';

const receiptId = 'abcdefab-0000-4000-8000-000000000001';
const invoiceId = 'abcdefab-0000-4000-8000-000000000002';
const profileId = 'abcdefab-0000-4000-8000-000000000003';
const base = '/api/admin/wallet/bank-receipt-top-ups';
function receipt(emergency: boolean) {
  return {
    transactionId: receiptId,
    walletId: profileId,
    amount: '250000',
    currency: 'IRR',
    state: 'Pending',
    paymentDate: '2026-08-15',
    payerReference: 'TRK',
    bankName: null,
    attachmentKey: null,
    attachmentUrl: null,
    customerNote: null,
    submittedAt: '2026-09-01T10:00:00Z',
    canDecide: true,
    staffDecision: null,
    creditTransactionId: null,
    canEmergencyOverride: emergency,
    dualApproval: emergency ? { requestId: receiptId, initiatorId: 'finance-1', invoiceId } : null,
  };
}
async function shell(page: Page, locale: 'en' | 'fa', darkMode: boolean, emergency: boolean) {
  await crmShell(page, locale);
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
        numberStyle: 'locale',
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
  await page.route('**/api/admin/config/wallet-top-up-limit', (route) =>
    route.fulfill({ json: { limitIrR: 2000000, version: 0 } })
  );
  await page.route(`**${base}`, (route) =>
    route.fulfill({ json: { items: [receipt(emergency)], nextCursor: null } })
  );
  await page.route(`**${base}/${receiptId}`, (route) =>
    route.fulfill({ json: receipt(emergency) })
  );
}

for (const emergency of [false, true]) {
  for (const locale of ['en', 'fa'] as const) {
    for (const darkMode of [false, true]) {
      test(`wallet ${emergency ? 'emergency' : 'allocation'} retains reviewed drafts and owned feedback (${locale}, ${darkMode ? 'dark' : 'light'})`, async ({
        page,
      }) => {
        await shell(page, locale, darkMode, emergency);
        let reviewFailure = !emergency;
        const reviews: string[] = [];
        await page.route(`**${base}/${receiptId}/review*`, (route) => {
          const invoice = new URL(route.request().url()).searchParams.get('invoiceId');
          reviews.push(invoice ?? '');
          if (invoice && reviewFailure)
            return route.fulfill({
              status: 400,
              json: {
                error: { code: ErrorCodes.VALIDATION_INPUT_INVALID.code, fields: ['invoiceId'] },
                message: 'private-review-diagnostic',
              },
            });
          const review = bankReceiptReview(receiptId, invoice, profileId);
          if (emergency) review.data.approval = { required: true, thresholdAmount: '100000' };
          return route.fulfill({ json: review });
        });
        let verified = false;
        let verifies = 0;
        await page.route('**/api/auth/step-up', (route) => {
          verifies++;
          if (verifies === 1) return route.fulfill({ status: 401, json: {} });
          verified = true;
          return route.fulfill({ json: { verified: true } });
        });
        let mode: 'owned' | 'mixed' | 'service' | 'success' = 'owned';
        const writes: unknown[] = [];
        const fieldName = emergency ? 'emergencyOverrideReason' : 'invoiceId';
        await page.route(`**${base}/${receiptId}/confirm`, (route) => {
          writes.push(route.request().postDataJSON());
          if (!verified)
            return route.fulfill({
              status: 403,
              json: { error: { code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code } },
            });
          if (mode === 'owned' || mode === 'mixed')
            return route.fulfill({
              status: 400,
              json: {
                error: {
                  code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
                  fields:
                    mode === 'owned'
                      ? [fieldName]
                      : [fieldName, emergency ? 'invoiceId' : 'expectedReviewHash'],
                },
                message: 'private-confirmation-diagnostic',
              },
            });
          if (mode === 'service')
            return route.fulfill({
              status: 503,
              json: { message: 'private-confirmation-diagnostic' },
            });
          return route.fulfill({
            json: {
              ...receipt(emergency),
              state: 'Released',
              canDecide: false,
              dualApproval: null,
              reviewHash: 'a'.repeat(64),
              overpayment: {
                invoiceId,
                remainingBefore: '100000',
                invoiceAllocation: '100000',
                walletCreditAmount: '150000',
                overpaymentCreditTransactionId: receiptId,
              },
            },
          });
        });
        await page.goto('/admin/wallet-receipts');
        await expect(page.locator('html')).toHaveClass(darkMode ? /dark/ : /^(?!.*\bdark\b)/);
        const region = page.getByTestId('admin-wallet-receipts-page');
        const invoice = page.locator('#apply-invoice-id');
        const field = emergency ? page.locator('#receipt-emergency-reason') : invoice;
        const button = page.getByTestId(
          emergency ? 'wallet-receipt-emergency-confirm' : 'wallet-receipt-confirm'
        );
        const rejection = page.locator('#reject-reason');
        await expect(button).toBeEnabled();
        await rejection.fill('Keep a valid companion draft');
        if (emergency) await expect(invoice).toHaveAttribute('readonly', '');
        await field.fill(emergency ? ' ' : 'bad-invoice');
        await button.click();
        await expect(field).toBeFocused();
        await expect(field).toHaveAttribute('aria-invalid', 'true');
        const message = text(
          emergency
            ? 'admin.walletReceipts.error.emergencyReason'
            : 'admin.walletReceipts.error.invoiceId',
          locale
        );
        await expect(region.getByRole('alert')).toHaveText(message);
        expect(writes).toEqual([]);
        if (!emergency) expect(reviews.some((value) => value === 'bad-invoice')).toBe(false);
        const raw = emergency
          ? '  Urgent bank deadline; second reviewer unavailable  '
          : ` ${invoiceId.toUpperCase()} `;
        await field.fill(raw);
        if (!emergency) {
          const refresh = region.getByRole('button', {
            name: text('admin.walletReceipts.review.refresh', locale),
            exact: true,
          });
          await expect.poll(() => reviews.filter((value) => value === invoiceId).length).toBe(1);
          await expect(refresh).toBeEnabled();
          await expect(field).toBeFocused();
          await expect(field).toHaveAttribute('aria-invalid', 'true');
          await expect(region.getByRole('alert')).toHaveText(message);
          await expect(button).toBeDisabled();
          await expect(field).toHaveValue(raw);
          await expect(page.getByText('private-review-diagnostic')).toHaveCount(0);
          reviewFailure = false;
          await refresh.click();
          await expect.poll(() => reviews.filter((value) => value === invoiceId).length).toBe(2);
          await expect(field).not.toHaveAttribute('aria-invalid', 'true');
        }
        await expect(button).toBeEnabled();
        await button.evaluate((node: HTMLButtonElement) => {
          node.click();
          node.click();
        });
        await expect.poll(() => writes.length).toBe(1);
        await expect(field).toBeDisabled();
        await expect(rejection).toBeDisabled();
        await expect(button).toHaveAttribute('aria-busy', 'true');
        const dialog = page.getByRole('dialog');
        const password = page.getByTestId('wallet-receipt-step-up-password');
        await expect(password).toBeFocused();
        await password.fill('Test-password-123!');
        await page.getByTestId('wallet-receipt-step-up-submit').click();
        await expect(dialog.getByRole('alert')).toHaveText(
          text('admin.walletReceipts.stepUp.failed', locale)
        );
        expect(writes).toHaveLength(1);
        await page.getByTestId('wallet-receipt-step-up-submit').click();
        await expect(dialog).toHaveCount(0);
        await expect(field).toBeFocused();
        await expect(field).toBeEnabled();
        await expect(field).toHaveValue(raw);
        await expect(rejection).toHaveValue('Keep a valid companion draft');
        await expect(invoice).toHaveValue(emergency ? invoiceId : raw);
        await expect(region.getByRole('alert')).toHaveText(message);
        const ids = (await field.getAttribute('aria-describedby'))!.split(' ');
        expect(await region.getByRole('alert').getAttribute('id')).toBe(ids.at(-1));
        await expect(region).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-testid="admin-wallet-receipts-page"]')
              .analyze()
          ).violations
        ).toEqual([]);
        const bounds = await field.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
        if (locale === 'fa' && darkMode && test.info().project.name === 'mobile-safari') {
          await field.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: `/tmp/barghsa-wallet-${emergency ? 'emergency' : 'allocation'}-validation-fa-dark-mobile.png`,
          });
        }
        mode = 'mixed';
        await button.click();
        await expect(region.getByRole('alert')).toHaveText(
          text('admin.walletReceipts.error.save', locale)
        );
        await expect(field).toHaveValue(raw);
        await expect(rejection).toHaveValue('Keep a valid companion draft');
        await expect(page.getByText('private-confirmation-diagnostic')).toHaveCount(0);
        mode = 'service';
        await button.click();
        await expect.poll(() => writes.length).toBe(4);
        await expect(button).toBeEnabled();
        await expect(field).toHaveValue(raw);
        mode = 'success';
        await button.click();
        await expect.poll(() => writes.length).toBe(5);
        await expect(field).toHaveCount(0);
        await expect(region).toContainText(
          text(
            emergency
              ? 'admin.walletReceipts.emergencyConfirmed'
              : 'admin.walletReceipts.overpaymentConfirmed',
            locale
          )
        );
        expect(writes).toEqual(
          Array.from({ length: 5 }, () => ({
            expectedReviewHash: 'a'.repeat(64),
            invoiceId,
            ...(emergency ? { emergencyOverrideReason: raw.trim() } : {}),
          }))
        );
      });
    }
  }
  for (const status of [401, 403]) {
    test(`wallet ${emergency ? 'emergency' : 'allocation'} denial ${status} clears private drafts`, async ({
      page,
    }) => {
      await shell(page, 'en', false, emergency);
      await page.route(`**${base}/${receiptId}/review*`, (route) =>
        route.fulfill({
          json: bankReceiptReview(
            receiptId,
            new URL(route.request().url()).searchParams.get('invoiceId'),
            profileId
          ),
        })
      );
      let writes = 0;
      await page.route(`**${base}/${receiptId}/confirm`, (route) => {
        writes++;
        return route.fulfill({
          status,
          json: { error: { code: ErrorCodes.AUTHZ_FORBIDDEN.code } },
        });
      });
      await page.goto('/admin/wallet-receipts');
      const button = page.getByTestId(
        emergency ? 'wallet-receipt-emergency-confirm' : 'wallet-receipt-confirm'
      );
      await expect(button).toBeEnabled();
      await page.locator('#reject-reason').fill('Private rejection draft');
      await page
        .locator(emergency ? '#receipt-emergency-reason' : '#apply-invoice-id')
        .fill(emergency ? 'Private emergency draft' : invoiceId);
      await expect(button).toBeEnabled();
      await button.click();
      await expect(page.locator('#apply-invoice-id')).toHaveCount(0);
      await expect(page.locator('#receipt-emergency-reason')).toHaveCount(0);
      await expect(page.locator('#reject-reason')).toHaveCount(0);
      await expect(page.getByText('Private rejection draft')).toHaveCount(0);
      expect(writes).toBe(1);
    });
  }
}
