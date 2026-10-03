import { test, expect } from './coverage-fixture';
import { en, fa } from '../../../packages/i18n/src/contracts';
import { t } from '../../../packages/i18n/src/app';
import { refundDecisionReviewFixture } from './refund-review-fixture';
const walletId = '55555555-5555-4555-8555-555555555555';
const bankId = '66666666-6666-4666-8666-666666666666';
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
      await page.route('**/api/admin/wallet-refunds/contract-obligations', (route) =>
        route.fulfill({
          json: {
            obligations: [
              ...(!walletComplete
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
              ...(bankState !== 'Completed'
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
            nextBefore: null,
          },
        })
      );
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
      await page.goto('/admin/contracts');
      const queue = page.getByRole('region', { name: w.cancellationQueue, exact: true });
      await expect(queue.getByText(w.cancellationQueueExhausted, { exact: true })).toBeVisible();
      await page.screenshot({
        path: test.info().outputPath('refund-queue-' + locale + '.png'),
        fullPage: true,
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        await queue
          .getByRole('button', { name: w['cancellation.queue.process'], exact: true })
          .click();
        await page
          .getByRole('dialog')
          .getByRole('button', { name: t('team.confirm', locale), exact: true })
          .click();
        if (attempt === 0)
          await expect(
            queue.getByRole('button', { name: w['cancellation.queue.process'], exact: true })
          ).toBeVisible();
      }
      await expect(
        queue.getByRole('button', { name: w['cancellation.queue.process'], exact: true })
      ).toHaveCount(0);
      await queue
        .getByRole('button', { name: w['cancellation.queue.record-transfer'], exact: true })
        .click();
      await expect(queue.getByText(w.refundBankReferenceInvalid, { exact: true })).toBeVisible();
      await queue.getByLabel(w.cancellationBankReference, { exact: true }).fill('BANK-123');
      await queue
        .getByRole('button', { name: w['cancellation.queue.record-transfer'], exact: true })
        .click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: t('team.confirm', locale), exact: true })
        .click();
      await queue
        .getByRole('button', { name: w['cancellation.queue.reconcile'], exact: true })
        .click();
      await expect(page.getByRole('dialog')).toContainText(w.cancellationQueueReconcileNotice);
      await page
        .getByRole('dialog')
        .getByRole('button', { name: t('team.confirm', locale), exact: true })
        .click();
      await expect(queue.getByText(w.cancellationQueueEmpty, { exact: true })).toBeVisible();
    }
  );
