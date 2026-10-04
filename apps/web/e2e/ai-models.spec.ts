import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/admin-ui';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { cookieResponse } from './cookie-response';
import { aiModel } from '../src/test/ai-catalogue-fixtures';
for (const locale of ['en', 'fa'] as const)
  test(`AI model form retries captured input after password verification (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';

    let failed = true,
      verified = false,
      denied = false;
    const attempts: unknown[] = [];
    await setupCatalogueForms(page, locale, false);
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'America/Los_Angeles' } })
    );
    await page.route('**/api/admin/ai-models', (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill(
          denied ? { status: 403, json: {} } : failed ? { status: 503, json: {} } : { json: [] }
        );
      attempts.push(route.request().postDataJSON());
      if (!verified)
        return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
      denied = true;
      const publicBody = { ...route.request().postDataJSON() };
      delete publicBody.apiToken;
      return route.fulfill({
        status: 201,
        json: {
          ...aiModel,
          ...publicBody,
          apiTokenMasked: '********oken',
          budget: null,
        },
      });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = route.request().postDataJSON().password === 'correct';
      return cookieResponse(route, {
        status: verified ? 200 : 401,
        json: { verified },
        ...(verified
          ? { headers: { 'Set-Cookie': 'barghsa_csrf=ai-fresh; Path=/; SameSite=Lax' } }
          : {}),
      });
    });
    await page.goto('/admin/ai-models');
    await expect(page.getByRole('alert')).toBeVisible();
    failed = false;
    await page.getByRole('button', { name: fa ? 'تلاش مجدد' : 'Retry', exact: true }).click();
    await page.getByRole('button', { name: fa ? 'افزودن مدل' : 'Add model', exact: true }).click();
    await page.getByLabel(fa ? 'عنوان مدل' : 'Model title', { exact: true }).fill('Local draft');
    await page
      .getByLabel(fa ? 'نشانی پایه' : 'Base URL', { exact: true })
      .fill('http://127.0.0.1/v1');
    await page
      .getByLabel(fa ? 'شناسه مدل نزد ارائه‌دهنده' : 'Provider model name', { exact: true })
      .fill('local-test');
    await page
      .getByLabel(fa ? 'کلید API' : 'API token', { exact: true })
      .fill('test-only-private-token');
    await page.getByRole('button', { name: fa ? 'ذخیره مدل' : 'Save model', exact: true }).click();
    const dialog = page.getByRole('dialog'),
      confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    await confirm.click();
    await dialog.locator('input[type="password"]').fill('wrong');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.locator('input[type="password"]').fill('correct');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toEqual(
      Array(2).fill({
        title: 'Local draft',
        providerType: 'openai_compatible',
        baseUrl: 'http://127.0.0.1/v1',
        modelName: 'local-test',
        config: { max_tokens: 256, temperature: 0 },
        apiToken: 'test-only-private-token',
      })
    );
    await expect(page.getByRole('alert')).toContainText(
      fa ? 'اجازه مدیریت' : 'permission to manage'
    );
    await expect(page.locator('input')).toHaveCount(0);
  });

for (const locale of ['en', 'fa'] as const)
  test(`AI model edits, test results and deletion remain readable in dark mode (${locale})`, async ({
    page,
  }) => {
    const label = (key: string) => t(`admin.aiModels.${key}`, locale);

    let present = true,
      invalid = true,
      inUse = true;
    const edits: unknown[] = [];
    const model = {
      id: '01900000-0000-7000-8000-000000000001',
      title: 'Support model',
      providerType: 'openai_compatible',
      baseUrl: 'https://model.example.test/v1',
      modelName: 'test',
      config: { max_tokens: 256, temperature: 0 },
      isEnabled: false,
      apiTokenMasked: '********1234',
      status: 'unreachable',
      lastTestedAt: null,
      lastTestError: 'Provider unavailable',
      lastTestLatencyMs: null,
      circuitOpen: false,
      circuitCooldownUntil: null,
      budget: null,
    };
    await setupCatalogueForms(page, locale, true);
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'UTC' } })
    );
    await page.route('**/api/admin/ai-models', (route) =>
      route.fulfill({ json: present ? [model] : [] })
    );
    await page.route(`**/api/admin/ai-models/${model.id}`, (route) => {
      if (route.request().method() === 'PUT') {
        edits.push(route.request().postDataJSON());
        if (invalid)
          return route.fulfill({ status: 400, json: { error: 'VALIDATION:PARSE:ZOD_ERROR' } });
        return route.fulfill({ json: model });
      }
      if (inUse) return route.fulfill({ status: 409, json: { error: 'AI_MODEL_IN_USE' } });
      present = false;
      return route.fulfill({ status: 204 });
    });
    await page.route(`**/api/admin/ai-models/${model.id}/test`, (route) =>
      route.fulfill({
        json: { model, test: { ok: true, responsePreview: '<script>provider reply</script>' } },
      })
    );
    const readable = async () =>
      expect(
        (await new AxeBuilder({ page }).include('main').withRules(['color-contrast']).analyze())
          .violations
      ).toEqual([]);
    await page.goto('/admin/ai-models');
    await expect(page.getByRole('row', { name: model.title })).toBeVisible();
    await readable();
    await page.getByRole('button', { name: label('edit'), exact: true }).click();
    await expect(page.getByLabel(label('tokenChoice'), { exact: true })).toHaveValue('keep');
    await readable();
    await page.getByRole('button', { name: label('save'), exact: true }).click();
    const confirm = () =>
      page
        .getByRole('dialog')
        .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true });
    await confirm().click();
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(label('invalid'));
    invalid = false;
    await confirm().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(edits).toEqual(
      Array(2).fill({
        title: model.title,
        providerType: model.providerType,
        baseUrl: model.baseUrl,
        modelName: model.modelName,
        config: { max_tokens: 256, temperature: 0 },
      })
    );
    await page.getByRole('button', { name: label('test'), exact: true }).click();
    await confirm().click();
    await expect(page.getByText('<script>provider reply</script>', { exact: true })).toBeVisible();
    await readable();
    await page.getByRole('button', { name: label('delete'), exact: true }).click();
    await confirm().click();
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(label('inUse'));
    inUse = false;
    await confirm().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(label('empty'), { exact: true })).toBeVisible();
  });

for (const locale of ['en', 'fa'] as const)
  test(`AI model monthly budget can be configured and read back (${locale})`, async ({ page }) => {
    const label = (key: string) => t(`admin.aiModels.${key}`, locale);

    const model = {
      id: '01900000-0000-7000-8000-000000000019',
      title: 'Customer guide model',
      providerType: 'openai_compatible',
      baseUrl: 'https://model.example.test/v1',
      modelName: 'guide',
      apiTokenMasked: '',
      status: 'reachable',
      isEnabled: true,
      config: { max_tokens: 256, temperature: 0 },
      lastTestedAt: null,
      lastTestError: null,
      lastTestLatencyMs: null,
      circuitOpen: false,
      circuitCooldownUntil: null,
      budget: null as Record<string, unknown> | null,
    };
    let saved: unknown = null;
    await setupCatalogueForms(page, locale, false);
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'UTC' } })
    );
    await page.route('**/api/admin/ai-models', (route) => route.fulfill({ json: [model] }));
    await page.route(`**/api/admin/ai-models/${model.id}/budget`, (route) => {
      saved = route.request().postDataJSON();
      model.budget = {
        ...(saved as object),
        usedInputTokens: 200,
        usedOutputTokens: 50,
        usedCostMicros: 125_000,
        periodStart: '2026-09-01T00:00:00.000Z',
        alertedAt: null,
      };
      return route.fulfill({ json: model });
    });
    await page.goto('/admin/ai-models');
    await page.getByRole('button', { name: label('budgetEdit') }).click();
    await page.getByLabel(label('budgetTokens'), { exact: true }).fill('10000');
    await page.getByLabel(label('budgetCost'), { exact: true }).fill('2.5');
    await page.getByLabel(label('budgetInputPrice'), { exact: true }).fill('0.3');
    await page.getByLabel(label('budgetOutputPrice'), { exact: true }).fill('0.9');
    await page.getByRole('button', { name: label('budgetSave'), exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(saved).toEqual({
      monthlyTokenLimit: 10_000,
      monthlyCostLimitMicros: 2_500_000,
      inputPricePerMillionMicros: 300_000,
      outputPricePerMillionMicros: 900_000,
    });
    await expect(page.getByRole('row', { name: model.title })).toContainText(
      new Intl.NumberFormat(locale).format(10_000)
    );
  });
