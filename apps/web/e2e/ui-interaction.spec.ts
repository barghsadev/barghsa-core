import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { createStaticServer } from '../server.js';
import { test, expect } from './coverage-fixture';
import type { Page, Locator } from '@playwright/test';

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
  const audit = new AxeBuilder({ page }).include('[data-story-surface]');
  if (await page.locator('[data-slot="tooltip-content"][data-open]').count()) {
    await expect(page.locator('[data-slot="tooltip-content"][data-open]')).toHaveCSS(
      'opacity',
      '1'
    );
    audit.include('[data-slot="tooltip-content"][data-open]');
  }
  expect((await audit.withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual(
    []
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function inViewport(tab: Locator, viewport: Locator) {
  const t = await tab.boundingBox(),
    v = await viewport.boundingBox();
  return !!t && !!v && t.x >= v.x - 1 && t.x + t.width <= v.x + v.width + 1;
}
for (const fa of [false, true])
  for (const theme of ['light', 'dark']) {
    const mode = (fa ? 'fa' : 'en') + ', ' + theme;
    test(`tooltip descriptions retain focus, placement and disabled guidance (${mode})`, async ({
      page,
    }, info) => {
      await story(page, 'overlays--tooltips', fa, theme);
      for (const side of ['top', 'bottom', 'left', 'right']) {
        const trigger = page.getByRole('button', { name: side, exact: true });
        await trigger.focus();
        const tip = page.getByRole('tooltip');
        await expect(tip).toBeVisible();
        await expect(trigger).toBeFocused();
        await expect(tip).toHaveAttribute('data-side', side);
        await expect(trigger).toHaveAttribute(
          'aria-describedby',
          (await tip.getAttribute('id')) as string
        );
        await page.keyboard.press('Escape');
        await expect(tip).toHaveCount(0);
      }
      await story(page, 'overlays--tooltip-options', fa, theme);
      const rich = page.getByRole('button', {
        name: fa ? 'راهنمای توضیحی' : 'Descriptive guidance',
        exact: true,
      });
      await rich.focus();
      await expect(page.getByRole('tooltip').locator('strong')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      await page.getByRole('heading', { level: 1 }).hover();
      await rich.hover();
      await expect(page.getByRole('tooltip')).toBeVisible();
      await page
        .getByRole('button', { name: fa ? 'راهنمای خاموش' : 'Disabled tooltip', exact: true })
        .focus();
      await page.getByRole('heading', { level: 1 }).hover();
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      const unavailable = page.getByLabel(fa ? 'دلیل غیرفعال بودن' : 'Why unavailable', {
        exact: true,
      });
      await unavailable.focus();
      await expect(page.getByRole('tooltip')).toHaveText(
        fa
          ? 'این اقدام در وضعیت نمونه آماده نیست.'
          : 'This action is unavailable in the sample state.'
      );
      await expect(unavailable).toBeFocused();
      await accessible(page);
      await page.screenshot({
        path: `test-results/tooltip-${fa ? 'fa' : 'en'}-${theme}-${info.project.name}.png`,
      });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      await page
        .getByRole('button', { name: fa ? 'راهنمای خاموش' : 'Disabled tooltip', exact: true })
        .focus();
      await expect(page.getByRole('tooltip')).toHaveCount(0);
    });
    test(`custom grouped and native selections retain keyboard and clear behavior (${mode})`, async ({
      page,
    }) => {
      await story(page, 'overlays--custom-select', fa, theme);
      const select = page.getByRole('combobox');
      await select.focus();
      await select.press('ArrowDown');
      await expect(
        page.getByRole('group', { name: fa ? 'گزینه‌ها' : 'Options', exact: true })
      ).toBeVisible();
      await expect(
        page.getByRole('option', { name: fa ? 'غیرفعال' : 'Disabled', exact: true })
      ).toHaveAttribute('aria-disabled', 'true');
      await expect
        .poll(() =>
          page.getByRole('option').evaluateAll((nodes) => nodes.includes(document.activeElement!))
        )
        .toBe(true);
      await page.keyboard.press('ArrowDown');
      await expect(
        page.getByRole('option', { name: fa ? 'گزینه دو' : 'Option two', exact: true })
      ).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(select).toContainText(fa ? 'گزینه دو' : 'Option two');
      await select.press('ArrowDown');
      await expect(
        page.getByRole('group', { name: fa ? 'گزینه‌ها' : 'Options', exact: true })
      ).toBeVisible();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await expect(select).toContainText(fa ? 'گزینه دو' : 'Option two');
      await page.keyboard.press('Escape');
      await accessible(page);
      await story(page, 'widgets--choices', fa, theme);
      const native = page.getByRole('combobox', {
        name: fa ? 'انتخاب بومی' : 'Native select',
        exact: true,
      });
      await native.selectOption(fa ? 'تبریز' : 'Tabriz');
      await expect(native).toHaveValue(fa ? 'تبریز' : 'Tabriz');
      await expect(native.locator('optgroup')).toHaveAttribute('label', fa ? 'شهرها' : 'Cities');
      const city = page.getByRole('combobox', { name: fa ? 'شهر' : 'City', exact: true });
      await city.fill(fa ? 'شیراز' : 'Shiraz');
      await city.press('ArrowDown');
      await city.press('Enter');
      await page
        .getByRole('button', { name: fa ? 'پاک‌کردن شهر' : 'Clear city', exact: true })
        .click();
      await expect(city).toBeFocused();
      await expect(city).toHaveValue('');
      await accessible(page);
    });
    test(`command search uses arrows and skips disabled results (${mode})`, async ({ page }) => {
      await story(page, 'overlays--commands', fa, theme);
      const search = page.getByRole('combobox', {
        name: fa ? 'جستجوی اقدام' : 'Find action',
        exact: true,
      });
      await search.fill('Solar');
      await expect(page.getByRole('option')).toHaveCount(1);
      await search.press('ArrowDown');
      await search.press('Enter');
      await expect(page.getByRole('status')).toHaveText('Solar');
      await search.fill('not-a-command');
      await expect(
        page.getByText(fa ? 'نتیجه‌ای یافت نشد' : 'No results', { exact: true })
      ).toBeVisible();
      await search.fill('');
      await search.press('End');
      await expect(page.getByRole('option', { name: 'Disabled', exact: true })).toHaveAttribute(
        'aria-disabled',
        'true'
      );
      await search.press('Enter');
      await expect(page.getByRole('status')).toHaveText('Solar');
      await accessible(page);
    });
    test(`tab variants and both orientations preserve manual activation (${mode})`, async ({
      page,
    }) => {
      await story(page, 'overlays--tabs', fa, theme);
      for (const variant of ['default', 'line', 'underline', 'pills', 'boxed'])
        for (const orientation of ['horizontal', 'vertical']) {
          const list = page.getByRole('tablist', {
            name: variant + ' ' + orientation,
            exact: true,
          });
          await expect(list).toHaveAttribute(
            'data-variant',
            variant === 'default' || variant === 'underline' || variant === 'line'
              ? 'line'
              : variant === 'pills'
                ? 'default'
                : 'boxed'
          );
          await expect(list).toHaveAttribute('data-orientation', orientation);
          if (orientation === 'vertical')
            await expect(list).toHaveAttribute('aria-orientation', 'vertical');
          else expect(await list.getAttribute('aria-orientation')).toBeNull(); // Horizontal is the ARIA default.
          const first = list.getByRole('tab', { name: 'One', exact: true }),
            second = list.getByRole('tab', { name: 'Two', exact: true });
          await first.focus();
          await first.press(
            orientation === 'vertical' ? 'ArrowDown' : fa ? 'ArrowLeft' : 'ArrowRight'
          );
          await expect(second).toBeFocused();
          await expect(first).toHaveAttribute('aria-selected', 'true');
          await second.press('Enter');
          await expect(second).toHaveAttribute('aria-selected', 'true');
          await expect(list.getByRole('tab', { name: 'Disabled', exact: true })).toBeDisabled();
        }
      await accessible(page);
    });
    test(`scrolling tabs use logical edges, keyboard visibility and resize (${mode})`, async ({
      page,
    }, info) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 390, height: 844 });
      await story(page, 'overlays--scrolling-tabs', fa, theme);
      const previous = page.getByRole('button', {
        name: fa ? 'نمایش زبانه‌های قبلی' : 'Show previous tabs',
        exact: true,
      });
      const next = page.getByRole('button', {
        name: fa ? 'نمایش زبانه‌های بعدی' : 'Show next tabs',
        exact: true,
      });
      const viewport = page.locator('[data-slot="tabs-viewport"]');
      await expect(previous).toBeDisabled();
      await expect(next).toBeEnabled();
      await next.click();
      await expect(previous).toBeEnabled();
      const first = page.getByRole('tab', { name: fa ? 'خدمت 1' : 'Service 1', exact: true });
      const last = page.getByRole('tab', { name: fa ? 'خدمت 12' : 'Service 12', exact: true });
      await first.focus();
      await first.press('End');
      await expect(last).toBeFocused();
      await expect.poll(() => inViewport(last, viewport)).toBe(true);
      await last.press('Enter');
      await expect(last).toHaveAttribute('aria-selected', 'true');
      await expect(next).toBeDisabled();
      await expect(previous).toBeEnabled();
      await last.press('Home');
      await expect(first).toBeFocused();
      await expect.poll(() => inViewport(first, viewport)).toBe(true);
      await expect(previous).toBeDisabled();
      await accessible(page);
      await page.screenshot({
        path: `test-results/scrolling-tabs-${fa ? 'fa' : 'en'}-${theme}-${info.project.name}.png`,
      });
      await page.setViewportSize({ width: 1280, height: 960 });
      await expect(next).toBeEnabled();
      await expect.poll(() => inViewport(first, viewport)).toBe(true);
    });
  }
