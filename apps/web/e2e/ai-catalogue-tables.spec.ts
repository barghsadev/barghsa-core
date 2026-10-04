import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { aiModel, aiAgent, aiDetail, aiOptions } from '../src/test/ai-catalogue-fixtures';
import { t } from '@barghsa/i18n/admin-ui';
import { aiModelFormText } from '@barghsa/i18n/ai-model-forms';
import { aiAgentFormText } from '@barghsa/i18n/ai-agent-forms';
import AxeBuilder from '@axe-core/playwright';

for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true])
    test(`AI catalogue tables and cards preserve operational metadata and protected drafts (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
    }, info) => {
      const numerals = locale === 'fa' ? 'latn' : 'arabext';
      await setupCatalogueForms(page, locale, dark, {
        numberStyle: locale === 'fa' ? 'western' : 'persian',
      });
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'UTC' } })
      );
      const model = {
        ...structuredClone(aiModel),
        title: 'Zeta model <b>literal</b>',
        lastTestedAt: '2026-10-01T00:00:00Z',
        lastTestLatencyMs: 12,
        circuitOpen: true,
        circuitCooldownUntil: '2026-10-05T00:00:00Z',
        budget: {
          ...aiModel.budget,
          usedInputTokens: 12,
          usedOutputTokens: 0,
          usedCostMicros: 1250000,
          monthlyCostLimitMicros: 2500000,
        },
      };
      const agent = { ...aiDetail, title: 'Zeta agent <script>literal</script>', kbCount: 12 };
      const privateToken = 'private-never-rendered';
      let unsafePayload = false,
        modelStatus = 200,
        agentStatus = 200,
        writes = 0;
      await page.route('**/api/admin/ai-models', (route) => {
        if (route.request().method() !== 'GET') writes++;
        return route.fulfill({
          status: modelStatus,
          json:
            modelStatus === 200
              ? [
                  unsafePayload ? { ...model, apiToken: privateToken } : model,
                  {
                    ...aiModel,
                    id: '01900000-0000-7000-8000-000000000002',
                    title: 'Alpha model',
                    isEnabled: false,
                    status: 'unknown',
                    budget: null,
                  },
                ]
              : {},
        });
      });
      await page.route('**/api/admin/ai-models/*', (route) => {
        if (route.request().method() !== 'GET') writes++;
        return route.fulfill({ status: 404, json: {} });
      });
      await page.route('**/api/admin/agents', (route) => {
        if (route.request().method() !== 'GET') writes++;
        return route.fulfill({
          status: agentStatus,
          json:
            agentStatus === 200
              ? [
                  agent,
                  {
                    ...aiAgent,
                    id: '01900000-0000-7000-8000-000000000012',
                    title: 'Alpha agent',
                    enabled: false,
                    kbCount: undefined,
                    policyCount: undefined,
                  },
                ]
              : {},
        });
      });
      await page.route('**/api/admin/agents/options', (route) =>
        route.fulfill({ json: aiOptions })
      );
      await page.route(`**/api/admin/agents/${agent.id}`, (route) => {
        if (route.request().method() !== 'GET') writes++;
        return route.fulfill({ json: agent });
      });
      const number = new Intl.NumberFormat(locale, { numberingSystem: numerals });
      const dollars = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'USD',
        numberingSystem: numerals,
      });
      const inspect = async (name: string) => {
        expect(
          (await new AxeBuilder({ page }).include('#admin-content').analyze()).violations
        ).toEqual([]);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
        ).toBe(true);
        await page.screenshot({ path: info.outputPath(name), fullPage: true });
      };
      const cancelDelete = async () => {
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await dialog
          .getByRole('button', { name: locale === 'fa' ? 'انصراف' : 'Cancel', exact: true })
          .click();
        await expect(dialog).toHaveCount(0);
        expect(writes).toBe(0);
      };
      const modelText = (key: string) => t(`admin.aiModels.${key}`, locale);
      const modelCaption = aiModelFormText('list', locale);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('/admin/ai-models');
      const modelTable = page.getByRole('table', { name: modelCaption, exact: true });
      await expect(modelTable).toBeVisible();
      await expect(modelTable.getByRole('columnheader')).toHaveCount(5);
      await expect(modelTable.getByRole('rowheader').first()).toContainText(model.title);
      await expect(modelTable.locator('thead button')).toHaveCount(0);
      const modelRow = modelTable.locator('tbody tr').first();
      await expect(modelRow).toContainText(model.apiTokenMasked);
      await expect(modelRow).toContainText(`${modelText('latency')}: ${number.format(12)} ms`);
      await expect(modelRow).toContainText(dollars.format(1.25));
      await expect(modelRow).toContainText(dollars.format(2.5));
      await expect(modelRow).toContainText(modelText('lastTest'));
      await expect(modelRow).toContainText(modelText('circuitOpen'));
      const viewport = page.getByRole('region', { name: modelCaption, exact: true });
      const before = await viewport.evaluate((node) => ({
        left: node.scrollLeft,
        overflow: node.scrollWidth > node.clientWidth,
      }));
      expect(before.overflow).toBe(true);
      await viewport.focus();
      await viewport.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
      await expect.poll(() => viewport.evaluate((node) => node.scrollLeft)).not.toBe(before.left);
      await inspect('model-table-desktop.png');
      await modelRow.getByRole('button', { name: modelText('edit'), exact: true }).press('Enter');
      const modelDraft = page.locator('#ai-model-title');
      await expect(modelDraft).toHaveValue(model.title);
      await modelDraft.fill('Retained model draft');
      await page.setViewportSize({ width: 390, height: 844 });
      const modelCards = page.getByRole('list', { name: modelCaption, exact: true });
      await expect(modelCards).toBeVisible();
      await expect(modelTable).toHaveCount(0);
      await expect(modelDraft).toHaveValue('Retained model draft');
      await expect(modelCards.getByRole('listitem').first()).toContainText(dollars.format(1.25));
      await expect(
        modelCards
          .getByRole('listitem')
          .nth(1)
          .getByRole('button', { name: modelText('enable'), exact: true })
      ).toBeDisabled();
      await expect(page.locator('#admin-content')).not.toContainText(privateToken);
      await expect(page.locator('#admin-content script')).toHaveCount(0);
      modelStatus = 503;
      await page.getByRole('button', { name: modelText('refresh'), exact: true }).click();
      await expect(
        page.getByRole('button', { name: modelText('retry'), exact: true })
      ).toBeVisible();
      const modelControls = modelCards.getByRole('button');
      expect(await modelControls.count()).toBe(10);
      for (const control of await modelControls.all()) await expect(control).toBeDisabled();
      await expect(modelDraft).toHaveValue('Retained model draft');
      modelStatus = 200;
      await page.getByRole('button', { name: modelText('retry'), exact: true }).click();
      await expect(modelControls.first()).toBeEnabled();
      unsafePayload = true;
      await page.getByRole('button', { name: modelText('refresh'), exact: true }).click();
      await expect(
        page.getByRole('button', { name: modelText('retry'), exact: true })
      ).toBeVisible();
      await expect(modelControls.first()).toBeDisabled();
      await expect(modelDraft).toHaveValue('Retained model draft');
      await expect(page.locator('#admin-content')).not.toContainText(privateToken);
      unsafePayload = false;
      await page.getByRole('button', { name: modelText('retry'), exact: true }).click();
      await expect(modelControls.first()).toBeEnabled();
      await page.getByRole('button', { name: modelText('cancel'), exact: true }).click();
      await modelCards
        .getByRole('listitem')
        .first()
        .getByRole('button', { name: modelText('delete'), exact: true })
        .press('Enter');
      await cancelDelete();
      await inspect('model-cards-mobile.png');
      modelStatus = 403;
      await page.getByRole('button', { name: modelText('refresh'), exact: true }).click();
      await expect(modelCards).toHaveCount(0);
      await expect(page.locator('#admin-content')).not.toContainText(model.title);

      const agentText = (key: string) => t(`admin.agents.${key}`, locale);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('/admin/agents');
      const agentTable = page.getByRole('table', { name: agentText('title'), exact: true });
      await expect(agentTable).toBeVisible();
      const agentRow = agentTable.locator('tbody tr').first();
      await expect(agentRow).toContainText(agent.title);
      await expect(agentRow).toContainText(aiAgentFormText('linkedKbs', locale));
      await expect(agentRow.locator('dd').first()).toHaveText(number.format(12));
      await expect(agentTable.locator('tbody tr').nth(1).locator('dd').first()).toHaveText('—');
      await inspect('agent-table-desktop.png');
      await agentRow
        .getByRole('button', { name: `${agentText('edit')} ${agent.title}`, exact: true })
        .press('Enter');
      const agentDraft = page.locator('#agent-title');
      await expect(agentDraft).toHaveValue(agent.title);
      await agentDraft.fill('Retained agent draft');
      await page.setViewportSize({ width: 390, height: 844 });
      const agentCards = page.getByRole('list', { name: agentText('title'), exact: true });
      await expect(agentCards).toBeVisible();
      await expect(agentTable).toHaveCount(0);
      await expect(agentDraft).toHaveValue('Retained agent draft');
      await expect(agentCards.getByRole('listitem').first().locator('dd').first()).toHaveText(
        number.format(12)
      );
      agentStatus = 503;
      await page.getByRole('button', { name: agentText('refresh'), exact: true }).click();
      await expect(
        page.getByRole('button', { name: agentText('retry'), exact: true })
      ).toBeVisible();
      const agentControls = agentCards.getByRole('button');
      expect(await agentControls.count()).toBe(4);
      for (const control of await agentControls.all()) await expect(control).toBeDisabled();
      await expect(agentDraft).toHaveValue('Retained agent draft');
      agentStatus = 200;
      await page.getByRole('button', { name: agentText('retry'), exact: true }).click();
      await expect(agentControls.first()).toBeEnabled();
      await page.getByRole('button', { name: agentText('cancel'), exact: true }).click();
      await agentCards
        .getByRole('listitem')
        .first()
        .getByRole('button', { name: `${agentText('delete')} ${agent.title}`, exact: true })
        .press('Enter');
      await cancelDelete();
      await inspect('agent-cards-mobile.png');
      agentStatus = 403;
      await page.getByRole('button', { name: agentText('refresh'), exact: true }).click();
      await expect(agentCards).toHaveCount(0);
      await expect(page.locator('#admin-content')).not.toContainText(agent.title);
      expect(writes).toBe(0);
    });
