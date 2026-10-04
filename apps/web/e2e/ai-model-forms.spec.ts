import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { cookieResponse } from './cookie-response';
import { aiModel } from '../src/test/ai-catalogue-fixtures';
import { t } from '@barghsa/i18n/admin-ui';
import { aiModelFormText } from '@barghsa/i18n/ai-model-forms';
import AxeBuilder from '@axe-core/playwright';
test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    test(`AI model and budget forms retain owned feedback and recover uncertain saves (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
    }, info) => {
      await setupCatalogueForms(page, locale, dark);
      const label = (key: string) => t(`admin.aiModels.${key}`, locale);
      const model = structuredClone(aiModel);
      let readStatus = 200,
        verified = false;
      const modelWrites: unknown[] = [],
        budgetWrites: unknown[] = [];
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
      await page.route('**/api/admin/ai-models', (route) =>
        route.fulfill({ status: readStatus, json: readStatus === 200 ? [model] : {} })
      );
      await page.route(`**/api/admin/ai-models/${model.id}`, (route) => {
        const body = route.request().postDataJSON();
        modelWrites.push(body);
        if (modelWrites.length === 1) return route.fulfill(invalid('maxTokens'));
        if (!verified)
          return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
        expect(route.request().headers()['x-csrf-token']).toBe('model-fresh');
        const publicBody = { ...body };
        delete publicBody.apiToken;
        Object.assign(model, {
          ...publicBody,
          apiTokenMasked: '********oken',
          isEnabled: false,
          status: 'unknown',
        });
        return route.fulfill({ json: model });
      });
      await page.route('**/api/auth/step-up', (route) => {
        verified = true;
        return cookieResponse(route, {
          json: { verified: true },
          headers: { 'Set-Cookie': 'barghsa_csrf=model-fresh; Path=/; SameSite=Lax' },
        });
      });
      await page.route(`**/api/admin/ai-models/${model.id}/budget`, (route) => {
        const body = route.request().postDataJSON();
        budgetWrites.push(body);
        if (budgetWrites.length === 1) return route.fulfill(invalid('monthlyCostUsd'));
        Object.assign(model.budget, { ...body });
        if (budgetWrites.length === 2) {
          readStatus = 503;
          return route.fulfill({ json: {} });
        }
        return route.fulfill({ json: model });
      });
      const button = (key: string) => page.getByRole('button', { name: label(key), exact: true });
      const confirm = async () => {
        const dialog = page.getByRole('dialog');
        await dialog.locator('button[type=submit]').click();
        if (await dialog.locator('input[type=password]').count()) {
          await dialog.locator('input[type=password]').fill('Model-password-123!');
          await dialog.locator('button[type=submit]').click();
        }
        await expect(dialog).toHaveCount(0);
      };
      await page.goto('/admin/ai-models');
      await button('edit').click();
      const max = page.locator('#ai-model-max-tokens'),
        base = page.locator('#ai-model-baseUrl'),
        choice = page.locator('#ai-model-token-choice');
      await max.fill('1.5');
      await button('save').click();
      await expect(max).toBeFocused();
      await expect(max).toHaveAttribute('aria-invalid', 'true');
      expect(modelWrites).toHaveLength(0);
      await max.fill('512');
      await base.fill('https://changed.example.test/v1');
      await button('save').click();
      await expect(choice).toBeFocused();
      await choice.selectOption('replace');
      await page.locator('#ai-model-token').fill('private-new-token');
      await button('save').click();
      await confirm();
      await expect(max).toBeFocused();
      await expect(max).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('#ai-model-token')).toHaveValue('private-new-token');
      expect(await max.getAttribute('aria-describedby')).toContain('-maxTokens-error');
      await expect(page.locator('#admin-content')).not.toContainText('private-server-value');
      await page.screenshot({ path: info.outputPath('ai-model-feedback.png'), fullPage: true });
      await button('save').click();
      const dialog = page.getByRole('dialog');
      await dialog.locator('button[type=submit]').click();
      await expect(dialog.locator('input[type=password]')).toBeVisible();
      await dialog.locator('input[type=password]').fill('Model-password-123!');
      await dialog.locator('button[type=submit]').click();
      await expect(dialog).toHaveCount(0);
      expect(modelWrites).toEqual(
        Array(3).fill({
          title: model.title,
          providerType: model.providerType,
          baseUrl: model.baseUrl,
          modelName: model.modelName,
          config: { max_tokens: 512, temperature: 0 },
          apiToken: 'private-new-token',
        })
      );
      await expect(page.locator('#ai-model-token')).toHaveCount(0);
      await button('budgetEdit').click();
      const cost = page.locator('#ai-model-monthlyCostUsd');
      await cost.fill('0.0000001');
      await button('budgetSave').click();
      await expect(cost).toBeFocused();
      expect(budgetWrites).toHaveLength(0);
      await cost.fill('0.000001');
      await page.locator('#ai-model-inputPriceUsd').fill('0.000001');
      await page.locator('#ai-model-outputPriceUsd').fill('0.000002');
      await button('budgetSave').click();
      await confirm();
      await expect(cost).toBeFocused();
      await expect(cost).toHaveAttribute('aria-invalid', 'true');
      const axe = await new AxeBuilder({ page }).include('#admin-content').analyze();
      expect(axe.violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await page.screenshot({ path: info.outputPath('ai-budget-feedback.png'), fullPage: true });
      await button('budgetSave').click();
      await confirm();
      const reset = page.getByRole('button', {
        name: aiModelFormText('reset', locale),
        exact: true,
      });
      await expect(
        page.getByText(aiModelFormText('uncertain', locale), { exact: true })
      ).toBeVisible();
      await expect(reset).toBeDisabled();
      await expect(cost).toHaveValue('0.000001');
      await expect(button('budgetSave')).toBeDisabled();
      readStatus = 200;
      await button('refresh').click();
      await expect(reset).toBeEnabled();
      await reset.click();
      await expect(cost).toHaveValue('0.000001');
      await button('budgetSave').click();
      await confirm();
      await expect(cost).toHaveCount(0);
      expect(budgetWrites).toEqual(
        Array(3).fill({
          monthlyTokenLimit: 10000,
          monthlyCostLimitMicros: 1,
          inputPricePerMillionMicros: 1,
          outputPricePerMillionMicros: 2,
        })
      );
      await button('edit').click();
      await choice.selectOption('replace');
      await page.locator('#ai-model-token').fill('clear-on-denial');
      readStatus = 403;
      await button('refresh').click();
      await expect(page.locator('#ai-model-token')).toHaveCount(0);
      await expect(page.locator('#admin-content table')).toHaveCount(0);
    });
  }
