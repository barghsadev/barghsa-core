import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';
import { fullNavigation } from './navigation-fixture';
import { shellText } from '@barghsa/i18n/shell';
import { contractText } from '@barghsa/i18n/contracts';
import { feedbackText } from '@barghsa/i18n/feedback';
import type { NavigationConfiguration } from '../src/lib/navigation-config.js';

async function shell(
  page: Page,
  area: 'staff' | 'customer',
  locale: 'en' | 'fa',
  read: () => unknown
) {
  await page.addInitScript((language) => localStorage.setItem('barghsa.locale', language), locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'viewer',
        isStaff: true,
        operatingContext: area,
        canSwitchContext: false,
        requiresTosAcceptance: false,
        navigation: read(),
      },
    })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [{ id: 'profile-1', profileType: 'LEGAL', isDefault: true, status: 'ACTIVE' }],
        activeProfileId: 'profile-1',
        hasDefault: true,
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/invoices{,?*}', (route) => route.fulfill({ json: { invoices: [] } }));
  await page.route('**/api/contracts{,?*}', (route) =>
    route.fulfill({ json: { contracts: [], nextBefore: null } })
  );
}

for (const locale of ['en', 'fa'] as const) {
  test(`customer menu follows backend Finance and Legal grants even when the account is staff eligible (${locale})`, async ({
    page,
  }) => {
    let configuration: NavigationConfiguration = {
      ...fullNavigation('customer', 'LEGAL'),
      paths: ['/app', '/wallet', '/invoices', '/settings'],
    };
    await shell(page, 'customer', locale, () => configuration);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/invoices');
    const quick = page.getByRole('navigation', { name: shellText('quickNavigation', locale) });
    await expect(quick.getByRole('link')).toHaveCount(4);
    await expect(quick.locator('a[href="/invoices"]')).toHaveAttribute('aria-current', 'page');
    const aside = page.locator('#dashboard-navigation');
    await expect(aside.locator('a[href="/admin/roles"]')).toHaveCount(0);
    await expect(aside.locator('a[href="/contracts"]')).toHaveCount(0);
    await expect(aside.locator('a[href="/settings/team"]')).toHaveCount(0);
    configuration = {
      ...configuration,
      paths: ['/app', '/contracts', '/settings/profile', '/tickets', '/settings'],
    };
    await quick.locator('a[href="/settings"]').click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(aside.locator('a[href="/wallet"]')).toHaveCount(0);
    await expect(aside.locator('a[href="/invoices"]')).toHaveCount(0);
    await expect(aside.locator('a[href="/contracts"]')).toHaveCount(1);
    await page.getByRole('button', { name: shellText('menu', locale), exact: true }).click();
    await expect(aside.locator('a[href="/settings/profile"]')).toHaveText(
      shellText('legalProfile', locale)
    );
    expect(
      (await new AxeBuilder({ page }).include('#dashboard-navigation').analyze()).violations
    ).toEqual([]);
  });
  test(`a restricted staff menu uses its granted pages and spreads three mobile links across the bar (${locale})`, async ({
    page,
  }) => {
    let configuration = {
      ...fullNavigation('staff'),
      paths: ['/app', '/admin/inbox', '/admin/tickets'],
    };
    await shell(page, 'staff', locale, () => configuration);
    await page.route('**/api/staff/tickets?*', (route) => route.fulfill({ json: [] }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/tickets');
    const quick = page.getByRole('navigation', { name: shellText('quickNavigation', locale) });
    await expect(quick.getByRole('link')).toHaveCount(3);
    const widths = await quick
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getBoundingClientRect().width));
    for (const width of widths) expect(width).toBeCloseTo(130, 0);
    const aside = page.locator('#admin-navigation');
    await expect(aside.locator('a[href="/admin/roles"]')).toHaveCount(0);
    await expect(aside.locator('a[href="/admin/crm"]')).toHaveCount(0);
    configuration = fullNavigation('staff');
    await quick.locator('a[href="/app"]').click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(aside.locator('a[href="/admin/roles"]')).toHaveCount(1);
    await expect(aside.locator('a[href="/admin/crm"]')).toHaveCount(1);
    await page.setViewportSize({ width: 1280, height: 844 });
    await expect(aside).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).include('#admin-navigation').analyze()).violations
    ).toEqual([]);
  });
}

test('missing or changed-workspace navigation never falls back to broad links and refresh restores verified access', async ({
  page,
}) => {
  let configuration: unknown;
  let reads = 0;
  await shell(page, 'customer', 'en', () => {
    reads++;
    return configuration;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/invoices');
  const aside = page.locator('#dashboard-navigation');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(aside.getByRole('status')).toContainText('Page navigation could not be verified.');
  await expect(
    aside.getByRole('navigation', { name: 'Main navigation' }).getByRole('link')
  ).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Quick navigation' })).toHaveCount(0);
  const readsBeforeRefresh = reads;
  configuration = fullNavigation('staff');
  await aside.getByRole('button', { name: 'Refresh navigation', exact: true }).click();
  await expect.poll(() => reads).toBeGreaterThan(1);
  await expect.poll(() => reads).toBeGreaterThan(readsBeforeRefresh);
  await expect(
    aside.getByRole('navigation', { name: 'Main navigation' }).getByRole('link')
  ).toHaveCount(0);
  configuration = fullNavigation('customer', 'LEGAL');
  await aside.getByRole('button', { name: 'Refresh navigation', exact: true }).click();
  await expect(aside.locator('a[href="/wallet"]')).toHaveCount(1);
  await expect(aside.getByRole('status')).toHaveCount(0);
  await expect(page).toHaveURL(/\/invoices$/);
});

test('contract detail downloads only after selection and a failed download preserves the list and URL filters', async ({
  page,
}) => {
  await shell(page, 'staff', 'en', () => fullNavigation('staff'));
  await page.route('**/api/staff/contracts{,?*}', (route) =>
    route.fulfill({ json: { contracts: [], nextBefore: null } })
  );
  const dist = process.env['BARGHSA_BROWSER_COVERAGE'] === '1' ? 'dist-coverage' : 'dist';
  const manifest = JSON.parse(readFileSync(resolve(dist, '.vite/manifest.json'), 'utf8'));
  const chunk = manifest['src/components/ContractDetail.tsx'];
  expect(chunk?.file).toBeTruthy();
  let downloads = 0;
  await page.route(`**/${chunk.file}`, (route) => {
    downloads++;
    return route.abort('failed');
  });
  await page.goto('/admin/contracts?contractNumber=12345');
  await expect(
    page.getByRole('heading', { name: contractText('staffTitle', 'en'), exact: true })
  ).toBeVisible();
  expect(downloads).toBe(0);
  await page.goto(
    '/admin/contracts?contractNumber=12345&contractId=01900000-0000-7000-8000-000000000123'
  );
  const recovery = page.getByRole('alert').filter({ hasText: feedbackText('chunkTitle', 'en') });
  await expect(recovery).toBeVisible();
  expect(downloads).toBe(1);
  await recovery.getByRole('button', { name: contractText('close', 'en'), exact: true }).click();
  await expect(recovery).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.has('contractId')).toBe(false);
  expect(JSON.parse(new URL(page.url()).searchParams.get('contractNumber')!)).toBe('12345');
  await expect(
    page.getByRole('textbox', { name: contractText('contractNumber', 'en'), exact: true })
  ).toHaveValue('12345');
  await expect(
    page.getByRole('heading', { name: contractText('staffTitle', 'en'), exact: true })
  ).toBeVisible();
});
