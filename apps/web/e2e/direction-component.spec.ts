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
  outDir = await mkdtemp(join(buildParent, 'component-direction-'));
  const root = resolve('e2e/fixtures/direction');
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

for (const locale of ['en', 'fa']) {
  test(`horizontal arrows follow ${locale} direction`, async ({ page }) => {
    await page.goto(`${url}?${locale}`);
    await page
      .getByRole('tab', { name: 'Alpha', exact: true })
      .press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
    await expect(page.getByRole('tab', { name: 'Beta', exact: true })).toBeFocused();
    await page.getByRole('tab', { name: 'Beta', exact: true }).press('Enter');
    await expect(page.getByRole('tab', { name: 'Beta', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });
  test(`vertical tabs expose orientation and navigate vertically (${locale})`, async ({ page }) => {
    await page.goto(`${url}?${locale}&vertical`);
    await expect(page.getByRole('tablist', { name: 'Sections' })).toHaveAttribute(
      'aria-orientation',
      'vertical'
    );
    await page.getByRole('tab', { name: 'Alpha', exact: true }).press('ArrowDown');
    await expect(page.getByRole('tab', { name: 'Beta', exact: true })).toBeFocused();
    await page.getByRole('tab', { name: 'Beta', exact: true }).press('Enter');
    await expect(page.getByRole('tabpanel', { name: 'Beta', exact: true })).toHaveText(
      'Beta content'
    );
    await expect(page.getByRole('tabpanel', { name: 'Alpha', exact: true })).not.toBeVisible();
    await page.getByRole('tab', { name: 'Beta', exact: true }).press('ArrowUp');
    await expect(page.getByRole('tab', { name: 'Alpha', exact: true })).toBeFocused();
  });
}

test('live language changes update direction without resetting selection', async ({ page }) => {
  await page.goto(`${url}?fa`);
  await page.getByRole('tab', { name: 'Beta', exact: true }).click();
  await page.getByRole('button', { name: 'Switch language' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('tab', { name: 'Beta', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await page.getByRole('tab', { name: 'Beta', exact: true }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Gamma', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Switch language' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('tab', { name: 'Gamma', exact: true }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Beta', exact: true })).toBeFocused();
});
