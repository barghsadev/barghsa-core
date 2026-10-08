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
async function story(page: Page, name: string, fa: boolean, theme: string) {
  await page.goto(
    origin + '/index.html?story=' + name + '&rtl=' + fa + '&theme=' + theme + '&mode=preview'
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
    for (const fallback of [false, true]) {
      test(`textarea counters, growth and reset preserve drafts (${mode}, ${fallback ? 'fallback' : 'native'})`, async ({
        page,
      }, info) => {
        test.skip(
          fallback && info.project.name !== 'chromium',
          'Forced fallback is covered in Chromium; other engines retain their actual CSS support.'
        );
        if (fallback)
          await page.addInitScript(() => {
            const supports = CSS.supports.bind(CSS);
            CSS.supports = ((property: string, value?: string) =>
              property === 'field-sizing'
                ? false
                : value === undefined
                  ? supports(property)
                  : supports(property, value)) as typeof CSS.supports;
          });
        await story(page, 'feedback--textareas', fa, theme);
        if (fallback)
          await page.addStyleTag({
            content: '[data-slot="textarea"] { field-sizing: fixed !important; }',
          });
        const message = page.getByRole('textbox', {
          name: fa ? 'متن درخواست' : 'Request message',
          exact: true,
        });
        const initial = await message.evaluate((node) => node.getBoundingClientRect().height);
        const content = (fa ? 'شرح درخواست\n' : 'Request details\n').repeat(20);
        await message.fill(content);
        await expect(message).toHaveValue(content);
        await expect
          .poll(() => message.evaluate((node) => node.getBoundingClientRect().height))
          .toBeGreaterThan(initial + 100);
        const descriptions = (await message.getAttribute('aria-describedby'))!.split(' ');
        expect(descriptions).toContain('message-help');
        const format = new Intl.NumberFormat(fa ? 'fa' : 'en');
        await expect(page.locator('[id="' + descriptions.at(-1) + '"]')).toHaveText(
          fa
            ? `${format.format(content.length)} از ${format.format(600)} نویسه`
            : `${format.format(content.length)} of 600 characters`
        );
        const note = page.getByRole('textbox', { name: fa ? 'یادداشت' : 'Note', exact: true });
        await note.fill('');
        await note.pressSequentially('a'.repeat(35));
        await expect(note).toHaveValue('a'.repeat(30));
        await expect(page.getByLabel(fa ? 'ارسال فرم' : 'Form submissions')).toHaveText('0');
        await expect(
          page.getByRole('textbox', { name: fa ? 'یادداشت نامعتبر' : 'Invalid note', exact: true })
        ).toHaveAttribute('aria-invalid', 'true');
        await expect(
          page.getByRole('textbox', { name: fa ? 'غیرفعال' : 'Disabled', exact: true })
        ).toBeDisabled();
        await expect(
          page.getByRole('textbox', { name: fa ? 'فقط خواندنی' : 'Read-only', exact: true })
        ).toHaveAttribute('readonly', '');
        await accessible(page);
        await page.screenshot({ path: info.outputPath('textarea.png'), fullPage: true });
        await page.getByRole('button', { name: fa ? 'بازنشانی' : 'Reset', exact: true }).click();
        await expect(message).toHaveValue('');
        await expect(note).toHaveValue('sample');
        await expect
          .poll(() => message.evaluate((node) => node.getBoundingClientRect().height))
          .toBe(initial);
        await expect(page.locator('[id="' + descriptions.at(-1) + '"]')).toHaveText(
          fa ? '۰ از ۶۰۰ نویسه' : '0 of 600 characters'
        );
        const noteDescription = (await note.getAttribute('aria-describedby'))!;
        await expect(page.locator('[id="' + noteDescription + '"]')).toHaveText(
          fa ? '۶ از ۳۰ نویسه' : '6 of 30 characters'
        );
        await page
          .getByRole('button', { name: fa ? 'تمرکز بر درخواست' : 'Focus request', exact: true })
          .click();
        await expect(message).toBeFocused();
        await expect(page.getByLabel(fa ? 'ارسال فرم' : 'Form submissions')).toHaveText('0');
      });
    }
    test(`alert severities, actions and dismissal preserve keyboard access (${mode})`, async ({
      page,
    }, info) => {
      await story(page, 'feedback--alerts', fa, theme);
      for (const variant of ['info', 'success', 'warning', 'error', 'critical'])
        await expect(page.getByRole('alert', { name: variant, exact: true })).toBeVisible();
      const critical = page.getByRole('alert', { name: 'critical', exact: true });
      expect(
        await critical.evaluate((node) => getComputedStyle(node, '::after').animationName)
      ).toBe('pulse');
      const retry = page.getByRole('button', { name: fa ? 'تلاش دوباره' : 'Retry', exact: true });
      await retry.focus();
      await retry.press('Enter');
      await expect(page.getByLabel(fa ? 'تعداد تلاش‌ها' : 'Retry count')).toHaveText('1');
      const close = page.getByRole('button', {
        name: fa ? 'بستن اعلان' : 'Dismiss notice',
        exact: true,
      });
      const r = await retry.boundingBox(),
        c = await close.boundingBox();
      expect(
        r &&
          c &&
          (r.y + r.height <= c.y ||
            c.y + c.height <= r.y ||
            r.x + r.width <= c.x ||
            c.x + c.width <= r.x)
      ).toBe(true);
      await accessible(page);
      await page.screenshot({ path: info.outputPath('alerts.png'), fullPage: true });
      await close.focus();
      await close.press('Space');
      await expect(
        page.getByRole('alert', {
          name: fa ? 'اعلان قابل بستن' : 'Dismissible notice',
          exact: true,
        })
      ).toHaveCount(0);
      await expect(page.getByLabel(fa ? 'تعداد تلاش‌ها' : 'Retry count')).toHaveText('1');
      await expect(
        page.getByRole('button', { name: fa ? 'مشاهده جزئیات' : 'View details', exact: true })
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: fa ? 'راهنمای پیگیری' : 'Follow-up help', exact: true })
      ).toHaveAttribute('href', '#help');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect(
        await critical.evaluate((node) => getComputedStyle(node, '::after').animationName)
      ).toBe('none');
    });
  }
