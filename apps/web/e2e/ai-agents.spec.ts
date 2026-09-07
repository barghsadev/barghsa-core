import { test, expect } from './coverage-fixture';
for (const locale of ['en', 'fa'])
  test(`agent editor retries captured group selections (${locale})`, async ({ page }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      if (document.documentElement) document.documentElement.lang = value;
      new MutationObserver(() => {
        document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    const model = '01900000-0000-7000-8000-000000000001',
      kb = '01900000-0000-7000-8000-000000000002',
      policy = '01900000-0000-7000-8000-000000000003';
    let failed = true,
      verified = false,
      denied = false;
    const attempts: unknown[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/admin/agents/options', (route) =>
      route.fulfill({
        json: {
          models: [{ id: model, title: 'Local model' }],
          kbs: [],
          policies: [],
          kbGroups: [{ id: kb, title: 'Support knowledge' }],
          policyGroups: [{ id: policy, title: 'Support policies' }],
        },
      })
    );
    await page.route('**/api/admin/agents', (route) => {
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
    await page.goto('/admin/agents');
    await expect(page.getByRole('alert')).toBeVisible();
    failed = false;
    await page.getByRole('button', { name: fa ? 'تازه‌سازی' : 'Refresh', exact: true }).click();
    await page.getByRole('button', { name: fa ? 'افزودن عامل' : 'Add agent', exact: true }).click();
    await page.getByLabel(fa ? 'عنوان' : 'Title', { exact: true }).fill('Local assistant');
    await page.getByLabel(fa ? 'مدل' : 'Model', { exact: true }).selectOption(model);
    await page.getByLabel('Support knowledge', { exact: true }).check();
    await page.getByLabel('Support policies', { exact: true }).check();
    await page.getByRole('button', { name: fa ? 'ذخیره عامل' : 'Save agent', exact: true }).click();
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
        title: 'Local assistant',
        description: '',
        modelId: model,
        enabled: true,
        kbIds: [],
        policyIds: [],
        kbGroupIds: [kb],
        policyGroupIds: [policy],
      })
    );
    await expect(page.getByRole('alert')).toContainText(
      fa ? 'اجازه مدیریت' : 'permission to manage'
    );
    await expect(page.locator('input,select')).toHaveCount(0);
  });
