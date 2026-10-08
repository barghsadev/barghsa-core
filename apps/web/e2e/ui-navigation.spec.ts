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
    test(`themed scroll areas retain native vertical and logical horizontal navigation (${fa ? 'fa' : 'en'}, ${theme})`, async ({
      page,
    }, info) => {
      await story(page, 'navigation--scroll-areas', fa, theme);
      const vertical = page.getByRole('region', {
        name: fa ? 'رکوردهای عمودی' : 'Vertical records',
        exact: true,
      });
      const viewport = vertical.locator('[data-slot="scroll-area-viewport"]');
      await viewport.focus();
      await expect(viewport).toBeFocused();
      await viewport.press('PageDown');
      await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
      await vertical.hover();
      const bar = vertical.locator('[data-slot="scroll-area-scrollbar"]');
      await expect(bar).toBeVisible();
      const box = await bar.boundingBox(),
        outer = await vertical.boundingBox();
      expect(box!.width).toBeLessThanOrEqual(11);
      expect(fa ? box!.x < outer!.x + outer!.width / 2 : box!.x > outer!.x + outer!.width / 2).toBe(
        true
      );
      const thumb = bar.locator('[data-slot="scroll-area-thumb"]');
      expect(
        await thumb.evaluate((node) => {
          const probe = document.createElement('span');
          probe.style.color = 'var(--muted-foreground)';
          node.append(probe);
          const color = getComputedStyle(probe).color;
          probe.remove();
          return getComputedStyle(node).backgroundColor === color;
        })
      ).toBe(true);
      const horizontal = page.getByRole('region', {
        name: fa ? 'رکوردهای افقی' : 'Horizontal records',
        exact: true,
      });
      const h = horizontal.locator('[data-slot="scroll-area-viewport"]');
      await h.focus();
      await expect(h).toBeFocused();
      await h.press(fa ? 'ArrowLeft' : 'ArrowRight');
      await expect.poll(() => h.evaluate((node) => Math.abs(node.scrollLeft))).toBeGreaterThan(0);
      // Native horizontal viewports use directional arrows; Home/End scroll vertically.
      const maximum = await h.evaluate((node) => node.scrollWidth - node.clientWidth);
      for (let i = 0; i <= Math.ceil(maximum / 80); i++)
        await h.press(fa ? 'ArrowLeft' : 'ArrowRight');
      await expect.poll(() => h.evaluate((node) => Math.abs(node.scrollLeft))).toBe(maximum);
      for (let i = 0; i <= Math.ceil(maximum / 80); i++)
        await h.press(fa ? 'ArrowRight' : 'ArrowLeft');
      await expect.poll(() => h.evaluate((node) => Math.abs(node.scrollLeft))).toBe(0);
      const button = horizontal.getByRole('button', {
        name: (fa ? 'رکورد ' : 'Record ') + '1',
        exact: true,
      });
      await button.focus();
      await button.press(fa ? 'ArrowLeft' : 'ArrowRight');
      await expect.poll(() => h.evaluate((node) => Math.abs(node.scrollLeft))).toBe(0);
      await accessible(page);
      await expect(page.getByLabel(fa ? 'کلیدهای کنترل داخلی' : 'Nested control keys')).toHaveText(
        '1'
      );
      await expect.poll(() => h.evaluate((node) => Math.abs(node.scrollLeft))).toBe(0);
      await page.screenshot({ path: info.outputPath('scroll-areas.png'), fullPage: true });
    });
  }
