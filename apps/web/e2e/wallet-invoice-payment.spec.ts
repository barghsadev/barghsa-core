import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';
import { ErrorCodes } from '@barghsa/shared/errors';
const invoiceId = '11111111-1111-7111-8111-111111111111',
  profileId = '22222222-2222-7222-8222-222222222222',
  transactionId = '33333333-3333-7333-8333-333333333333';
async function shell(
  page: Page,
  locale: 'fa' | 'en',
  darkMode: boolean,
  amount: string,
  readPaid: () => string
) {
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
        numberStyle: locale === 'fa' ? 'persian' : 'western',
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route(`**/api/invoices/${invoiceId}`, (route) => {
    const paid = readPaid();
    const invoice = {
      invoiceId,
      role: 'original',
      state: paid === amount ? 'Paid' : paid === '0' ? 'Unpaid' : 'PartiallyFunded',
      totalAmount: amount,
      paidAmount: paid,
      refundedAmount: '0',
      accountingAmount: amount,
      adjustmentKind: null,
      issuedAt: '2026-09-01T10:00:00.000Z',
      payableFrom: '2026-09-01T10:00:00.000Z',
      dueAt: '2026-09-25T09:00:00.000Z',
      cancelledAt: null,
      createdAt: '2026-09-01T10:00:00.000Z',
      replacesInvoiceId: null,
      adjustmentForInvoiceId: null,
      explanation: null,
      lines: [
        {
          description: 'Electricity',
          quantity: 1,
          unitPrice: amount,
          lineTotal: amount,
          vatRate: 0,
          vatAmount: '0',
          isTaxable: false,
        },
      ],
    };
    return route.fulfill({
      json: { viewedInvoiceId: invoiceId, originalInvoiceId: invoiceId, invoice, chain: [invoice] },
    });
  });
}
for (const locale of ['fa', 'en'] as const)
  for (const darkMode of [false, true])
    test(`wallet payment keeps exact confirmation across verification and ambiguous retry (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
      const fa = locale === 'fa',
        amount = '10000000000000001',
        balance = '10000000000010001';
      let paid = '0';
      await shell(page, locale, darkMode, amount, () => paid);
      const requests: Array<Record<string, unknown>> = [];
      let reads = 0,
        verifications = 0;
      await page.route(`**/api/invoices/${invoiceId}/wallet-payment`, async (route) => {
        if (route.request().method() === 'GET') {
          reads++;
          if (reads === 1) return route.fulfill({ status: 503, json: {} });
          return route.fulfill({
            json: {
              invoiceId,
              profileId,
              remainingAmount: amount,
              availableBalance: reads === 2 ? '500' : balance,
              canPay: reads > 2,
            },
          });
        }
        expect(route.request().headers()['x-csrf-token']).toBe('wallet-payment-csrf');
        const body = route.request().postDataJSON() as Record<string, unknown>;
        requests.push(body);
        if (requests.length === 1)
          return route.fulfill({
            status: 403,
            json: { error: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code },
          });
        if (requests.length === 2 && !darkMode) return route.fulfill({ status: 503, json: {} });
        if (requests.length >= 3) paid = amount;
        return route.fulfill({
          json: {
            ...body,
            invoiceId,
            profileId,
            state: 'Paid',
            amount: requests.length === 2 ? '999' : amount,
            walletTransactionId: transactionId,
          },
        });
      });
      await page.route('**/api/auth/step-up', (route) => {
        verifications++;
        return route.fulfill({ json: { verified: true } });
      });
      await page.goto(`/invoices/${invoiceId}`);
      await page
        .context()
        .addCookies([
          { name: 'barghsa_csrf', value: 'wallet-payment-csrf', url: new URL(page.url()).origin },
        ]);
      const panel = page.locator('#wallet-invoice-payment');
      await expect(panel.getByRole('alert')).toBeVisible();
      const refresh = panel.getByRole('button', {
        name: fa ? 'بررسی مبلغ فعلی' : 'Review latest amount',
        exact: true,
        includeHidden: true,
      });
      const pay = panel.getByRole('button', {
        name: fa ? 'بررسی پرداخت از کیف پول' : 'Review wallet payment',
        exact: true,
      });
      await refresh.click();
      await expect(pay).toBeDisabled();
      await expect(panel).toContainText(fa ? 'در حال حاضر پرداخت' : 'cannot be paid');
      await refresh.click();
      await expect(pay).toBeEnabled();
      const money = formatCurrencyIrr(amount, locale, { numberStyle: fa ? 'persian' : 'western' });
      await expect(panel).toContainText(money);
      await pay.hover();
      await pay.evaluate(async (element) => {
        await Promise.all(element.getAnimations().map((a) => a.finished.catch(() => {})));
      });
      expect(
        (
          await new AxeBuilder({ page })
            .include('#wallet-invoice-payment')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations
      ).toEqual([]);
      await pay.click();
      let dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(money);
      await expect(dialog).toContainText(invoiceId);
      await expect(refresh).toBeDisabled();
      await dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true }).click();
      const password = dialog.getByLabel(
        fa ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password'
      );
      await expect(password).toBeFocused();
      await password.fill('test-only');
      await dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true }).click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await dialog.getByRole('button', { name: fa ? 'انصراف' : 'Cancel', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await panel
        .getByRole('button', {
          name: fa ? 'تلاش مجدد برای همین پرداخت' : 'Retry this payment',
          exact: true,
        })
        .click();
      dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(panel.getByRole('status')).toContainText(transactionId);
      await expect(panel.getByRole('status')).toContainText(money);
      await expect(page.getByTestId(`invoice-card-${invoiceId}`)).toContainText(
        fa ? 'پرداخت‌شده' : 'Paid'
      );
      expect(requests).toHaveLength(3);
      expect(requests[1]).toEqual(requests[0]);
      expect(requests[2]).toEqual(requests[0]);
      expect(Object.keys(requests[0]!).sort()).toEqual([
        'expectedRemainingAmount',
        'idempotencyKey',
      ]);
      expect(requests[0]!.expectedRemainingAmount).toBe(amount);
      expect(verifications).toBe(1);
    });

test('a changed invoice amount needs a new review and a newly captured request', async ({
  page,
}) => {
  let paid = '0';
  await shell(page, 'en', false, '100000', () => paid);
  const requests: Array<Record<string, unknown>> = [];
  await page.route(`**/api/invoices/${invoiceId}/wallet-payment`, (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: {
          invoiceId,
          profileId,
          remainingAmount: (100000n - BigInt(paid)).toString(),
          availableBalance: '150000',
          canPay: paid !== '100000',
        },
      });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    if (requests.length === 1) {
      paid = '20000';
      return route.fulfill({ status: 409, json: {} });
    }
    paid = '100000';
    return route.fulfill({
      json: {
        ...body,
        invoiceId,
        profileId,
        state: 'Paid',
        amount: '80000',
        walletTransactionId: transactionId,
      },
    });
  });
  await page.goto(`/invoices/${invoiceId}`);
  const panel = page.locator('#wallet-invoice-payment');
  await panel.getByRole('button', { name: 'Review wallet payment', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'review the latest amount'
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await panel.getByRole('button', { name: 'Review latest amount', exact: true }).click();
  await expect(panel).toContainText('IRR 80,000');
  await panel.getByRole('button', { name: 'Review wallet payment', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('IRR 80,000');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('IRR 80,000');
  expect(requests[1]!.expectedRemainingAmount).toBe('80000');
  expect(requests[1]!.idempotencyKey).not.toBe(requests[0]!.idempotencyKey);
});
