import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';
import { t } from '@barghsa/i18n/admin-ui';
import { t as appT } from '@barghsa/i18n/app';
import { aiModel, aiAgent, aiOptions, aiDetail } from '../src/test/ai-catalogue-fixtures';
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
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
}
async function inspect(page: Page, name: string, locale: 'en' | 'fa', project: string) {
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'mobile-safari')
    await page.screenshot({
      path: `/tmp/barghsa-ai-catalogue-${name}-fa-mobile-safari.png`,
      fullPage: true,
    });
}
for (const locale of ['en', 'fa'] as const) {
  const m = (key: string) => t(`admin.aiModels.${key}`, locale),
    a = (key: string) => t(`admin.agents.${key}`, locale);
  test(`model drafts, budgets and frozen decisions recover without retaining denied work (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    let fail = false,
      deny = false,
      usage = 100,
      limit = 10000;
    await page.route('**/api/admin/ai-models', (route) =>
      route.fulfill(
        deny
          ? { status: 401, json: {} }
          : fail
            ? { status: 503, json: {} }
            : {
                json: [
                  {
                    ...aiModel,
                    budget: { ...aiModel.budget, usedInputTokens: usage, monthlyTokenLimit: limit },
                  },
                ],
              }
      )
    );
    await page.goto('/admin/ai-models');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    const viewport = page
      .getByRole('region', { name: m('title'), exact: true })
      .locator('[data-slot="scroll-area-viewport"]');
    await viewport.focus();
    await viewport.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
    await expect
      .poll(() => viewport.evaluate((node) => Math.abs(node.scrollLeft)))
      .toBeGreaterThan(0);
    await page.getByRole('button', { name: m('add'), exact: true }).click();
    await page.locator('#ai-model-title').fill('Draft model');
    await page.locator('#ai-model-token').fill('test-only-private-token');
    fail = true;
    await page.getByRole('button', { name: m('refresh'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(m('error'));
    await expect(page.locator('#ai-model-token')).toHaveValue('test-only-private-token');
    await page.locator('#ai-model-modelName').fill('During recovery');
    fail = false;
    await page.getByRole('button', { name: m('retry'), exact: true }).click();
    await expect(page.locator('#ai-model-modelName')).toHaveValue('During recovery');
    await page.getByRole('button', { name: m('cancel'), exact: true }).click();
    await page.getByRole('button', { name: m('budgetEdit'), exact: true }).click();
    await page.locator('#ai-model-monthlyTokenLimit').fill('15000');
    usage = 900;
    await page.getByRole('button', { name: m('refresh'), exact: true }).click();
    await expect(page.locator('#ai-model-monthlyTokenLimit')).toHaveValue('15000');
    await inspect(page, 'budget', locale, info.project.name);
    limit = 20000;
    await page.getByRole('button', { name: m('refresh'), exact: true }).click();
    await expect(page.locator('#ai-model-monthlyTokenLimit')).toHaveCount(0);
    await page.getByRole('button', { name: m('test'), exact: true }).click();
    const dialog = page.getByRole('dialog'),
      confirm = dialog.getByRole('button', { name: appT('team.confirm', locale), exact: true });
    fail = true;
    await dialog.getByRole('button', { name: m('refresh'), exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(m('error'));
    await expect(confirm).toBeDisabled();
    fail = false;
    await dialog.getByRole('button', { name: m('retry'), exact: true }).click();
    await expect(confirm).toBeEnabled();
    deny = true;
    await dialog.getByRole('button', { name: m('refresh'), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('table')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveText(m('forbidden'));
  });
  test(`agent list and options recover independently and preserve prompt and test-chat work (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    let failList = false,
      failOptions = false,
      removed = false,
      deny = false,
      optionReads = 0,
      listReads = 0,
      detailReads = 0;
    await page.route('**/api/admin/agents', (route) => {
      listReads++;
      return route.fulfill(
        deny
          ? { status: 403, json: {} }
          : failList
            ? { status: 503, json: {} }
            : { json: [aiAgent] }
      );
    });
    await page.route('**/api/admin/agents/options', (route) => {
      optionReads++;
      return route.fulfill(
        failOptions
          ? { status: 503, json: {} }
          : { json: { ...aiOptions, kbs: removed ? [] : aiOptions.kbs } }
      );
    });
    await page.route(`**/api/admin/agents/${aiAgent.id}`, (route) => {
      detailReads++;
      return route.fulfill({ json: aiDetail });
    });
    await page.goto('/admin/agents');
    await page.locator('#test-chat-message').fill('Keep test question');
    await page.getByRole('button', { name: `${a('edit')} ${aiAgent.title}`, exact: true }).click();
    await expect(page.locator('#agent-system-prompt')).toHaveValue(aiDetail.systemPrompt);
    expect(optionReads).toBe(1);
    expect(listReads).toBe(1);
    await expect(page.locator('#test-chat-message')).toHaveValue('Keep test question');
    await page.locator('#agent-system-prompt').fill('Retained system prompt');
    failList = true;
    await page.getByRole('button', { name: a('refresh'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(a('error'));
    await page.locator('#agent-description').fill('During recovery');
    const optionsBefore = optionReads,
      detailBefore = detailReads;
    failList = false;
    await page.getByRole('button', { name: a('retry'), exact: true }).click();
    await expect(page.locator('#agent-description')).toHaveValue('During recovery');
    expect(optionReads).toBe(optionsBefore);
    expect(detailReads).toBe(detailBefore);
    failOptions = true;
    await page.getByRole('button', { name: a('refresh'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(a('optionsError'));
    const listsBefore = listReads;
    failOptions = false;
    removed = true;
    await page.getByRole('button', { name: a('optionsRetry'), exact: true }).click();
    await expect(page.getByRole('button', { name: a('save'), exact: true })).toBeDisabled();
    expect(listReads).toBe(listsBefore);
    await expect(page.locator('#agent-system-prompt')).toHaveValue('Retained system prompt');
    const withdrawn = page.getByRole('checkbox', {
      name: `${a('unavailable')} (kb-one)`,
      exact: true,
    });
    await withdrawn.click();
    await expect(withdrawn).toHaveCount(0);
    await expect(page.getByRole('button', { name: a('save'), exact: true })).toBeEnabled();
    await inspect(page, 'agent', locale, info.project.name);
    await page.getByRole('button', { name: a('save'), exact: true }).click();
    deny = true;
    await page
      .getByRole('dialog')
      .getByRole('button', { name: a('refresh'), exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('#agent-system-prompt')).toHaveCount(0);
    await expect(page.locator('#test-chat-message')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveText(a('denied'));
  });
  test(`agent settings retry is independent and changed configuration clears stale editing (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    let fail = true,
      phase = 0,
      lists = 0,
      options = 0;
    await page.route('**/api/admin/agents', (route) => {
      lists++;
      return route.fulfill({ json: [aiAgent] });
    });
    await page.route('**/api/admin/agents/options', (route) => {
      options++;
      return route.fulfill({
        json: { ...aiOptions, kbs: [...aiOptions.kbs, { id: 'kb-two', title: 'Other knowledge' }] },
      });
    });
    await page.route(`**/api/admin/agents/${aiAgent.id}`, (route) =>
      route.fulfill(
        fail
          ? { status: 503, json: {} }
          : {
              json: {
                ...aiDetail,
                kbs: phase
                  ? [{ id: 'kb-two', title: 'Renamed knowledge' }, ...aiDetail.kbs]
                  : [...aiDetail.kbs, { id: 'kb-two', title: 'Other knowledge' }],
                modelTitle: phase ? 'Renamed model' : aiDetail.modelTitle,
                systemPrompt: phase === 2 ? 'Changed server prompt' : aiDetail.systemPrompt,
              },
            }
      )
    );
    await page.goto('/admin/agents');
    await page.getByRole('button', { name: `${a('edit')} ${aiAgent.title}`, exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(a('detailError'));
    fail = false;
    await page.getByRole('button', { name: a('detailRetry'), exact: true }).click();
    await expect(page.locator('#agent-system-prompt')).toHaveValue(aiDetail.systemPrompt);
    expect(lists).toBe(1);
    expect(options).toBe(1);
    await page.locator('#agent-system-prompt').fill('Keep my prompt');
    phase = 1;
    await page.getByRole('button', { name: a('refresh'), exact: true }).click();
    await expect(page.locator('#agent-system-prompt')).toHaveValue('Keep my prompt');
    await inspect(page, 'detail', locale, info.project.name);
    phase = 2;
    await page.getByRole('button', { name: a('refresh'), exact: true }).click();
    await expect(page.locator('#agent-system-prompt')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}
