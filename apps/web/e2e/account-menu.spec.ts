import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { shellText } from '@barghsa/i18n/shell';
import { t } from '@barghsa/i18n/app';

for (const locale of ['en', 'fa'] as const) {
  for (const area of ['customer', 'staff'] as const) {
    test(`account menu keeps the header usable and completes account actions (${area}, ${locale})`, async ({
      page,
    }, testInfo) => {
      await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
      let authenticated = true;
      let accountUsername = 'Ari Example';
      let logoutStatus = 503;
      let logoutReads = 0;
      let mode: 'dark' | 'light' | null = 'dark';
      const themeWrites: unknown[] = [];
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/auth/user', (route) =>
        authenticated
          ? route.fulfill({
              json: {
                userId: 'account-owner',
                username: accountUsername,
                email: 'ari@example.test',
                mobile: '+989121234567',
                isStaff: area === 'staff',
                operatingContext: area === 'staff' ? 'staff' : 'customer',
                canSwitchContext: area === 'staff',
                requiresTosAcceptance: false,
              },
            })
          : route.fulfill({ status: 401, json: {} })
      );
      await page.route('**/api/user/settings/theme', (route) => {
        if (route.request().method() === 'PUT') {
          mode = route.request().postDataJSON().mode;
          themeWrites.push(mode);
        }
        return route.fulfill({ json: { mode } });
      });
      await page.route('**/api/user/settings/notifications', (route) =>
        route.fulfill({ json: { channels: ['IN_APP'], availableChannels: ['IN_APP'] } })
      );
      await page.route('**/api/user/settings/marketing-consent', (route) =>
        route.fulfill({
          json: {
            channels: {
              email: { optedIn: false, lastChangedAt: null },
              sms: { optedIn: false, lastChangedAt: null },
            },
          },
        })
      );
      await page.route('**/api/auth/logout', (route) => {
        logoutReads++;
        expect(route.request().method()).toBe('POST');
        expect(route.request().headers()['x-csrf-token']).toBe('menu-csrf');
        if (logoutStatus === 200) authenticated = false;
        return route.fulfill({
          status: logoutStatus,
          json: {
            message: logoutStatus === 200 ? 'Logged out successfully.' : 'Temporary failure',
          },
        });
      });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/app');
      await page.evaluate(() => {
        document.cookie = 'barghsa_csrf=menu-csrf; path=/';
      });
      // The mobile preference stays mounted in the closed popup, so saved theme applies at entry.
      await expect(page.locator('html')).toHaveClass(/dark/);
      const menu = page.getByRole('button', {
        name: shellText('accountMenu', locale),
        exact: true,
      });
      const header = page.getByRole('banner');
      for (const width of [320, 375, 390, 414, 768, 1024, 1280, 1920]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect(menu).toBeVisible();
        const controls = header.locator('a:visible, button:visible, select:visible');
        const boxes = await controls.evaluateAll((elements) =>
          elements.map((element) => {
            const box = element.getBoundingClientRect();
            return {
              x: box.x,
              right: box.right,
              y: box.y,
              bottom: box.bottom,
              width: box.width,
              height: box.height,
            };
          })
        );
        for (const box of boxes) {
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(width);
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        ).toBe(true);
        if (width < 1024) {
          await expect(
            header.getByRole('combobox', { name: shellText('theme', locale) })
          ).toHaveCount(0);
          await expect(
            header.getByRole('button', { name: shellText('language', locale) })
          ).toHaveCount(0);
        } else {
          await expect(
            header.getByRole('combobox', { name: shellText('theme', locale) })
          ).toBeVisible();
          await expect(
            header.getByRole('button', { name: shellText('language', locale) })
          ).toBeVisible();
        }
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await menu.focus();
      await menu.press('Enter');
      const popup = page.locator('[data-slot="popover-content"]');
      await expect(
        page.getByRole('dialog', { name: shellText('account', locale), exact: true })
      ).toBeVisible();
      await expect(popup).toContainText('Ari Example');
      await expect(popup).toContainText('ari@example.test');
      await expect(popup).toContainText('+989121234567');
      await expect(
        popup.getByRole('link', { name: shellText('myProfile', locale) })
      ).toHaveAttribute('href', area === 'staff' ? '/settings/username' : '/settings/profile');
      await expect(
        popup.getByRole('button', { name: shellText('switchToStaff', locale) })
      ).toHaveCount(0);
      await expect(
        popup.getByRole('button', { name: shellText('switchToCustomer', locale) })
      ).toHaveCount(area === 'staff' ? 1 : 0);
      const theme = popup.getByRole('combobox', { name: shellText('theme', locale) });
      await expect(theme).toBeEnabled();
      await theme.selectOption('light');
      await expect(page.locator('html')).not.toHaveClass(/dark/);
      expect(themeWrites).toEqual(['light']);
      expect(
        (await new AxeBuilder({ page }).include('[data-slot="popover-content"]').analyze())
          .violations
      ).toEqual([]);
      await popup.press('Escape');
      await expect(popup).toBeHidden();
      await expect(menu).toBeFocused();
      await expect(page.locator('html')).not.toHaveClass(/dark/);
      accountUsername = 'Updated Account';
      await menu.click();
      await expect(popup).toContainText(accountUsername);
      await popup.getByRole('button', { name: shellText('language', locale) }).click();
      const other = locale === 'en' ? 'fa' : 'en';
      await expect(page.locator('html')).toHaveAttribute('lang', other);
      await popup.getByRole('button', { name: shellText('language', other) }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await page.screenshot({
        path: `/tmp/barghsa-account-menu-${area}-${locale}-${testInfo.project.name}.png`,
        fullPage: true,
      });
      await popup.getByRole('link', { name: shellText('settings', locale) }).click();
      await expect(page).toHaveURL(/\/settings\/?$/);
      await expect(
        page.getByRole('heading', { name: t('dashboard.nav.settings', locale), exact: true })
      ).toBeVisible();
      if (area === 'staff') {
        await expect(page.locator('#admin-navigation')).toBeAttached();
        await expect(page.getByRole('main').locator('a[href="/settings/profile"]')).toHaveCount(0);
        await expect(page.getByRole('main').locator('a[href="/settings/addresses"]')).toHaveCount(
          0
        );
        await page.goto('/wallet');
        await expect(page).toHaveURL(/\/app$/);
      }
      await menu.click();
      await popup.getByRole('button', { name: shellText('logout', locale), exact: true }).click();
      await expect(popup.getByRole('alert')).toContainText(shellText('logoutError', locale));
      expect(logoutReads).toBe(1);
      await expect(menu).toBeVisible();
      logoutStatus = 200;
      await popup.getByRole('button', { name: shellText('logout', locale), exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);
      expect(logoutReads).toBe(2);
      await page.goto('/app');
      await expect(page).toHaveURL(/\/login$/);
    });
  }
}
