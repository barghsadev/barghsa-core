import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from './coverage-fixture';

export async function scanCriticalMain(page: Page) {
  await expect(page.locator('main#main-content')).toBeVisible();
  await expect(page.getByRole('main')).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  const result = await new AxeBuilder({ page })
    .include('main#main-content')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(result.violations).toEqual([]);
}

export async function skipToMain(page: Page, locale: string) {
  const link = page.getByRole('link', {
    name: locale === 'fa' ? 'رفتن به محتوای اصلی' : 'Skip to main content',
    exact: true,
  });
  await expect(page.locator('main#main-content')).toBeVisible();
  const focusOwner = () =>
    page.evaluate(() => {
      const active = document.activeElement;
      return [
        active?.tagName,
        active?.id,
        active?.getAttribute('data-slot'),
        document.documentElement.lang,
      ];
    });
  const previous = await focusOwner();
  await page.keyboard.press('Tab');
  await expect(
    link,
    `First tab on ${new URL(page.url()).pathname}: ${JSON.stringify(previous)} → ${JSON.stringify(await focusOwner())}`
  ).toBeFocused();
  const box = (await link.boundingBox())!;
  expect(box.width).toBeGreaterThan(20);
  expect(box.height).toBeGreaterThan(20);
  const url = page.url();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main-content')).toBeFocused();
  expect(page.url()).toBe(url);
}
