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
    test(`accordion single and multiple sections preserve keyboard focus (${mode})`, async ({
      page,
    }, info) => {
      await story(page, 'controls--accordions', fa, theme);
      const single = page.getByRole('region', { name: 'single', exact: true });
      const faq = single.getByRole('button', { name: fa ? 'پرسش‌های رایج' : 'FAQ', exact: true });
      const settings = single.getByRole('button', {
        name: fa ? 'تنظیمات' : 'Settings',
        exact: true,
      });
      await expect(faq).toHaveAttribute('aria-expanded', 'true');
      await settings.focus();
      await settings.press('Enter');
      await expect(settings).toBeFocused();
      await expect(settings).toHaveAttribute('aria-expanded', 'true');
      await expect(faq).toHaveAttribute('aria-expanded', 'false');
      await expect(settings.locator('svg')).toHaveCSS('rotate', '180deg');
      await expect(
        page.locator('[id="' + (await settings.getAttribute('aria-controls')) + '"]')
      ).toBeVisible();
      await settings.press('Space');
      await expect(settings).toHaveAttribute('aria-expanded', 'false');
      const disabled = single.getByRole('button', {
        name: fa ? 'غیرفعال' : 'Disabled',
        exact: true,
      });
      await expect(disabled).toBeDisabled();
      await disabled.focus();
      await disabled.press('Enter');
      await expect(disabled).toHaveAttribute('aria-expanded', 'false');
      await expect(disabled).toHaveCSS('opacity', '0.5');
      const multiple = page.getByRole('region', { name: 'multiple', exact: true });
      for (const name of [fa ? 'پرسش‌های رایج' : 'FAQ', fa ? 'تنظیمات' : 'Settings'])
        await multiple.getByRole('button', { name, exact: true }).click();
      await expect(
        multiple.locator('[data-slot="accordion-trigger"][aria-expanded="true"]')
      ).toHaveCount(2);
      await accessible(page);
      await page.screenshot({ path: info.outputPath('accordion.png'), fullPage: true });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(multiple.locator('[data-slot="accordion-content"]').first()).toHaveCSS(
        'animation-name',
        'none'
      );
    });
    test(`boolean labels, mixed selection and radio layouts retain form boundaries (${mode})`, async ({
      page,
    }, info) => {
      await story(page, 'controls--boolean-states', fa, theme);
      const choice = page.getByRole('checkbox', {
        name: fa ? 'نمایش جزئیات' : 'Show details',
        exact: true,
      });
      await choice.focus();
      await choice.press('Enter');
      await expect(choice).toBeChecked();
      await expect(page.getByLabel(fa ? 'ارسال فرم' : 'Form submissions')).toHaveText('0');
      await choice.press('Space');
      await expect(choice).not.toBeChecked();
      const mixed = page.getByRole('checkbox', {
        name: fa ? 'انتخاب بخشی' : 'Partial selection',
        exact: true,
      });
      await expect(mixed).toHaveAttribute('aria-checked', 'mixed');
      await expect(mixed.locator('svg.lucide-minus')).toBeVisible();
      await expect(mixed.locator('svg.lucide-check')).toBeHidden();
      await expect(
        page.getByRole('checkbox', { name: fa ? 'انتخاب الزامی' : 'Required choice', exact: true })
      ).toHaveAttribute('aria-invalid', 'true');
      const setting = page.getByRole('switch', {
        name: fa ? 'اعلان‌ها' : 'Notifications',
        exact: true,
      });
      await setting.focus();
      await setting.press('Space');
      await expect(setting).toBeChecked();
      await page.getByText(fa ? 'اعلان‌ها' : 'Notifications', { exact: true }).click();
      await expect(setting).not.toBeChecked();
      await expect(
        page.getByRole('switch', { name: fa ? 'تنظیم غیرفعال' : 'Disabled setting', exact: true })
      ).toBeDisabled();
      const readOnly = page.getByRole('switch', {
        name: fa ? 'تنظیم فقط خواندنی' : 'Read-only setting',
        exact: true,
      });
      await readOnly.focus();
      await readOnly.press('Space');
      await expect(readOnly).toBeChecked();
      for (const layout of ['horizontal', 'vertical']) {
        const group = page.getByRole('radiogroup', { name: layout, exact: true });
        await expect(group).toHaveAttribute('aria-invalid', 'true');
        const one = group.getByRole('radio', { name: fa ? 'گزینه یک' : 'Option one', exact: true });
        const two = group.getByRole('radio', { name: fa ? 'گزینه دو' : 'Option two', exact: true });
        await one.focus();
        await one.press('ArrowDown');
        await expect(two).toBeChecked();
        await expect(two).toBeFocused();
        await expect(
          group.getByRole('radio', { name: fa ? 'غیرفعال' : 'Disabled', exact: true })
        ).toBeDisabled();
        const boxes = await group.getByRole('radio').evaluateAll((nodes) =>
          nodes.map((node) => {
            const r = node.getBoundingClientRect();
            return { x: r.x, y: r.y };
          })
        );
        expect(
          layout === 'horizontal'
            ? Math.abs(boxes[0]!.y - boxes[1]!.y)
            : Math.abs(boxes[0]!.x - boxes[1]!.x)
        ).toBeLessThan(2);
      }
      await accessible(page);
      await page.screenshot({ path: info.outputPath('boolean.png'), fullPage: true });
    });
    test(`progress variants, custom tracks and reduced motion preserve semantics (${mode})`, async ({
      page,
    }, info) => {
      await story(page, 'controls--progress-states', fa, theme);
      for (const variant of ['default', 'success', 'warning']) {
        const root = page
          .locator('[data-slot="progress"][data-variant="' + variant + '"]')
          .filter({ has: page.locator('[data-slot="progress-label"]') });
        await expect(root).toHaveAttribute('role', 'progressbar');
        await expect(root).toHaveAttribute('aria-valuenow', variant === 'success' ? '100' : '65');
        const color = await root.evaluate(
          (node, token) =>
            getComputedStyle(node)
              .getPropertyValue('--' + token)
              .trim(),
          variant === 'default' ? 'primary' : variant
        );
        expect(
          await root.locator('[data-slot="progress-indicator"]').evaluate((node, token) => {
            const probe = document.createElement('span');
            probe.style.color = token;
            node.append(probe);
            const expected = getComputedStyle(probe).color;
            probe.remove();
            return getComputedStyle(node).backgroundColor === expected;
          }, color)
        ).toBe(true);
      }
      const stripe = page.locator('[data-striped] [data-slot="progress-indicator"]');
      await expect(stripe).toHaveCSS('animation-name', 'progress-stripes');
      await expect(stripe).not.toHaveCSS('background-image', 'none');
      const waiting = page.getByRole('progressbar', {
        name: fa ? 'در انتظار پاسخ' : 'Waiting for response',
        exact: true,
      });
      await expect(waiting).not.toHaveAttribute('aria-valuenow');
      const custom = page.getByRole('progressbar', {
        name: fa ? 'مسیر سفارشی' : 'Custom track',
        exact: true,
      });
      await expect(custom.locator('[data-slot="progress-track"]')).toHaveCount(1);
      await accessible(page);
      await page.screenshot({ path: info.outputPath('progress.png'), fullPage: true });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(stripe).toHaveCSS('animation-name', 'none');
    });
    test(`single and range sliders enforce steps, bounds and RTL navigation (${mode})`, async ({
      page,
    }) => {
      await story(page, 'widgets--sliders', fa, theme);
      const single = page.getByRole('slider', { name: fa ? 'درصد' : 'Percentage', exact: true });
      await single.focus();
      await single.press(fa ? 'ArrowLeft' : 'ArrowRight');
      await expect(single).toHaveAttribute('aria-valuenow', '40');
      await single.press('Home');
      await expect(single).toHaveAttribute('aria-valuenow', '0');
      await single.press('End');
      await expect(single).toHaveAttribute('aria-valuenow', '100');
      const start = page.getByRole('slider', { name: fa ? 'شروع' : 'Start', exact: true });
      const end = page.getByRole('slider', { name: fa ? 'پایان' : 'End', exact: true });
      await start.focus();
      await start.press('ArrowUp');
      await expect(start).toHaveAttribute('aria-valuenow', '21');
      await expect(end).toHaveAttribute('aria-valuenow', '80');
      await start.press('End');
      expect(Number(await start.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(
        Number(await end.getAttribute('aria-valuenow'))
      );
      await expect(
        page.getByRole('slider', { name: fa ? 'غیرفعال' : 'Disabled', exact: true })
      ).toBeDisabled();
      await accessible(page);
    });
  }
