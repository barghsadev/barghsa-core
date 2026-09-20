import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';

for (const locale of ['fa', 'en'])
  for (const darkMode of [false, true])
    test(`chargeback warning preserves open exceptions and current access (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
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
            appTitle: 'Finance review',
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
      await page.route('**/api/crm/dashboard/pending-verification', (route) =>
        route.fulfill({ status: 403, json: {} })
      );
      const warning = {
        count: 1,
        unmatchedCount: 1,
        reversalFailedCount: 0,
        items: [
          {
            eventId: 'evt-open',
            status: 'unmatched',
            amountIrR: '150000',
            walletId: null,
            originalTransactionId: null,
            reason: 'provider chargeback',
            createdAt: '2026-09-09T08:00:00Z',
          },
        ],
      };
      let body: unknown = warning;
      let status = 200,
        requests = 0;
      let hold = false;
      let release: (() => void) | undefined;
      await page.route('**/api/admin/wallet/chargebacks/unresolved-warning', async (route) => {
        requests++;
        if (hold)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        await route.fulfill({ status, json: body });
      });
      await page.clock.install();
      await page.goto('/admin');
      const banner = page.getByRole('alert', {
        name: locale === 'fa' ? 'هشدار شارژبک‌های حل‌نشده' : 'Unresolved chargeback warning',
      });
      await expect(banner).toContainText('evt-open');
      await expect(banner.locator('[dir="ltr"]')).toHaveText('evt-open');
      await expect(banner.getByRole('button')).toHaveCount(0);
      const accessibility = await new AxeBuilder({ page })
        .include('#admin-content')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(accessibility.violations).toEqual([]);
      expect(accessibility.incomplete.filter((item) => item.id === 'color-contrast')).toEqual([]);

      await page.clock.pauseAt(new Date());
      status = 503;
      await page.clock.runFor(30000);
      await expect(
        page.getByRole('status').filter({ hasText: locale === 'fa' ? 'شارژبک' : 'chargeback' })
      ).toBeVisible();
      await expect(banner).toContainText('evt-open');
      status = 200;
      for (const invalid of [
        null,
        { ...warning, items: null },
        { ...warning, unmatchedCount: -1 },
        { ...warning, items: [{ ...warning.items[0], amountIrR: 'not-money' }] },
      ]) {
        body = invalid;
        const before = requests;
        await page.clock.runFor(30000);
        await expect.poll(() => requests).toBeGreaterThan(before);
        await expect(banner).toContainText('evt-open');
      }
      body = warning;
      hold = true;
      await page.clock.runFor(30000);
      await expect.poll(() => release !== undefined).toBe(true);
      const held = requests;
      await page.clock.runFor(60000);
      expect(requests).toBe(held);
      status = 403;
      hold = false;
      release!();
      await expect(banner).toHaveCount(0);
      await expect(
        page.getByRole('status').filter({ hasText: locale === 'fa' ? 'شارژبک' : 'chargeback' })
      ).toHaveCount(0);
      status = 200;
      await page.clock.runFor(30000);
      await expect(banner).toContainText('evt-open');
      body = { count: 0, unmatchedCount: 0, reversalFailedCount: 0, items: [] };
      await page.clock.runFor(30000);
      await expect(banner).toHaveCount(0);
    });
