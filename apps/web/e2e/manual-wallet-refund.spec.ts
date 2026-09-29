import { test, expect } from './coverage-fixture';
import { en, fa } from '../../../packages/i18n/src/admin-ui';
import { t as appText } from '../../../packages/i18n/src/app';

const invoiceId = '11111111-1111-4111-8111-111111111111';
const refundId = '22222222-2222-4222-8222-222222222222';

for (const locale of ['en', 'fa'] as const)
  test(`${locale}: finance requests, processes and reopens a manual wallet refund`, async ({
    page,
  }) => {
    const copy = locale === 'fa' ? fa : en;
    const word = (key: string) => copy[`admin.invoices.walletRefunds.${key}`]!;
    await page.addInitScript((language) => {
      if (document.documentElement) document.documentElement.lang = language;
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = language;
      }).observe(document, { childList: true });
    }, locale);
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
    let state: 'none' | 'Requested' | 'Approved' | 'Completed' = 'none';
    const actions: string[] = [];
    await page.route(/\/api\/admin\/wallet-refunds\?/, (route) =>
      route.fulfill({
        json: {
          invoice: {
            invoiceId,
            profileId: '33333333-3333-4333-8333-333333333333',
            state: state === 'Completed' ? 'PartiallyRefunded' : 'Paid',
            paidAmount: '100',
            refundedAmount: state === 'Completed' ? '40' : '0',
            reservedAmount: state === 'Requested' || state === 'Approved' ? '40' : '0',
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
                    approvalRequestId: null,
                    retry: null,
                  },
                ],
          nextBefore: null,
        },
      })
    );
    await page.route('**/api/admin/wallet-refunds', (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        invoiceId,
        amount: '40',
        reason: 'Customer return',
        idempotencyKey: expect.any(String),
      });
      state = 'Requested';
      actions.push('request');
      return route.fulfill({ status: 201, json: { id: refundId, state } });
    });
    await page.route(`**/api/admin/wallet-refunds/${refundId}/approve`, (route) => {
      state = 'Approved';
      actions.push('approve');
      return route.fulfill({ json: { id: refundId, state } });
    });
    await page.route(`**/api/admin/wallet-refunds/${refundId}/process`, (route) => {
      state = 'Completed';
      actions.push('process');
      return route.fulfill({ json: { id: refundId, state } });
    });

    await page.goto(`/admin/invoices?invoiceId=${invoiceId}`);
    await page.locator('html').evaluate((element, language) => {
      element.lang = language;
      element.dir = language === 'fa' ? 'rtl' : 'ltr';
    }, locale);
    const panel = page.getByRole('region', { name: word('title'), exact: true });
    await expect(panel.getByText(word('available'))).toBeVisible();
    await panel.getByLabel(word('requestAmount')).fill('40');
    await panel.getByLabel(word('reason'), { exact: true }).fill('Customer return');
    await panel.getByRole('button', { name: word('request'), exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText(word('review'));
    await page
      .getByRole('dialog')
      .getByRole('button', { name: appText('team.confirm', locale) })
      .click();
    await expect(panel.getByText(refundId)).toBeVisible();
    await panel.getByRole('button', { name: word('approve') }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: appText('team.confirm', locale) })
      .click();
    await panel.getByRole('button', { name: word('process') }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: appText('team.confirm', locale) })
      .click();
    await expect(panel.getByText(word('state.Completed'))).toBeVisible();
    expect(actions).toEqual(['request', 'approve', 'process']);
    await page.reload();
    await page.locator('html').evaluate((element, language) => {
      element.lang = language;
      element.dir = language === 'fa' ? 'rtl' : 'ltr';
    }, locale);
    await expect(
      page.getByRole('region', { name: word('title') }).getByText(refundId)
    ).toBeVisible();
  });
