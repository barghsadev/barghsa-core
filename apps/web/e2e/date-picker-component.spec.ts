import { test, expect } from './coverage-fixture';
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
  outDir = await mkdtemp(join(tmpdir(), 'barghsa-date-picker-'));
  const root = resolve('e2e/fixtures/date-picker');
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
    await expect(page.getByRole('status', { name: 'Stored value', exact: true })).toContainText(
      mode === 'range' ? '2026-03-24T00:00:00.000Z' : '2026-03-23'
    );
  });
}

test('locale switches calendar and placeholder without changing stored date', async ({ page }) => {
  await page.goto(url);
  const value = await page.getByRole('status', { name: 'Stored value', exact: true }).textContent();
  await expect(page.getByRole('combobox', { name: 'Select date', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Switch language' }).click();
  await expect(page.getByRole('status', { name: 'Stored value', exact: true })).toHaveText(value!);
  await expect(page.getByRole('combobox', { name: 'انتخاب تاریخ', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Delivery date' }).click();
  await expect(page.getByRole('dialog').getByRole('grid')).toHaveAttribute('aria-label', /فروردین/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Switch language' }).click();
  await expect(page.getByRole('status', { name: 'Stored value', exact: true })).toHaveText(value!);
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
        await expect(trigger).toContainText(locale === 'fa' ? '۱ فروردین ۱۴۰۵' : 'March 21, 2026');
        await expect(page.getByRole('status', { name: 'Stored value', exact: true })).toHaveText(
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
        await expect(trigger).toContainText(locale === 'fa' ? '۲ فروردین ۱۴۰۵' : 'March 22, 2026');
        await expect(page.getByRole('status', { name: 'Stored value', exact: true })).toHaveText(
          '"2026-03-21T20:30:00.000Z"'
        );
        await page.getByRole('button', { name: 'Switch language' }).click();
        await expect(trigger).toContainText(locale === 'fa' ? 'March 22, 2026' : '۲ فروردین ۱۴۰۵');
        await expect(page.getByRole('status', { name: 'Stored value', exact: true })).toHaveText(
          '"2026-03-21T20:30:00.000Z"'
        );
      });
    }
  });
}

test('range end excludes the next day and keeps calendar days across DST', async ({ page }) => {
  await page.goto(`${url}?range&dst`);
  const trigger = page.getByRole('combobox', { name: 'Delivery date' });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /March 9th/ }).click();
  await expect(page.getByRole('status', { name: 'Stored value', exact: true })).toHaveText(
    '{"from":"2026-03-07T05:00:00.000Z","to":"2026-03-10T04:00:00.000Z"}'
  );
  await expect(trigger).toContainText('March 10, 2026 (end excluded)');
  await expect(
    dialog.getByRole('gridcell').filter({ has: page.getByRole('button', { name: /March 9th/ }) })
  ).toHaveAttribute('aria-selected', 'true');
  await expect(
    dialog.getByRole('gridcell').filter({ has: page.getByRole('button', { name: /March 10th/ }) })
  ).not.toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await trigger.click();
  await expect(
    dialog.getByRole('gridcell').filter({ has: page.getByRole('button', { name: /March 9th/ }) })
  ).toHaveAttribute('aria-selected', 'true');
});

test('a fresh one-day range has a nonempty half-open interval', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-03-22T12:00:00Z') });
  await page.goto(`${url}?range&empty`);
  const trigger = page.getByRole('combobox', { name: 'Delivery date' });
  await trigger.click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /March 23rd/ })
    .click();
  await expect(page.getByRole('status', { name: 'Stored value', exact: true })).toHaveText(
    '{"from":"2026-03-23T00:00:00.000Z","to":"2026-03-24T00:00:00.000Z"}'
  );
  await expect(trigger).toContainText('March 24, 2026 (end excluded)');
});

test('Persian mobile month selection shows both years and allows Latin digits', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${url}?fa&latin`);
  const trigger = page.getByRole('combobox', { name: 'Delivery date' });
  await expect(trigger).toContainText('2 فروردین 1405 (2026)');
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('1405 / 2026');
  const month = dialog.getByRole('combobox', { name: 'ماه را انتخاب کنید' });
  await month.selectOption({ label: 'اردیبهشت' });
  await expect(dialog.getByRole('grid')).toHaveAttribute('aria-label', /اردیبهشت/);
  await expect(trigger).toContainText('2 فروردین 1405 (2026)');
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '/tmp/audit-date-picker-fa-mobile.png', animations: 'disabled' });
});

test('default picker uses Persian and Tehran while keeping UTC instants', async ({ page }) => {
  await page.goto(url);
  const trigger = page.getByRole('combobox', { name: 'Default date', exact: true });
  await expect(trigger).toContainText('۱ فروردین ۱۴۰۵');
  await trigger.click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: / ۲-ام فروردین ۱۴۰۵/ })
    .click();
  await expect(page.getByRole('status', { name: 'Default stored value', exact: true })).toHaveText(
    '2026-03-21T20:30:00.000Z'
  );
});
