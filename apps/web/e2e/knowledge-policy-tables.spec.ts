import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { t } from '@barghsa/i18n/admin-ui';
import {
  knowledgeBase,
  knowledgeGroup,
  policyEntry,
  policyGroup,
} from '../src/test/knowledge-policy-fixtures';
import AxeBuilder from '@axe-core/playwright';

for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true])
    test(`knowledge and policy tables preserve protected actions and mobile drafts (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
    }, info) => {
      await setupCatalogueForms(page, locale, dark, {
        numberStyle: locale === 'fa' ? 'western' : 'persian',
      });
      let status = 200,
        writes = 0;
      const cases = [
        {
          kind: 'knowledge-bases',
          domain: 'kb',
          row: knowledgeBase,
          field: 'documentCount',
          fieldLabel: 'documents',
          titleInput: '#kb-title',
          page: '/admin/knowledge-bases',
        },
        {
          kind: 'kb-groups',
          domain: 'kb',
          row: knowledgeGroup,
          field: 'memberCount',
          fieldLabel: 'members',
          titleInput: '#kb-title',
          page: null,
        },
        {
          kind: 'policies',
          domain: 'policies',
          row: policyEntry,
          field: 'priority',
          fieldLabel: 'priority',
          titleInput: '#policy-title',
          page: '/admin/policies',
        },
        {
          kind: 'policy-groups',
          domain: 'policies',
          row: policyGroup,
          field: 'memberCount',
          fieldLabel: 'members',
          titleInput: '#policy-title',
          page: null,
        },
      ] as const;
      for (const item of cases) {
        await page.route(`**/api/admin/${item.kind}`, (route) => {
          if (route.request().method() !== 'GET') {
            writes++;
            return route.fulfill({ status: 400, json: {} });
          }
          return route.fulfill({
            status,
            json:
              status === 200
                ? [
                    {
                      ...item.row,
                      title: `Zeta ${item.kind} <b>literal</b>`,
                      description: '<script>Literal description</script>',
                      [item.field]: 12,
                    },
                    {
                      ...item.row,
                      id: 'a0000000-0000-4000-8000-000000000001',
                      title: `Alpha ${item.kind}`,
                      [item.field]: undefined,
                    },
                  ]
                : {},
          });
        });
        await page.route(`**/api/admin/${item.kind}/*`, (route) => {
          if (route.request().method() !== 'GET') writes++;
          return route.fulfill({ status: 404, json: {} });
        });
      }
      const digits = new Intl.NumberFormat(locale === 'fa' ? 'en-US' : 'fa-IR').format(12);
      for (const item of cases) {
        const label = (key: string) => t(`admin.${item.domain}.${key}`, locale);
        const title = `Zeta ${item.kind} <b>literal</b>`;
        await page.setViewportSize({ width: 1280, height: 900 });
        if (item.page) await page.goto(item.page);
        else await page.getByRole('button', { name: label(item.kind), exact: true }).click();
        const table = page.getByRole('table', { name: label(item.kind), exact: true });
        await expect(table).toBeVisible();
        await expect(table.locator('thead').getByRole('button')).toHaveCount(0);
        const first = table.locator('tbody tr').first();
        await expect(first.getByRole('heading', { name: title, exact: true })).toBeVisible();
        await expect(first).toContainText(`${label(item.fieldLabel)}: ${digits}`);
        await expect(table.locator('tbody tr').nth(1)).toContainText('—');
        await expect(page.locator('#admin-content script')).toHaveCount(0);
        expect(
          (await new AxeBuilder({ page }).include('#admin-content').analyze()).violations
        ).toEqual([]);
        if (item.kind === 'knowledge-bases')
          await page.screenshot({
            path: info.outputPath('catalogue-table-desktop.png'),
            fullPage: true,
          });
        await first
          .getByRole('button', { name: `${label('edit')} ${title}`, exact: true })
          .press('Enter');
        const draft = page.locator(item.titleInput);
        await expect(draft).toHaveValue(title);
        await draft.fill(`Retained draft ${item.kind}`);
        await page.setViewportSize({ width: 390, height: 844 });
        const cards = page.getByRole('list', { name: label(item.kind), exact: true });
        await expect(cards).toBeVisible();
        await expect(page.getByRole('table', { name: label(item.kind), exact: true })).toHaveCount(
          0
        );
        await expect(draft).toHaveValue(`Retained draft ${item.kind}`);
        await expect(cards.getByRole('listitem').first()).toContainText(
          `${label(item.fieldLabel)}: ${digits}`
        );
        expect(
          (await new AxeBuilder({ page }).include('#admin-content').analyze()).violations
        ).toEqual([]);
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
          .toBe(true);
        await page.getByRole('button', { name: label('cancel'), exact: true }).click();
        await cards
          .getByRole('listitem')
          .first()
          .getByRole('button', { name: `${label('delete')} ${title}`, exact: true })
          .press('Enter');
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await dialog
          .getByRole('button', { name: locale === 'fa' ? 'انصراف' : 'Cancel', exact: true })
          .click();
        await expect(dialog).toHaveCount(0);
        expect(writes).toBe(0);
      }
      const label = (key: string) => t(`admin.policies.${key}`, locale);
      const cards = page.getByRole('list', { name: label('policy-groups'), exact: true });
      status = 503;
      await page.getByRole('button', { name: label('refresh'), exact: true }).click();
      await expect(page.getByRole('button', { name: label('retry'), exact: true })).toBeVisible();
      const controls = cards.getByRole('button');
      expect(await controls.count()).toBe(6);
      for (const control of await controls.all()) await expect(control).toBeDisabled();
      await expect(cards).toContainText('Zeta policy-groups');
      status = 200;
      await page.getByRole('button', { name: label('retry'), exact: true }).click();
      await expect(controls.first()).toBeEnabled();
      await page.screenshot({ path: info.outputPath('catalogue-table-cards.png'), fullPage: true });
      status = 403;
      await page.getByRole('button', { name: label('refresh'), exact: true }).click();
      await expect(cards).toHaveCount(0);
      await expect(page.locator('#admin-content')).not.toContainText('Zeta policy-groups');
      await expect(page.locator('#admin-content')).not.toContainText('Alpha policy-groups');
      expect(writes).toBe(0);
    });
