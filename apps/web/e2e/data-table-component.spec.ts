import { test, expect, registerComponentCoverage } from './coverage-fixture';
import { build, preview, type PreviewServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

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

test('disabled sorting preserves input order and toggling restores the saved sort', async ({
  page,
}) => {
  await page.goto(`${url}?no-sort&initial-sort`);
  const header = page.getByRole('columnheader', { name: 'Name', exact: true });
  await expect(header.getByRole('button')).toHaveCount(0);
  await expect(page.locator('tbody tr').first()).toContainText('Beta');
  await page.getByRole('button', { name: 'Toggle sorting', exact: true }).click();
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.locator('tbody tr').first()).toContainText('Alpha');
  await page.getByRole('button', { name: 'Toggle sorting', exact: true }).click();
  await expect(header.getByRole('button')).toHaveCount(0);
  await expect(page.locator('tbody tr').first()).toContainText('Beta');
  await expect(page.getByRole('status', { name: 'Sort events' })).toHaveText('0');
});

for (const locale of ['en', 'fa'] as const) {
  test(`responsive cards retain sorting selection and details across the breakpoint (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${url}?advanced&responsive&locale=${locale}&latin`);
    const list = page.getByRole('list', {
      name: locale === 'fa' ? 'صورتحساب‌ها' : 'Invoices',
      exact: true,
    });
    await expect(list).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    const show = locale === 'fa' ? 'نمایش جزئیات Beta' : 'Show details for Beta';
    const hide = locale === 'fa' ? 'بستن جزئیات Beta' : 'Hide details for Beta';
    await list.getByRole('button', { name: show, exact: true }).press('Enter');
    await expect(
      list.getByText('Details Beta <script>literal</script>', { exact: true })
    ).toBeVisible();
    await list
      .getByRole('checkbox', {
        name: locale === 'fa' ? 'انتخاب ردیف 1' : 'Select row 1',
        exact: true,
      })
      .press('Space');
    await expect(page.getByRole('status', { name: 'Selected keys' })).toHaveText('b');
    const sort = page.getByRole('group', {
      name: locale === 'fa' ? 'مرتب‌سازی بر اساس' : 'Sort by',
    });
    await sort.getByRole('button').press('Enter');
    await expect(list.getByRole('listitem').first()).toContainText('Alpha');
    await expect(list.getByRole('button', { name: hide, exact: true })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(list.getByRole('listitem').last().getByRole('checkbox')).toBeChecked();
    await page.setViewportSize({ width: 1100, height: 844 });
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    await expect(
      page.getByRole('list', { name: locale === 'fa' ? 'صورتحساب‌ها' : 'Invoices', exact: true })
    ).toHaveCount(0);
    await expect(table.getByRole('button', { name: hide, exact: true })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(
      table.getByRole('checkbox', {
        name: locale === 'fa' ? 'انتخاب ردیف 2' : 'Select row 2',
        exact: true,
      })
    ).toBeChecked();
    await table.getByRole('button', { name: hide, exact: true }).press('Space');
    await expect(
      table.getByText('Details Beta <script>literal</script>', { exact: true })
    ).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(list.getByRole('button', { name: show, exact: true })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    await expect(page.getByRole('status', { name: 'Selection events' })).toHaveText('1');
    await expect(page.getByRole('status', { name: 'Sort events' })).toHaveText('1');
    expect(
      (await new AxeBuilder({ page }).include('[data-slot="card-list-view"]').analyze()).violations
    ).toEqual([]);
    if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))) {
      await test.info().attach('responsive-layout', {
        contentType: 'application/json',
        body: JSON.stringify(
          await page.evaluate(() => ({
            width: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            scrollBoxes: [...document.querySelectorAll('body *')]
              .filter((element) => element.scrollWidth > element.clientWidth + 1)
              .map((element) => ({
                tag: element.tagName,
                classes: element.className,
                width: element.clientWidth,
                scrollWidth: element.scrollWidth,
                position: getComputedStyle(element).position,
                overflow: getComputedStyle(element).overflow,
                text: element.textContent?.slice(0, 60),
              })),
            overflowing: [...document.querySelectorAll('main *')]
              .map((element) => ({
                tag: element.tagName,
                text: element.textContent?.slice(0, 80),
                classes: element.className,
                left: element.getBoundingClientRect().left,
                right: element.getBoundingClientRect().right,
              }))
              .filter((element) => element.right > innerWidth + 1 || element.left < -1),
          }))
        ),
      });
    }
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    await page.screenshot({ path: test.info().outputPath(`table-cards-${locale}.png`) });
  });

  test(`sticky header and safe cells expose native keyboard actions (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1100, height: 844 });
    await page.goto(`${url}?advanced&long&locale=${locale}&latin`);
    const table = page.getByRole('table');
    const viewport = table.locator('..');
    const header = table.locator('thead');
    await viewport.evaluate((element) => {
      element.scrollTop = 450;
    });
    const [box, head] = await Promise.all([viewport.boundingBox(), header.boundingBox()]);
    expect(head!.y).toBeGreaterThanOrEqual(box!.y - 1);
    expect(head!.y).toBeLessThan(box!.y + 4);
    await viewport.evaluate((element) => {
      element.scrollTop = 0;
    });
    const sort = table.getByRole('button', { name: 'Name', exact: true });
    await sort.focus();
    await sort.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
    await expect(sort).toBeFocused();
    await sort.press('Enter');
    await expect(table.getByRole('columnheader', { name: 'Name', exact: true })).toHaveAttribute(
      'aria-sort',
      'ascending'
    );
    const first = table.locator('tbody tr').first();
    await expect(first).toContainText('12,345');
    await expect(first).toContainText('9,007,199,254,740,993,123');
    await expect(first.locator('time')).toHaveAttribute('datetime', '2026-10-01T22:30:00.000Z');
    await expect(
      first.getByRole('link', { name: 'Invoice Record 1', exact: true })
    ).toHaveAttribute('href', '/invoices/row-0');
    const actions = first.getByRole('button', {
      name: `${locale === 'fa' ? 'اقدامات' : 'Actions'} Record 1`,
      exact: true,
    });
    await actions.press('Enter');
    await expect(
      page.getByRole('menuitem', { name: locale === 'fa' ? 'حذف' : 'Delete', exact: true })
    ).toBeDisabled();
    await page
      .getByRole('menuitem', { name: locale === 'fa' ? 'نمایش' : 'View', exact: true })
      .press('Enter');
    await expect(page.getByRole('status', { name: 'Action events' })).toHaveText('1');
    await expect(actions).toBeFocused();
    expect((await new AxeBuilder({ page }).include('table').analyze()).violations).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`table-desktop-${locale}.png`) });
  });
}
