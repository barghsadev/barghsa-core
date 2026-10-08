import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { createStaticServer } from '../server.js';
import { test, expect } from './coverage-fixture';
import type { Page } from '@playwright/test';

let server: ReturnType<typeof createStaticServer>, origin: string;
test.beforeAll(async () => {
  server = createStaticServer({
    distDir: fileURLToPath(new URL('../../../packages/ui/story-build/', import.meta.url)),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
test.afterAll(async () => {
  server?.closeAllConnections();
  await new Promise<void>((done) => server?.close(() => done()));
});
async function open(page: Page, name: string, fa: boolean, theme: string) {
  await page.goto(
    origin +
      '/index.html?story=pagination--' +
      name +
      '&rtl=' +
      fa +
      '&theme=' +
      theme +
      '&mode=preview'
  );
  await expect(page.locator('[data-story-surface]')).toBeVisible();
}
async function accessible(page: Page) {
  expect(
    (
      await new AxeBuilder({ page })
        .include('[data-story-surface]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
for (const fa of [false, true])
  for (const theme of ['light', 'dark']) {
    const mode = (fa ? 'fa' : 'en') + ', ' + theme;
    test(`offset pages retain ellipses, localized counts and owner-controlled sizes (${mode})`, async ({
      page,
    }, info) => {
      await open(page, 'offset', fa, theme);
      const number = (n: number) => new Intl.NumberFormat(fa ? 'fa' : 'en').format(n),
        summary = page.locator('[data-slot="pagination-summary"]'),
        nav = page.getByRole('navigation', { name: fa ? 'صفحه‌بندی' : 'Pagination', exact: true }),
        changes = page.getByRole('status', { name: fa ? 'تعداد تغییرها' : 'Change count' }),
        size = page.getByRole('combobox', { name: fa ? 'تعداد در صفحه' : 'Page size' }),
        pageButton = (n: number) =>
          nav.getByRole('button', { name: (fa ? 'صفحه ' : 'Page ') + number(n), exact: true });
      await expect(summary).toHaveText(
        (fa ? 'نمایش ' : 'Showing ') +
          number(41) +
          '–' +
          number(50) +
          (fa ? ' از ' : ' of ') +
          number(154)
      );
      await expect(pageButton(5)).toHaveAttribute('aria-current', 'page');
      await expect(nav.getByText('…', { exact: true })).toHaveCount(2);
      await expect(size.locator('option')).toHaveText([10, 20, 50, 100].map(number));
      await pageButton(5).click();
      await expect(changes).toHaveText('0');
      await nav.getByRole('button', { name: fa ? 'بعدی' : 'Next', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(pageButton(6)).toHaveAttribute('aria-current', 'page');
      await expect(changes).toHaveText('1');
      await pageButton(16).click();
      await expect(summary).toContainText(number(151) + '–' + number(154));
      await expect(
        nav.getByRole('button', { name: fa ? 'بعدی' : 'Next', exact: true })
      ).toBeDisabled();
      await size.selectOption('20');
      await expect(pageButton(1)).toHaveAttribute('aria-current', 'page');
      await expect(summary).toContainText(number(1) + '–' + number(20));
      await expect(changes).toHaveText('3');
      await page.getByRole('button', { name: fa ? 'تغییر انتظار' : 'Toggle pending' }).click();
      for (const button of await nav.getByRole('button').all()) await expect(button).toBeDisabled();
      await expect(size).toBeDisabled();
      await expect(changes).toHaveText('3');
      await page.getByRole('button', { name: fa ? 'تغییر انتظار' : 'Toggle pending' }).click();
      await accessible(page);
      await page.screenshot({ path: info.outputPath('offset.png'), fullPage: true });
      await page.getByRole('button', { name: fa ? 'نمایش خالی' : 'Show empty' }).click();
      await expect(summary).toHaveText(
        (fa ? 'نمایش ' : 'Showing ') +
          number(0) +
          '–' +
          number(0) +
          (fa ? ' از ' : ' of ') +
          number(0)
      );
      await expect(
        nav.getByRole('button', { name: fa ? 'قبلی' : 'Previous', exact: true })
      ).toBeDisabled();
      await expect(
        nav.getByRole('button', { name: fa ? 'بعدی' : 'Next', exact: true })
      ).toBeDisabled();
    });
    test(`cursor history stays navigable at exhaustion and blocks duplicate pending actions (${mode})`, async ({
      page,
    }, info) => {
      await open(page, 'cursor', fa, theme);
      const nav = page.getByRole('navigation', {
          name: fa ? 'صفحه‌بندی نشانگر' : 'Cursor pagination',
        }),
        previous = nav.getByRole('button', { name: fa ? 'قبلی' : 'Previous', exact: true }),
        next = nav.getByRole('button', { name: fa ? 'بعدی' : 'Next', exact: true }),
        changes = page.getByRole('status', { name: fa ? 'تعداد تغییرها' : 'Change count' });
      await expect(previous).toBeDisabled();
      await next.focus();
      await page.keyboard.press('Enter');
      await expect(changes).toHaveText('1');
      await next.click();
      await expect(changes).toHaveText('2');
      await expect(next).toBeDisabled();
      await expect(previous).toBeEnabled();
      await previous.click();
      await expect(changes).toHaveText('3');
      await expect(page.locator('[data-slot="pagination-summary"]')).toHaveText(
        (fa ? 'بخش ' : 'Batch ') + '2'
      );
      await page.getByRole('button', { name: fa ? 'تغییر انتظار' : 'Toggle pending' }).click();
      await expect(previous).toBeDisabled();
      await expect(next).toBeDisabled();
      await expect(changes).toHaveText('3');
      await page.getByRole('button', { name: fa ? 'تغییر انتظار' : 'Toggle pending' }).click();
      await accessible(page);
      await page.screenshot({ path: info.outputPath('cursor.png'), fullPage: true });
    });
  }
