import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { cookieResponse } from './cookie-response';
import { aiDetail, aiOptions, aiAgent } from '../src/test/ai-catalogue-fixtures';
import {
  assignmentAgent,
  otherAssignmentAgent,
  assignmentSlots,
} from '../src/test/assignment-settings-fixtures';
import { t } from '@barghsa/i18n/admin-ui';
import { aiAgentFormText } from '@barghsa/i18n/ai-agent-forms';
import AxeBuilder from '@axe-core/playwright';
test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true])
    test(`agent and slot forms own feedback, verify saves and recover safely (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
    }, info) => {
      await setupCatalogueForms(page, locale, dark);
      const agentText = (key: string) => t(`admin.agents.${key}`, locale),
        slotText = (key: string) => t(`admin.slots.${key}`, locale),
        copy = (key: Parameters<typeof aiAgentFormText>[0]) => aiAgentFormText(key, locale);
      let stored = structuredClone(aiDetail),
        readStatus = 200,
        verified = false,
        incompleteDetail = false;
      const agentWrites: Record<string, unknown>[] = [],
        slotWrites: unknown[] = [];
      const invalid = (field: string) => ({
        status: 400,
        json: {
          error: {
            code: 'VALIDATION:INPUT:INVALID',
            fields: [field],
            message: 'private-server-value',
          },
        },
      });
      await page.route('**/api/admin/agents', (route) =>
        route.fulfill({ status: readStatus, json: readStatus === 200 ? [stored] : {} })
      );
      await page.route('**/api/admin/agents/options', (route) =>
        route.fulfill({ status: readStatus, json: readStatus === 200 ? aiOptions : {} })
      );
      await page.route(`**/api/admin/agents/${aiAgent.id}`, (route) => {
        if (route.request().method() === 'GET') {
          if (incompleteDetail) {
            incompleteDetail = false;
            readStatus = 503;
            return route.fulfill({ json: { ...stored, kbs: [] } });
          }
          return route.fulfill({ status: readStatus, json: readStatus === 200 ? stored : {} });
        }
        const body = route.request().postDataJSON();
        agentWrites.push(body);
        if (agentWrites.length === 1) return route.fulfill(invalid('kbIds'));
        if (!verified)
          return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
        expect(route.request().headers()['x-csrf-token']).toBe('agent-slot-fresh');
        stored = { ...stored, ...body };
        if (agentWrites.length === 3) incompleteDetail = true;
        return route.fulfill({ json: stored });
      });
      await page.route('**/api/auth/step-up', (route) => {
        verified = true;
        return cookieResponse(route, {
          json: { verified: true },
          headers: { 'Set-Cookie': 'barghsa_csrf=agent-slot-fresh; Path=/; SameSite=Lax' },
        });
      });
      const button = (name: string) => page.getByRole('button', { name, exact: true });
      const confirm = async () => {
        const dialog = page.getByRole('dialog');
        await dialog.locator('button[type=submit]').click();
        await expect(dialog).toHaveCount(0);
      };
      await page.goto('/admin/agents');
      await button(`${agentText('edit')} ${aiAgent.title}`).click();
      const max = page.locator('#agent-max-tokens'),
        prompt = page.locator('#agent-system-prompt'),
        group = page
          .locator('fieldset')
          .filter({ has: page.getByRole('checkbox', { name: 'Tariffs', exact: true }) })
          .last();
      await max.fill('1.5');
      await button(agentText('save')).click();
      await expect(max).toBeFocused();
      await expect(max).toHaveAttribute('aria-invalid', 'true');
      expect(agentWrites).toHaveLength(0);
      await max.fill('512');
      await prompt.fill('Preserve my instructions');
      await button(agentText('save')).click();
      await confirm();
      await expect(group).toBeFocused();
      await expect(group).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByRole('checkbox', { name: 'Tariffs', exact: true })).toBeChecked();
      await expect(prompt).toHaveValue('Preserve my instructions');
      await expect(page.locator('#admin-content')).not.toContainText('private-server-value');
      expect(
        (await new AxeBuilder({ page }).include('#admin-content').analyze()).violations
      ).toEqual([]);
      await page.screenshot({ path: info.outputPath('agent-link-feedback.png'), fullPage: true });
      await button(agentText('save')).click();
      const dialog = page.getByRole('dialog');
      await dialog.locator('button[type=submit]').click();
      await expect(dialog.locator('input[type=password]')).toBeVisible();
      await dialog.locator('input[type=password]').fill('Agent-password-123!');
      await dialog.locator('button[type=submit]').click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText(copy('uncertain'), { exact: true })).toBeVisible();
      await expect(button(copy('reset'))).toBeDisabled();
      await expect(button(agentText('cancel'))).toBeDisabled();
      await expect(max).toHaveValue('512');
      await expect(button(agentText('save'))).toBeDisabled();
      readStatus = 200;
      await button(agentText('refresh')).click();
      await expect(button(copy('reset'))).toBeEnabled();
      await button(copy('reset')).click();
      await expect(prompt).toHaveValue('Preserve my instructions');
      await button(agentText('save')).click();
      await confirm();
      await expect(max).toHaveCount(0);
      expect(agentWrites).toEqual(
        Array(4).fill({
          title: aiAgent.title,
          description: aiAgent.description,
          modelId: aiAgent.modelId,
          systemPrompt: 'Preserve my instructions',
          temperature: null,
          maxTokens: 512,
          linkMode: 'any_kb',
          enabled: true,
          kbIds: [aiOptions.kbs[0]!.id],
          policyIds: [],
          kbGroupIds: [],
          policyGroupIds: [],
        })
      );
      await button(`${agentText('edit')} ${aiAgent.title}`).click();
      await page.locator('#test-chat-message').fill('Clear on denied access');
      readStatus = 403;
      await button(agentText('refresh')).click();
      await expect(prompt).toHaveCount(0);
      await expect(page.locator('#test-chat-message')).toHaveCount(0);

      let slots = assignmentSlots(),
        slotsStatus = 200,
        agentsStatus = 200;
      await page.route('**/api/admin/agents', (route) =>
        route.fulfill({
          status: agentsStatus,
          json: agentsStatus === 200 ? [assignmentAgent, otherAssignmentAgent] : {},
        })
      );
      await page.route('**/api/admin/agent-slots', (route) =>
        route.fulfill({ status: slotsStatus, json: slotsStatus === 200 ? slots : {} })
      );
      await page.route('**/api/admin/agent-slots/*/agent', (route) => {
        const body = route.request().postDataJSON();
        slotWrites.push(body);
        if (slotWrites.length === 1) return route.fulfill(invalid('agentId'));
        const key = new URL(route.request().url()).pathname.split('/').at(-2)!;
        const selected =
          body.agentId === assignmentAgent.id
            ? assignmentAgent
            : body.agentId === otherAssignmentAgent.id
              ? otherAssignmentAgent
              : null;
        slots = slots.map((row) =>
          row.slotKey === key ? { ...row, agent: selected, updatedAt: '2026-10-01T01:00:00Z' } : row
        );
        slots = slots.map((row) => ({
          ...row,
          alsoUsedIn: row.agent
            ? slots
                .filter(
                  (other) => other.slotKey !== row.slotKey && other.agent?.id === row.agent?.id
                )
                .map((other) => other.slotKey)
            : [],
        }));
        if (slotWrites.length === 2) {
          slotsStatus = 503;
          return route.fulfill({ json: {} });
        }
        return route.fulfill({ json: slots.find((row) => row.slotKey === key) });
      });
      await page.goto('/admin/agent-slots');
      const individual = page.locator('#slot-individual_chatbot'),
        website = page.locator('#slot-website_chatbot'),
        saveSlot = button(`${slotText('save')} ${slotText('individual_chatbot')}`);
      await individual.selectOption(assignmentAgent.id);
      await website.selectOption(otherAssignmentAgent.id);
      await expect(page.getByText(slotText('disabledHelp'), { exact: true }).first()).toBeVisible();
      await expect(
        page.getByText(`${slotText('shared')}: ${slotText('staff_chatbot')}`, { exact: true })
      ).toBeVisible();
      await saveSlot.click();
      await confirm();
      await expect(individual).toBeFocused();
      await expect(individual).toHaveAttribute('aria-invalid', 'true');
      await expect(website).toHaveValue(otherAssignmentAgent.id);
      expect(
        (await new AxeBuilder({ page }).include('#admin-content').analyze()).violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await page.screenshot({ path: info.outputPath('slot-feedback.png'), fullPage: true });
      await saveSlot.click();
      await confirm();
      await expect(page.getByText(copy('uncertain'), { exact: true })).toBeVisible();
      await expect(button(copy('reset'))).toBeDisabled();
      await expect(saveSlot).toBeDisabled();
      await expect(individual).toHaveValue(assignmentAgent.id);
      await expect(website).toHaveValue(otherAssignmentAgent.id);
      slotsStatus = 200;
      await button(slotText('refresh')).click();
      await expect(button(copy('reset'))).toBeEnabled();
      await button(copy('reset')).click();
      await expect(website).toHaveValue(otherAssignmentAgent.id);
      await individual.selectOption('');
      await saveSlot.click();
      await confirm();
      await expect(individual).toHaveValue('');
      expect(slotWrites).toEqual([
        { agentId: assignmentAgent.id },
        { agentId: assignmentAgent.id },
        { agentId: null },
      ]);
      agentsStatus = 403;
      await button(slotText('agentsRetry')).click();
      await expect(page.locator('select[id^=slot-]')).toHaveCount(0);
    });
