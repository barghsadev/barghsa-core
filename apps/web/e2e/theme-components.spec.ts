import AxeBuilder from '@axe-core/playwright';
import { test, expect, registerComponentCoverage } from './coverage-fixture';
import { build, preview, type PreviewServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Build the real shared component outside the product routes and production output.
test.use({ timezoneId: 'UTC' });

let server: PreviewServer;
let outDir: string;
let url: string;
test.beforeAll(async () => {
  const coverageDir = process.env['BARGHSA_BROWSER_COVERAGE_DIR'];
  const buildParent = coverageDir ? join(coverageDir, 'builds') : tmpdir();
  await mkdir(buildParent, { recursive: true });
  outDir = await mkdtemp(join(buildParent, 'component-theme-'));
  const root = resolve('e2e/fixtures/theme');
  await build({
    configFile: false,
    root,
    plugins: [react(), tailwindcss()],
    logLevel: 'error',
    build: { outDir, emptyOutDir: true, sourcemap: coverageDir ? 'hidden' : false },
  });
  server = await preview({
    configFile: false,
    root,
    logLevel: 'error',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0 },
  });
  url = server.resolvedUrls.local[0]!;
  if (coverageDir) registerComponentCoverage(url, outDir);
});
test.afterAll(async () => {
  if (server)
    await new Promise<void>((done, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : done()))
    );
  if (outDir && !process.env['BARGHSA_BROWSER_COVERAGE_DIR'])
    await rm(outDir, { recursive: true, force: true });
});

for (const locale of ['en', 'fa'])
  for (const darkMode of [false, true])
    test(`shared controls remain readable and focused (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
      for (const primaryColor of ['#2563eb', '#777777', '#ffffff']) {
        await page.route('**/api/public/branding/config', (route) =>
          route.fulfill({
            json: {
              appTitle: 'Theme checks',
              slogan: '',
              primaryColor,
              secondaryColor: '#64748b',
              accentColor: '#f59e0b',
              logoUrl: null,
              faviconUrl: null,
              darkMode,
            },
          })
        );
        await page.goto(`${url}?${locale}`);
        await expect
          .poll(() =>
            page.locator('html').evaluate((element) => element.style.getPropertyValue('--primary'))
          )
          .toBe(primaryColor);
        expect
          .soft(
            (await new AxeBuilder({ page }).include('main').withRules(['color-contrast']).analyze())
              .violations,
            primaryColor
          )
          .toEqual([]);
        for (const variant of ['default', 'secondary', 'destructive', 'link']) {
          const button = page.getByRole('button', { name: variant, exact: true });
          await button.hover();
          expect
            .soft(
              (
                await new AxeBuilder({ page })
                  .include('main')
                  .withRules(['color-contrast'])
                  .analyze()
              ).violations,
              `${primaryColor} ${variant} hover`
            )
            .toEqual([]);
        }
        await page.getByRole('button', { name: 'default', exact: true }).focus();
        await page.keyboard.press('Tab');
        const focused = page.getByRole('button', { name: 'outline', exact: true });
        await expect(focused).toBeFocused();
        expect(await focused.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe(
          'none'
        );
        await page.emulateMedia({ reducedMotion: 'reduce' });
        expect(
          await focused.evaluate((element) => getComputedStyle(element).transitionDuration)
        ).toBe('0s');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.unroute('**/api/public/branding/config');
      }
    });
