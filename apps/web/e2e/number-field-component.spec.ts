import { test, expect, registerComponentCoverage } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
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
  outDir = await mkdtemp(join(buildParent, 'component-number-field-'));
  const root = resolve('e2e/fixtures/number-field');
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

for (const locale of ['en-US', 'fa-IR'])
  for (const theme of ['light', 'dark']) {
    test(`stepper names, keyboard bounds and logical borders (${locale}, ${theme})`, async ({
      page,
    }) => {
      await page.goto(`${url}?locale=${locale}&theme=${theme}`);
      const fa = locale.startsWith('fa');
      const increase = page.getByRole('button', { name: fa ? 'افزایش' : 'Increase', exact: true });
      const decrease = page.getByRole('button', { name: fa ? 'کاهش' : 'Decrease', exact: true });
      await expect(increase).toBeVisible();
      await expect(page.locator('[data-slot="number-field"]')).toHaveAttribute(
        'dir',
        fa ? 'rtl' : 'ltr'
      );
      await expect(decrease).toBeVisible();
      await expect(increase).toHaveCSS('border-inline-start-width', '1px');
      await expect(decrease).toHaveCSS('border-inline-end-width', '1px');
      await increase.focus();
      await increase.press('Space');
      await expect(page.getByRole('status', { name: 'Stored value' })).toHaveText('2');
      await expect(increase).toBeDisabled();
      await expect(page.locator('[data-slot="number-field-input"]')).toHaveValue(fa ? '۲' : '2');
      await decrease.focus();
      await expect
        .poll(() => decrease.evaluate((button) => getComputedStyle(button).boxShadow))
        .not.toBe('none');
      await decrease.press('Enter');
      await decrease.press('Space');
      await expect(page.getByRole('status', { name: 'Stored value' })).toHaveText('0');
      await expect(decrease).toBeDisabled();
      await page.getByRole('button', { name: 'Switch language' }).click();
      await expect(
        page.getByRole('button', { name: fa ? 'Increase' : 'افزایش', exact: true })
      ).toBeVisible();
      await expect(page.getByRole('status', { name: 'Stored value' })).toHaveText('0');
      const input = page.locator('[data-slot="number-field-input"]');
      await input.press('ArrowUp');
      await expect(page.getByRole('status', { name: 'Stored value' })).toHaveText('1');
      await expect(input).toHaveValue(fa ? '1' : '۱');
      const scan = await new AxeBuilder({ page }).include('[data-slot="number-field"]').analyze();
      expect(scan.violations).toEqual([]);
    });
  }

test('caller can override the accessible stepper name', async ({ page }) => {
  await page.goto(`${url}?custom`);
  await page.getByRole('button', { name: 'Add one unit', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Stored value' })).toHaveText('2');
});
