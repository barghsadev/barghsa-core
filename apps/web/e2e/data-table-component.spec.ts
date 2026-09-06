import { test, expect } from '@playwright/test';
import { build, preview, type PreviewServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Build the real shared component outside the product routes and production output.
test.use({ timezoneId: 'UTC' });

let server: PreviewServer;
let outDir: string;
let url: string;
test.beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'barghsa-data-table-'));
  const root = resolve('e2e/fixtures/data-table');
  await build({
    configFile: false,
    root,
    plugins: [react(), tailwindcss()],
    logLevel: 'error',
    build: { outDir, emptyOutDir: true },
  });
  server = await preview({
    configFile: false,
    root,
    logLevel: 'error',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0 },
  });
  url = server.resolvedUrls.local[0]!;
});
test.afterAll(async () => {
  if (server)
    await new Promise<void>((done, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : done()))
    );
  if (outDir) await rm(outDir, { recursive: true, force: true });
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
