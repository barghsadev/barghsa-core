import { feedbackText } from '@barghsa/i18n/feedback';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, registerComponentCoverage } from './coverage-fixture';
import { build, preview, type PreviewServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Locator } from '@playwright/test';
import { measureControlContrast } from './control-contrast';

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

for (const locale of ['en', 'fa'] as const) {
  test(`popup actions have full touch targets (${locale})`, async ({ page }, info) => {
    test.skip(!info.project.use.hasTouch, 'Requires a coarse pointer');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${url}?${locale}`);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);

    const checkTargets = async (targets: Locator) => {
      for (const target of await targets.all()) {
        const { width, height, scale, name } = await target.evaluate((node) => {
          const { width, height } = node.getBoundingClientRect();
          return { width, height, scale: devicePixelRatio, name: node.textContent?.trim() };
        });
        expect.soft(Math.round(width * scale), `${name} width`).toBeGreaterThanOrEqual(44 * scale);
        expect
          .soft(Math.round(height * scale), `${name} height`)
          .toBeGreaterThanOrEqual(44 * scale);
      }
    };

    const select = page.getByRole('combobox', { name: 'Category', exact: true });
    await select.tap();
    const list = page.locator('[data-slot=select-content]').getByRole('listbox');
    await expect(list.getByRole('option')).toHaveCount(2);
    await checkTargets(list.getByRole('option'));
    await list.getByRole('option', { name: 'Beta', exact: true }).tap();
    await expect(select).toContainText(/beta/i);

    const actions = page.getByRole('button', { name: 'Actions', exact: true });
    await actions.tap();
    const menu = page.getByRole('menu');
    const checkbox = menu.getByRole('menuitemcheckbox', { name: 'Selected action', exact: true });
    await expect(checkbox).toBeChecked();
    await expect(menu.getByRole('menuitem')).toHaveCount(2);
    await checkTargets(checkbox);
    await checkTargets(menu.getByRole('menuitem'));
    await checkbox.tap();
    await expect(checkbox).not.toBeChecked();
    await page.keyboard.press('Escape');

    const dialogTrigger = page.getByRole('button', { name: 'Open commands', exact: true });
    await dialogTrigger.tap();
    const dialog = page.getByRole('dialog');
    const command = dialog.getByRole('option', { name: 'Run', exact: true });
    await expect(command).toBeVisible();
    await checkTargets(command);
    await command.tap();
    await expect(dialog).toBeHidden();
  });
}

for (const locale of ['en', 'fa'] as const)
  for (const darkMode of [false, true])
    test(`essential control contrast meets 3:1 (${locale}, dark=${darkMode})`, async ({
      page,
    }, info) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const base = {
        appTitle: 'Control contrast',
        appTitleFa: 'کنتراست کنترل‌ها',
        supportEmail: 'support@example.test',
        supportPhone: '02126658042',
        supportMobile: '09002550292',
        slogan: '',
        primaryColor: '#156558',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        logoUrl: null,
        faviconUrl: null,
        darkMode,
      };
      const edge = darkMode ? '#6b6b6b' : '#999999';
      let palette: typeof base & { backgroundColor?: string; darkBackgroundColor?: string } = base;
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({ json: palette })
      );
      const rows: Array<{ palette: string; high: boolean; cue: string; ratio: number }> = [];
      const textFailures: Array<{ palette: string; high: boolean; nodes: unknown[] }> = [];
      for (const variant of ['default', 'brand-limit'] as const) {
        if (variant === 'brand-limit')
          palette = {
            ...base,
            primaryColor: edge,
            backgroundColor: '#999999',
            darkBackgroundColor: '#6b6b6b',
          };
        for (const high of [false, true]) {
          await page.goto(`${url}?${locale}`);
          await expect
            .poll(() =>
              page.locator('html').evaluate((node) => node.style.getPropertyValue('--primary'))
            )
            .toBe(palette.primaryColor);
          await page.locator('html').evaluate((node, value) => {
            if (value) node.dataset.contrast = 'more';
          }, high);
          const text = await new AxeBuilder({ page })
            .include('main')
            .withRules(['color-contrast'])
            .analyze();
          const nodes = text.violations.flatMap((item) =>
            item.nodes.map(({ target, failureSummary }) => ({ target, failureSummary }))
          );
          textFailures.push({ palette: variant, high, nodes });
          expect.soft(nodes, `${variant}, high=${high}, text contrast`).toEqual([]);
          const measure = async (
            cue: string,
            control: Locator,
            kind: 'boundary' | 'indicator' | 'focus',
            indicator?: string
          ) => {
            const ratio = await measureControlContrast(control, kind, indicator);
            rows.push({ palette: variant, high, cue, ratio });
            expect.soft(ratio, `${variant}, high=${high}, ${cue}`).toBeGreaterThanOrEqual(3);
          };
          const input = page.getByRole('textbox', { name: 'Name', exact: true });
          const checkbox = page.getByRole('checkbox', { name: 'Consent', exact: true });
          const toggle = page.getByRole('switch', { name: 'Alerts', exact: true });
          const radio = page.getByRole('radio', { name: 'SMS', exact: true });
          for (const name of ['Name', 'Invalid name', 'Notes'])
            await measure(name, page.getByRole('textbox', { name, exact: true }), 'boundary');
          for (const name of ['Category', 'Native category'])
            await measure(name, page.getByRole('combobox', { name, exact: true }), 'boundary');
          await measure('unchecked checkbox', checkbox, 'boundary');
          await measure('unselected radio', radio, 'boundary');
          await measure('off switch track', toggle, 'boundary');
          await measure('off switch thumb', toggle, 'indicator', '[data-slot=switch-thumb]');
          await measure(
            'slider track',
            page.locator('[data-slot=slider-track]').first(),
            'boundary'
          );
          await checkbox.press('Space');
          await expect(checkbox).toBeChecked();
          await measure(
            'checkbox checkmark',
            checkbox,
            'indicator',
            '[data-slot=checkbox-indicator] svg'
          );
          await measure(
            'radio selection dot',
            page.getByRole('radio', { name: 'Email', exact: true }),
            'indicator',
            '[data-slot=radio-group-indicator] span'
          );
          await toggle.press('Space');
          await expect(toggle).toBeChecked();
          await toggle.evaluate((element) => (element as HTMLElement).blur());
          await measure('on switch track', toggle, 'boundary');
          await measure('on switch thumb', toggle, 'indicator', '[data-slot=switch-thumb]');
          await page.keyboard.press('Tab');
          await input.focus();
          await expect(input).toBeFocused();
          await measure('input focus', input, 'focus');
        }
      }
      await info.attach('essential-control-contrast', {
        body: JSON.stringify({ locale, darkMode, rows, textFailures }),
        contentType: 'application/json',
      });
    });

for (const locale of ['en', 'fa'] as const) {
  test(`responsive layout wraps long records and retains independent spacing (${locale})`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: locale === 'fa' ? 'dark' : 'light' });
    await page.goto(`${url}?${locale}&layout`);
    const main = page.getByRole('main');
    const controls = main.getByRole('button');
    await expect(controls).toHaveCount(2);
    await expect(main.getByRole('heading', { level: 1 })).toHaveText(
      locale === 'fa' ? 'چیدمان واکنش‌گرا' : 'Responsive layout'
    );
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
    const rows = [];
    for (const [width, columns, inlineGap, stackGap] of [
      [320, 1, 8, 12],
      [375, 1, 12, 12],
      [390, 1, 12, 12],
      [414, 1, 12, 12],
      [768, 2, 16, 20],
      [1024, 3, 16, 20],
      [1280, 3, 20, 20],
      [1920, 3, 24, 20],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      const row = await main.evaluate((node) => {
        const grid = node.querySelector('[data-slot=grid]')!;
        const stack = node.querySelector('[data-slot=stack]')!;
        const inline = node.querySelector('[data-slot=inline]')!;
        const style = getComputedStyle(grid);
        const first = inline.children[0]!.getBoundingClientRect();
        const second = inline.children[1]!.getBoundingClientRect();
        return {
          columns: style.gridTemplateColumns.split(' ').length,
          gap: parseFloat(style.gap),
          stackGap: parseFloat(getComputedStyle(stack).gap),
          inlineGap: parseFloat(getComputedStyle(inline).gap),
          overflow: Math.max(
            node.scrollWidth - node.clientWidth,
            ...[...grid.children].map((card) => card.scrollWidth - card.clientWidth)
          ),
          wraps: second.top > first.top,
          leftToRight: first.left < second.left,
          target: Math.min(first.width, first.height, second.width, second.height),
          coarse: matchMedia('(pointer: coarse)').matches,
        };
      });
      rows.push({ width, ...row });
      expect(row).toMatchObject({ columns, gap: 16, inlineGap, stackGap });
      expect(row.overflow).toBeLessThanOrEqual(1);
      if (width === 320) expect(row.wraps).toBe(true);
      if (width >= 768) {
        expect(row.wraps).toBe(false);
        expect(row.leftToRight).toBe(locale === 'en');
      }
      if (row.coarse) expect(row.target).toBeGreaterThanOrEqual(44);
    }
    await controls.first().focus();
    await page.keyboard.press('Tab');
    await expect(controls.last()).toBeFocused();
    await info.attach('responsive-layout', {
      body: JSON.stringify({ locale, rows }),
      contentType: 'application/json',
    });
  });
}

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
            appTitleFa: 'آزمون نمایش',
            supportEmail: 'support@example.test',
            supportPhone: '02126658042',
            supportMobile: '09002550292',
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
      expect(horizontalSeparator.height).toBeCloseTo(1, 2);
      expect(verticalSeparator.width).toBeCloseTo(1, 2);
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
    for (const primaryColor of ['#2563eb', '#777777', '#ffffff'])
      test(`shared controls remain readable and focused (${locale}, dark=${darkMode}, primary=${primaryColor})`, async ({
        page,
      }) => {
        await page.route('**/api/public/branding/config', (route) =>
          route.fulfill({
            json: {
              appTitle: 'Theme checks',
              appTitleFa: 'آزمون نمایش',
              supportEmail: 'support@example.test',
              supportPhone: '02126658042',
              supportMobile: '09002550292',
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
            appTitleFa: 'آزمون نمایش',
            supportEmail: 'support@example.test',
            supportPhone: '02126658042',
            supportMobile: '09002550292',
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

for (const locale of ['fa', 'en'] as const) {
  test(`application notices follow device, user and published policy (${locale})`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    let themeMode: 'light' | 'dark' | 'system' = 'system';
    await page.route('**/api/public/branding/config', (route) =>
      route.fulfill({
        json: {
          appTitle: 'Notice check',
          appTitleFa: 'آزمون اعلان',
          supportEmail: 'support@example.test',
          supportPhone: '02126658042',
          supportMobile: '09002550292',
          slogan: '',
          primaryColor: '#176b5b',
          secondaryColor: '#547467',
          accentColor: '#d6a74e',
          backgroundColor: '#f6f7f4',
          darkBackgroundColor: '#15201c',
          logoUrl: null,
          faviconUrl: null,
          darkMode: themeMode === 'dark',
          themeMode,
        },
      })
    );
    await page.goto(`${url}?${locale}`);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.getByRole('button', { name: 'Application notice', exact: true }).click();
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Application notice' });
    const host = page.locator('[data-sonner-toaster]');
    const color = async () =>
      page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.backgroundColor = 'var(--success-soft)';
        document.body.append(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      });
    await expect(toast).toBeVisible();
    await expect(toast).toHaveAttribute('data-type', 'success');
    await expect(host).toHaveAttribute('data-sonner-theme', 'dark');
    await expect(toast).toHaveCSS('background-color', await color());
    await expect(toast).toHaveCSS('font-family', /Vazirmatn/);
    await page.screenshot({
      path: info.outputPath(`application-notice-${locale}.png`),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Light notice theme', exact: true }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(host).toHaveAttribute('data-sonner-theme', 'light');
    await expect(toast).toHaveCSS('background-color', await color());
    themeMode = 'dark';
    await page.evaluate(() => window.dispatchEvent(new Event('barghsa:branding-activated')));
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(host).toHaveAttribute('data-sonner-theme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(host).toHaveAttribute('data-sonner-theme', 'dark');
    await page.getByRole('button', { name: 'Device notice theme', exact: true }).click();
    themeMode = 'system';
    await page.evaluate(() => window.dispatchEvent(new Event('barghsa:branding-activated')));
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(host).toHaveAttribute('data-sonner-theme', 'light');
    await expect(toast).toHaveCSS('background-color', await color());
    await toast.getByRole('button', { name: feedbackText('close', locale) }).click();
    await expect(toast).toBeHidden();
  });
}

for (const locale of ['fa', 'en'] as const) {
  test(`live palettes, logos and motion preserve readable work (${locale})`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
    let reads = 0;
    const config = {
      appTitle: 'Appearance',
      appTitleFa: 'آزمون ظاهر',
      supportEmail: 'support@example.test',
      supportPhone: '02126658042',
      supportMobile: '09002550292',
      slogan: '',
      primaryColor: '#176b5b',
      secondaryColor: '#547467',
      accentColor: '#d6a74e',
      darkPrimaryColor: '#abcdef',
      darkSecondaryColor: '#fedcba',
      darkAccentColor: '#567890',
      logoUrl: 'https://assets.example.test/light.png',
      logoDarkUrl: 'https://assets.example.test/dark.png',
      faviconUrl: null,
      darkMode: false,
      themeMode: 'system',
    };
    await page.route('**/api/public/branding/config', (route) => {
      reads++;
      return route.fulfill({ json: config });
    });
    await page.route('https://assets.example.test/**', (route) =>
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
          'base64'
        ),
      })
    );
    await page.goto(`${url}?${locale}`);
    const section = page.getByRole('region', { name: 'Appearance and motion' });
    const image = section.locator('[data-slot=brand-logo]');
    await expect(image).toHaveAttribute('src', config.logoDarkUrl);
    await expect(page.locator('html')).toHaveCSS('--primary', '#abcdef');
    await page.getByRole('button', { name: 'Light notice theme', exact: true }).click();
    await expect(image).toHaveAttribute('src', config.logoUrl);
    await expect(page.locator('html')).toHaveCSS('--primary', '#176b5b');
    await page.getByRole('button', { name: 'Device notice theme', exact: true }).click();
    await expect(image).toHaveAttribute('src', config.logoDarkUrl);
    const preference = section.getByRole('status', { name: 'Motion preference' });
    await expect(preference).toHaveText('full');
    const route = page.getByTestId('motion-route');
    await expect(route).toHaveCSS('animation-name', 'barghsa-slide-up');
    await expect(route).toHaveCSS('animation-duration', '0.2s');
    const entrance = await route.evaluate((node) => {
      const effect = node.getAnimations()[0]?.effect;
      return effect instanceof KeyframeEffect ? effect.getKeyframes() : [];
    });
    expect(entrance).toHaveLength(2);
    expect(entrance.every(({ opacity }) => opacity === undefined || opacity === '1')).toBe(true);
    const input = section.getByRole('textbox', { name: 'Retained draft', exact: true });
    await input.fill('captured-order-9007199254740993-edited');
    await route.evaluate((node) => node.setAttribute('data-retained-node', 'yes'));
    const geometry = await route.evaluate((node) => ({
      width: (node as HTMLElement).offsetWidth,
      height: (node as HTMLElement).offsetHeight,
    }));
    await expect
      .poll(() => route.evaluate((node) => node.getAnimations()[0]?.playState))
      .toBe('finished');
    const start = await route.evaluate((node) => Number(node.getAnimations()[0]?.startTime));
    await section.getByRole('button', { name: 'Replay transition', exact: true }).click();
    await expect
      .poll(() => route.evaluate((node) => Number(node.getAnimations()[0]?.startTime)))
      .toBeGreaterThan(start);
    await expect(route).toHaveAttribute('data-retained-node', 'yes');
    await expect(input).toHaveValue('captured-order-9007199254740993-edited');
    expect(
      await route.evaluate((node) => ({
        width: (node as HTMLElement).offsetWidth,
        height: node.offsetHeight,
      }))
    ).toEqual(geometry);
    for (const variant of ['fade', 'slide', 'scale', 'shimmer']) {
      const content = page.getByTestId('motion-' + variant);
      await expect(content).toContainText('Immediately readable');
      expect(
        Number(await content.evaluate((node) => getComputedStyle(node).opacity))
      ).toBeGreaterThanOrEqual(0.85);
    }
    const card = section.locator('[data-slot=card][data-variant=interactive]');
    await card.hover();
    await expect(card).toHaveCSS('translate', '0px -2px');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(preference).toHaveText('reduced');
    await expect(route).toHaveCSS('animation-name', 'none');
    await expect(route).not.toHaveAttribute('data-motion');
    await expect(card).toHaveCSS('translate', 'none');
    expect(
      await page
        .getByTestId('motion-shimmer')
        .evaluate((node) => getComputedStyle(node, '::after').animationName)
    ).toBe('none');
    const spinner = section.locator('.animate-spin');
    await expect(spinner).toHaveCSS('animation-name', 'spin');
    await expect(spinner).toHaveCSS('animation-duration', '2s');
    await expect(input).toHaveValue('captured-order-9007199254740993-edited');
    expect(reads).toBe(1);
    expect(
      (
        await new AxeBuilder({ page })
          .include('main')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`appearance-motion-${locale}.png`),
      fullPage: true,
    });
    await page.emulateMedia({ media: 'print' });
    expect(await page.evaluate(() => localStorage.getItem('barghsa.theme.v1'))).toBe('system');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.locator('body')).toHaveCSS('color', 'rgb(32, 54, 49)');
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
    await expect(spinner).toHaveCSS('animation-name', 'none');
    await expect(image).toBeHidden();
    const printImage = section.locator('[data-slot=brand-logo-print]');
    await expect(printImage).toBeVisible();
    await expect
      .poll(() => printImage.evaluate((node) => (node as HTMLImageElement).currentSrc))
      .toBe(config.logoUrl);
    await expect
      .poll(() => printImage.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await page.emulateMedia({ media: 'screen', colorScheme: 'dark', reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute('src', config.logoDarkUrl);
    await expect(printImage).toBeHidden();
    await expect(input).toHaveValue('captured-order-9007199254740993-edited');
  });
}
