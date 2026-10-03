import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { contractText } from '@barghsa/i18n/contracts';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { t } from '@barghsa/i18n/app';
import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { fullNavigation } from './navigation-fixture';
import { refundDecisionReviewFixture, refundReviewFixture } from './refund-review-fixture';
const invoiceId = '11111111-1111-4111-8111-111111111111',
  refundId = '22222222-2222-4222-8222-222222222222';
async function shell(page: Page, locale: 'en' | 'fa', dark: boolean) {
  await crmShell(page, locale);
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'finance',
        isStaff: true,
        operatingContext: 'staff',
        navigation: fullNavigation('staff'),
        canSwitchContext: true,
      },
    })
  );
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
      json: {
        appTitle: 'Refunds',
        appTitleFa: 'بازپرداخت‌ها',
        slogan: '',
        supportEmail: 'support@example.test',
        supportPhone: '+982112345678',
        supportMobile: '+989121234567',
        backgroundColor: '#f6f7f4',
        darkBackgroundColor: '#15201c',
        fontFamily: 'vazirmatn',
        borderRadiusRem: 0.75,
        spacingScale: 1,
        numberStyle: 'locale',
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        logoUrl: null,
        faviconUrl: null,
        darkMode: dark,
      },
    })
  );
  await page.addInitScript((language) => {
    new MutationObserver(() => {
      document.documentElement.lang = language;
    }).observe(document, { childList: true });
  }, locale);
}
function balance() {
  return {
    invoiceId,
    profileId: '33333333-3333-4333-8333-333333333333',
    state: 'Paid',
    paidAmount: '100',
    refundedAmount: '0',
    reservedAmount: '0',
    availableAmount: '100',
    requestable: true,
  };
}
async function finishLayout(page: Page, selector: string, locale: string) {
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
  expect((await new AxeBuilder({ page }).include(selector).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    )
  ).toBe(true);
}
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    test(`refund request retains owned fields and an exact verified retry (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
    }) => {
      await shell(page, locale, dark);
      const word = (key: string) => adminText('admin.invoices.walletRefunds.' + key, locale);
      let requested = false,
        attempt = 0;
      const attempts: unknown[] = [];
      await page.route(/\/api\/admin\/wallet-refunds\?/, (route) =>
        route.fulfill({ json: { invoice: balance(), refunds: [], nextBefore: null } })
      );
      await page.route('**/api/admin/wallet-refunds/review', (route) => {
        const body = route.request().postDataJSON();
        expect(body).toEqual({ invoiceId, amount: '40', reason: 'Raw request reason' });
        return route.fulfill({
          json: refundReviewFixture(invoiceId, 'wallet', body.amount, body.reason),
        });
      });
      await page.route('**/api/admin/wallet-refunds', (route) => {
        attempts.push(route.request().postDataJSON());
        attempt++;
        if (attempt === 1)
          return route.fulfill({
            status: 403,
            json: { error: { code: 'AUTHZ:STEP_UP_REQUIRED' } },
          });
        if (attempt === 2)
          return route.fulfill({
            status: 400,
            json: { error: { code: 'VALIDATION:INPUT:INVALID', fields: ['reason'] } },
          });
        if (attempt === 3) return route.fulfill({ status: 503, json: {} });
        if (attempt === 4)
          return route.fulfill({
            status: 400,
            json: {
              error: { code: 'VALIDATION:INPUT:INVALID', fields: ['reason', 'expectedReviewHash'] },
            },
          });
        if (attempt === 5)
          return route.fulfill({
            status: 201,
            json: {
              id: refundId,
              invoiceId: refundId,
              amount: '40',
              destination: 'wallet',
              state: 'Requested',
            },
          });
        requested = true;
        return route.fulfill({
          status: 201,
          json: {
            id: refundId,
            invoiceId,
            amount: '40',
            destination: 'wallet',
            state: 'Requested',
          },
        });
      });
      await page.route('**/api/auth/step-up', (route) => {
        expect(route.request().postDataJSON()).toEqual({ password: 'Test-password' });
        return route.fulfill({ json: { verified: true } });
      });
      await page.goto('/admin/invoices?invoiceId=' + invoiceId);
      const panel = page.locator('#wallet-refunds-panel'),
        amount = panel.locator('#wallet-refund-amount'),
        reason = panel.locator('#wallet-refund-reason');
      await expect(amount).toBeVisible();
      await panel.getByRole('button', { name: word('request'), exact: true }).click();
      await expect(amount).toBeFocused();
      await expect(amount).toHaveAttribute('aria-describedby', /.+/);
      await amount.fill('۴۰');
      await reason.fill('  Raw request reason  ');
      await panel.locator('#wallet-refund-invoice').fill(refundId);
      await expect(
        panel.getByRole('button', { name: word('request'), exact: true })
      ).toBeDisabled();
      await expect(
        panel.getByText(contractText('refundLoadInvoice', locale), { exact: true })
      ).toBeVisible();
      await panel.locator('#wallet-refund-invoice').fill(invoiceId);
      await expect(amount).toHaveValue('۴۰');
      await panel.getByRole('button', { name: word('request'), exact: true }).click();
      const dialog = page.getByRole('dialog'),
        confirm = dialog.getByRole('button', { name: t('team.confirm', locale), exact: true });
      await expect(dialog).toContainText(word('review'));
      await expect(amount).toBeDisabled();
      await confirm.click();
      await dialog.getByLabel(t('team.password', locale), { exact: true }).fill('Test-password');
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      await expect(reason).toBeFocused();
      await expect(amount).toHaveValue('۴۰');
      await expect(reason).toHaveValue('  Raw request reason  ');
      expect(attempts[1]).toEqual(attempts[0]);
      await panel.getByRole('button', { name: word('request'), exact: true }).click();
      for (let index = 0; index < 3; index++) {
        await confirm.click();
        await expect(dialog.getByRole('alert')).toBeVisible();
        await expect(reason).toHaveValue('  Raw request reason  ');
      }
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      await expect(amount).toHaveValue('');
      await expect(reason).toHaveValue('');
      expect(requested).toBe(true);
      expect(
        attempts.slice(2).every((value) => JSON.stringify(value) === JSON.stringify(attempts[2]))
      ).toBe(true);
      await expect(page.locator('html')).toHaveClass(dark ? /dark/ : /^(?!.*\bdark\b)/);
      await finishLayout(page, '#wallet-refunds-panel', locale);
    });
    test(`bank decision validates the selected fields and preserves companion request (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
    }) => {
      await shell(page, locale, dark);
      const shared = (key: string) => adminText('admin.invoices.walletRefunds.' + key, locale),
        bank = (key: string) => adminText('admin.invoices.externalRefunds.' + key, locale);
      let state = 'Approved',
        previews = 0,
        transferAttempts = 0;
      const row = () => ({
        id: refundId,
        invoiceId,
        amount: '40',
        destination: 'external_bank',
        state,
        bankReference: ['Processing', 'Completed'].includes(state) ? 'BANK-123' : null,
        reconciliationStatus:
          state === 'Processing' ? 'Pending' : state === 'Completed' ? 'Confirmed' : null,
        approvalRequestId: null,
        retry: null,
      });
      await page.route(/\/api\/admin\/external-refunds\?/, (route) =>
        route.fulfill({ json: { invoice: balance(), refunds: [row()], nextBefore: null } })
      );
      for (const operation of ['cancel', 'record-transfer', 'reconcile'] as const)
        await page.route(
          `**/api/admin/external-refunds/${refundId}/${operation}/review`,
          (route) => {
            const body = route.request().postDataJSON();
            if (operation === 'record-transfer' && ++previews === 1)
              return route.fulfill({
                status: 400,
                json: { error: { code: 'VALIDATION:INPUT:INVALID', fields: ['bankReference'] } },
              });
            return route.fulfill({
              json: refundDecisionReviewFixture(
                invoiceId,
                refundId,
                'external_bank',
                state,
                operation,
                body.bankReference ?? null,
                body.reason ?? null
              ),
            });
          }
        );
      await page.route(`**/api/admin/external-refunds/${refundId}/record-transfer`, (route) => {
        expect(route.request().postDataJSON()).toEqual({
          bankReference: 'BANK-123',
          expectedReviewHash: 'b'.repeat(64),
        });
        transferAttempts++;
        if (transferAttempts === 1) return route.fulfill({ status: 503, json: {} });
        if (transferAttempts === 2)
          return route.fulfill({
            json: {
              ...row(),
              state: 'Processing',
              bankReference: 'OTHER',
              reconciliationStatus: 'Pending',
            },
          });
        state = 'Processing';
        return route.fulfill({ json: row() });
      });
      await page.route(`**/api/admin/external-refunds/${refundId}/reconcile`, (route) => {
        expect(route.request().postDataJSON()).toEqual({
          bankReference: 'BANK-123',
          expectedReviewHash: 'b'.repeat(64),
        });
        state = 'Completed';
        return route.fulfill({ json: row() });
      });
      await page.goto('/admin/invoices?invoiceId=' + invoiceId);
      const panel = page.locator('#external-refunds-panel'),
        amount = panel.locator('#external-refund-amount'),
        reason = panel.locator('#external-refund-reason'),
        decisionReason = panel.locator('#external-refund-reason-' + refundId),
        reference = panel.locator('#refund-bank-reference-' + refundId);
      await expect(reference).toBeVisible();
      await amount.fill('۴۰');
      await reason.fill('  Companion request  ');
      await panel.getByRole('button', { name: shared('cancel'), exact: true }).click();
      await expect(decisionReason).toBeFocused();
      await decisionReason.fill('  Decline return  ');
      await panel.getByRole('button', { name: shared('cancel'), exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: t('team.cancel', locale), exact: true }).click();
      await expect(decisionReason).toHaveValue('  Decline return  ');
      await panel.getByRole('button', { name: bank('record-transfer'), exact: true }).click();
      await expect(reference).toBeFocused();
      await reference.fill('  BANK-123  ');
      await panel.getByRole('button', { name: bank('record-transfer'), exact: true }).click();
      await expect(reference).toHaveAttribute('aria-invalid', 'true');
      await expect(reference).toBeFocused();
      await expect(decisionReason).toHaveValue('  Decline return  ');
      await panel.getByRole('button', { name: bank('record-transfer'), exact: true }).click();
      const confirm = dialog.getByRole('button', { name: t('team.confirm', locale), exact: true });
      for (let index = 0; index < 2; index++) {
        await confirm.click();
        await expect(dialog.getByRole('alert')).toBeVisible();
        await expect(amount).toHaveValue('۴۰');
      }
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      await expect(panel.getByText(bank('secondReviewer'), { exact: true })).toBeVisible();
      await expect(reason).toHaveValue('  Companion request  ');
      await reference.fill('BANK-WRONG');
      await panel.getByRole('button', { name: bank('reconcile'), exact: true }).click();
      await expect(reference).toBeFocused();
      await expect(
        panel.getByText(contractText('refundBankReferenceMismatch', locale), { exact: true })
      ).toBeVisible();
      await reference.fill('BANK-123');
      await panel.getByRole('button', { name: bank('reconcile'), exact: true }).click();
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      await expect(panel.getByText(shared('state.Completed'), { exact: true })).toBeVisible();
      await expect(amount).toHaveValue('۴۰');
      await expect(reason).toHaveValue('  Companion request  ');
      await expect(page.locator('html')).toHaveClass(dark ? /dark/ : /^(?!.*\bdark\b)/);
      await finishLayout(page, '#external-refunds-panel', locale);
    });
    test(`refund queue corrects references and binds confirmation to a financial review (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
    }) => {
      await shell(page, locale, dark);
      const word = (key: string) => contractText(key, locale);
      let reads = 200,
        previewAttempts = 0,
        commandAttempts = 0,
        state = 'Approved';
      await page.route('**/api/admin/contracts?*', (route) =>
        route.fulfill({ json: { contracts: [], nextBefore: null } })
      );
      await page.route('**/api/admin/wallet-refunds/contract-obligations', (route) =>
        route.fulfill({
          status: reads,
          json: {
            obligations: [
              {
                id: refundId,
                contractId: invoiceId,
                invoiceId,
                amount: '40',
                destination: 'external_bank',
                state,
                bankReference: state === 'Processing' ? 'BANK-123' : null,
                nextAttemptAt: null,
                exhausted: false,
                orderId: null,
              },
            ],
            nextBefore: null,
          },
        })
      );
      await page.route(
        `**/api/admin/external-refunds/${refundId}/record-transfer/review`,
        (route) => {
          expect(route.request().postDataJSON()).toEqual({ bankReference: 'BANK-123' });
          previewAttempts++;
          if (previewAttempts === 1)
            return route.fulfill({
              status: 400,
              json: { error: { code: 'VALIDATION:INPUT:INVALID', fields: ['bankReference'] } },
            });
          return route.fulfill({
            json: refundDecisionReviewFixture(
              invoiceId,
              refundId,
              'external_bank',
              state,
              'record-transfer',
              'BANK-123'
            ),
          });
        }
      );
      await page.route(`**/api/admin/external-refunds/${refundId}/record-transfer`, (route) => {
        expect(route.request().postDataJSON()).toEqual({
          bankReference: 'BANK-123',
          expectedReviewHash: 'b'.repeat(64),
        });
        commandAttempts++;
        if (commandAttempts === 1)
          return route.fulfill({
            status: 400,
            json: { error: { code: 'VALIDATION:INPUT:INVALID', fields: ['bankReference'] } },
          });
        state = 'Processing';
        return route.fulfill({
          json: {
            id: refundId,
            invoiceId,
            amount: '40',
            destination: 'external_bank',
            state,
            bankReference: 'BANK-123',
            reconciliationStatus: 'Pending',
          },
        });
      });
      await page.goto('/admin/contracts');
      const queue = page.locator('#refund-obligations'),
        reference = queue.locator('#bank-return-' + refundId),
        button = queue.getByRole('button', {
          name: word('cancellation.queue.record-transfer'),
          exact: true,
        });
      await button.click();
      await expect(reference).toBeFocused();
      await expect(reference).toHaveAttribute('aria-describedby', /.+/);
      await reference.fill('  BANK-123  ');
      reads = 503;
      await queue.getByRole('button', { name: word('refresh'), exact: true }).click();
      await expect(reference).toHaveValue('  BANK-123  ');
      await expect(reference).toBeDisabled();
      reads = 200;
      await queue.getByRole('button', { name: word('retry'), exact: true }).click();
      await expect(reference).toBeEnabled();
      await button.click();
      await expect(reference).toHaveAttribute('aria-invalid', 'true');
      await expect(reference).toBeFocused();
      await button.click();
      const dialog = page.getByRole('dialog'),
        confirm = dialog.getByRole('button', { name: t('team.confirm', locale), exact: true });
      await expect(dialog).toContainText(adminText('admin.invoices.walletRefunds.review', locale));
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      await expect(reference).toBeFocused();
      await expect(reference).toHaveValue('  BANK-123  ');
      await button.click();
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      await expect(
        queue.getByRole('button', { name: word('cancellation.queue.reconcile'), exact: true })
      ).toBeVisible();
      await expect(page.locator('html')).toHaveClass(dark ? /dark/ : /^(?!.*\bdark\b)/);
      await finishLayout(page, '#refund-obligations', locale);
      if (locale === 'fa' && dark && test.info().project.name === 'mobile-safari')
        await page.screenshot({ path: '/tmp/barghsa-refunds-fa-dark-mobile.png' });
    });
  }
for (const locale of ['en', 'fa'] as const)
  test(`refund submission stays blocked when validation cannot load (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale, false);
    const manifest = JSON.parse(
      await readFile(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8')
    ) as Record<string, { file: string }>;
    await page.route('**/' + manifest['src/lib/refund-form-schemas.ts']!.file, (route) =>
      route.abort()
    );
    let previews = 0;
    await page.route(/\/api\/admin\/wallet-refunds\?/, (route) =>
      route.fulfill({ json: { invoice: balance(), refunds: [], nextBefore: null } })
    );
    await page.route('**/api/admin/wallet-refunds/review', (route) => {
      previews++;
      return route.fulfill({ status: 500, json: {} });
    });
    await page.goto('/admin/invoices?invoiceId=' + invoiceId);
    const panel = page.locator('#wallet-refunds-panel');
    await panel.locator('#wallet-refund-amount').fill('40');
    await panel.locator('#wallet-refund-reason').fill('Retained request');
    await panel
      .getByRole('button', {
        name: adminText('admin.invoices.walletRefunds.request', locale),
        exact: true,
      })
      .click();
    await expect(
      panel.getByText(contractText('cancellationValidationUnavailable', locale), { exact: true })
    ).toBeVisible();
    await expect(panel.locator('#wallet-refund-reason')).toHaveValue('Retained request');
    expect(previews).toBe(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

for (const locale of ['en', 'fa'] as const)
  test(`refund confirmation waits for its financial summary and recovers from a failed load (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale, false);
    const manifest = JSON.parse(
      await readFile(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8')
    ) as Record<string, { file: string }>;
    let failSummary!: () => void;
    const summaryLoad = new Promise<void>((resolve) => {
      failSummary = resolve;
    });
    let summaryRequested = false,
      commits = 0,
      workspaceLoads = 0;
    await page.route('**/' + manifest['src/components/RefundPanel.tsx']!.file, (route) => {
      workspaceLoads++;
      return route.continue();
    });
    await page.route(
      '**/' + manifest['src/components/RefundFinancialReviewSummary.tsx']!.file,
      async (route) => {
        summaryRequested = true;
        await summaryLoad;
        await route.abort();
      }
    );
    await page.route(/\/api\/admin\/wallet-refunds\?/, (route) =>
      route.fulfill({ json: { invoice: balance(), refunds: [], nextBefore: null } })
    );
    await page.route('**/api/admin/wallet-refunds/review', (route) =>
      route.fulfill({ json: refundReviewFixture(invoiceId, 'wallet', '40', 'Retained request') })
    );
    await page.route('**/api/admin/wallet-refunds', (route) => {
      commits++;
      return route.fulfill({ status: 500, json: {} });
    });
    await page.goto('/admin/invoices');
    const open = page.getByRole('button', {
      name: contractText('refundOpen', locale),
      exact: true,
    });
    await expect(open).toBeVisible();
    await expect(page.locator('#wallet-refunds-panel')).toHaveCount(0);
    expect(workspaceLoads).toBe(0);
    await open.click();
    const panel = page.locator('#wallet-refunds-panel'),
      request = panel.getByRole('button', {
        name: adminText('admin.invoices.walletRefunds.request', locale),
        exact: true,
      });
    await panel.locator('#wallet-refund-invoice').fill(invoiceId);
    await panel
      .getByRole('button', {
        name: adminText('admin.invoices.walletRefunds.load', locale),
        exact: true,
      })
      .click();
    await panel.locator('#wallet-refund-amount').fill('۴۰');
    await panel.locator('#wallet-refund-reason').fill('  Retained request  ');
    await request.click();
    await expect.poll(() => summaryRequested).toBe(true);
    await expect(request).toBeDisabled();
    await expect(panel.locator('#wallet-refund-reason')).toBeDisabled();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    failSummary();
    await expect(
      panel.getByText(adminText('admin.invoices.walletRefunds.error', locale), { exact: true })
    ).toBeVisible();
    await expect(request).toBeEnabled();
    await expect(panel.locator('#wallet-refund-amount')).toHaveValue('۴۰');
    await expect(panel.locator('#wallet-refund-reason')).toHaveValue('  Retained request  ');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(commits).toBe(0);
  });
