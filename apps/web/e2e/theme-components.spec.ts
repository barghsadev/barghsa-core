import AxeBuilder from '@axe-core/playwright';
import { test, expect, registerComponentCoverage } from './coverage-fixture';
import { build, preview, type PreviewServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Locator } from '@playwright/test';

// Build the real shared component outside the product routes and production output.
test.use({ timezoneId: 'UTC' });

let server: PreviewServer;
let outDir: string;
let url: string;
test.beforeAll(async () => {
  const coverageDir = process.env['BARGHSA_BROWSER_COVERAGE_DIR'];
  const buildParent = coverageDir ? join(coverageDir, 'builds') : tmpdir();
  await mkdir(buildParent, { recursive: true });
  outDir = await mkdtemp(join(buildParent, 'component-theme-'));
  const root = resolve('e2e/fixtures/theme');
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
  for (const darkMode of [false, true]) {
    test(`form controls preserve focus and direction (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            appTitle: 'Controls',
            slogan: '',
            primaryColor: '#777777',
            secondaryColor: '#64748b',
            accentColor: '#f59e0b',
            logoUrl: null,
            faviconUrl: null,
            darkMode,
          },
        })
      );
      await page.goto(`${url}?${locale}`);
      await expect
        .poll(() => page.locator('html').evaluate((e) => e.style.getPropertyValue('--primary')))
        .toBe('#777777');
      await page.keyboard.press('Tab');
      const focusRing = async (control: Locator, visual: Locator = control) => {
        await control.focus();
        await expect(control).toBeFocused();
        expect.soft(await control.evaluate((e) => e.matches(':focus-visible'))).toBe(true);
        const style = await visual.evaluate((e) => {
          const css = getComputedStyle(e);
          return {
            shadow: css.boxShadow,
            offset: css.getPropertyValue('--tw-ring-offset-width'),
          };
        });
        expect.soft(style.shadow).toContain('0px 0px 0px 4px');
        expect.soft(style.offset).toBe('2px');
      };
      for (const name of ['Name', 'Invalid name', 'Notes'])
        await focusRing(page.getByRole('textbox', { name, exact: true }));
      const checkbox = page.getByRole('checkbox', { name: 'Consent', exact: true });
      await focusRing(checkbox);
      await checkbox.press('Space');
      await expect(checkbox).toBeChecked();
      await checkbox.press('Enter');
      await expect(checkbox).not.toBeChecked();
      await expect(page.getByLabel('Form submissions')).toHaveText('0');
      const readOnly = page.getByRole('checkbox', { name: 'Read-only consent', exact: true });
      await readOnly.press('Space');
      await readOnly.press('Enter');
      await expect(readOnly).toBeChecked();
      const intercepted = page.getByRole('checkbox', { name: 'Intercepted consent', exact: true });
      await intercepted.press('Enter');
      await expect(intercepted).not.toBeChecked();
      await expect(
        page.getByRole('checkbox', { name: 'Unavailable consent', exact: true })
      ).toBeDisabled();
      const toggle = page.getByRole('switch', { name: 'Alerts', exact: true });
      await focusRing(toggle);
      await toggle.press('Space');
      await expect(toggle).toBeChecked();
      const thumb = await toggle.locator('[data-slot="switch-thumb"]').boundingBox();
      const toggleBox = (await toggle.boundingBox())!;
      if (locale === 'fa') expect.soft(thumb!.x).toBeLessThan(toggleBox.x + toggleBox.width / 2);
      else expect.soft(thumb!.x).toBeGreaterThan(toggleBox.x + toggleBox.width / 2 - 2);
      await focusRing(page.getByRole('radio', { name: 'Email', exact: true }));
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('radio', { name: 'SMS', exact: true })).toBeChecked();
      await focusRing(page.getByRole('tab', { name: 'One', exact: true }));
      await page.keyboard.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('tab', { name: 'Two', exact: true })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      const tabBox = (await page
        .getByRole('tablist', { name: 'Sections', exact: true })
        .boundingBox())!;
      const panelBox = (await page
        .getByRole('tabpanel', { name: 'Two', exact: true })
        .boundingBox())!;
      expect(panelBox.y).toBeGreaterThanOrEqual(tabBox.y + tabBox.height);
      const native = page.getByRole('combobox', { name: 'Native category', exact: true });
      await focusRing(native);
      await native.selectOption('two');
      await expect(native).toHaveValue('two');
      const horizontalSeparator = (await page
        .locator('[data-slot=separator]')
        .nth(0)
        .boundingBox())!;
      const verticalSeparator = (await page.locator('[data-slot=separator]').nth(1).boundingBox())!;
      expect(horizontalSeparator.width).toBeGreaterThan(100);
      expect(horizontalSeparator.height).toBe(1);
      expect(verticalSeparator.width).toBe(1);
      expect(verticalSeparator.height).toBeGreaterThan(10);
      const track = (await page.locator('[data-slot=slider-track]').first().boundingBox())!;
      expect(track.width).toBeGreaterThan(100);
      expect(track.height).toBeGreaterThanOrEqual(4);
      const sliders = page.getByRole('slider', { name: 'Volume', exact: true });
      await expect(sliders).toHaveCount(1);
      await focusRing(sliders, page.locator('[data-slot=slider-thumb]').filter({ has: sliders }));
      await sliders.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
      await expect(sliders).toHaveAttribute('aria-valuenow', '51');
      await expect(page.getByRole('slider', { name: 'Minimum', exact: true })).toHaveAttribute(
        'aria-valuenow',
        '25'
      );
      await expect(page.getByRole('slider', { name: 'Maximum', exact: true })).toHaveAttribute(
        'aria-valuenow',
        '75'
      );
      const viewport = page.locator('[data-slot="scroll-area-viewport"]');
      await focusRing(viewport);
      await viewport.press('PageDown');
      await expect.poll(() => viewport.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
      const scrollbar = page.locator('[data-slot=scroll-area-scrollbar]');
      await expect(scrollbar).toBeVisible();
      expect((await scrollbar.boundingBox())!.width).toBeGreaterThan(0);
      await focusRing(page.getByRole('link', { name: 'default badge', exact: true }));
      const select = page.getByRole('combobox', { name: 'Category', exact: true });
      await focusRing(select);
      await select.press('Enter');
      const selected = page.getByRole('option', { name: 'Alpha', exact: true });
      await expect(selected).toBeVisible();
      await focusRing(selected);
      const marker = (await selected.locator('span.absolute').boundingBox())!;
      const selectedBox = (await selected.boundingBox())!;
      if (locale === 'fa')
        expect.soft(marker.x).toBeLessThan(selectedBox.x + selectedBox.width / 2);
      else expect.soft(marker.x).toBeGreaterThan(selectedBox.x + selectedBox.width / 2);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(select).toContainText(/beta/i);
      const actions = page.getByRole('button', { name: 'Actions', exact: true });
      await actions.focus();
      await actions.press('Enter');
      const checked = page.getByRole('menuitemcheckbox', { name: 'Selected action', exact: true });
      await expect(checked).toBeVisible();
      await focusRing(checked);
      const indicator = (await checked
        .locator('[data-slot="dropdown-menu-checkbox-item-indicator"]')
        .boundingBox())!;
      const itemBox = (await checked.boundingBox())!;
      if (locale === 'fa') expect.soft(indicator.x).toBeLessThan(itemBox.x + itemBox.width / 2);
      else expect.soft(indicator.x).toBeGreaterThan(itemBox.x + itemBox.width / 2);
      await focusRing(page.getByRole('menuitem', { name: 'Remove item', exact: true }));
      const violations = (await new AxeBuilder({ page }).withRules(['color-contrast']).analyze())
        .violations;
      expect
        .soft(
          violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
          }))
        )
        .toEqual([]);
      await focusRing(page.getByRole('menuitem', { name: 'More', exact: true }));
      await page.keyboard.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
      await expect(
        page.getByRole('menuitem', { name: 'Nested action', exact: true })
      ).toBeVisible();
      const nested = page.getByRole('menuitem', { name: 'Nested action', exact: true });
      const nestedBox = (await nested.boundingBox())!;
      const parentBox = (await page
        .getByRole('menuitem', { name: 'More', exact: true })
        .boundingBox())!;
      if (locale === 'fa') expect(nestedBox.x + nestedBox.width).toBeLessThanOrEqual(parentBox.x);
      else expect(nestedBox.x).toBeGreaterThanOrEqual(parentBox.x + parentBox.width);
      await nested.screenshot({ path: `/tmp/r03-controls-submenu-${locale}-${darkMode}.png` });
      await page.screenshot({
        path: `/tmp/r03-controls-${locale}-${darkMode}.png`,
        fullPage: true,
      });
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(actions).toBeFocused();
      await expect(page.getByRole('textbox', { name: 'Unavailable', exact: true })).toBeDisabled();
    });
  }

for (const locale of ['en', 'fa'])
  for (const darkMode of [false, true])
    test(`shared controls remain readable and focused (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
      for (const primaryColor of ['#2563eb', '#777777', '#ffffff']) {
        await page.route('**/api/public/branding/config', (route) =>
          route.fulfill({
            json: {
              appTitle: 'Theme checks',
              slogan: '',
              primaryColor,
              secondaryColor: '#64748b',
              accentColor: '#f59e0b',
              logoUrl: null,
              faviconUrl: null,
              darkMode,
            },
          })
        );
        await page.goto(`${url}?${locale}`);
        await expect
          .poll(() =>
            page.locator('html').evaluate((element) => element.style.getPropertyValue('--primary'))
          )
          .toBe(primaryColor);
        expect
          .soft(
            (
              await new AxeBuilder({ page }).include('main').withRules(['color-contrast']).analyze()
            ).violations.map((v) => ({
              id: v.id,
              nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
            })),
            primaryColor
          )
          .toEqual([]);
        for (const variant of ['default', 'secondary', 'destructive', 'link']) {
          const button = page.getByRole('button', { name: variant, exact: true });
          await button.hover();
          expect
            .soft(
              (
                await new AxeBuilder({ page })
                  .include('main')
                  .withRules(['color-contrast'])
                  .analyze()
              ).violations.map((v) => ({
                id: v.id,
                nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
              })),
              `${primaryColor} ${variant} hover`
            )
            .toEqual([]);
        }
        for (const variant of ['default', 'secondary', 'destructive', 'outline', 'ghost', 'link']) {
          await page.getByRole('link', { name: `${variant} badge`, exact: true }).hover();
          const failures = (
            await new AxeBuilder({ page }).include('main').withRules(['color-contrast']).analyze()
          ).violations;
          expect
            .soft(
              failures.map((v) => ({
                id: v.id,
                nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
              })),
              `${primaryColor} ${variant} badge`
            )
            .toEqual([]);
        }
        await page.getByRole('button', { name: 'default', exact: true }).focus();
        await page.keyboard.press('Tab');
        const focused = page.getByRole('button', { name: 'outline', exact: true });
        await expect(focused).toBeFocused();
        expect(await focused.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe(
          'none'
        );
        await page.emulateMedia({ reducedMotion: 'reduce' });
        expect(
          await focused.evaluate((element) => getComputedStyle(element).transitionDuration)
        ).toBe('0s');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.unroute('**/api/public/branding/config');
      }
    });

for (const locale of ['en', 'fa'])
  for (const darkMode of [false, true]) {
    test(`auxiliary controls mirror and support keyboard (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            appTitle: 'Controls',
            slogan: '',
            primaryColor: '#777777',
            secondaryColor: '#64748b',
            accentColor: '#f59e0b',
            logoUrl: null,
            faviconUrl: null,
            darkMode,
          },
        })
      );
      await page.goto(`${url}?${locale}`);
      await expect
        .poll(() => page.locator('html').evaluate((e) => e.style.getPropertyValue('--primary')))
        .toBe('#777777');
      const auxiliary = page.getByRole('region', { name: 'Auxiliary controls' });
      const atEnd = async (outer: Locator, inner: Locator) => {
        const box = (await outer.boundingBox())!,
          child = (await inner.boundingBox())!;
        expect(
          Math.abs(locale === 'fa' ? child.x - box.x : box.x + box.width - child.x - child.width)
        ).toBeLessThanOrEqual(12);
      };
      await atEnd(
        auxiliary.locator('[data-slot=avatar]'),
        auxiliary.locator('[data-slot=avatar-badge]')
      );
      await atEnd(
        auxiliary.locator('[data-slot=progress]'),
        auxiliary.locator('[data-slot=progress-value]')
      );
      const track = (await auxiliary.locator('[data-slot=progress-track]').boundingBox())!;
      const indicator = (await auxiliary.locator('[data-slot=progress-indicator]').boundingBox())!;
      expect(indicator.width / track.width).toBeCloseTo(0.25, 2);
      expect(
        Math.abs(
          locale === 'fa'
            ? track.x + track.width - indicator.x - indicator.width
            : indicator.x - track.x
        )
      ).toBeLessThan(1);
      const input = auxiliary.getByRole('combobox', { name: 'Actions', exact: true });
      await page.keyboard.press('Tab');
      await input.focus();
      const shadow = await auxiliary
        .locator('[data-slot=input-group]')
        .evaluate((e) => getComputedStyle(e).boxShadow);
      expect(shadow).toContain('0px 0px 0px 4px');
      const alpha = auxiliary.getByRole('option', { name: /^Alpha/ });
      await expect(alpha).toHaveAttribute('aria-selected', 'true');
      await atEnd(alpha, alpha.locator('[data-slot=command-shortcut]'));
      const beta = auxiliary.getByRole('option', { name: 'Beta', exact: true });
      expect(await beta.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(
        'rgba(0, 0, 0, 0)'
      );
      await input.press('ArrowDown');
      await expect(beta).toHaveAttribute('aria-selected', 'true');
      expect(await beta.evaluate((e) => getComputedStyle(e).boxShadow)).toContain(
        '0px 0px 0px 4px'
      );
      await input.press('Enter');
      await expect(auxiliary.getByLabel('Selected command')).toHaveText('beta');
      await input.fill('not-present');
      await expect(auxiliary.getByText('No matches', { exact: true })).toBeVisible();
      await input.clear();
      await auxiliary.getByRole('button', { name: 'Open commands' }).click();
      const dialog = page.getByRole('dialog', { name: locale === 'fa' ? 'دستورها' : 'Commands' });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAccessibleDescription(
        locale === 'fa' ? 'یک دستور انتخاب کنید' : 'Choose a command'
      );
      await expect(
        dialog.getByRole('button', { name: locale === 'fa' ? 'بستن' : 'Close', exact: true })
      ).toBeVisible();
      await expect(dialog.getByRole('combobox')).toBeFocused();
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-slot=dialog-content]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations
      ).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await auxiliary.getByRole('button', { name: 'Show toast' }).click();
      const toast = page.locator('[data-slot=toast]');
      await expect(toast).toContainText(locale === 'fa' ? 'ذخیره شد' : 'Saved');
      const toastBox = (await toast.boundingBox())!;
      const width = page.viewportSize()!.width;
      expect(
        Math.abs(locale === 'fa' ? toastBox.x - 16 : width - toastBox.x - toastBox.width - 16)
      ).toBeLessThan(2);
      await toast.focus();
      await page.keyboard.press('Tab');
      await expect(
        toast.getByRole('button', { name: locale === 'fa' ? 'بستن' : 'Close', exact: true })
      ).toBeVisible();
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-slot=toast]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations
      ).toEqual([]);
      await toast
        .getByRole('button', { name: locale === 'fa' ? 'بستن' : 'Close', exact: true })
        .click();
      await expect(toast).toHaveCount(0);
      await expect(
        auxiliary.getByRole('status', { name: locale === 'fa' ? 'در حال بارگذاری' : 'Loading' })
      ).toBeVisible();
      const shapes = auxiliary.getByLabel('Placeholder shapes').locator('[data-slot=skeleton]');
      for (const [index, height] of [128, 40, 32].entries()) {
        expect((await shapes.nth(index).boundingBox())!.height).toBe(height);
        expect(
          await shapes.nth(index).evaluate((e) => getComputedStyle(e, '::after').animationName)
        ).toBe('none');
      }
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await expect
        .poll(() => shapes.first().evaluate((e) => getComputedStyle(e, '::after').animationName))
        .toBe('shimmer');
    });
  }
