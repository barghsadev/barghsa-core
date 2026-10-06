import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { dashboardText } from '@barghsa/i18n/dashboard';
import { t } from '@barghsa/i18n/app';
import { tSaving } from '@barghsa/i18n/saving';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';

const profileId = '74000000-0000-4000-8000-000000000001';
for (const locale of ['en', 'fa'] as const) {
  test(`dashboard widgets load and retry independently without moving the grid (${locale})`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({ json: { userId: 'customer', isStaff: false, requiresTosAcceptance: false } })
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
    await page.route('**/api/dashboard/context', (route) =>
      route.fulfill({
        json: {
          profile: { id: profileId, name: 'Ari Buyer' },
          access: { wallet: true, invoices: true, orders: true, contracts: true },
        },
      })
    );
    const reads: Record<string, number> = {};
    let failOrders = true;
    let releaseInvoices!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseInvoices = resolve;
    });
    await page.route('**/api/dashboard/widgets/**', async (route) => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get('profileId')).toBe(profileId);
      const widget = url.pathname.split('/').at(-1)!;
      reads[widget] = (reads[widget] ?? 0) + 1;
      if (widget === 'orders' && failOrders) return route.fulfill({ status: 503, json: {} });
      if (widget === 'invoices') await held;
      const data =
        widget === 'wallet'
          ? {
              balance: '9007199254740993',
              postedBalance: '9007199254740993',
              reservedBalance: '0',
              currency: 'IRR',
              lowBalanceWarning: false,
              pendingInvoices: 0,
            }
          : widget === 'status'
            ? { activeContracts: 0, pendingOrders: 0, openTickets: 0, unpaidInvoices: 0 }
            : [];
      return route.fulfill({ json: { profileId, data } });
    });
    try {
      await page.goto('/app');
      const orders = page.getByRole('region', { name: dashboardText('orders.title', locale) });
      const invoices = page.getByRole('region', { name: dashboardText('invoice.title', locale) });
      const wallet = page.getByRole('region', {
        name: t('dashboard.overview.walletBalance', locale),
      });
      await expect(orders.getByRole('alert')).toBeVisible();
      await expect(invoices.getByRole('status')).toBeVisible();
      await expect(
        wallet.getByText(formatCurrencyIrr('9007199254740993', locale), { exact: true }).first()
      ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const position = (element: Element) => {
        const box = element.getBoundingClientRect();
        const grid = element.parentElement!.getBoundingClientRect();
        return {
          x: box.x - grid.x,
          y: box.y - grid.y,
          width: box.width,
          height: box.height,
        };
      };
      const before = await orders.evaluate(position);
      const invoiceBefore = await invoices.evaluate(position);
      const previousReads = { ...reads };
      failOrders = false;
      await orders.getByRole('button', { name: dashboardText('widget.retry', locale) }).click();
      await expect(orders.getByText(dashboardText('orders.empty', locale))).toBeVisible();
      expect(reads.orders).toBe(previousReads.orders! + 1);
      for (const widget of ['wallet', 'status', 'invoices', 'contracts'])
        expect(reads[widget]).toBe(previousReads[widget]);
      releaseInvoices();
      await expect(invoices.getByText(dashboardText('invoice.empty', locale))).toBeVisible();
      const after = await orders.evaluate(position);
      const invoiceAfter = await invoices.evaluate(position);
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        expect(after[key]).toBeCloseTo(before[key], 2);
        expect(invoiceAfter[key]).toBeCloseTo(invoiceBefore[key], 2);
      }
      await expect(orders).toHaveCSS('direction', locale === 'fa' ? 'rtl' : 'ltr');
      const statusCards = page.getByRole('region', { name: dashboardText('status.title', locale) });
      for (const [label, pathname, parameters] of [
        [t('dashboard.overview.contractStatus', locale), '/contracts', { state: 'Active' }],
        [
          t('dashboard.overview.openTickets', locale),
          '/tickets',
          { status: 'active', scope: 'active' },
        ],
        [t('dashboard.overview.pendingInvoices', locale), '/invoices', { status: 'unpaid' }],
        [t('electricity.orders.title', locale), '/electricity/orders', { status: 'pending' }],
        [tSaving('orders', locale), '/savings/orders', { status: 'pending' }],
      ] as const) {
        const href = await statusCards.getByRole('link', { name: label }).getAttribute('href');
        const target = new URL(href!, 'https://dashboard.test');
        expect(target.pathname).toBe(pathname);
        expect(Object.fromEntries(target.searchParams)).toEqual(parameters);
      }
      for (const [width, columns] of [
        [390, 1],
        [900, 2],
        [1440, 3],
      ] as const) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            )
        );
        const count = await wallet.evaluate(
          (card) => getComputedStyle(card.parentElement!).gridTemplateColumns.split(' ').length
        );
        expect(count).toBe(columns);
        const summary = page.getByRole('region', { name: dashboardText('status.title', locale) });
        expect(
          await summary
            .locator('[data-slot="card-content"]')
            .evaluate((body) => body.scrollHeight <= body.clientHeight)
        ).toBe(true);
        const overflow = await page.evaluate(() => {
          if (document.documentElement.scrollWidth <= innerWidth) return [];
          return [...document.querySelectorAll('body *')].flatMap((element) => {
            const box = element.getBoundingClientRect();
            if (box.width && (box.right > innerWidth + 1 || box.left < -1))
              return [
                {
                  tag: element.tagName,
                  slot: element.getAttribute('data-slot'),
                  className: element.className,
                  text: element.textContent?.slice(0, 90),
                  left: box.left,
                  right: box.right,
                  width: box.width,
                },
              ];
            return [];
          });
        });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          `Dashboard overflow at ${width}px (${locale}): ${JSON.stringify(overflow)}`
        ).toBe(true);
      }
      const accessibility = await new AxeBuilder({ page }).include('main').analyze();
      expect(accessibility.violations).toEqual([]);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('main').evaluate((main) => {
        main.scrollTop = 0;
      });
      await page.screenshot({
        path: `/tmp/barghsa-dashboard-framework-${locale}-${testInfo.project.name}.png`,
        fullPage: true,
      });
    } finally {
      releaseInvoices();
    }
  });
}
