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
  outDir = await mkdtemp(join(buildParent, 'component-multi-select-'));
  const root = resolve('e2e/fixtures/multi-select');
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
  test(`chip removal has a localized native button and restores input focus (${locale})`, async ({
    page,
  }) => {
    await page.goto(`${url}?${locale}`);
    const name = locale === 'fa' ? 'حذف سیب' : 'Remove Apple';
    const remove = page.getByRole('button', { name, exact: true });
    await expect(remove).toHaveJSProperty('tagName', 'BUTTON');
    await remove.click();
    await expect(page.getByRole('status', { name: 'Selected values' })).toHaveText('');
    await expect(
      page.getByRole('combobox', { name: locale === 'fa' ? 'میوه' : 'Fruit' })
    ).toBeFocused();
  });
}

test('search filters options, keyboard selects and Backspace removes a selected chip', async ({
  page,
}) => {
  await page.goto(url);
  const input = page.getByRole('combobox', { name: 'Fruit' });
  await input.fill('Ban');
  await expect(page.getByRole('option', { name: 'Banana', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Cherry', exact: true })).toHaveCount(0);
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(page.getByRole('status', { name: 'Selected values' })).toHaveText('Apple,Banana');
  await input.press('Escape');
  await input.press('Backspace');
  await expect(page.getByRole('status', { name: 'Selected values' })).toHaveText('Apple');
});

for (const state of ['disabled', 'readonly']) {
  test(`chip removal respects ${state} state`, async ({ page }) => {
    await page.goto(`${url}?${state}`);
    const remove = page.getByRole('button', { name: 'Remove Apple', exact: true });
    await expect(remove).toBeDisabled();
    await remove.press('Enter');
    await expect(page.getByRole('status', { name: 'Selected values' })).toHaveText('Apple');
  });
}
