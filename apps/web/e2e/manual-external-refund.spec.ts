import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { en, fa } from '../../../packages/i18n/src/admin-ui';
import { t as appText } from '../../../packages/i18n/src/app';
import { refundDecisionReviewFixture, refundReviewFixture } from './refund-review-fixture';

const invoiceId = '11111111-1111-4111-8111-111111111111';
const refundId = '22222222-2222-4222-8222-222222222222';
const bankReference = 'BANK-RETURN-40';

for (const locale of ['en', 'fa'] as const)
  test(`${locale}: finance records and reconciles an external refund`, async ({ page }) => {
    const copy = locale === 'fa' ? fa : en;
    const word = (key: string) => copy[`admin.invoices.externalRefunds.${key}`]!;
    const shared = (key: string) => copy[`admin.invoices.walletRefunds.${key}`]!;
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({ json: { isStaff: true, operatingContext: 'staff', canSwitchContext: true } })
    );
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
          darkMode: false,
        },
      })
    );
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'Asia/Tehran' } })
    );
    await page.route('**/api/admin/config/invoice-reminder-offsets', (route) =>
      route.fulfill({ json: [] })
    );
    let state: 'none' | 'Requested' | 'Approved' | 'Processing' | 'Completed' = 'none';
    const actions: string[] = [];
    await page.route(/\/api\/admin\/external-refunds\?/, (route) =>
      route.fulfill({
        json: {
          invoice: {
            invoiceId,
            profileId: '33333333-3333-4333-8333-333333333333',
            state: state === 'Completed' ? 'PartiallyRefunded' : 'Paid',
            paidAmount: '100',
            refundedAmount: state === 'Completed' ? '40' : '0',
            reservedAmount: state !== 'none' && state !== 'Completed' ? '40' : '0',
            availableAmount: state === 'none' ? '100' : '60',
            requestable: true,
          },
          refunds:
            state === 'none'
              ? []
              : [
                  {
                    id: refundId,
                    invoiceId,
                    amount: '40',
                    state,
                    destination: 'external_bank',
                    bankReference:
                      state === 'Processing' || state === 'Completed' ? bankReference : null,
                    reconciliationStatus:
                      state === 'Processing'
                        ? 'Pending'
                        : state === 'Completed'
                          ? 'Confirmed'
                          : null,
                    approvalRequestId: null,
                    retry: null,
                  },
                ],
          nextBefore: null,
        },
      })
    );
    await page.route('**/api/admin/external-refunds/review', (route) => {
      const body = route.request().postDataJSON();
      expect(body).toEqual({ invoiceId, amount: '40', reason: 'Customer return' });
      return route.fulfill({
        json: refundReviewFixture(invoiceId, 'external_bank', '40', body.reason),
      });
    });
    await page.route('**/api/admin/external-refunds', (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        invoiceId,
        amount: '40',
        reason: 'Customer return',
        idempotencyKey: expect.any(String),
        expectedReviewHash: 'a'.repeat(64),
      });
      state = 'Requested';
      actions.push('request');
      return route.fulfill({ status: 201, json: { id: refundId, state } });
    });
    for (const [operation, next] of [
      ['approve', 'Approved'],
      ['record-transfer', 'Processing'],
      ['reconcile', 'Completed'],
    ] as const)
      await page.route(`**/api/admin/external-refunds/${refundId}/${operation}`, (route) => {
        expect(route.request().postDataJSON()).toEqual(
          operation === 'approve'
            ? { expectedReviewHash: 'b'.repeat(64) }
            : { bankReference, expectedReviewHash: 'b'.repeat(64) }
        );
        state = next;
        actions.push(operation);
        return route.fulfill({ json: { id: refundId, state } });
      });
    for (const operation of ['approve', 'record-transfer', 'reconcile'] as const)
      await page.route(`**/api/admin/external-refunds/${refundId}/${operation}/review`, (route) => {
        expect(route.request().postDataJSON()).toEqual(
          operation === 'approve' ? {} : { bankReference }
        );
        return route.fulfill({
          json: refundDecisionReviewFixture(
            invoiceId,
            refundId,
            'external_bank',
            state,
            operation,
            operation === 'approve' ? null : bankReference
          ),
        });
      });

    await page.goto(`/admin/invoices?invoiceId=${invoiceId}`);
    await page.locator('html').evaluate((element, language) => {
      element.lang = language;
      element.dir = language === 'fa' ? 'rtl' : 'ltr';
    }, locale);
    const panel = page.getByRole('region', { name: word('title'), exact: true });
    await expect(panel.getByText(`${shared('available')}:`)).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).include('#external-refunds-panel').analyze()).violations
    ).toEqual([]);
    await panel.getByLabel(shared('requestAmount')).fill('40');
    await panel.getByLabel(shared('reason'), { exact: true }).fill('Customer return');
    await panel.getByRole('button', { name: word('request'), exact: true }).click();
    const confirm = async () =>
      page
        .getByRole('dialog')
        .getByRole('button', { name: appText('team.confirm', locale) })
        .click();
    await confirm();
    await expect(panel.getByText(refundId)).toBeVisible();
    await panel.getByRole('button', { name: shared('approve') }).click();
    await confirm();
    await panel.getByLabel(word('bankReference')).fill(bankReference);
    await panel.getByRole('button', { name: word('record-transfer') }).click();
    await confirm();
    await expect(panel.getByText(word('secondReviewer'))).toBeVisible();
    await panel.getByLabel(word('bankReference')).fill(bankReference);
    await panel.getByRole('button', { name: word('reconcile') }).click();
    await confirm();
    await expect(panel.getByText(shared('state.Completed'))).toBeVisible();
    expect(actions).toEqual(['request', 'approve', 'record-transfer', 'reconcile']);
    await page.reload();
    await page.locator('html').evaluate((element, language) => {
      element.lang = language;
      element.dir = language === 'fa' ? 'rtl' : 'ltr';
    }, locale);
    await expect(
      page.getByRole('region', { name: word('title') }).getByText(bankReference)
    ).toBeVisible();
  });
