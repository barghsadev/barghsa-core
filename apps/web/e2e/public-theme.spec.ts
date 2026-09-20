import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';

for (const locale of ['fa', 'en'] as const) {
  for (const darkMode of [false, true]) {
    test(`public links remain readable with a white brand (${locale}, dark=${darkMode})`, async ({
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
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            appTitle: 'Theme checks',
            slogan: '',
            primaryColor: '#ffffff',
            secondaryColor: '#64748b',
            accentColor: '#f59e0b',
            logoUrl: null,
            faviconUrl: null,
            darkMode,
          },
        })
      );
      await page.route('**/api/tos/current?*', (route) =>
        route.fulfill({
          json: {
            id: '00000000-0000-4000-8000-000000000001',
            versionId: 'v1',
            content: locale === 'fa' ? 'متن شرایط' : 'Terms content',
            updatedAt: '2026-09-01T00:00:00Z',
            publishedAt: '2026-09-01T00:00:00Z',
          },
        })
      );
      for (const path of ['/register', '/forgot-password', '/activate', `/terms?lang=${locale}`]) {
        await page.goto(path);
        await expect
          .poll(() => page.locator('html').evaluate((e) => e.style.getPropertyValue('--primary')))
          .toBe('#ffffff');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        const violations = (await new AxeBuilder({ page }).withRules(['color-contrast']).analyze())
          .violations;
        expect
          .soft(
            violations.map((v) => ({
              id: v.id,
              nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
            })),
            path
          )
          .toEqual([]);
        const links = page.getByRole('link');
        for (let index = 0; index < (await links.count()); index++) {
          const link = links.nth(index);
          if (!(await link.isVisible())) continue;
          await link.hover();
          const failures = (await new AxeBuilder({ page }).withRules(['color-contrast']).analyze())
            .violations;
          expect
            .soft(
              failures.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
              `${path} link ${index} hover`
            )
            .toEqual([]);
        }
      }
    });
  }
}
