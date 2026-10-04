import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';
import { t } from '@barghsa/i18n/admin-ui';
import { t as appT } from '@barghsa/i18n/app';
import {
  knowledgeBase as kb,
  knowledgeGroup as kg,
  knowledgeDetail as kd,
  policyEntry as policy,
  policySecond,
  policyGroup as pg,
} from '../src/test/knowledge-policy-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
async function shell(page: Page, locale: 'en' | 'fa') {
  await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'admin',
        isStaff: true,
        operatingContext: 'staff',
        canSwitchContext: false,
        requiresTosAcceptance: false,
      },
    })
  );
}
async function inspect(page: Page, name: string, locale: string, project: string) {
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'mobile-safari')
    await page.screenshot({
      path: `/tmp/barghsa-knowledge-policy-${name}-fa-mobile-safari.png`,
      fullPage: true,
    });
}
for (const locale of ['en', 'fa'] as const) {
  const k = (key: string) => t(`admin.kb.${key}`, locale),
    p = (key: string) => t(`admin.policies.${key}`, locale);
  test(`knowledge retries retain query results and document-picker selection (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    let failList = false,
      failDetail = false,
      listReads = 0,
      detailReads = 0;
    await page.route('**/api/admin/knowledge-bases', (route) => {
      listReads++;
      return route.fulfill(failList ? { status: 503, json: {} } : { json: [kb] });
    });
    await page.route(`**/api/admin/knowledge-bases/${kb.id}`, (route) => {
      detailReads++;
      return route.fulfill(failDetail ? { status: 503, json: {} } : { json: kd });
    });
    await page.route('**/api/admin/knowledge-bases/documents/available**', (route) =>
      route.fulfill({
        json: [{ storageKey: 'uploads/document/guide.txt', fileName: 'Guide.txt' }],
      })
    );
    await page.route(`**/api/admin/knowledge-bases/${kb.id}/query`, (route) =>
      route.fulfill({
        json: [
          {
            id: 'chunk-one',
            kbId: kb.id,
            excerpt: 'Accepted guidance',
            score: 0.9,
            metadata: { fileName: 'Guide.txt' },
          },
        ],
      })
    );
    await page.goto('/admin/knowledge-bases');
    await page.getByRole('button', { name: `${k('open')} ${kb.title}`, exact: true }).click();
    await expect(page.locator('#kb-file')).toBeVisible();
    expect(listReads).toBe(1);
    expect(detailReads).toBe(1);
    await page.locator('#kb-test-query').fill('meter charge');
    await page.getByRole('button', { name: k('runQuery'), exact: true }).click();
    await expect(page.getByText('Accepted guidance', { exact: true })).toBeVisible();
    await page.locator('#kb-file-search').fill('Retained search');
    await page.locator('#kb-file').selectOption('uploads/document/guide.txt');
    failList = true;
    await page.getByRole('button', { name: k('refresh'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(k('error'));
    await expect(page.locator('#kb-test-query')).toHaveValue('meter charge');
    await expect(page.locator('#kb-file')).toHaveValue('uploads/document/guide.txt');
    await expect(page.getByText('Accepted guidance', { exact: true })).toBeVisible();
    const detailBefore = detailReads;
    failList = false;
    await page.getByRole('button', { name: k('retry'), exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(detailReads).toBe(detailBefore);
    failDetail = true;
    await page.getByRole('button', { name: k('refresh'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(k('detailError'));
    const listBefore = listReads;
    failDetail = false;
    await page.getByRole('button', { name: k('detailRetry'), exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(listReads).toBe(listBefore);
    await expect(page.locator('#kb-file-search')).toHaveValue('Retained search');
    await expect(page.locator('#kb-file')).toHaveValue('uploads/document/guide.txt');
    await inspect(page, 'knowledge', locale, info.project.name);
  });
  test(`knowledge group choices recover independently and denial clears private inputs (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    let fail = false,
      denied = false,
      listReads = 0,
      detailReads = 0;
    await page.route('**/api/admin/knowledge-bases', (route) =>
      route.fulfill(
        denied ? { status: 403, json: {} } : fail ? { status: 503, json: {} } : { json: [kb] }
      )
    );
    await page.route('**/api/admin/kb-groups', (route) => {
      listReads++;
      return route.fulfill({ json: [kg] });
    });
    await page.route(`**/api/admin/kb-groups/${kg.id}`, (route) => {
      detailReads++;
      return route.fulfill({ json: { ...kg, members: [] } });
    });
    await page.goto('/admin/knowledge-bases');
    await page.getByRole('button', { name: k('kb-groups'), exact: true }).click();
    await page.getByRole('button', { name: `${k('open')} ${kg.title}`, exact: true }).click();
    await page.locator('#kb-member').selectOption(kb.id);
    await page.locator('#kb-test-query').fill('Keep group question');
    fail = true;
    await page.getByRole('button', { name: k('refresh'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(k('optionsError'));
    const before = [listReads, detailReads];
    fail = false;
    await page.getByRole('button', { name: k('optionsRetry'), exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect([listReads, detailReads]).toEqual(before);
    await expect(page.locator('#kb-member')).toHaveValue(kb.id);
    await expect(page.locator('#kb-test-query')).toHaveValue('Keep group question');
    await inspect(page, 'knowledge-group', locale, info.project.name);
    denied = true;
    await page.getByRole('button', { name: k('refresh'), exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(k('denied'));
    await expect(page.locator('#kb-member')).toHaveCount(0);
    await expect(page.locator('#kb-test-query')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: `${k('open')} ${kg.title}`, exact: true })
    ).toHaveCount(0);
  });
  test(`policy drafts survive list recovery and frozen save waits for a valid read (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    let fail = false;
    const writes: unknown[] = [];
    await page.route('**/api/admin/policies', (route) => {
      if (route.request().method() !== 'GET') {
        writes.push(route.request().postDataJSON());
        return route.fulfill({
          status: 201,
          json: { ...policy, ...route.request().postDataJSON() },
        });
      }
      return route.fulfill(fail ? { status: 503, json: {} } : { json: [policy] });
    });
    await page.goto('/admin/policies');
    await page.getByRole('button', { name: p('addPolicy'), exact: true }).click();
    await page.locator('#policy-title').fill('Local draft');
    await page.locator('#policy-items').fill('energy\nbilling');
    fail = true;
    await page.getByRole('button', { name: p('refresh'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(p('error'));
    await page.locator('#policy-description').fill('During recovery');
    await expect(page.getByRole('button', { name: p('save'), exact: true })).toBeDisabled();
    fail = false;
    await page.getByRole('button', { name: p('retry'), exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('#policy-items')).toHaveValue('energy\nbilling');
    await inspect(page, 'policy-draft', locale, info.project.name);
    await page.getByRole('button', { name: p('save'), exact: true }).click();
    const dialog = page.getByRole('dialog'),
      confirm = dialog.getByRole('button', { name: appT('team.confirm', locale), exact: true });
    fail = true;
    await dialog.getByRole('button', { name: p('refresh'), exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(p('error'));
    await expect(confirm).toBeDisabled();
    fail = false;
    await dialog.getByRole('button', { name: p('retry'), exact: true }).click();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toEqual([
      {
        title: 'Local draft',
        description: 'During recovery',
        policyType: 'allowed_topics',
        rules: { topics: ['energy', 'billing'] },
        enabled: true,
        priority: 100,
      },
    ]);
  });
  test(`policy group recovery preserves priority drafts and changed membership invalidates confirmation (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    let failDetail = false,
      failChoices = false,
      changed = false,
      listReads = 0,
      optionReads = 0;
    await page.route('**/api/admin/policies', (route) => {
      optionReads++;
      return route.fulfill(
        failChoices ? { status: 503, json: {} } : { json: [policy, policySecond] }
      );
    });
    await page.route('**/api/admin/policy-groups', (route) => {
      listReads++;
      return route.fulfill({ json: [pg] });
    });
    await page.route(`**/api/admin/policy-groups/${pg.id}`, (route) =>
      route.fulfill(
        failDetail
          ? { status: 503, json: {} }
          : { json: { ...pg, members: [{ ...policy, priorityOverride: changed ? 30 : null }] } }
      )
    );
    await page.goto('/admin/policies');
    await page.getByRole('button', { name: p('policy-groups'), exact: true }).click();
    await page.getByRole('button', { name: `${p('open')} ${pg.title}`, exact: true }).click();
    const override = page.locator(`#member-priority-${policy.id}`);
    await override.fill('25');
    await page.locator('#policy-member').selectOption(policySecond.id);
    await page.locator('#policy-member-priority').fill('75');
    failDetail = true;
    await page.getByRole('button', { name: p('refresh'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(p('detailError'));
    const before = [listReads, optionReads];
    failDetail = false;
    await page.getByRole('button', { name: p('detailRetry'), exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect([listReads, optionReads]).toEqual(before);
    await expect(override).toHaveValue('25');
    await expect(page.locator('#policy-member')).toHaveValue(policySecond.id);
    await expect(page.locator('#policy-member-priority')).toHaveValue('75');
    failChoices = true;
    await page.getByRole('button', { name: p('refresh'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(p('optionsError'));
    await expect(page.getByRole('button', { name: p('link'), exact: true })).toBeDisabled();
    await expect(
      page.getByRole('button', { name: p('updatePriority'), exact: true })
    ).toBeEnabled();
    failChoices = false;
    await page.getByRole('button', { name: p('optionsRetry'), exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await inspect(page, 'policy-group', locale, info.project.name);
    await page.getByRole('button', { name: p('updatePriority'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    changed = true;
    await dialog.getByRole('button', { name: p('refresh'), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(override).toHaveValue('25');
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'بازنشانی به تنظیمات ذخیره‌شده' : 'Reset to saved settings',
        exact: true,
      })
      .click();
    await expect(override).toHaveValue('30');
    await expect(page.locator('#policy-member-priority')).toHaveValue('75');
  });
}
