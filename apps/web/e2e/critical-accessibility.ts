import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from './coverage-fixture';

async function scanMain(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  return new AxeBuilder({ page })
    .include('main#main-content')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
}

export async function scanCriticalMain(page: Page) {
  await expect(page.locator('main#main-content')).toBeVisible();
  await expect(page.getByRole('main')).toHaveCount(1);
  const result = await scanMain(page);
  expect(result.violations).toEqual([]);
}

export async function scanAdvisoryMain(page: Page, info: TestInfo) {
  const result = await scanMain(page);
  const route = new URL(page.url()).pathname;
  const direction = await page.locator('html').getAttribute('dir');
  const browser = info.project.name;
  const summarize = (rules: typeof result.violations) =>
    rules.map(({ id, help, impact, nodes }) => ({
      id,
      help,
      impact: impact ?? null,
      targets: nodes.map(({ target }) => target),
    }));
  const violations = summarize(result.violations);
  const incomplete = summarize(result.incomplete);
  await info.attach('a11y-advisory', {
    body: JSON.stringify({ route, direction, browser, violations, incomplete }),
    contentType: 'application/json',
  });
  for (const [kind, rules] of [
    ['violation', violations],
    ['manual review', incomplete],
  ] as const) {
    for (const rule of rules) {
      const message = `${route} (${browser}, ${direction}) ${kind} ${rule.id} (${rule.impact ?? 'unrated'}): ${rule.help}; targets ${JSON.stringify(rule.targets)}`;
      const escaped = message
        .replaceAll('%', '%25')
        .replaceAll('\r', '%0D')
        .replaceAll('\n', '%0A');
      console.warn(`::warning title=Accessibility advisory::${escaped}`);
    }
  }
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
  // WebKit's default full-page keyboard traversal uses Option-Tab for links.
  await page.keyboard.press(
    page.context().browser()?.browserType().name() === 'webkit' ? 'Alt+Tab' : 'Tab'
  );
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
