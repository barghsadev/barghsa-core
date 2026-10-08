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
    test(`avatar sizes, image recovery and named presence preserve existing callers (${mode})`, async ({
      page,
    }, info) => {
      await page.route('**/avatar-loaded.svg', (route) =>
        route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="currentColor"/></svg>',
        })
      );
      await page.route('**/avatar-failed.svg', (route) => route.fulfill({ status: 404, body: '' }));
      await story(page, 'identity--avatars', fa, theme);
      const name = fa ? 'مجید علی سعادت' : 'Ari Middle Buyer';
      for (const [size, pixels] of Object.entries({
        xs: 24,
        sm: 32,
        md: 48,
        lg: 64,
        xl: 96,
      })) {
        const avatar = page.getByRole('img', { name: name + ' ' + size, exact: true });
        await expect(avatar.locator('[data-slot="avatar-fallback"]')).toHaveText(fa ? 'مس' : 'AB');
        const bounds = await avatar.boundingBox();
        expect(bounds!.width).toBe(pixels);
        expect(bounds!.height).toBe(pixels);
      }
      for (const status of ['online', 'offline', 'busy']) {
        const avatar = page.locator('[data-status="' + status + '"]');
        await expect(avatar).toHaveAccessibleName(name);
        await expect(avatar).toHaveAccessibleDescription(
          status === 'online'
            ? fa
              ? 'برخط'
              : 'Online'
            : status === 'offline'
              ? fa
                ? 'برون‌خط'
                : 'Offline'
              : fa
                ? 'مشغول'
                : 'Busy'
        );
        await expect(avatar).toHaveCSS(
          'outline-style',
          status === 'online' ? 'solid' : status === 'offline' ? 'dashed' : 'double'
        );
      }
      const loaded = page.getByRole('img', {
        name: fa ? 'تصویر آماده' : 'Loaded picture',
        exact: true,
      });
      await expect(loaded.locator('[data-slot="avatar-image"]')).toBeVisible();
      await expect(loaded.locator('[data-slot="avatar-fallback"]')).toHaveCount(0);
      await expect(
        page
          .getByRole('img', { name: fa ? 'تصویر ناموفق' : 'Failed picture', exact: true })
          .locator('[data-slot="avatar-fallback"]')
      ).toHaveText(fa ? 'مس' : 'AB');
      await expect(
        page
          .getByRole('img', { name: fa ? 'حروف سفارشی' : 'Custom initials', exact: true })
          .locator('[data-slot="avatar-fallback"]')
      ).toHaveText('EX');
      for (const [size, pixels] of Object.entries({ xs: 24, md: 48, xl: 96 })) {
        const group = page.getByRole('group', {
          name: (fa ? 'گروه ' : 'Group ') + size,
          exact: true,
        });
        expect((await group.locator('[data-slot="avatar-group-count"]').boundingBox())!.width).toBe(
          pixels
        );
        await expect(group.locator('[data-slot="avatar-badge"]')).toBeVisible();
      }
      await accessible(page);
      await page.screenshot({ path: info.outputPath('avatars.png'), fullPage: true });
    });
    test(`skeleton shapes shimmer without announcing fake records and separators retain geometry (${mode})`, async ({
      page,
    }, info) => {
      await story(page, 'identity--loading-shapes', fa, theme);
      const loading = page.getByRole('status', {
        name: fa ? 'در حال بارگذاری' : 'Loading',
        exact: true,
      });
      await expect(loading.locator('[data-slot="skeleton-text"]')).toHaveCount(2);
      await expect(
        loading.locator('[data-slot="skeleton-text"]').last().locator('[data-slot="skeleton"]')
      ).toHaveCount(3);
      await expect(loading.locator('[data-slot="skeleton-table-row"] td')).toHaveCount(4);
      await expect(
        loading.locator('[data-slot="skeleton-chart"] [data-slot="skeleton"]')
      ).toHaveCount(6);
      await expect(loading.locator('[data-slot="skeleton"]')).toHaveCount(16);
      expect((await loading.locator('[data-slot="skeleton"]').nth(4).boundingBox())!.height).toBe(
        128
      );
      const avatarShape = await loading.locator('[data-slot="skeleton"]').nth(5).boundingBox();
      expect(avatarShape!.width).toBe(40);
      expect(avatarShape!.height).toBe(40);
      const skeleton = loading.locator('[data-slot="skeleton"]').first();
      expect(
        await skeleton.evaluate((node) => getComputedStyle(node, '::after').animationName)
      ).toBe('shimmer');
      const horizontal = page.locator('[data-slot="separator"][data-orientation="horizontal"]');
      const vertical = page.locator('[data-slot="separator"][data-orientation="vertical"]');
      expect((await horizontal.boundingBox())!.height).toBe(1);
      expect((await vertical.boundingBox())!.width).toBe(1);
      expect((await vertical.boundingBox())!.height).toBeGreaterThan(20);
      await accessible(page);
      await page.screenshot({ path: info.outputPath('skeletons.png'), fullPage: true });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect(
        await skeleton.evaluate((node) => getComputedStyle(node, '::after').animationName)
      ).toBe('none');
      await expect(loading).toHaveAccessibleName(fa ? 'در حال بارگذاری' : 'Loading');
    });
  }
