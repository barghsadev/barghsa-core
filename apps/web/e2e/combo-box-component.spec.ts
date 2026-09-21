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
  outDir = await mkdtemp(join(buildParent, 'component-combo-box-'));
  const root = resolve('e2e/fixtures/combo-box');
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
  for (const theme of ['light', 'dark']) {
    test(`search, keyboard highlight, custom trigger and form roundtrip (${locale}, ${theme})`, async ({
      page,
    }) => {
      await page.goto(`${url}?locale=${locale}&theme=${theme}`);
      const fa = locale === 'fa';
      const billing = fa ? 'صورتحساب' : 'Billing';
      const orders = fa ? 'سفارش‌ها' : 'Orders';
      const submit = page.getByRole('button', { name: fa ? 'ارسال' : 'Submit', exact: true });
      await submit.click();
      await expect(page.getByRole('status', { name: 'Submitted values' })).toBeEmpty();
      const category = page.getByRole('combobox', {
        name: fa ? 'دسته‌بندی' : 'Category',
        exact: true,
      });
      await expect(category).toBeFocused();
      await expect(category).toHaveCSS('--tw-ring-offset-width', '2px');
      await category.fill(billing);
      await expect(page.getByRole('option')).toHaveCount(1);
      await category.press('ArrowDown');
      const option = page.getByRole('option', { name: billing, exact: true });
      await expect(option).toHaveAttribute('data-highlighted', '');
      await expect(option).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await category.press('Enter');
      await expect(category).toHaveValue(billing);
      await expect(page.getByRole('listbox')).toBeHidden();
      const trigger = page.getByRole('button', { name: fa ? 'نمایش دسته‌ها' : 'Show categories' });
      await expect(trigger).toHaveAttribute('data-custom-trigger', 'true');
      await expect(trigger).toContainText(billing);
      await expect(trigger.locator('svg')).toHaveCount(1);
      await trigger.click();
      await expect(category).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('listbox')).toBeVisible();
      await expect(page.locator('[data-slot="combobox-popup"]')).toHaveCSS('opacity', '1');
      expect(
        (await new AxeBuilder({ page }).include('[data-slot="combobox-popup"]').analyze())
          .violations
      ).toEqual([]);
      await page.screenshot({ path: `/tmp/v01-ui-combobox-${locale}-${theme}.png` });
      await category.press('Escape');
      await expect(page.getByRole('listbox')).toBeHidden();
      const topics = page.getByRole('combobox', { name: fa ? 'موضوع‌ها' : 'Topics', exact: true });
      await submit.click();
      await expect(page.getByRole('status', { name: 'Submitted values' })).toBeEmpty();
      await expect(topics).toBeFocused();
      for (const value of [billing, orders]) {
        await topics.fill(value);
        await expect(page.getByRole('option', { name: value, exact: true })).toBeVisible();
        await topics.press('ArrowDown');
        await expect(page.getByRole('option', { name: value, exact: true })).toHaveAttribute(
          'data-highlighted',
          ''
        );
        await topics.press('Enter');
        await expect(
          page.locator('[data-slot="combobox-chip"]').filter({ hasText: value })
        ).toBeVisible();
        await expect(topics).toHaveValue('');
        await expect(page.getByRole('listbox')).toBeHidden();
      }
      if ((await topics.getAttribute('aria-expanded')) === 'true') await topics.press('Escape');
      await expect(page.locator('[data-slot="combobox-chip"]')).toHaveCount(2);
      await page
        .getByRole('button', { name: fa ? `حذف ${billing}` : `Remove ${billing}`, exact: true })
        .click();
      await expect(page.locator('[data-slot="combobox-chip"]')).toHaveCount(1);
      await submit.click();
      await expect(page.getByRole('status', { name: 'Submitted values' })).toHaveText(
        JSON.stringify({ category: billing, topics: [orders] })
      );
      await expect(
        page.getByRole('combobox', { name: fa ? 'غیرفعال' : 'Disabled', exact: true })
      ).toBeDisabled();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    });
  }

test('self-hosted fonts follow language changes without overriding code', async ({ page }) => {
  const fontResponses: string[] = [];
  page.on('response', (response) => {
    if (response.url().endsWith('.woff2') && response.ok()) fontResponses.push(response.url());
  });
  await page.goto(`${url}?locale=en`);
  const sample = page.locator('#font-sample');
  await expect(sample).toHaveCSS(
    'font-family',
    /^(?:Inter Variable|"Inter Variable"), sans-serif$/
  );
  await expect(page.locator('#nested-language')).toHaveCSS(
    'font-family',
    /^(?:Vazirmatn|"Vazirmatn"), sans-serif$/
  );
  await expect(page.locator('code')).toHaveCSS('font-family', /monospace/);
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await document.fonts.load('400 16px "Inter Variable"', 'English')).length
      )
    )
    .toBeGreaterThan(0);
  expect(
    fontResponses.some(
      (value) => new URL(value).origin === new URL(url).origin && value.includes('inter-latin')
    )
  ).toBe(true);
  await page.getByRole('button', { name: 'Switch language' }).click();
  await expect(sample).toHaveCSS('font-family', /^(?:Vazirmatn|"Vazirmatn"), sans-serif$/);
  await expect(page.locator('code')).toHaveCSS('font-family', /monospace/);
});
