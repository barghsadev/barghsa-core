import { fullNavigation } from './navigation-fixture';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { shellText } from '@barghsa/i18n/shell';
import { t } from '@barghsa/i18n/app';
import { test, expect, type Page } from './coverage-fixture';
import { fulfillDashboard } from './dashboard-fixture';
import { brandSettings } from '../src/test/branding-settings-fixtures';
import { measureControlContrast } from './control-contrast';

async function setup(page: Page, locale: 'en' | 'fa', area: 'customer' | 'admin') {
  await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'viewer',
        isStaff: area === 'admin',
        navigation: fullNavigation(area === 'admin' ? 'staff' : 'customer'),
        operatingContext: area === 'admin' ? 'staff' : 'profile',
        requiresTosAcceptance: false,
      },
    })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [
          {
            id: '01900000-0000-7000-8000-000000000001',
            profileType: 'INDIVIDUAL',
            isDefault: true,
            status: 'ACTIVE',
            title: null,
            nationalId: null,
            firstName: 'Ari',
            lastName: 'Buyer',
          },
        ],
        hasDefault: true,
        activeProfileId: '01900000-0000-7000-8000-000000000001',
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/dashboard{,/**}', (route) =>
    fulfillDashboard(route, {
      json: {
        profile: { id: '01900000-0000-7000-8000-000000000001', name: 'Ari Buyer' },
        access: { wallet: true, invoices: true },
        wallet: { balance: '1234500', currency: 'IRR' },
        pendingInvoices: 2,
      },
    })
  );
  await page.route('**/api/invoices{,?*}', (route) => route.fulfill({ json: { invoices: [] } }));
  await page.route('**/api/ai/knowledge/availability', (route) =>
    route.fulfill({
      json: {
        available: area === 'customer',
        profileId: '01900000-0000-7000-8000-000000000001',
        profileName: 'Ari Buyer',
        slotKey: 'individual_chatbot',
      },
    })
  );
  await page.route('**/api/admin/failed-notifications/access', (route) =>
    route.fulfill({ json: { canView: true, canRetry: false } })
  );
  await page.route('**/api/admin/failed-notifications?*', (route) => route.fulfill({ json: [] }));
}

for (const locale of ['en', 'fa'] as const)
  for (const area of ['customer', 'admin'] as const) {
    const copy = (key: Parameters<typeof shellText>[0]) => shellText(key, locale);
    test(`${area}, ${locale}: quick tabs, More navigation and breadcrumbs work across phone, tablet and desktop`, async ({
      page,
    }, info) => {
      await setup(page, locale, area);
      await page.setViewportSize({ width: 390, height: 844 });
      const dist = process.env['BARGHSA_BROWSER_COVERAGE'] === '1' ? 'dist-coverage' : 'dist';
      const manifest = JSON.parse(readFileSync(resolve(dist, '.vite/manifest.json'), 'utf8'));
      const sheetPath = '/' + manifest['src/components/MobileNavigationSheet.tsx'].file;
      let sheetRequests = 0;
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === sheetPath) sheetRequests++;
      });
      await page.goto(area === 'customer' ? '/invoices' : '/admin/failed-notifications');
      const quick = page.getByRole('navigation', { name: copy('quickNavigation') });
      await expect(quick.getByRole('link')).toHaveCount(4);
      const more = quick.getByRole('button', { name: copy('more'), exact: true });
      const selected = more;
      if (area === 'customer') {
        await expect(quick.locator('a[href="/settings/profile"]')).toBeVisible();
        await expect(quick.locator('a[href="/wallet"]')).toBeVisible();
      }
      await expect(selected).toHaveAttribute('aria-current', 'page');
      const barBox = await quick.boundingBox();
      const content = page.locator(
        area === 'customer' ? 'main[data-area=dashboard]' : 'main[data-area=admin]'
      );
      const contentBox = await content.boundingBox();
      expect(contentBox!.y + contentBox!.height).toBeLessThanOrEqual(barBox!.y + 1);
      if (area === 'customer') {
        const guideBox = await page
          .getByRole('button', { name: t('assistant.open', locale), exact: true })
          .boundingBox();
        expect(guideBox!.y + guideBox!.height).toBeLessThan(barBox!.y);
      }
      expect(sheetRequests).toBe(0);
      await more.focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => sheetRequests).toBe(1);
      const dialog = page.getByRole('dialog', { name: copy('more'), exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute('data-side', locale === 'fa' ? 'right' : 'left');
      const otherPages = dialog.getByRole('navigation', { name: copy('moreNavigation') });
      const target = otherPages.locator(
        `a[href="${area === 'customer' ? '/contracts' : '/admin/contracts'}"]`
      );
      await expect(target).toBeVisible();
      await expect(dialog).toHaveCSS('opacity', '1');
      await expect(dialog).toHaveCSS('transition-property', 'opacity, transform, translate');
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(page.locator('html')).toHaveClass(/dark/);
      expect(await measureControlContrast(target, 'text')).toBeGreaterThanOrEqual(4.5);
      await page.emulateMedia({ colorScheme: 'light' });
      await expect(page.locator('html')).not.toHaveClass(/dark/);
      expect(
        (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations
      ).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(more).toBeFocused();
      await more.click();
      await target.click();
      await expect(page).toHaveURL(
        new RegExp(area === 'customer' ? '/contracts$' : '/admin/contracts$')
      );
      await expect(dialog).toBeHidden();
      await expect(more).toHaveAttribute('aria-current', 'page');
      const breadcrumbs = page.getByRole('navigation', { name: copy('breadcrumbs') });
      await expect(breadcrumbs.locator('[aria-current="page"]:visible')).toHaveCount(1);
      await breadcrumbs.getByLabel(copy('parentPages')).click();
      await expect(
        breadcrumbs.getByRole('link', {
          name: copy('backToPage').replace(
            '{page}',
            copy(area === 'customer' ? 'workspace' : 'administration')
          ),
        })
      ).toBeVisible();
      await breadcrumbs.getByRole('link').focus();
      await page.keyboard.press('Escape');
      await expect(breadcrumbs.getByLabel(copy('parentPages'))).toBeFocused();
      await breadcrumbs.getByLabel(copy('parentPages')).press('Enter');
      await expect(breadcrumbs.getByRole('link')).toBeVisible();
      expect(
        (
          await new AxeBuilder({ page })
            .include('nav[aria-label="' + copy('breadcrumbs') + '"]')
            .analyze()
        ).violations
      ).toEqual([]);
      await breadcrumbs.getByLabel(copy('parentPages')).press('Escape');
      await expect(breadcrumbs.getByLabel(copy('parentPages'))).toBeFocused();
      await page.setViewportSize({ width: 900, height: 820 });
      await expect(quick).toBeVisible();
      const rail = page.locator(
        area === 'customer' ? '#dashboard-navigation' : '#admin-navigation'
      );
      await page.mouse.move(450, 400);
      await expect(rail).toBeVisible();
      await expect.poll(async () => (await rail.boundingBox())!.width).toBe(60);
      const railTarget = (await rail.getByRole('link').first().boundingBox())!;
      expect(railTarget.width).toBeGreaterThanOrEqual(44);
      expect(railTarget.height).toBeGreaterThanOrEqual(44);
      const menu = page.getByRole('button', { name: copy('menu'), exact: true });
      await menu.click();
      await expect(menu).toHaveAttribute('aria-expanded', 'true');
      await expect.poll(async () => (await rail.boundingBox())!.width).toBeGreaterThan(60);
      await menu.click();
      await page.mouse.move(450, 400);
      await expect.poll(async () => (await rail.boundingBox())!.width).toBe(60);
      if (await page.evaluate(() => matchMedia('(hover: hover)').matches)) {
        await rail.hover();
        await expect.poll(async () => (await rail.boundingBox())!.width).toBeGreaterThan(60);
        await page.mouse.move(450, 400);
      }
      await rail.getByRole('link').first().focus();
      await expect.poll(async () => (await rail.boundingBox())!.width).toBeGreaterThan(60);
      await breadcrumbs.getByLabel(copy('parentPages')).focus();
      await more.click();
      await expect(dialog).toBeVisible();
      await page.setViewportSize({ width: 1280, height: 820 });
      await expect(dialog).toBeHidden();
      await expect(quick).toBeHidden();
      await expect(
        page.locator(area === 'customer' ? '#dashboard-navigation' : '#admin-navigation')
      ).toBeVisible();
      await expect(breadcrumbs.getByLabel(copy('parentPages'))).toBeHidden();
      await expect(breadcrumbs.getByRole('link')).toHaveCount(1);
      await page.screenshot({ path: info.outputPath(`navigation-${area}-${locale}-desktop.png`) });
      for (const width of [320, 375, 390, 414, 768, 1024, 1280, 1920]) {
        await page.setViewportSize({ width, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        );
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goBack();
      await expect(selected).toHaveAttribute('aria-current', 'page');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await page.screenshot({ path: info.outputPath(`navigation-${area}-${locale}.png`) });
    });
  }

for (const locale of ['en', 'fa'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`scrollable admin navigation stays readable on a custom canvas (${locale}, ${theme})`, async ({
      page,
    }, info) => {
      await setup(page, locale, 'admin');
      await page.setViewportSize({ width: 1280, height: 640 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            ...brandSettings,
            themeMode: theme,
            darkMode: theme === 'dark',
            backgroundColor: '#999999',
            darkBackgroundColor: '#6b6b6b',
          },
        })
      );
      await page.goto('/admin/maintenance');
      await expect(page.locator('html')).toHaveCSS('--brand-light-background', '#999999');
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
      await expect(page.getByTestId('admin-settings-layout').locator('nav')).toHaveCount(0);
      const sidebar = page.locator('#admin-navigation').getByRole('navigation');
      await expect(sidebar).toBeVisible();
      const rows = [];
      for (const high of [false, true]) {
        await page.locator('html').evaluate((node, high) => {
          if (high) node.dataset.contrast = 'more';
          else delete node.dataset.contrast;
        }, high);
        await page.mouse.move(640, 1);
        const entries = await sidebar
          .locator('a.shell-navigation-link, p.text-muted-foreground')
          .all();
        expect(entries.length).toBeGreaterThan(10);
        for (const entry of entries) {
          await entry.scrollIntoViewIfNeeded();
          const label = (await entry.textContent())?.trim();
          const ratio = await measureControlContrast(entry, 'text');
          rows.push({ surface: 'workspace', high, label, ratio });
          expect
            .soft(ratio, `workspace ${label} with high contrast=${high}`)
            .toBeGreaterThanOrEqual(4.5);
        }
        const link = sidebar.locator('a.shell-navigation-link:not([aria-current])').first();
        await link.hover();
        const ratio = await measureControlContrast(link, 'text');
        rows.push({ surface: 'workspace', high, hovered: true, ratio });
        expect
          .soft(ratio, `workspace hover with high contrast=${high}`)
          .toBeGreaterThanOrEqual(4.5);
        await page.mouse.move(640, 1);
      }
      await info.attach('scrollable-navigation-contrast', {
        body: JSON.stringify({ locale, theme, rows }),
        contentType: 'application/json',
      });
    });
  }
}

test('record breadcrumbs never display raw record IDs and return to the actual invoice list', async ({
  page,
}) => {
  await setup(page, 'en', 'customer');
  await page.setViewportSize({ width: 390, height: 844 });
  const id = '01900000-0000-7000-8000-000000000123';
  await page.goto(`/invoices/${id}`);
  const breadcrumbs = page.getByRole('navigation', { name: 'Page path' });
  await expect(breadcrumbs.locator('[aria-current="page"]:visible')).toHaveText('Details');
  await expect(breadcrumbs).not.toContainText(id);
  await breadcrumbs.getByLabel('Parent pages').click();
  await breadcrumbs.getByRole('link', { name: 'Back to Invoices', exact: true }).click();
  await expect(page).toHaveURL(/\/invoices$/);
  await expect(breadcrumbs.locator('[aria-current="page"]:visible')).toHaveText('Invoices');
});

test('a failed More chunk preserves the page and opens the existing navigation menu', async ({
  page,
}) => {
  await setup(page, 'en', 'customer');
  await page.setViewportSize({ width: 390, height: 844 });
  const dist = process.env['BARGHSA_BROWSER_COVERAGE'] === '1' ? 'dist-coverage' : 'dist';
  const manifest = JSON.parse(readFileSync(resolve(dist, '.vite/manifest.json'), 'utf8'));
  const chunk = manifest['src/components/MobileNavigationSheet.tsx'];
  expect(chunk?.file).toBeTruthy();
  await page.route(`**/${chunk.file}`, (route) => route.abort('failed'));
  await page.goto('/invoices');
  await page
    .getByRole('navigation', { name: 'Quick navigation' })
    .getByRole('button', { name: 'More', exact: true })
    .click();
  const recovery = page.getByRole('alert').filter({ hasText: 'Navigation did not load.' });
  await expect(recovery).toBeVisible();
  await recovery.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.locator('#dashboard-navigation')).toBeVisible();
  await expect(page.locator('#dashboard-navigation a[href="/contracts"]')).toBeVisible();
  await expect(page).toHaveURL(/\/invoices$/);
});

test('a failed mobile-bar chunk retains the page and gives access to the original menu', async ({
  page,
}) => {
  await setup(page, 'en', 'customer');
  await page.setViewportSize({ width: 390, height: 844 });
  const dist = process.env['BARGHSA_BROWSER_COVERAGE'] === '1' ? 'dist-coverage' : 'dist';
  const manifest = JSON.parse(readFileSync(resolve(dist, '.vite/manifest.json'), 'utf8'));
  const chunk = manifest['src/components/BottomTabBar.tsx'];
  expect(chunk?.file).toBeTruthy();
  await page.route(`**/${chunk.file}`, (route) => route.abort('failed'));
  await page.goto('/invoices');
  const fallback = page.getByRole('region', { name: 'Quick navigation' });
  await expect(fallback.getByRole('alert')).toContainText('Navigation did not load.');
  await fallback.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.locator('#dashboard-navigation a[href="/contracts"]')).toBeVisible();
  await expect(page).toHaveURL(/\/invoices$/);
});
