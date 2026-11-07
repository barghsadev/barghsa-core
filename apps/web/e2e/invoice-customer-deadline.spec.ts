import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { fullNavigation } from './navigation-fixture';
import { formatBrowserDate } from './browser-date';
import { checkRoutePresentation } from './route-presentation';
import { t } from '@barghsa/i18n/app';

const invoiceId = '11111111-1111-7111-8111-111111111111';
const adjustmentId = '33333333-3333-7333-8333-333333333333';
for (const locale of ['fa', 'en'] as const)
  for (const darkMode of [false, true])
    test(`customer sees the deadline reason (${locale}, dark=${darkMode})`, async ({
      page,
    }, info) => {
      const fa = locale === 'fa';
      const profileId = '22222222-2222-4222-8222-222222222222';
      await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/auth/user', (route) =>
        route.fulfill({
          json: {
            userId: 'deadline-customer',
            isStaff: false,
            operatingContext: 'customer',
            requiresTosAcceptance: false,
            navigation: { ...fullNavigation('customer', 'INDIVIDUAL'), profileId },
          },
        })
      );
      await page.route('**/api/profiles', (route) =>
        route.fulfill({
          json: {
            activeProfileId: profileId,
            profiles: [
              { id: profileId, profileType: 'INDIVIDUAL', status: 'ACTIVE', title: 'Customer' },
            ],
          },
        })
      );
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
      const explanation = fa ? 'اصلاح مبلغ پس از بازبینی' : 'Amount corrected after review';
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
      const adjustment = {
        ...invoice,
        invoiceId: adjustmentId,
        role: 'adjustment_charge',
        state: 'Unpaid',
        totalAmount: '50000',
        paidAmount: '0',
        accountingAmount: '50000',
        adjustmentKind: 'charge',
        adjustmentForInvoiceId: invoiceId,
        dueAtOverrideReason: null,
        explanation,
        lines: [
          {
            ...invoice.lines[0]!,
            unitPrice: '50000',
            lineTotal: '50000',
          },
        ],
      };
      const details = {
        viewedInvoiceId: invoiceId,
        originalInvoiceId: invoiceId,
        invoice,
        chain: [invoice, adjustment],
      };
      let reads = 0;
      let release!: () => void;
      const held = new Promise<void>((done) => {
        release = done;
      });
      await page.route(`**/api/invoices/${invoiceId}`, async (route) => {
        reads++;
        if (!darkMode && reads === 1) {
          await held;
          await route
            .fulfill({
              json: {
                ...details,
                invoice: { ...invoice, dueAtOverrideReason: 'Obsolete invoice' },
                chain: [{ ...invoice, dueAtOverrideReason: 'Obsolete invoice' }],
              },
            })
            .catch(() => {});
          return;
        }
        if (!darkMode && reads === 2)
          return route.fulfill({
            json: {
              ...details,
              viewedInvoiceId: adjustmentId,
              invoice: adjustment,
              chain: [adjustment],
            },
          });
        return route.fulfill({ json: details });
      });
      if (!darkMode) await page.clock.install();
      await page.goto(`/invoices/${invoiceId}`);
      if (!darkMode) {
        try {
          await expect.poll(() => reads).toBe(1);
          await expect(
            page.getByText(t('invoices.details.loading', locale), { exact: true })
          ).toBeVisible();
          await page.clock.fastForward(15_001);
          const failed = page.getByTestId('invoice-load-error');
          const retry = failed.getByRole('button', { name: t('invoices.activity.retry', locale) });
          await expect(failed).toBeVisible();
          expect(reads).toBe(1);
          await retry.click();
          await expect.poll(() => reads).toBe(2);
          await expect(failed).toBeVisible();
          await expect(page.getByTestId(`invoice-card-${adjustmentId}`)).toHaveCount(0);
          await retry.click();
          await expect.poll(() => reads).toBe(3);
          await expect(page.getByTestId(`invoice-card-${invoiceId}`)).toBeVisible();
        } finally {
          release();
        }
        await expect(page.getByText('Obsolete invoice', { exact: true })).toHaveCount(0);
      }
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('html')).toHaveClass(darkMode ? /dark/ : /^(?!.*\bdark\b)/);
      const card = page.getByTestId(`invoice-card-${invoiceId}`);
      await expect(card).toBeVisible();
      await expect(page.getByTestId(`invoice-explanation-${adjustmentId}`)).toContainText(
        explanation
      );
      await expect(page.getByTestId(`invoice-due-reason-${invoiceId}`)).toContainText(reason);
      await expect(card).toContainText(fa ? 'توضیح تغییرات' : 'Explanation of changes');
      await expect(
        card.getByRole('columnheader', { name: fa ? 'قیمت واحد' : 'Unit price' })
      ).toBeVisible();
      await expect(card.getByRole('columnheader', { name: fa ? 'مالیات' : 'VAT' })).toBeVisible();
      if (!fa)
        await expect(card).toContainText(
          await formatBrowserDate(
            page,
            locale,
            { timeZone: 'Asia/Tehran', dateStyle: 'medium', timeStyle: 'short' },
            invoice.dueAt
          )
        );
      const lines = card.getByRole('region', { name: t('invoices.details.lines', locale) });
      const adjustmentLines = page
        .getByTestId(`invoice-card-${adjustmentId}`)
        .getByRole('region', { name: t('invoices.details.lines', locale) });
      await expect(lines).toHaveAccessibleName(new RegExp(invoiceId));
      await expect(adjustmentLines).toHaveAccessibleName(new RegExp(adjustmentId));
      await lines.focus();
      await expect(lines).toBeFocused();
      if (await lines.evaluate((element) => element.scrollWidth > element.clientWidth)) {
        const before = await lines.evaluate((element) => element.scrollLeft);
        await page.keyboard.press(fa ? 'ArrowLeft' : 'ArrowRight');
        await expect.poll(() => lines.evaluate((element) => element.scrollLeft)).not.toBe(before);
      }
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      await checkRoutePresentation(page, info, locale);
    });
