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
  await expect(
    page.locator('[data-closed][data-ending-style]').filter({ visible: true })
  ).toHaveCount(0);
  for (const selector of [
    '[data-slot="popover-content"]',
    '[data-slot="select-content"]',
    '[data-slot="combobox-popup"]',
    '[data-slot="dropdown-menu-content"]',
    '[data-slot="toast"]',
    '[data-sonner-toast]',
  ]) {
    const popup = page.locator(selector).filter({ visible: true });
    if (await popup.count()) {
      await expect(popup.first()).toHaveCSS('opacity', '1');
      expect(await popup.first().evaluate((node) => getComputedStyle(node).direction)).toBe(
        await page.locator('html').getAttribute('dir')
      );
      await expect(popup.first()).toHaveCSS('font-family', /Vazirmatn/);
      audit.include(selector);
    }
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
    test(`typed destructive confirmation withdraws changed targets and traps focus (${mode})`, async ({
      page,
    }) => {
      await page.setViewportSize(fa ? { width: 390, height: 844 } : { width: 1280, height: 900 });
      await story(page, 'workflows--protected-confirmations', fa, theme);
      const trigger = page.getByRole('button', {
        name: fa ? 'حذف نمونه' : 'Remove sample',
        exact: true,
      });
      await trigger.click();
      const dialog = page.getByRole('dialog');
      const cancel = dialog.getByRole('button', { name: fa ? 'انصراف' : 'Cancel', exact: true });
      const confirm = dialog.getByRole('button', {
        name: fa ? 'تأیید اقدام' : 'Confirm action',
        exact: true,
      });
      await expect(cancel).toBeFocused();
      await expect(confirm).toBeDisabled();
      await dialog.getByRole('textbox').fill(fa ? 'تایید' : 'confirm');
      await expect(confirm).toBeDisabled();
      await dialog.getByRole('textbox').fill(fa ? 'تأیید' : 'CONFIRM');
      await expect(confirm).toBeEnabled();
      await dialog.getByRole('button', { name: fa ? 'تغییر منبع' : 'Change resource' }).click();
      await expect(confirm).toBeDisabled();
      await expect(dialog.getByRole('textbox')).toHaveValue('');
      for (let index = 0; index < 8; index++) {
        await page.keyboard.press(index % 2 ? 'Shift+Tab' : 'Tab');
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
          true
        );
      }
      expect(
        (
          await new AxeBuilder({ page })
            .include('[role=dialog]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations
      ).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      await trigger.click();
      await expect(
        page
          .getByRole('dialog')
          .getByRole('button', { name: fa ? 'تأیید اقدام' : 'Confirm action', exact: true })
      ).toBeDisabled();
    });
    test(`financial confirmation requires acknowledgement and preserves exact amounts (${mode})`, async ({
      page,
    }, info) => {
      await page.setViewportSize(fa ? { width: 390, height: 844 } : { width: 1280, height: 900 });
      await story(page, 'workflows--protected-confirmations', fa, theme);
      await page
        .getByRole('button', { name: fa ? 'پرداخت نمونه' : 'Review payment', exact: true })
        .click();
      const dialog = page.getByRole('dialog');
      const confirm = dialog.getByRole('button', {
        name: fa ? 'تأیید اقدام' : 'Confirm action',
        exact: true,
      });
      await expect(
        dialog.getByRole('button', { name: fa ? 'انصراف' : 'Cancel', exact: true })
      ).toBeFocused();
      await expect(confirm).toBeDisabled();
      await expect(dialog).toContainText('9,007,199,254,740,993 IRR · 900,719,925,474,099.3 toman');
      await dialog.getByRole('checkbox').check();
      await expect(confirm).toBeEnabled();
      expect(
        (
          await new AxeBuilder({ page })
            .include('[role=dialog]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await page.screenshot({
        path: info.outputPath('financial-confirmation.png'),
        fullPage: true,
      });
      await confirm.click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('status')).toContainText(fa ? 'تأیید شد' : 'Confirmed');
    });
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

for (const fa of [false, true])
  for (const theme of ['light', 'dark']) {
    test(`active widgets, scrub controls and help links respect direction and theme (${fa ? 'fa' : 'en'}, ${theme})`, async ({
      page,
    }) => {
      await story(page, 'widgets--numbers', fa, theme);
      const number = page.getByRole('textbox', { name: fa ? 'مقدار' : 'Quantity', exact: true });
      const output = page.getByRole('status', {
        name: fa ? 'مقدار کنونی' : 'Current quantity',
        exact: true,
      });
      await number.press('ArrowUp');
      await expect(output).toHaveText('1235');
      await number.press('ArrowDown');
      await expect(output).toHaveText('1234.5');
      const scrub = page.locator('[data-slot="number-field-scrub"]');
      const bounds = await scrub.boundingBox();
      await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds!.x + bounds!.width / 2 + 60, bounds!.y + bounds!.height / 2, {
        steps: 12,
      });
      await page.mouse.up();
      await expect(output).not.toHaveText('1234.5');
      const quantity = Number(await output.textContent());
      expect(quantity).toBeGreaterThanOrEqual(0);
      expect(quantity).toBeLessThanOrEqual(5000);
      await expect(
        page.getByRole('textbox', {
          name: fa ? 'مقدار غیرفعال' : 'Disabled quantity',
          exact: true,
        })
      ).toBeDisabled();
      await expect(
        page.getByRole('textbox', {
          name: fa ? 'مقدار فقط خواندنی' : 'Read-only quantity',
          exact: true,
        })
      ).not.toBeEditable();
      await accessible(page);
      await story(page, 'workflows--statuses', fa, theme);
      for (const size of ['sm', 'default', 'lg']) {
        await expect(page.getByText('success · ' + size, { exact: true })).toHaveCount(2);
      }
      await expect(
        page.getByText(fa ? 'در انتظار بررسی' : 'Awaiting review', { exact: true })
      ).toHaveCount(3);
      await accessible(page);
      await story(page, 'widgets--multiple-choices', fa, theme);
      const services = page.getByRole('combobox', { name: fa ? 'خدمات' : 'Services', exact: true });
      await services.click();
      await page.getByRole('option', { name: 'Green', exact: true }).click();
      await expect(page.locator('[data-story-surface] output')).toHaveText('Thermal, Green');
      await accessible(page);
      await services.press('Escape');
      await page
        .getByRole('button', { name: (fa ? 'حذف ' : 'Remove ') + 'Green', exact: true })
        .click();
      await expect(page.locator('[data-story-surface] output')).toHaveText('Thermal');
      await page
        .getByRole('button', { name: fa ? 'پاک‌کردن انتخاب‌ها' : 'Clear choices', exact: true })
        .click();
      await expect(page.locator('[data-story-surface] output')).toHaveText('');
      await story(page, 'lists--filters', fa, theme);
      for (const name of [fa ? 'انتخاب' : 'Selection', fa ? 'چند انتخاب' : 'Multiple selections']) {
        const filter = page.getByRole('combobox', { name, exact: true });
        await filter.click();
        await expect(filter).toHaveAttribute('aria-expanded', 'true');
        await accessible(page);
        await filter.press('Escape');
        await expect(filter).toHaveAttribute('aria-expanded', 'false');
      }
      await story(page, 'widgets--dates', fa, theme);
      const date = page.getByRole('combobox', { name: fa ? 'تاریخ' : 'Date', exact: true });
      const before = await date.textContent();
      await date.press('Enter');
      const popup = page.locator('[data-slot="popover-content"]').filter({ visible: true });
      await expect(popup.getByRole('grid')).toBeVisible();
      await accessible(page);
      await popup.locator('button[data-day]:not([disabled])').nth(10).press('Enter');
      await expect(popup).toBeHidden();
      await expect(date).not.toHaveText(before!);
      await expect(date).toBeFocused();
      const range = page.getByRole('combobox', {
        name: fa ? 'بازه تاریخ' : 'Date range',
        exact: true,
      });
      await range.press('Enter');
      await popup.locator('button[data-day]:not([disabled])').nth(10).click();
      await popup.locator('button[data-day]:not([disabled])').nth(15).click();
      await expect(popup.locator('button[data-range-start=true]')).toHaveCount(1);
      await expect(popup.locator('button[data-range-end=true]')).toHaveCount(1);
      await accessible(page);
      await page.keyboard.press('Escape');
      await expect(popup).toBeHidden();
      await expect(range).toBeFocused();
      await story(page, 'overlays--rich-help', fa, theme);
      const help = page.getByRole('button', {
        name: fa ? 'راهنمای پیونددار' : 'Help with links',
        exact: true,
      });
      await help.press('Enter');
      const link = page.getByRole('link', {
        name: fa ? 'باز کردن راهنما' : 'Open guidance',
        exact: true,
      });
      await link.focus();
      await expect(link).toBeFocused();
      await expect(link).toHaveAttribute('href', '#guidance');
      await accessible(page);
      await link.press('Enter');
      await expect(page).toHaveURL(/#guidance$/);
      await page.keyboard.press('Escape');
      await expect(help).toBeFocused();
      await story(page, 'overlays--toasts', fa, theme);
      await page
        .getByRole('button', { name: fa ? 'نمایش اعلان' : 'Show notification', exact: true })
        .click();
      const toast = page.locator('[data-slot="toast"]');
      await expect(toast).toContainText(fa ? 'انجام شد' : 'Completed');
      await toast.focus();
      await expect(toast).toBeFocused();
      await toast.press('Tab');
      await expect(
        toast.getByRole('button', { name: fa ? 'بستن اعلان' : 'Close notification', exact: true })
      ).toBeFocused();
      await accessible(page);
      await toast
        .getByRole('button', { name: fa ? 'بستن اعلان' : 'Close notification', exact: true })
        .press('Enter');
      await expect(toast).toBeHidden();
      await story(page, 'overlays--sonner-notifications', fa, theme);
      await page.getByRole('button', { name: 'success', exact: true }).click();
      const notice = page.locator('[data-sonner-toast]');
      await expect(notice).toContainText(fa ? 'اعلان نمونه' : 'Sample notification');
      await accessible(page);
      await notice
        .getByRole('button', { name: fa ? 'بستن اعلان' : 'Close notification', exact: true })
        .click();
      await expect(notice).toBeHidden();
    });
  }
