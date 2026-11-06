import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { assignmentSlots } from '../src/test/assignment-settings-fixtures';
import { t } from '@barghsa/i18n/admin-ui';

const paths = [
  '/admin/ai-models',
  '/admin/knowledge-bases',
  '/admin/policies',
  '/admin/agents',
  '/admin/agent-slots',
];
for (const width of [390, 1440]) {
  test.describe(`AI sections at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    for (const locale of ['en', 'fa'] as const)
      for (const dark of [false, true])
        test(`AI section tabs follow routes with manual keyboard activation (${locale}, dark=${dark})`, async ({
          page,
        }, info) => {
          await setupCatalogueForms(page, locale, dark);
          for (const path of [
            'ai-models',
            'knowledge-bases',
            'kb-groups',
            'policies',
            'policy-groups',
            'agents',
          ])
            await page.route(`**/api/admin/${path}`, (route) => route.fulfill({ json: [] }));
          await page.route('**/api/admin/agents/options', (route) =>
            route.fulfill({
              json: { models: [], kbs: [], kbGroups: [], policies: [], policyGroups: [] },
            })
          );
          await page.route('**/api/admin/agent-slots', (route) =>
            route.fulfill({ json: assignmentSlots })
          );
          await page.goto(paths[0]!);
          const list = page.getByRole('tablist', {
            name: t('admin.settings.ai', locale),
            exact: true,
          });
          const tabs = list.getByRole('tab');
          await expect(tabs).toHaveCount(5);
          await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
          await tabs.nth(0).focus();
          await tabs.nth(0).press('End');
          await expect(tabs.nth(4)).toBeFocused();
          await expect(page).toHaveURL(/\/admin\/ai-models$/);
          await tabs.nth(4).press('Enter');
          await expect(page).toHaveURL(/\/admin\/agent-slots$/);
          await expect(tabs.nth(4)).toHaveAttribute('aria-selected', 'true');
          await expect(tabs.nth(4)).toBeFocused();
          await page.goBack();
          await expect(page).toHaveURL(/\/admin\/ai-models$/);
          for (const [index, path] of paths.entries()) {
            await tabs.nth(index).click();
            await expect(page).toHaveURL(new RegExp(`${path}$`));
            await expect(tabs.nth(index)).toHaveAttribute('aria-selected', 'true');
            const panel = page.locator('[role=tabpanel]:visible');
            await expect(panel).toHaveCount(1);
            await expect
              .poll(
                async () =>
                  (await panel.getAttribute('aria-labelledby')) ===
                  (await tabs.nth(index).getAttribute('id'))
              )
              .toBe(true);
            await expect(panel.getByRole('heading', { level: 1 })).toBeVisible();
          }
          expect(
            (
              await new AxeBuilder({ page })
                .include('[data-testid="admin-settings-layout"]')
                .analyze()
            ).violations
          ).toEqual([]);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
          ).toBe(true);
          if (width === 390)
            await list.locator('..').screenshot({
              path: info.outputPath(`ai-sections-${locale}-${dark ? 'dark' : 'light'}.png`),
            });
        });
  });
}
