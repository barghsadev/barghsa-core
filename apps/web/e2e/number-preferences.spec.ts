import { test, expect } from './coverage-fixture';

const id = '11111111-1111-4111-8111-111111111111';
const amount = '10000000000000001';
const western = '10,000,000,000,000,001';
const persian = '۱۰٬۰۰۰٬۰۰۰٬۰۰۰٬۰۰۰٬۰۰۱';
for (const locale of ['en', 'fa']) {
  test(`published number preference reaches finance without changing submitted values (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      if (document.documentElement) document.documentElement.lang = value;
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    let numberStyle = locale === 'fa' ? 'western' : 'persian';
    let walletAmount: string | number = amount;
    const digits = locale === 'fa' ? western : persian;
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/public/branding/config', (route) =>
      route.fulfill({
        json: {
          appTitle: 'Number preference test',
          slogan: '',
          primaryColor: '#2563eb',
          secondaryColor: '#64748b',
          accentColor: '#f59e0b',
          logoUrl: null,
          faviconUrl: null,
          darkMode: false,
          numberStyle,
        },
      })
    );
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({ json: { userId: id, requiresTosAcceptance: false } })
    );
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'Asia/Tehran' } })
    );
    await page.route('**/api/profiles', (route) =>
      route.fulfill({
        json: {
          activeProfileId: id,
          profiles: [{ id, profileType: 'INDIVIDUAL', title: 'Finance' }],
          hasDefault: true,
        },
      })
    );
    await page.route(`**/api/wallet/${id}`, (route) =>
      route.fulfill({
        json: {
          balance: walletAmount,
          currency: 'IRR',
          onlineTopUpLimit: 2000000000,
          configVersion: 0,
        },
      })
    );
    const invoice = {
      invoiceId: id,
      role: 'original',
      state: 'Paid',
      totalAmount: amount,
      paidAmount: amount,
      issuedAt: '2026-09-01T00:00:00Z',
      dueAt: '2026-09-01T00:00:00Z',
      explanation: null,
      lines: [],
      adjustmentKind: null,
    };
    await page.route('**/api/invoices', (route) =>
      route.fulfill({ json: { invoices: [invoice] } })
    );
    await page.route(`**/api/invoices/${id}`, (route) =>
      route.fulfill({
        json: { invoice, chain: [invoice], viewedInvoiceId: id, originalInvoiceId: id },
      })
    );
    await page.route('**/api/admin/approval-requests?*', (route) =>
      route.fulfill({
        json: [
          {
            id,
            actionType: 'bank_payment_confirmation',
            amountIrR: amount,
            initiatorId: 'initiator',
            initiatorUsername: 'finance@example.test',
            reason: 'Review payment',
            status: 'pending',
            reviewerId: null,
            details: { entityType: 'wallet_bank_receipt' },
          },
        ],
      })
    );
    await page.route('**/api/profiles/verification-status', (route) =>
      route.fulfill({
        json: { activeProfileId: id, verificationRequired: false, isVerified: false },
      })
    );
    await page.route('**/api/products', (route) =>
      route.fulfill({
        json: [
          {
            id,
            type: 'electricity',
            status: 'active',
            price: amount,
            title: { en: 'Electricity', fa: 'برق' },
          },
        ],
      })
    );
    await page.route('**/api/crm/dashboard/pending-verification', (route) =>
      route.fulfill({ json: { enabled: true, count: 12, profiles: [] } })
    );
    await page.route('**/api/admin/wallet/chargebacks/unresolved-warning', (route) =>
      route.fulfill({
        json: {
          count: 1,
          unmatchedCount: 1,
          reversalFailedCount: 0,
          items: [
            {
              eventId: id,
              status: 'unmatched',
              amountIrR: amount,
              walletId: id,
              originalTransactionId: null,
              reason: null,
              createdAt: '2026-09-01T00:00:00Z',
            },
          ],
        },
      })
    );
    let limit = { limitIrR: 2000000000, version: 0 };
    const writes: unknown[] = [];
    await page.route('**/api/admin/config/wallet-top-up-limit', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: limit });
      const body = route.request().postDataJSON();
      writes.push(body);
      limit = { limitIrR: body.limit_irr, version: body.expected_version + 1 };
      return route.fulfill({ json: limit });
    });
    for (const path of [
      '/wallet',
      '/invoices',
      `/invoices/${id}`,
      '/admin/approval-requests',
      '/electricity/order',
      '/admin',
    ]) {
      await page.goto(path);
      await expect(page.locator('main')).toContainText(digits);
      await expect(page.locator('main')).toContainText(locale === 'fa' ? 'ریال' : 'IRR');
      expect(await page.evaluate(() => document.documentElement.lang)).toBe(locale);
    }
    await page.goto('/admin/wallet-receipts');
    const input = page.getByTestId('wallet-top-up-limit-input');
    await expect(input).toHaveValue(locale === 'fa' ? '2,000,000,000' : '۲٬۰۰۰٬۰۰۰٬۰۰۰');
    await input.fill('۵۰۰۰۰۰۰۰۰');
    await page.getByTestId('wallet-top-up-limit-save').click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(writes).toEqual([{ limit_irr: 500000000, expected_version: 0 }]);
    numberStyle = 'locale';
    await page.evaluate(() => window.dispatchEvent(new Event('barghsa:branding-activated')));
    await expect(input).toHaveValue(locale === 'fa' ? '۵۰۰٬۰۰۰٬۰۰۰' : '500,000,000');
    expect(writes).toHaveLength(1);
    walletAmount = Number.MAX_SAFE_INTEGER + 1;
    await page.goto('/wallet');
    await expect(page.locator('main .text-3xl')).toHaveText('—');
  });
}
