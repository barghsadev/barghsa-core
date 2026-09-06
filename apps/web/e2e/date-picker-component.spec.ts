import { test, expect } from '@playwright/test';
import { build, preview, type PreviewServer } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Build the real shared component outside the product routes and production output.
test.use({ timezoneId: 'UTC' });

let server: PreviewServer;
let outDir: string;
let url: string;
test.beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'barghsa-date-picker-'));
  const root = resolve('e2e/fixtures/date-picker');
  await build({
    configFile: false,
    root,
    plugins: [react()],
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

for (const mode of ['single', 'range']) {
  test(`${mode} respects inclusive date bounds and Escape restores focus`, async ({ page }) => {
    await page.goto(`${url}?${mode}`);
    const trigger = page.getByRole('combobox', { name: 'Delivery date' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Delivery date' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: /March 20th/ })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: /March 21st/ })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: /March 23rd/ })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: /March 24th/ })).toBeDisabled();
    await dialog.getByRole('button', { name: /March 21st/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByRole('button', { name: /March 22nd/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await dialog.getByRole('button', { name: /March 23rd/ }).press('Enter');
    await expect(page.getByRole('status', { name: 'Stored value' })).toContainText('2026-03-23');
  });
}

test('locale switches calendar and placeholder without changing stored date', async ({ page }) => {
  await page.goto(url);
  const value = await page.getByRole('status', { name: 'Stored value' }).textContent();
  await expect(page.getByRole('combobox', { name: 'Select date', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Switch language' }).click();
  await expect(page.getByRole('status', { name: 'Stored value' })).toHaveText(value!);
  await expect(page.getByRole('combobox', { name: 'انتخاب تاریخ', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Delivery date' }).click();
  await expect(page.getByRole('dialog').getByRole('grid')).toHaveAttribute('aria-label', /فروردین/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Switch language' }).click();
  await expect(page.getByRole('status', { name: 'Stored value' })).toHaveText(value!);
});

test('disabled picker cannot open and validation error describes the control', async ({ page }) => {
  await page.goto(`${url}?disabled&error`);
  const trigger = page.getByRole('combobox', { name: 'Delivery date' });
  await expect(trigger).toBeDisabled();
  await expect(trigger).toHaveAttribute('aria-invalid', 'true');
  await expect(trigger).toHaveAccessibleDescription('Choose an allowed date');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

for (const browserZone of ['UTC', 'America/Los_Angeles']) {
  test.describe(`explicit Tehran zone in ${browserZone}`, () => {
    test.use({ timezoneId: browserZone });
    for (const locale of ['en', 'fa']) {
      test(`displays and selects ${locale} days in the configured zone`, async ({ page }) => {
        await page.goto(`${url}?timezone=Asia%2FTehran&${locale}`);
        const trigger = page.getByRole('combobox', { name: 'Delivery date' });
        await expect(trigger).toContainText(locale === 'fa' ? '1405/01/01' : '2026/03/21');
        await expect(page.getByRole('status', { name: 'Stored value' })).toHaveText(
          '"2026-03-20T21:00:00.000Z"'
        );
        await trigger.click();
        const dialog = page.getByRole('dialog');
        const nextDay = dialog.getByRole('button', {
          name: locale === 'fa' ? / ۲-ام فروردین ۱۴۰۵/ : /March 22nd/,
        });
        await expect(
          dialog.getByRole('button', {
            name: locale === 'fa' ? / ۴-ام فروردین ۱۴۰۵/ : /March 24th/,
          })
        ).toBeDisabled();
        await nextDay.click();
        await expect(trigger).toContainText(locale === 'fa' ? '1405/01/02' : '2026/03/22');
        await expect(page.getByRole('status', { name: 'Stored value' })).toHaveText(
          '"2026-03-21T20:30:00.000Z"'
        );
        await page.getByRole('button', { name: 'Switch language' }).click();
        await expect(trigger).toContainText(locale === 'fa' ? '2026/03/22' : '1405/01/02');
        await expect(page.getByRole('status', { name: 'Stored value' })).toHaveText(
          '"2026-03-21T20:30:00.000Z"'
        );
      });
    }
  });
}
