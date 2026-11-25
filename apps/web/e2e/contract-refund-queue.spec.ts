import { test, expect } from './coverage-fixture';
import { approveRiskConfirmation } from './confirmation-fixture';
import { en, fa } from '../../../packages/i18n/src/contracts';
import { t } from '../../../packages/i18n/src/app';
import { tWorkspace } from '@barghsa/i18n/workspace-admin';
import { refundDecisionReviewFixture } from './refund-review-fixture';
const walletId = '55555555-5555-4555-8555-555555555555';
const bankId = '66666666-6666-4666-8666-666666666666';
const laterPage = '77777777-7777-4777-8777-777777777777';
for (const locale of ['en', 'fa'] as const)
  test(
    locale + ': finance retries failed returns and records then reconciles bank transfers',
    async ({ page }) => {
      const w = locale === 'fa' ? fa : en;
      await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 403, json: {} }));
      await page.route('**/api/auth/user', (route) =>
        route.fulfill({
          json: {
            userId: 'finance',
            isStaff: true,
            operatingContext: 'staff',
            canSwitchContext: false,
            requiresTosAcceptance: false,
          },
        })
      );
      await page.route('**/api/admin/contracts?*', (route) =>
        route.fulfill({ json: { contracts: [], nextBefore: null } })
      );
      let walletComplete = false,
        attempts = 0,
        bankState = 'Approved';
      const base = {
        contractId: '11111111-1111-4111-8111-111111111111',
        invoiceId: '22222222-2222-4222-8222-222222222222',
        nextAttemptAt: null,
      };
      await page.route(
        (url) => url.pathname === '/api/admin/wallet-refunds/contract-obligations',
        (route) => {
          const before = new URL(route.request().url()).searchParams.get('before');
          return route.fulfill({
            json: {
              obligations: [
                ...(!walletComplete && !before
                  ? [
                      {
                        ...base,
                        id: walletId,
                        amount: '9007199254740993',
                        destination: 'wallet',
                        state: 'Failed',
                        bankReference: null,
                        exhausted: true,
                      },
                    ]
                  : []),
                ...(bankState !== 'Completed' && before === laterPage
                  ? [
                      {
                        ...base,
                        id: bankId,
                        amount: '400',
                        destination: 'external_bank',
                        state: bankState,
                        bankReference: bankState === 'Processing' ? 'BANK-123' : null,
                        exhausted: false,
                      },
                    ]
                  : []),
              ],
              nextBefore: before ? null : laterPage,
            },
          });
        }
      );
      for (const destination of ['wallet', 'external_bank'] as const) {
        const wallet = destination === 'wallet';
        const id = wallet ? walletId : bankId;
        await page.route(`**/api/admin/${wallet ? 'wallet' : 'external'}-refunds?*`, (route) => {
          const query = new URL(route.request().url()).searchParams;
          expect(query.get('invoiceId')).toBe(base.invoiceId);
          expect(query.get('refundId')).toBe(id);
          return route.fulfill({
            json: {
              invoice: {
                invoiceId: base.invoiceId,
                profileId: base.contractId,
                state: 'Paid',
                paidAmount: '9100000000000000',
                refundedAmount: '0',
                reservedAmount: '9007199254741393',
                availableAmount: '92800745258607',
                requestable: true,
              },
              refunds: [
                {
                  id,
                  invoiceId: base.invoiceId,
                  destination,
                  amount: wallet ? '9007199254740993' : '400',
                  state: wallet ? (walletComplete ? 'Completed' : 'Failed') : bankState,
                  bankReference: !wallet && bankState !== 'Approved' ? 'BANK-123' : null,
                  reconciliationStatus: !wallet && bankState === 'Processing' ? 'Pending' : null,
                  approvalRequestId: null,
                  retry: wallet ? { nextAttemptAt: null, exhausted: true } : null,
                },
              ],
              nextBefore: null,
            },
          });
        });
      }
      await page.route(`**/api/admin/wallet-refunds/${walletId}/process`, (route) => {
        attempts++;
        walletComplete = attempts === 2;
        return route.fulfill({
          json: {
            id: walletId,
            invoiceId: base.invoiceId,
            amount: '9007199254740993',
            destination: 'wallet',
            state: walletComplete ? 'Completed' : 'Failed',
            bankReference: null,
            reconciliationStatus: null,
          },
        });
      });
      await page.route(`**/api/admin/external-refunds/${bankId}/record-transfer`, (route) => {
        expect(route.request().postDataJSON()).toEqual({
          bankReference: 'BANK-123',
          expectedReviewHash: 'b'.repeat(64),
        });
        bankState = 'Processing';
        return route.fulfill({
          json: {
            id: bankId,
            invoiceId: base.invoiceId,
            amount: '400',
            destination: 'external_bank',
            state: bankState,
            bankReference: 'BANK-123',
            reconciliationStatus: bankState === 'Processing' ? 'Pending' : 'Confirmed',
          },
        });
      });
      await page.route(`**/api/admin/external-refunds/${bankId}/reconcile`, (route) => {
        expect(route.request().postDataJSON()).toEqual({
          bankReference: 'BANK-123',
          expectedReviewHash: 'b'.repeat(64),
        });
        bankState = 'Completed';
        return route.fulfill({
          json: {
            id: bankId,
            invoiceId: base.invoiceId,
            amount: '400',
            destination: 'external_bank',
            state: bankState,
            bankReference: 'BANK-123',
            reconciliationStatus: bankState === 'Processing' ? 'Pending' : 'Confirmed',
          },
        });
      });
      await page.route(`**/api/admin/wallet-refunds/${walletId}/process/review`, (route) =>
        route.fulfill({
          json: refundDecisionReviewFixture(
            base.invoiceId,
            walletId,
            'wallet',
            'Failed',
            'process',
            null,
            null,
            '9007199254740993'
          ),
        })
      );
      for (const operation of ['record-transfer', 'reconcile'] as const)
        await page.route(`**/api/admin/external-refunds/${bankId}/${operation}/review`, (route) => {
          expect(route.request().postDataJSON()).toEqual({ bankReference: 'BANK-123' });
          return route.fulfill({
            json: refundDecisionReviewFixture(
              base.invoiceId,
              bankId,
              'external_bank',
              bankState,
              operation,
              'BANK-123',
              null,
              '400'
            ),
          });
        });
      await page.goto(locale === 'fa' ? '/admin/contracts#refund-obligations' : '/admin/contracts');
      if (locale === 'en')
        await page.getByRole('link', { name: w.contractRefunds, exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/contracts\/refunds$/);
      const queue = page.getByRole('region', { name: w.cancellationQueue, exact: true });
      await expect(queue.getByText(w.cancellationQueueExhausted, { exact: true })).toBeVisible();
      await expect(queue.locator('form, input, textarea')).toHaveCount(0);
      await page.screenshot({
        path: test.info().outputPath('refund-queue-' + locale + '.png'),
        fullPage: true,
      });
      const dialog = page.getByRole('dialog');
      const confirm = dialog.getByRole('button', { name: t('team.confirm', locale), exact: true });
      const approve = async () => {
        await expect(confirm).toBeDisabled();
        await approveRiskConfirmation(page, locale, 'financial');
        await confirm.click();
        await expect(dialog).toHaveCount(0);
      };
      const back = page.getByTestId('contract-refund-back-to-queue');
      const button = (action: 'process' | 'record-transfer' | 'reconcile') =>
        page.getByRole('button', {
          name: w[('cancellation.queue.' + action) as keyof typeof w],
          exact: true,
        });
      await queue.getByRole('link', { name: w['cancellation.queue.process'], exact: true }).click();
      await expect(page).toHaveURL(
        (url) => url.pathname.endsWith(`/refunds/wallet/${walletId}/process`) && !url.search
      );
      await expect(back).toBeVisible();
      await button('process').click();
      await approve();
      await expect(button('process')).toBeEnabled();
      await button('process').click();
      await approve();
      await expect(button('process')).toHaveCount(0);
      await back.click();
      await expect(
        queue.getByRole('link', { name: w['cancellation.queue.process'], exact: true })
      ).toHaveCount(0);
      await queue.getByRole('button', { name: w.next, exact: true }).click();
      await queue
        .getByRole('link', { name: w['cancellation.queue.record-transfer'], exact: true })
        .click();
      const reference = page.locator('#refund-bank-reference-' + bankId);
      await button('record-transfer').click();
      await expect(reference).toBeFocused();
      await expect(page.getByText(w.refundBankReferenceInvalid, { exact: true })).toBeVisible();
      await reference.fill('BANK-123');
      await button('record-transfer').click();
      await approve();
      await page
        .getByRole('link', { name: w['cancellation.queue.reconcile'], exact: true })
        .click();
      await page.reload();
      await expect(back).toBeVisible();
      await expect(reference).toHaveValue('');
      await reference.fill('BANK-123');
      await button('reconcile').click();
      await expect(dialog).toContainText(w.cancellationQueueReconcileNotice);
      await approve();
      await expect(
        page.getByText(tWorkspace('admin.invoices.walletRefunds.state.Completed', locale), {
          exact: true,
        })
      ).toBeVisible();
      await back.click();
      await expect(page).toHaveURL((url) => url.searchParams.get('refund_before') === laterPage);
      await expect(queue.getByRole('link', { name: w.firstRefundPage, exact: true })).toBeVisible();
      await expect(queue.getByText(w.cancellationQueueEmpty, { exact: true })).toBeVisible();
    }
  );
