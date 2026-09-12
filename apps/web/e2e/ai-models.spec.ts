import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/admin-ui';
for (const locale of ['en', 'fa'])
  test(`AI model form retries captured input after password verification (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      if (document.documentElement) document.documentElement.lang = value;
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    let failed = true,
      verified = false,
      denied = false;
    const attempts: unknown[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
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
      return route.fulfill({ status: 201, json: {} });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = route.request().postDataJSON().password === 'correct';
      return route.fulfill({ status: verified ? 200 : 401, json: {} });
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
    await page.addInitScript((value) => {
      localStorage.setItem('theme', 'dark');
      const apply = () => {
        document.documentElement.lang = value;
        document.documentElement.classList.add('dark');
      };
      if (document.documentElement) apply();
      new MutationObserver(apply).observe(document, { childList: true });
    }, locale);
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
      apiTokenMasked: '********1234',
      status: 'unreachable',
      lastTestedAt: null,
      lastTestError: 'Provider unavailable',
    };
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
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
