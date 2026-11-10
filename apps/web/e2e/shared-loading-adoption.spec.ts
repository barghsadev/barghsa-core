import { test, expect } from './coverage-fixture';
import { fullNavigation } from './navigation-fixture';
import { crmShell } from './crm-shell-fixture';
import { tSolar } from '@barghsa/i18n/solar';
import { documentText } from '@barghsa/i18n/documents';
import { contractText } from '@barghsa/i18n/contracts';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';
import { t } from '@barghsa/i18n/app';

const profileId = '22222222-2222-4222-8222-222222222222';
for (const locale of ['en', 'fa'] as const) {
  test(`wallet read placeholders expose no invented amount or enabled payment (${locale})`, async ({
    page,
  }, info) => {
    await page.addInitScript(
      (language) => localStorage.setItem('barghsa.locale', language),
      locale
    );
    await page.emulateMedia({
      colorScheme: locale === 'fa' ? 'dark' : 'light',
      reducedMotion: 'reduce',
    });
    await page.setViewportSize({ width: locale === 'fa' ? 390 : 1280, height: 900 });
    const writes: string[] = [];
    await page.route('**/api/**', (route) => {
      const request = route.request();
      // WebKit's screenshot helper injects a transient style and can emit native CSP telemetry.
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === '/api/csp-report' &&
        request.headers()['content-type'] === 'application/csp-report'
      )
        return route.fulfill({ status: 204 });
      if (request.method() !== 'GET') writes.push(request.url());
      return route.fulfill({ status: 404, json: {} });
    });
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'placeholder-owner',
          isStaff: false,
          operatingContext: 'customer',
          requiresTosAcceptance: false,
          navigation: fullNavigation('customer'),
        },
      })
    );
    await page.route('**/api/profiles', (route) =>
      route.fulfill({
        json: {
          activeProfileId: profileId,
          hasDefault: true,
          profiles: [
            { id: profileId, profileType: 'LEGAL', title: 'Read owner', status: 'VERIFIED' },
          ],
        },
      })
    );
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'Asia/Tehran' } })
    );
    await page.route(`**/api/wallet/${profileId}/transactions?*`, (route) =>
      route.fulfill({ json: { transactions: [], nextCursor: null } })
    );
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const amount = '9007199254740993';
    let balanceReads = 0;
    await page.route(`**/api/wallet/${profileId}`, async (route) => {
      expect(route.request().method()).toBe('GET');
      ++balanceReads;
      await held;
      await route.fulfill({
        json: { balance: amount, currency: 'IRR', onlineTopUpLimit: 0, configVersion: 1 },
      });
    });
    try {
      await page.clock.install();
      await page.goto('/wallet');
      const main = page.locator('main[data-area=dashboard]');
      const skeleton = main.getByTestId('wallet-loading');
      await expect(skeleton).toBeVisible();
      await expect(skeleton).toHaveAttribute('aria-hidden', 'true');
      await expect(skeleton.locator('..')).toHaveAttribute('role', 'status');
      await expect(main).not.toContainText(formatCurrencyIrr(amount, locale));
      await expect(main.locator('form')).toHaveCount(0);
      expect(writes).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`wallet-pending-${locale}.png`),
        fullPage: true,
      });
      await expect.poll(() => balanceReads).toBe(1);
      await page.clock.fastForward(15_001);
      await expect(
        main.getByText(t('wallet.page.loadError', locale), { exact: true })
      ).toBeVisible();
      await expect(skeleton).toHaveCount(0);
      await expect(main).not.toContainText(formatCurrencyIrr(amount, locale));
      await expect(main.getByTestId('wallet-submit')).toBeDisabled();
      expect(writes).toEqual([]);
      expect(balanceReads).toBe(1);
      await main.getByRole('button', { name: t('wallet.page.retry', locale), exact: true }).click();
      await expect.poll(() => balanceReads).toBe(2);
      release();
      await expect(skeleton).toHaveCount(0);
      await expect(main).toContainText(formatCurrencyIrr(amount, locale));
      await expect(
        main.getByRole('heading', { name: t('wallet.history.title', locale), exact: true })
      ).toBeVisible();
      expect(writes).toEqual([]);
    } finally {
      release();
    }
  });
}

for (const locale of ['en', 'fa'] as const) {
  const solar = (key: string) => tSolar(key, locale);
  const documents = (key: string) => documentText(key, locale);
  const contracts = (key: string) => contractText(key, locale);
  for (const surface of [
    {
      route: '/admin/solar-postal',
      region: null,
      endpoint: '/api/admin/solar/postal-queue',
      loading: solar('loading'),
      failure: solar('staffQueueLoadError'),
      retry: solar('retry'),
      empty: solar('postalStaffEmpty'),
      response: { requests: [], nextBefore: null },
    },
    {
      route: '/admin/documents',
      region: documents('listTitle'),
      endpoint: '/api/admin/documents',
      loading: documents('loading'),
      failure: documents('listError'),
      retry: documents('retry'),
      empty: documents('empty'),
      response: { documents: [], nextBefore: null },
    },
    {
      route: '/admin/contracts',
      region: contracts('staffTitle'),
      endpoint: '/api/admin/contracts',
      loading: contracts('loading'),
      failure: contracts('error'),
      retry: t('historyPagination.retry', locale),
      empty: contracts('empty'),
      response: { contracts: [], nextBefore: null },
    },
  ]) {
    test(`an owned read times out and recovers only on explicit retry (${surface.route}, ${locale})`, async ({
      page,
    }) => {
      await crmShell(page, locale);
      await page.clock.install();
      let releaseFirst!: () => void;
      const held = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const requests: string[] = [];
      await page.route(
        (url) => url.pathname === surface.endpoint,
        async (route) => {
          requests.push(route.request().method());
          if (requests.length === 1) {
            await held;
            // The already-timed-out transport may have been closed by the browser.
            await route.fulfill({ json: surface.response }).catch(() => {});
          } else {
            await route.fulfill({ json: surface.response });
          }
        }
      );
      try {
        await page.goto(surface.route);
        const main = page.getByRole('main');
        const queue = surface.region
          ? main.getByRole('region', { name: surface.region, exact: true })
          : main;
        const loading = queue.getByText(surface.loading, { exact: true });
        const failure = queue.getByRole('alert').filter({ hasText: surface.failure });
        await expect(loading).toBeVisible();
        await expect(loading.locator('..')).toHaveAttribute('role', 'status');
        await expect.poll(() => requests).toEqual(['GET']);
        await page.clock.fastForward(15_200);
        await expect(failure).toBeVisible();
        await expect(loading).toHaveCount(0);
        expect(requests).toEqual(['GET']);
        releaseFirst();
        await expect(failure).toBeVisible();
        const retrySection = surface.route === '/admin/documents' ? failure : failure.locator('..');
        await retrySection.getByRole('button', { name: surface.retry, exact: true }).click();
        await expect(queue.getByText(surface.empty, { exact: true })).toBeVisible();
        await expect(failure).toHaveCount(0);
        expect(requests).toEqual(['GET', 'GET']);
      } finally {
        releaseFirst();
      }
    });
  }
}
