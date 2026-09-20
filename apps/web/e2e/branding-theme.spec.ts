import AxeBuilder from '@axe-core/playwright';
import { brandingText } from '@barghsa/i18n/branding';
import { test, expect } from './coverage-fixture';

for (const locale of ['fa', 'en'] as const)
  for (const darkMode of [false, true]) {
    test(`branding editor and live preview remain readable (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript((value) => {
        const apply = () => {
          document.documentElement.lang = value;
        };
        if (document.documentElement) apply();
        new MutationObserver(apply).observe(document, { childList: true });
      }, locale);
      const config = {
        appTitle: 'Theme preview',
        slogan: 'Readable slogan',
        primaryColor: '#ffffff',
        secondaryColor: '#777777',
        accentColor: '#f59e0b',
        logoUrl: null,
        faviconUrl: null,
        darkMode,
      };
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/auth/user', (route) =>
        route.fulfill({ json: { userId: 'owner', requiresTosAcceptance: false } })
      );
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'Asia/Tehran' } })
      );
      await page.route('**/api/public/branding/config', (route) => route.fulfill({ json: config }));
      await page.route('**/api/admin/branding/config', (route) =>
        route.fulfill({
          json: {
            id: '11111111-1111-4111-8111-111111111111',
            config,
            version: 1,
            status: 'active',
            createdBy: 'system',
            createdAt: '2026-09-01T00:00:00Z',
            updatedAt: '2026-09-01T00:00:00Z',
          },
        })
      );
      await page.goto('/admin/branding');
      await expect(
        page.getByRole('textbox', { name: brandingText('appTitle', locale), exact: true })
      ).toHaveValue(config.appTitle);
      const preview = page.locator('section').filter({
        has: page.getByRole('heading', { name: brandingText('preview', locale), exact: true }),
      });
      const scan = async () => {
        const violations = (await new AxeBuilder({ page }).withRules(['color-contrast']).analyze())
          .violations;
        expect
          .soft(
            violations.map((v) => ({
              id: v.id,
              nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
            }))
          )
          .toEqual([]);
      };
      await scan();
      expect
        .soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page
        .getByRole('textbox', {
          name: brandingText('hex', locale).replace('{label}', brandingText('primary', locale)),
          exact: true,
        })
        .fill('#777777');
      await expect(
        preview.getByRole('button', { name: brandingText('primary', locale), exact: true })
      ).toHaveCSS('background-color', 'rgb(119, 119, 119)');
      await scan();
      // Preview follows the draft without changing the active application theme.
      const toggle = page.getByRole('checkbox', {
        name: brandingText('darkMode', locale),
        exact: true,
      });
      await toggle.focus();
      await toggle.press('Space');
      await expect(toggle).toBeChecked({ checked: !darkMode });
      await expect(page.locator('html')).toHaveClass(darkMode ? /dark/ : /^(?!.*\bdark\b)/);
      await scan();
      await preview.screenshot({ path: `/tmp/r03-branding-preview-${locale}-${darkMode}.png` });
      await page.screenshot({
        path: `/tmp/r03-branding-${locale}-${darkMode}.png`,
        fullPage: true,
      });
    });
  }
