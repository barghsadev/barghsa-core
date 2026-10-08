import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';

const directory = resolve(
  fileURLToPath(new URL('../../../packages/ui/story-build/', import.meta.url))
);
const meta = JSON.parse(readFileSync(resolve(directory, 'meta.json'), 'utf8')) as {
  stories: Record<string, unknown>;
};
test.describe.configure({ mode: 'parallel' });
let server: Server;
let origin: string;
test.beforeAll(async () => {
  const mime: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.png': 'image/png',
    '.webmanifest': 'application/manifest+json',
  };
  server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
      const path = resolve(directory, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!path.startsWith(directory + sep) || !(await stat(path)).isFile()) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.setHeader('content-type', mime[extname(path)] ?? 'application/octet-stream');
      res.end(await readFile(path));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No catalogue address');
  origin = 'http://127.0.0.1:' + address.port;
});
test.afterAll(async () => {
  server?.closeAllConnections();
  await new Promise<void>((done) => server?.close(() => done()));
});
for (const story of Object.keys(meta.stories)) {
  for (const rtl of [false, true]) {
    for (const theme of ['light', 'dark']) {
      test(
        'catalogue ' + story + ' ' + (rtl ? 'fa' : 'en') + ' ' + theme,
        async ({ page }, info) => {
          await page.setViewportSize(
            rtl ? { width: 390, height: 844 } : { width: 1280, height: 960 }
          );
          const errors: string[] = [];
          const external: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          page.on('request', (request) => {
            if (/^https?:/.test(request.url()) && !request.url().startsWith(origin + '/'))
              external.push(request.url());
          });
          await page.goto(
            origin + '/?story=' + story + '&rtl=' + rtl + '&theme=' + theme + '&mode=preview'
          );
          const surface = page.locator('[data-story-surface]');
          await expect(surface).toBeVisible();
          await expect(
            surface.getByRole('heading', {
              name: rtl ? 'نمونه‌های اجزای برقسا' : 'Barghsa component examples',
              exact: true,
            })
          ).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          const loadedFaces = await page.evaluate(async () => {
            const persian = document.documentElement.lang === 'fa';
            const faces = await document.fonts.load(
              '16px ' + (persian ? 'Vazirmatn' : '"Inter Variable"'),
              persian ? 'نمونه' : 'Sample'
            );
            return faces.map((face) => ({ family: face.family, status: face.status }));
          });
          expect(loadedFaces.length).toBeGreaterThan(0);
          expect(loadedFaces.every((face) => face.status === 'loaded')).toBe(true);
          expect(await page.evaluate(() => document.documentElement.lang)).toBe(rtl ? 'fa' : 'en');
          expect(
            await page.evaluate(() => document.documentElement.classList.contains('dark'))
          ).toBe(theme === 'dark');
          expect(
            await page.evaluate(() =>
              document.fonts.check(
                '16px ' +
                  (document.documentElement.lang === 'fa' ? 'Vazirmatn' : '"Inter Variable"')
              )
            )
          ).toBe(true);
          expect(
            await surface.evaluate((node) => {
              const probe = document.createElement('div');
              probe.style.backgroundColor = 'var(--background)';
              document.body.append(probe);
              const expected = getComputedStyle(probe).backgroundColor;
              probe.remove();
              return getComputedStyle(node).backgroundColor === expected;
            })
          ).toBe(true);
          expect(
            (
              await new AxeBuilder({ page })
                .include('[data-story-surface]')
                .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
                .analyze()
            ).violations
          ).toEqual([]);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
          ).toBe(true);
          expect(errors).toEqual([]);
          expect(external).toEqual([]);
          if (
            (story === 'primitives--buttons' &&
              ((!rtl && theme === 'light') || (rtl && theme === 'dark'))) ||
            (story === 'widgets--tables' && rtl && theme === 'dark')
          )
            await page.screenshot({
              path: info.outputPath(story + '-' + (rtl ? 'fa' : 'en') + '-' + theme + '.png'),
              fullPage: true,
            });
        }
      );
    }
  }
}

for (const rtl of [false, true]) {
  for (const theme of ['light', 'dark']) {
    test('primitive interactions ' + (rtl ? 'fa' : 'en') + ' ' + theme, async ({ page }, info) => {
      await page.setViewportSize(rtl ? { width: 390, height: 844 } : { width: 1280, height: 960 });
      const visit = (story: string) =>
        page.goto(
          origin +
            '/?story=primitives--' +
            story +
            '&rtl=' +
            rtl +
            '&theme=' +
            theme +
            '&mode=preview'
        );
      await visit('labels');
      const required = page.getByRole('textbox', {
        name: rtl ? 'نام ضروری' : 'Required name',
        exact: true,
      });
      await page.locator('label[for=required-name]').click();
      await expect(required).toBeFocused();
      expect(await required.evaluate((node: HTMLInputElement) => node.checkValidity())).toBe(false);
      await required.fill('Sample name');
      expect(await required.evaluate((node: HTMLInputElement) => node.checkValidity())).toBe(true);
      await expect(page.locator('label[for=required-name] [aria-hidden=true]')).toHaveText('*');
      await expect(
        page.getByRole('textbox', {
          name: rtl ? 'نام دوم اختیاری' : 'Other name Optional',
          exact: true,
        })
      ).toBeEditable();
      await expect(
        page.getByLabel(rtl ? 'نام غیرفعال' : 'Disabled name', { exact: true })
      ).toBeDisabled();
      await expect(page.locator('label[for=disabled-name]')).toHaveCSS('opacity', '0.5');
      await visit('badges');
      const dots = page.locator('[data-slot=badge][data-dot]');
      await expect(dots).toHaveCount(24);
      await expect(dots.locator('.sr-only')).toHaveCount(24);
      await expect(dots.first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      expect(
        await dots.first().evaluate((node) => getComputedStyle(node, '::before').backgroundColor)
      ).not.toBe('rgba(0, 0, 0, 0)');
      const widths = await dots.evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().width)
      );
      expect([...new Set(widths)].sort((a, b) => a - b)).toEqual([6, 8, 10]);
      await visit('cards');
      const card = page.locator('[data-slot=card]').filter({ hasText: 'interactive · default' });
      await expect(card).toHaveCSS('cursor', 'pointer');
      const shadow = await card.evaluate((node) => getComputedStyle(node).boxShadow);
      await card.hover();
      await expect
        .poll(() => card.evaluate((node) => getComputedStyle(node).boxShadow))
        .not.toBe(shadow);
      await visit('buttons');
      await page.getByRole('button', { name: 'default', exact: true }).first().press('Enter');
      await expect(page.getByRole('status')).toContainText('1');
      const loading = page.getByRole('button', {
        name: rtl ? 'در حال ذخیره' : 'Saving',
        exact: true,
      });
      await expect(loading).toBeDisabled();
      await expect(loading).toHaveAttribute('aria-busy', 'true');
      await expect(loading.locator('svg[aria-hidden=true]')).toBeVisible();
      await expect(
        page.getByRole('button', { name: rtl ? 'غیرفعال' : 'Disabled', exact: true })
      ).toBeDisabled();
      const xl = page.getByRole('button', { name: 'xl', exact: true });
      const xlWidths = await xl.evaluate((node) => ({
        control: node.getBoundingClientRect().width,
        container: node.parentElement!.getBoundingClientRect().width,
      }));
      if (rtl) expect(xlWidths.control).toBe(xlWidths.container);
      else expect(xlWidths.control).toBeLessThan(xlWidths.container);
      await expect(
        page.getByRole('link', { name: rtl ? 'پیوند نمونه' : 'Example link' })
      ).toHaveAttribute('href', '#story-link');
      await visit('inputs');
      await expect(
        page.getByLabel(rtl ? 'فقط خواندنی' : 'Read only', { exact: true })
      ).not.toBeEditable();
      await expect(page.getByLabel(rtl ? 'غیرفعال' : 'Disabled', { exact: true })).toBeDisabled();
      const input = page.getByLabel('default', { exact: true }).first();
      const unfocusedShadow = await input.evaluate((node) => getComputedStyle(node).boxShadow);
      await input.focus();
      await expect(input).toBeFocused();
      expect(await input.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe('none');
      await expect
        .poll(() => input.evaluate((node) => getComputedStyle(node).boxShadow))
        .not.toBe(unfocusedShadow);
      await visit('input-addons');
      const password = page.getByLabel(rtl ? 'گذرواژه نمونه' : 'Sample password', { exact: true });
      await expect(password).toHaveAttribute('type', 'password');
      await page
        .getByRole('button', { name: rtl ? 'نمایش گذرواژه' : 'Show password', exact: true })
        .press('Enter');
      await expect(password).toHaveAttribute('type', 'text');
      await expect(password).toHaveValue('example');
      await page
        .getByRole('button', { name: rtl ? 'پاک کردن' : 'Clear', exact: true })
        .press('Enter');
      await expect(page.getByLabel(rtl ? 'متن نمونه' : 'Sample text', { exact: true })).toHaveValue(
        ''
      );
      const invalid = page.getByLabel('error', { exact: true });
      await expect(invalid).toHaveAttribute('aria-invalid', 'true');
      await expect(invalid).toHaveAttribute('aria-describedby', 'adorned-help-error');
      await expect(
        page.getByLabel(rtl ? 'یادداشت چندخطی' : 'Multiline notes', { exact: true })
      ).toBeEditable();
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-story-surface]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if ((!rtl && theme === 'light') || (rtl && theme === 'dark'))
        await page.screenshot({
          path: info.outputPath('primitive-' + (rtl ? 'fa' : 'en') + '.png'),
          fullPage: true,
        });
    });
    test(
      'command separator preserves keyboard filtering ' + (rtl ? 'fa' : 'en') + ' ' + theme,
      async ({ page }) => {
        await page.goto(
          origin + '/?story=overlays--commands&rtl=' + rtl + '&theme=' + theme + '&mode=preview'
        );
        const surface = page.locator('[data-story-surface]');
        const input = surface.getByRole('combobox');
        await expect(input).toBeVisible();
        await input.fill('Solar');
        await expect(surface.getByRole('option', { name: 'Solar', exact: true })).toBeVisible();
        await expect(surface.getByRole('option', { name: /Electricity/ })).toHaveCount(0);
        await input.press('ArrowDown');
        await input.press('Enter');
        await expect(surface.getByRole('status')).toHaveText('Solar');
        await input.fill('No such choice');
        await expect(surface).toContainText(rtl ? 'نتیجه‌ای یافت نشد' : 'No results');
        await input.fill('');
        const separator = surface.locator('[data-slot=command-separator]');
        await expect(separator).toBeVisible();
        await expect(separator).toHaveAttribute('aria-hidden', 'true');
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-story-surface]')
              .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
              .analyze()
          ).violations
        ).toEqual([]);
      }
    );
  }
}

for (const rtl of [false, true]) {
  for (const theme of ['light', 'dark']) {
    test(
      'catalogue portal keyboard and theme ' + (rtl ? 'fa' : 'en') + ' ' + theme,
      async ({ page }) => {
        const visit = (story: string) =>
          page.goto(
            origin + '/?story=' + story + '&rtl=' + rtl + '&theme=' + theme + '&mode=preview'
          );
        await visit('overlays--dialog');
        const trigger = page.getByRole('button', {
          name: rtl ? 'باز کردن پنجره' : 'Open dialog',
          exact: true,
        });
        await trigger.press('Enter');
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveCSS('opacity', '1');
        await expect(dialog.getByLabel(rtl ? 'نام' : 'Name', { exact: true })).toBeVisible();
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-slot=dialog-content]')
              .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
              .analyze()
          ).violations
        ).toEqual([]);
        const themeMatches = await dialog.evaluate((node) => {
          const probe = document.createElement('div');
          probe.style.backgroundColor = 'var(--popover)';
          document.body.append(probe);
          const expected = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return getComputedStyle(node).backgroundColor === expected;
        });
        expect(themeMatches).toBe(true);
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
        await visit('overlays--sheets');
        for (const side of ['left', 'right', 'top', 'bottom']) {
          const button = page.getByRole('button', { name: side, exact: true });
          await button.press('Enter');
          await expect(page.getByRole('dialog')).toBeVisible();
          await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1');
          expect(
            (
              await new AxeBuilder({ page })
                .include('[data-slot=sheet-content]')
                .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
                .analyze()
            ).violations
          ).toEqual([]);
          await page.keyboard.press('Escape');
          await expect(page.getByRole('dialog')).toHaveCount(0);
          await expect(button).toBeFocused();
        }
        await visit('overlays--menus');
        const menuTrigger = page.getByRole('button', {
          name: rtl ? 'اقدام‌ها' : 'Actions',
          exact: true,
        });
        await menuTrigger.press('Enter');
        const menu = page.getByRole('menu');
        await expect(menu).toHaveCSS('opacity', '1');
        await expect
          .poll(() =>
            menu.evaluate((node) =>
              node
                .getAnimations({ subtree: true })
                .every((animation) => !animation.pending && animation.playState !== 'running')
            )
          )
          .toBe(true);
        const checkbox = page.getByRole('menuitemcheckbox', {
          name: rtl ? 'نمایش جزئیات' : 'Show details',
          exact: true,
        });
        await expect(checkbox).toBeVisible();
        await checkbox.press('Enter');
        await expect(checkbox).toBeChecked();
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-slot=dropdown-menu-content]')
              .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
              .analyze()
          ).violations
        ).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(menuTrigger).toBeFocused();
      }
    );
  }
}
