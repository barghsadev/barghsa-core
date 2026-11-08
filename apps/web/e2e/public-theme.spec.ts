import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { skipToMain } from './critical-accessibility';
import { mockPublicAuthCsrf } from './public-auth-fixture';

for (const locale of ['fa', 'en'] as const) {
  for (const darkMode of [false, true]) {
    test(`public links remain readable with a white brand (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript((value) => {
        localStorage.setItem('barghsa.locale', value);
        localStorage.setItem('barghsa-locale', value);
        const apply = () => {
          document.documentElement.lang = value;
        };
        if (document.documentElement) apply();
        new MutationObserver(apply).observe(document, { childList: true });
      }, locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await mockPublicAuthCsrf(page);
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            appTitle: 'Theme checks',
            appTitleFa: 'بررسی پوسته',
            supportEmail: 'support@example.test',
            supportPhone: '+982188888888',
            supportMobile: '+989121234567',
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
      for (const path of [
        '/register',
        '/forgot-password',
        '/activate',
        '/support',
        `/terms?lang=${locale}`,
      ]) {
        await page.goto(path);
        await expect
          .poll(() => page.locator('html').evaluate((e) => e.style.getPropertyValue('--primary')))
          .toBe('#ffffff');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await skipToMain(page, locale);
        if (path === '/support' || path.startsWith('/terms?')) {
          for (const width of [390, 1024]) {
            await page.setViewportSize({ width, height: 844 });
            const mark = page
              .getByRole('link', {
                name: locale === 'fa' ? 'بررسی پوسته' : 'Theme checks',
                exact: true,
              })
              .filter({ visible: true })
              .locator('svg');
            const fills = await mark.evaluate((icon) => ({
              tile: getComputedStyle(icon.querySelector('rect')!).fill,
              bolt: getComputedStyle(icon.querySelector('path')!).fill,
            }));
            expect.soft(fills, `${path} brand mark at ${width}px`).toEqual({
              tile: 'rgb(255, 255, 255)',
              bolt: 'rgb(0, 0, 0)',
            });
          }
          await page.setViewportSize({ width: 390, height: 844 });
        }
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
          if ((await link.getAttribute('href')) === '#main-content') continue;
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
