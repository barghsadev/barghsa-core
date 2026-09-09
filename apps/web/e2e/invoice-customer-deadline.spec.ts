import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';

const invoiceId = '11111111-1111-7111-8111-111111111111';
for (const locale of ['fa', 'en'] as const)
  for (const darkMode of [false, true])
    test(`customer sees the deadline reason (${locale}, dark=${darkMode})`, async ({ page }) => {
      const fa = locale === 'fa';
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
          },
        })
      );
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'Asia/Tehran' } })
      );
      const reason = fa ? 'تمدید مهلت به درخواست مشتری' : 'Customer requested more time';
      const invoice = {
        invoiceId,
        role: 'original',
        state: 'Paid',
        totalAmount: '100000',
        paidAmount: '100000',
        refundedAmount: '0',
        accountingAmount: '100000',
        adjustmentKind: null,
        issuedAt: '2026-09-01T10:00:00.000Z',
        payableFrom: '2026-09-01T10:00:00.000Z',
        dueAt: '2026-09-25T09:00:00.000Z',
        dueAtOverrideReason: reason,
        cancelledAt: null,
        createdAt: '2026-09-01T10:00:00.000Z',
        replacesInvoiceId: null,
        adjustmentForInvoiceId: null,
        explanation: null,
        lines: [
          {
            description: fa ? 'مصرف برق' : 'Electricity usage',
            quantity: 1,
            unitPrice: '100000',
            lineTotal: '100000',
            vatRate: 0,
            vatAmount: '0',
            isTaxable: false,
          },
        ],
      };
      await page.route(`**/api/invoices/${invoiceId}`, (route) =>
        route.fulfill({
          json: {
            viewedInvoiceId: invoiceId,
            originalInvoiceId: invoiceId,
            invoice,
            chain: [invoice],
          },
        })
      );
      await page.goto(`/invoices/${invoiceId}`);
      const card = page.getByTestId(`invoice-card-${invoiceId}`);
      await expect(card).toBeVisible();
      await expect(page.getByTestId(`invoice-due-reason-${invoiceId}`)).toContainText(reason);
      await expect(card).toContainText(fa ? 'توضیح تغییرات' : 'Explanation of changes');
      if (!fa) await expect(card).toContainText('Sep 25, 2026, 12:30 PM');
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    });
