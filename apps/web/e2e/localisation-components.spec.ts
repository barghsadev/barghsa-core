import { test, expect, registerComponentCoverage } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { shellText } from '@barghsa/i18n/shell';
import { timezoneText } from '@barghsa/i18n/timezone';
import { build, preview, type PreviewServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let server: PreviewServer;
let outDir: string;
let url: string;
test.beforeAll(async () => {
  const coverageDir = process.env['BARGHSA_BROWSER_COVERAGE_DIR'];
  const parent = coverageDir ? join(coverageDir, 'builds') : tmpdir();
  await mkdir(parent, { recursive: true });
  outDir = await mkdtemp(join(parent, 'component-localisation-'));
  const root = resolve('e2e/fixtures/localisation');
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

for (const theme of ['light', 'dark'] as const) {
  test(`language, calendar and directional controls update without changing the captured instant (${theme})`, async ({
    page,
  }, info) => {
    await page.addInitScript(() => localStorage.setItem('barghsa.locale', 'fa'));
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    let reads = 0;
    await page.route('**/api/user/settings/timezone', (route) => {
      reads++;
      expect(route.request().method()).toBe('GET');
      return route.fulfill({ json: { timezone: 'Asia/Tehran' } });
    });
    await page.goto(url);
    const captured = page.getByRole('status', { name: 'Captured instant', exact: true });
    const expected = '2026-03-20T21:00:00.000Z';
    const amount = page.getByRole('status', { name: 'Exact IRR amount', exact: true });
    await expect(amount).toHaveText('۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۳');
    await expect(amount).toHaveAttribute('data-value', '9007199254740993');
    await expect(captured).toHaveText(expected);
    await expect(page.getByTestId('calendar-date')).toHaveText('۱۴۰۵/۰۱/۰۱');
    await expect(page.getByTestId('account-time')).toHaveText('۱۴۰۵/۰۱/۰۱ ۰۰:۳۰');
    await expect(page.getByTestId('ambiguous-date')).toHaveText(
      timezoneText('display.invalid', 'fa')
    );
    await expect(page.getByTestId('invalid-timezone')).toHaveText(
      timezoneText('display.invalid', 'fa')
    );
    const direction = page.getByRole('img', { name: 'Next section', exact: true });
    await expect(direction).toHaveCSS('scale', '-1 1');
    await expect(page.getByRole('img', { name: 'Both directions' })).toHaveCSS('scale', 'none');
    await expect(page.getByRole('img', { name: 'Physical east' })).toHaveCSS('scale', 'none');
    await expect(page.getByRole('status', { name: 'Logical placement' })).toHaveText('right');
    await page.getByRole('button', { name: 'Open directional help' }).press('Enter');
    const help = page.locator('[data-slot=popover-content]');
    await expect(help).toHaveAttribute('data-side', 'right');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open directional help' })).toBeFocused();
    await page.evaluate(() => {
      document.body.dataset['sameDocument'] = 'yes';
    });
    const switcher = page.getByRole('button', { name: shellText('language', 'fa'), exact: true });
    await expect(switcher).toHaveText('EN');
    await switcher.click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('body')).toHaveAttribute('data-same-document', 'yes');
    await expect(captured).toHaveText(expected);
    await expect(amount).toHaveText('9,007,199,254,740,993');
    await expect(amount).toHaveAttribute('data-value', '9007199254740993');
    await expect(page.getByTestId('calendar-date')).toHaveText('2026/03/21');
    await expect(page.getByTestId('account-time')).toHaveText('2026/03/21 12:30 AM');
    await expect(page.getByRole('combobox', { name: 'Hour', exact: true })).toHaveValue('12');
    await expect(page.getByRole('combobox', { name: 'AM or PM', exact: true })).toHaveValue('AM');
    await expect(direction).toHaveCSS('scale', 'none');
    await expect(page.getByRole('status', { name: 'Logical placement' })).toHaveText('left');
    await page.getByRole('button', { name: 'Open directional help' }).press('Enter');
    await expect(help).toHaveAttribute('data-side', 'left');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: shellText('language', 'en'), exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
    await expect(captured).toHaveText(expected);
    await expect(page.getByRole('combobox', { name: 'ساعت', exact: true })).toHaveValue('0');
    expect(reads).toBe(1);
    expect(
      (
        await new AxeBuilder({ page })
          .include('main')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    expect(errors).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`calendar-language-${theme}.png`),
      fullPage: true,
    });
  });
}

test('a changed account waits for its own timezone before displaying its instant', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('barghsa.locale', 'en'));
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  let reads = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/user/settings/timezone', async (route) => {
    reads++;
    if (reads > 1) await held;
    await route.fulfill({ json: { timezone: reads === 1 ? 'Asia/Tehran' : 'America/New_York' } });
  });
  try {
    await page.goto(url);
    await expect(page.getByTestId('account-time')).toHaveText('2026/03/21 12:30 AM');
    expect(reads).toBe(1);
    await page.getByRole('button', { name: 'Switch account', exact: true }).click();
    await expect(page.getByTestId('account-time')).toHaveCount(0);
    await expect(
      page.getByText(timezoneText('display.pending', 'en'), { exact: true })
    ).toHaveCount(2);
    await expect(page.getByRole('combobox', { name: /Delivery/ })).toBeDisabled();
    expect(reads).toBe(2);
    release();
    await expect(page.getByTestId('account-time')).toHaveText('2026/03/20 5:00 PM');
    await expect(page.getByRole('status', { name: 'Captured instant' })).toHaveText(
      '2026-03-20T21:00:00.000Z'
    );
  } finally {
    release();
  }
});

test('relative labels update locally without fetching or changing the timestamp', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-07T00:00:00Z') });
  await page.addInitScript(() => localStorage.setItem('barghsa.locale', 'en'));
  const reads: string[] = [];
  await page.route('**/api/**', (route) => {
    reads.push(route.request().url());
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(url + '?relative');
  const relative = page.getByTestId('relative-time');
  await expect(relative).toHaveText('2 minutes ago');
  const instant = await relative.getAttribute('datetime');
  const previousReads = [...reads];
  await page.clock.fastForward(60_000);
  await expect(relative).toHaveText('3 minutes ago');
  await expect(relative).toHaveAttribute('datetime', instant!);
  expect(reads).toEqual(previousReads);
});

for (const boundary of [
  {
    date: '2025-03-19T21:00:00Z',
    lastDay: '۳۰',
    next: '2025-03-20T21:00:00.000Z',
    nextDate: '۱۴۰۴/۰۱/۰۱',
  },
  {
    date: '2026-03-19T21:00:00Z',
    lastDay: '۲۹',
    next: '2026-03-20T21:00:00.000Z',
    nextDate: '۱۴۰۵/۰۱/۰۱',
  },
]) {
  test(`Jalali year boundary after Esfand ${boundary.lastDay} preserves the selected civil time`, async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('barghsa.locale', 'fa'));
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'Asia/Tehran' } })
    );
    await page.goto(url + '?date=' + encodeURIComponent(boundary.date));
    const trigger = page.getByRole('combobox', { name: /Delivery/ });
    await expect(trigger).toBeEnabled();
    await trigger.press('Enter');
    const popup = page.locator('[data-slot=popover-content]');
    const selected = popup.locator('button[data-selected-single=true]');
    await expect(selected).toHaveText(boundary.lastDay);
    await selected.press('ArrowLeft');
    const focused = popup.locator('button[data-day]:focus');
    await expect(focused).toHaveText('۱');
    await focused.press('Enter');
    await expect(popup).toBeHidden();
    await expect(page.getByRole('status', { name: 'Captured instant' })).toHaveText(boundary.next);
    await expect(page.getByTestId('calendar-date')).toHaveText(boundary.nextDate);
    await expect(page.getByTestId('account-time')).toHaveText(boundary.nextDate + ' ۰۰:۳۰');
    await expect(trigger).toBeFocused();
  });
}
