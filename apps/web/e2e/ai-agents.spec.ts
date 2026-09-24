import { test, expect } from './coverage-fixture';
for (const locale of ['en', 'fa'])
  test(`admin can test an agent and inspect response context (${locale})`, async ({ page }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      if (document.documentElement) document.documentElement.lang = value;
      new MutationObserver(() => {
        if (document.documentElement.lang !== value) document.documentElement.lang = value;
      }).observe(document, {
        childList: true,
        attributes: true,
        attributeFilter: ['lang'],
        subtree: true,
      });
    }, locale);
    const agentId = '01900000-0000-7000-8000-000000000011';
    const sent: unknown[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/admin/agents/options', (route) =>
      route.fulfill({
        json: { models: [], kbs: [], policies: [], kbGroups: [], policyGroups: [] },
      })
    );
    await page.route('**/api/admin/agents', (route) =>
      route.fulfill({
        json: [
          {
            id: agentId,
            title: 'Support',
            description: '',
            modelId: agentId,
            modelTitle: 'Local',
            enabled: true,
          },
        ],
      })
    );
    await page.route('**/api/admin/ai/test-chat', (route) => {
      sent.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          conversationId: agentId,
          reply: 'Power is available.',
          sources: [{ kbId: agentId, title: 'Tariffs', excerpt: 'Current tariff text' }],
          policyResults: [
            { id: agentId, title: 'Concise', type: 'response_style', result: 'applied' },
          ],
          tokenUsage: { input: 9, output: 5 },
          latencyMs: 12,
          remainingQuota: 9,
        },
      });
    });
    await page.goto('/admin/agents');
    const chat = page.getByRole('region', { name: fa ? 'گفت‌وگوی آزمایشی عامل' : 'Test an agent' });
    await chat.locator('select').selectOption(agentId);
    await chat.getByLabel(fa ? 'پیام آزمایشی' : 'Test message').fill('Hello');
    await chat.getByRole('button', { name: fa ? 'ارسال' : 'Send', exact: true }).click();
    await expect(chat.getByText('Power is available.')).toBeVisible();
    await chat.locator('summary').first().click();
    await expect(chat.getByText('9 / 5')).toBeVisible();
    await expect(chat.getByText('Tariffs')).toBeVisible();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ agentId, message: 'Hello' });
    await chat.getByRole('button', { name: fa ? 'گفت‌وگوی جدید' : 'New conversation' }).click();
    await expect(chat.getByText('Power is available.')).toHaveCount(0);
  });
for (const locale of ['en', 'fa'])
  test(`agent editor retries captured group selections (${locale})`, async ({ page }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      if (document.documentElement) document.documentElement.lang = value;
      new MutationObserver(() => {
        if (document.documentElement.lang !== value) document.documentElement.lang = value;
      }).observe(document, {
        childList: true,
        attributes: true,
        attributeFilter: ['lang'],
        subtree: true,
      });
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
    await page.getByLabel(fa ? 'دستورالعمل سیستم' : 'System instructions').fill('Help with energy');
    await page.getByLabel(fa ? 'دما' : 'Temperature').fill('0.4');
    await page.getByLabel(fa ? 'حداکثر توکن' : 'Maximum tokens').fill('512');
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
        systemPrompt: 'Help with energy',
        temperature: 0.4,
        maxTokens: 512,
        linkMode: 'any_kb',
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
    await expect(
      page.getByRole('form', { name: fa ? 'تنظیمات عامل' : 'Agent settings' })
    ).toHaveCount(0);
  });
