import { test, expect } from './coverage-fixture';
import { en, fa } from '../../../packages/i18n/src/contracts';
import { t } from '../../../packages/i18n/src/app';
for (const locale of ['en', 'fa'] as const)
  test(
    locale + ': finance retries failed returns and records then reconciles bank transfers',
    async ({ page }) => {
      const w = locale === 'fa' ? fa : en;
      await page.addInitScript((language) => {
        if (document.documentElement) document.documentElement.lang = language;
        new MutationObserver(() => {
          if (document.documentElement) document.documentElement.lang = language;
        }).observe(document, { childList: true });
      }, locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 403, json: {} }));
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
                      id: 'wallet-return',
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
                      id: 'bank-return',
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
      await page.route('**/api/admin/wallet-refunds/wallet-return/process', (route) => {
        attempts++;
        walletComplete = attempts === 2;
        return route.fulfill({ json: { state: walletComplete ? 'Completed' : 'Failed' } });
      });
      await page.route('**/api/admin/external-refunds/bank-return/record-transfer', (route) => {
        expect(route.request().postDataJSON()).toEqual({ bankReference: 'BANK-123' });
        bankState = 'Processing';
        return route.fulfill({ json: { state: bankState } });
      });
      await page.route('**/api/admin/external-refunds/bank-return/reconcile', (route) => {
        expect(route.request().postDataJSON()).toEqual({ bankReference: 'BANK-123' });
        bankState = 'Completed';
        return route.fulfill({ json: { state: bankState } });
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
      await expect(
        queue.getByText(w.cancellationBankReferenceRequired, { exact: true })
      ).toBeVisible();
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
