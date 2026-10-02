import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/app';
import {
  formatCurrencyIrr,
  formatNumber,
  formatToman,
  type NumberStyle,
} from '@barghsa/i18n/numbers';
import { fulfillDashboard } from './dashboard-fixture';

const profileId = '74000000-0000-4000-8000-000000000001';
const invoiceId = '11111111-1111-7111-8111-111111111111';
const available = '9223372036854775802';
for (const locale of ['en', 'fa'] as const)
  for (const initialStyle of ['western', 'persian'] as const)
    test(`shared money respects ${locale} language and ${initialStyle} numerals through wallet navigation`, async ({
      page,
    }, testInfo) => {
      let numberStyle: NumberStyle = initialStyle;
      const darkMode = initialStyle === 'persian';
      await page.addInitScript((locale) => localStorage.setItem('barghsa.locale', locale), locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/auth/user', (route) =>
        route.fulfill({
          json: { userId: 'customer', isStaff: false, requiresTosAcceptance: false },
        })
      );
      await page.route('**/api/profiles', (route) =>
        route.fulfill({
          json: {
            activeProfileId: profileId,
            hasDefault: true,
            profiles: [
              {
                id: profileId,
                profileType: 'INDIVIDUAL',
                firstName: 'Ari',
                lastName: 'Buyer',
                status: 'ACTIVE',
              },
            ],
          },
        })
      );
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'Asia/Tehran' } })
      );
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            appTitle: 'Finance',
            appTitleFa: 'مالی',
            slogan: '',
            supportEmail: 'support@example.test',
            supportPhone: '+982188888888',
            supportMobile: '+989121234567',
            primaryColor: '#2563eb',
            secondaryColor: '#64748b',
            accentColor: '#f59e0b',
            logoUrl: null,
            faviconUrl: null,
            darkMode,
            numberStyle,
          },
        })
      );
      await page.route('**/api/dashboard/**', (route) =>
        fulfillDashboard(route, {
          json: {
            profile: { id: profileId, name: 'Ari Buyer' },
            pendingInvoices: 1,
            wallet: {
              balance: available,
              postedBalance: '9223372036854775807',
              reservedBalance: '5',
              currency: 'IRR',
              lowBalanceWarning: true,
            },
          },
        })
      );
      await page.route(`**/api/wallet/${profileId}`, (route) =>
        route.fulfill({
          json: { balance: available, currency: 'IRR', onlineTopUpLimit: 2000000000 },
        })
      );
      const cursors: Array<string | null> = [];
      await page.route(`**/api/wallet/${profileId}/transactions?*`, (route) => {
        const query = new URL(route.request().url()).searchParams;
        expect(query.get('limit')).toBe('25');
        expect(query.get('sort')).toBe('desc');
        cursors.push(query.get('cursor'));
        return route.fulfill({
          json: {
            transactions: query.get('cursor')
              ? [
                  {
                    id: 'older-refund',
                    type: 'refund',
                    amount: '10',
                    state: 'Completed',
                    refId: null,
                    description: 'Older refund',
                    createdAt: '2026-09-01T10:00:00Z',
                  },
                ]
              : [
                  {
                    id: 'credit',
                    type: 'topup',
                    amount: available,
                    state: 'Completed',
                    refId: null,
                    description: 'Credit reference',
                    createdAt: '2026-09-02T12:00:00Z',
                  },
                  {
                    id: 'invoice-payment',
                    type: 'payment',
                    amount: '-10053',
                    state: 'Completed',
                    refId: invoiceId,
                    description: 'Invoice payment reference',
                    createdAt: '2026-09-02T11:00:00Z',
                  },
                ],
            nextCursor: query.get('cursor') ? null : 'older-page',
          },
        });
      });
      await page.goto('/app');
      const wallet = page.getByRole('region', {
        name: t('dashboard.overview.walletBalance', locale),
      });
      await expect(wallet).toContainText(formatCurrencyIrr(available, locale, { numberStyle }));
      await expect(wallet).toContainText(
        `${formatToman(available, locale, { numberStyle })} ${t('currency.toman', locale)}`
      );
      await expect(wallet).toContainText(
        formatCurrencyIrr('9223372036854775807', locale, { numberStyle })
      );
      await expect(wallet).toContainText(t('dashboard.overview.reservedBalance', locale));
      const warning = wallet.getByRole('alert');
      await expect(warning).toContainText(t('dashboard.overview.lowBalanceWarning', locale));
      await expect(warning).toHaveClass(/text-destructive/);
      expect(
        await wallet
          .locator('[data-slot="currency"]')
          .first()
          .locator(':scope > bdi')
          .evaluate(
            (element) =>
              element.getBoundingClientRect().height <=
              parseFloat(getComputedStyle(element).lineHeight) + 1
          )
      ).toBe(true);
      expect(await wallet.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true
      );
      if (locale === 'fa' && initialStyle === 'persian')
        await wallet.screenshot({
          path: `/tmp/barghsa-money-card-fa-${testInfo.project.name}.png`,
        });
      expect(
        (
          await new AxeBuilder({ page })
            .include('[aria-label="' + t('dashboard.overview.chargeWallet', locale) + '"]')
            .analyze()
        ).violations
      ).toEqual([]);
      const card = wallet.getByRole('link', {
        name: t('dashboard.overview.chargeWallet', locale),
        exact: true,
      });
      await expect(card.locator('[data-slot="currency"]')).toHaveCount(3);
      await card.focus();
      await card.press('Enter');
      await expect(page).toHaveURL(/\/wallet(?:\?|$)/);
      await expect(page.getByTestId('wallet-balance')).toContainText(
        formatCurrencyIrr(available, locale, { numberStyle })
      );
      if (locale === 'fa' && initialStyle === 'persian')
        await page
          .getByTestId('wallet-balance')
          .screenshot({ path: `/tmp/barghsa-money-balance-fa-${testInfo.project.name}.png` });
      const history = page.getByRole('region', {
        name: t('wallet.history.title', locale),
        exact: true,
      });
      await history
        .getByRole('button', { name: t('historyView.card', locale), exact: true })
        .click();
      await expect(history).toContainText('Credit reference');
      await expect(history).toContainText(
        `+${formatNumber(BigInt(available), locale, { numberStyle })}`
      );
      await expect(history).toContainText(formatNumber(-10053n, locale, { numberStyle }));
      await expect(
        history.getByRole('link', { name: new RegExp(t('wallet.history.viewInvoice', locale)) })
      ).toHaveAttribute('href', `/invoices/${invoiceId}`);
      const initialReads = cursors.length;
      numberStyle = initialStyle === 'western' ? 'persian' : 'western';
      await page.evaluate(() => window.dispatchEvent(new Event('barghsa:branding-activated')));
      await expect(page.getByTestId('wallet-balance')).toContainText(
        formatCurrencyIrr(available, locale, { numberStyle })
      );
      await expect(history).toContainText(
        `+${formatNumber(BigInt(available), locale, { numberStyle })}`
      );
      await history
        .getByRole('button', { name: t('historyView.table', locale), exact: true })
        .click();
      const table = history.getByRole('table');
      await expect(table).toContainText(formatNumber(-10053n, locale, { numberStyle }));
      expect(cursors).toHaveLength(initialReads);
      await history
        .getByRole('button', { name: t('wallet.history.next', locale), exact: true })
        .click();
      await expect(history).toContainText('Older refund');
      await expect(history).not.toContainText('Credit reference');
      expect(cursors.at(-1)).toBe('older-page');
      await history
        .getByRole('button', { name: t('wallet.history.previous', locale), exact: true })
        .click();
      await expect(history).toContainText('Credit reference');
      expect(cursors.at(-1)).toBeNull();
      await history
        .getByRole('button', { name: t('historyView.card', locale), exact: true })
        .click();
      await expect(history.locator('time').first()).toHaveAttribute(
        'datetime',
        '2026-09-02T12:00:00Z'
      );
      await expect(history).toHaveCSS('direction', locale === 'fa' ? 'rtl' : 'ltr');
      expect(
        (await new AxeBuilder({ page }).include('[data-testid="wallet-page"]').analyze()).violations
      ).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      if (locale === 'fa' && initialStyle === 'persian')
        await page.screenshot({
          path: `/tmp/barghsa-money-components-fa-${testInfo.project.name}.png`,
          fullPage: true,
        });
    });
