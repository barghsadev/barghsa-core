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
  outDir = await mkdtemp(join(buildParent, 'component-data-table-'));
  const root = resolve('e2e/fixtures/data-table');
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

test('keyboard sorting announces direction, preserves fixed columns and emits once per action', async ({
  page,
}) => {
  await page.goto(url);
  const header = page.getByRole('columnheader', { name: 'Name', exact: true });
  const button = header.getByRole('button', { name: 'Name', exact: true });
  await expect(page.getByRole('columnheader', { name: 'Fixed column' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Kept B', exact: true })).toBeVisible();
  await expect(header).toHaveAttribute('aria-sort', 'none');
  await button.press('Enter');
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.locator('tbody tr').first()).toContainText('Alpha');
  await expect(page.getByRole('status', { name: 'Sort events' })).toHaveText('1');
  await button.press('Space');
  await expect(header).toHaveAttribute('aria-sort', 'descending');
  await expect(page.locator('tbody tr').first()).toContainText('Beta');
  await expect(page.getByRole('status', { name: 'Sort events' })).toHaveText('2');
  await button.press('Enter');
  await expect(header).toHaveAttribute('aria-sort', 'none');
  await expect(page.getByRole('status', { name: 'Sort events' })).toHaveText('3');
});

for (const mode of ['controlled', 'uncontrolled']) {
  test(`row selection emits once and select-all clears all visible rows (${mode})`, async ({
    page,
  }) => {
    await page.goto(`${url}?${mode}`);
    await page.getByRole('checkbox', { name: 'Select row 1', exact: true }).press('Space');
    await expect(page.getByRole('status', { name: 'Selected keys' })).toHaveText('b');
    await expect(page.getByRole('status', { name: 'Selection events' })).toHaveText('1');
    await page.getByRole('checkbox', { name: 'Select all rows', exact: true }).press('Space');
    await expect(page.getByRole('status', { name: 'Selected keys' })).toHaveText('a,b');
    await expect(page.getByRole('status', { name: 'Selection events' })).toHaveText('2');
    await page.getByRole('checkbox', { name: 'Deselect all rows', exact: true }).press('Space');
    await expect(page.getByRole('status', { name: 'Selected keys' })).toHaveText('');
    await expect(page.getByRole('status', { name: 'Selection events' })).toHaveText('3');
  });
}

test('controlled selection follows external updates without emitting user-change events', async ({
  page,
}) => {
  await page.goto(url);
  await page.getByRole('button', { name: 'Select Alpha externally' }).click();
  await expect(page.getByRole('checkbox', { name: 'Select row 2', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Select row 1', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Clear externally' }).click();
  await expect(page.getByRole('checkbox', { name: 'Select row 2', exact: true })).not.toBeChecked();
  await expect(page.getByRole('status', { name: 'Selection events' })).toHaveText('0');
});

for (const locale of ['en', 'fa'] as const) {
  test(`loading and empty tables explain state and prevent hidden selection (${locale})`, async ({
    page,
  }) => {
    await page.goto(`${url}?locale=${locale}&state=loading`);
    const table = page.getByRole('table');
    await expect(table).toHaveAttribute('aria-busy', 'true');
    await expect(
      table.getByText(locale === 'fa' ? 'در حال بارگذاری...' : 'Loading...')
    ).toBeVisible();
    await expect(table.getByRole('checkbox')).toBeDisabled();
    await page.getByRole('button', { name: 'Show empty', exact: true }).click();
    await expect(table).toHaveAttribute('aria-busy', 'false');
    await expect(
      table.getByText(locale === 'fa' ? 'نتیجه‌ای یافت نشد' : 'No results')
    ).toBeVisible();
    await expect(table.getByRole('checkbox')).toBeDisabled();
    await expect(page.getByRole('status', { name: 'Selection events' })).toHaveText('0');
    await page.getByRole('button', { name: 'Show rows', exact: true }).click();
    const selectAll = table.getByRole('checkbox', {
      name: locale === 'fa' ? 'انتخاب همه ردیف‌ها' : 'Select all rows',
      exact: true,
    });
    await expect(selectAll).toBeEnabled();
    await selectAll.press('Space');
    await expect(page.getByRole('status', { name: 'Selected keys' })).toHaveText('a,b');
    await expect(
      table.getByRole('checkbox', {
        name: locale === 'fa' ? 'لغو انتخاب همه ردیف‌ها' : 'Deselect all rows',
        exact: true,
      })
    ).toBeChecked();
  });
}

test('language switching updates direction and selection labels without losing state', async ({
  page,
}) => {
  await page.goto(url);
  await page.getByRole('checkbox', { name: 'Select row 1', exact: true }).press('Space');
  await page.getByRole('button', { name: 'Switch language', exact: true }).click();
  const table = page.getByRole('table');
  await expect(table.locator('..')).toHaveAttribute('dir', 'rtl');
  await expect(table.locator('..')).toHaveAttribute('lang', 'fa');
  await expect(table.getByRole('checkbox', { name: 'انتخاب ردیف ۱', exact: true })).toBeChecked();
  await expect(page.getByRole('status', { name: 'Selected keys' })).toHaveText('b');
  await expect(page.getByRole('status', { name: 'Selection events' })).toHaveText('1');
  await expect(page.getByRole('columnheader', { name: 'Name', exact: true })).toHaveCSS(
    'text-align',
    'start'
  );
  await page.getByRole('button', { name: 'Switch language', exact: true }).click();
  await expect(table.locator('..')).toHaveAttribute('dir', 'ltr');
  await expect(table.getByRole('checkbox', { name: 'Select row 1', exact: true })).toBeChecked();
});

test('Persian labels support an explicit Latin numeral preference', async ({ page }) => {
  await page.goto(`${url}?locale=fa&latin`);
  await page.getByRole('checkbox', { name: 'انتخاب ردیف 1', exact: true }).press('Space');
  await expect(page.getByRole('status', { name: 'Selected keys' })).toHaveText('b');
  await expect(page.getByRole('checkbox', { name: 'انتخاب ردیف 1', exact: true })).toBeChecked();
});
