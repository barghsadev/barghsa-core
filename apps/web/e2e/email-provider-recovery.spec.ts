import { test, expect } from './coverage-fixture';

for (const locale of ['en', 'fa'] as const) {
  test(`provider list rejects malformed data and recovers (${locale})`, async ({ page }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    let valid = false;
    await page.route('**/api/admin/email-providers', (route) =>
      route.fulfill({ json: valid ? [] : null })
    );
    await page.goto('/admin/providers');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    await expect(
      page.getByRole('alert').filter({
        hasText: locale === 'fa' ? 'خطا در بارگذاری ارائه‌دهنده‌ها' : 'Failed to load providers',
      })
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: locale === 'fa' ? 'ارائه‌دهنده جدید' : 'New provider',
        exact: true,
      })
    ).toBeDisabled();
    valid = true;
    await page
      .getByRole('button', { name: locale === 'fa' ? 'تلاش مجدد' : 'Retry', exact: true })
      .click();
    await expect(
      page.getByRole('button', {
        name: locale === 'fa' ? 'ارائه‌دهنده جدید' : 'New provider',
        exact: true,
      })
    ).toBeEnabled();
  });
  test(`provider save requires acknowledgement and preserves secret for retry (${locale})`, async ({
    page,
  }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    let saves = 0;
    await page.route('**/api/admin/email-providers', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: [] });
      saves++;
      return route.fulfill({
        json:
          saves === 1
            ? {}
            : {
                id: 'new-provider',
                transport: 'resend',
                label: 'Recovery',
                status: 'draft',
                lastTestStatus: 'pending',
              },
      });
    });
    await page.goto('/admin/providers');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'ارائه‌دهنده جدید' : 'New provider',
        exact: true,
      })
      .click();
    await page.locator('#email-provider-label').fill('Recovery');
    await page.locator('#email-provider-transport').selectOption('resend');
    await page
      .getByLabel(locale === 'fa' ? 'کلید API' : 'API key', { exact: false })
      .fill('test-provider-secret');
    await page
      .getByLabel(locale === 'fa' ? 'ایمیل فرستنده' : 'From email', { exact: false })
      .fill('sender@example.test');
    await page.locator('button[type="submit"]').click();
    await expect(
      page.getByRole('alert').filter({
        hasText: locale === 'fa' ? 'خطا در ذخیره ارائه‌دهنده' : 'Failed to save provider',
      })
    ).toBeVisible();
    await expect(
      page.getByLabel(locale === 'fa' ? 'کلید API' : 'API key', { exact: false })
    ).toHaveValue('test-provider-secret');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('#email-provider-label')).toHaveCount(0);
    expect(saves).toBe(2);
  });
}

for (const locale of ['en', 'fa'] as const) {
  test(`provider lifecycle requires verified state acknowledgements (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    let provider = {
      id: 'provider-1',
      transport: 'smtp',
      label: 'Lifecycle provider',
      status: 'draft',
      lastTestStatus: 'pending',
    };
    let testCalls = 0;
    let activateCalls = 0;
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/admin/email-providers**', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: [provider] });
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/test-connection')) {
        testCalls++;
        if (testCalls === 1)
          return route.fulfill({ json: { ...provider, test: { ok: 'true', error: null } } });
        provider = { ...provider, lastTestStatus: 'passed' };
        return route.fulfill({ json: { ...provider, test: { ok: true, error: null } } });
      }
      if (path.endsWith('/activate')) {
        activateCalls++;
        if (activateCalls === 1) return route.fulfill({ json: provider });
        provider = { ...provider, status: 'active' };
      }
      if (path.endsWith('/disable')) provider = { ...provider, status: 'disabled' };
      if (path.endsWith('/rollback'))
        provider = { ...provider, id: 'new-version', status: 'active' };
      return route.fulfill({ json: provider });
    });
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto('/admin/providers');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    const row = page.getByRole('row').filter({ hasText: 'Lifecycle provider' });
    const activate = row.getByRole('button', { name: fa ? 'فعال‌سازی' : 'Activate', exact: true });
    const connection = row.getByRole('button', {
      name: fa ? 'تست اتصال' : 'Test connection',
      exact: true,
    });
    await expect(activate).toBeDisabled();
    await connection.click();
    await expect(row).toContainText(fa ? 'خطا در تست اتصال' : 'Failed to run connection test');
    await expect(activate).toBeDisabled();
    await connection.click();
    await expect(activate).toBeEnabled();
    await activate.click();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: fa ? 'خطا در فعال‌سازی' : 'Failed to activate provider' })
    ).toBeVisible();
    await activate.click();
    await row.getByRole('button', { name: fa ? 'غیرفعال‌سازی' : 'Disable', exact: true }).click();
    await row
      .getByRole('button', {
        name: fa ? 'بازگشت به این نسخه' : 'Rollback to this version',
        exact: true,
      })
      .click();
    await expect(
      row.getByRole('button', { name: fa ? 'غیرفعال‌سازی' : 'Disable', exact: true })
    ).toBeVisible();
    expect(provider.id).toBe('new-version');
    expect(testCalls).toBe(2);
    expect(activateCalls).toBe(2);
  });
}

for (const locale of ['en', 'fa'] as const) {
  test(`provider save completes password step-up with the captured configuration (${locale})`, async ({
    page,
    baseURL,
  }) => {
    const fa = locale === 'fa';
    let verified = false;
    let currentCsrf = 'provider-ui-csrf';
    await page.context().addCookies([{ url: baseURL!, name: 'barghsa_csrf', value: currentCsrf }]);
    const attempts: unknown[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/admin/email-providers', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: [] });
      expect(route.request().headers()['x-csrf-token']).toBe(currentCsrf);
      attempts.push(route.request().postDataJSON());
      return route.fulfill(
        verified
          ? {
              json: {
                id: 'new',
                transport: 'resend',
                label: 'Protected provider',
                status: 'draft',
                lastTestStatus: 'pending',
              },
            }
          : { status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } }
      );
    });
    await page.route('**/api/auth/step-up', (route) => {
      expect(route.request().headers()['x-csrf-token']).toBe(currentCsrf);
      verified = route.request().postDataJSON().password === 'correct';
      if (!verified) return route.fulfill({ status: 401, json: {} });
      currentCsrf = 'rotated-provider-csrf';
      return route.fulfill({
        headers: { 'set-cookie': `barghsa_csrf=${currentCsrf}; Path=/; SameSite=Strict` },
        json: {},
      });
    });
    await page.goto('/admin/providers');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    await page
      .getByRole('button', { name: fa ? 'ارائه‌دهنده جدید' : 'New provider', exact: true })
      .click();
    await page.locator('#email-provider-label').fill('Protected provider');
    await page.locator('#email-provider-transport').selectOption('resend');
    await page.getByLabel(fa ? 'کلید API' : 'API key', { exact: false }).fill('captured-test-key');
    await page
      .getByLabel(fa ? 'ایمیل فرستنده' : 'From email', { exact: false })
      .fill('sender@example.test');
    await page.locator('button[type="submit"]').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    await dialog.locator('input[type="password"]').fill('wrong');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(attempts).toHaveLength(1);
    await dialog.locator('input[type="password"]').fill('correct');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#email-provider-label')).toHaveCount(0);
    expect(attempts).toEqual(
      Array(2).fill({
        transport: 'resend',
        label: 'Protected provider',
        config: { from_email: 'sender@example.test', api_key: 'captured-test-key' },
      })
    );
  });
}

for (const operation of ['test-connection', 'activate', 'disable', 'rollback'] as const) {
  test(`provider ${operation} resumes after password verification`, async ({ page }) => {
    let verified = false;
    const initialState =
      operation === 'disable' ? 'active' : operation === 'rollback' ? 'disabled' : 'draft';
    let provider = {
      id: 'protected-row',
      transport: 'smtp',
      label: 'Protected row',
      status: initialState,
      lastTestStatus: 'passed',
    };
    const attempts: string[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/admin/email-providers**', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: [provider] });
      const path = new URL(route.request().url()).pathname;
      attempts.push(path);
      if (!verified)
        return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
      provider = {
        ...provider,
        status:
          operation === 'disable'
            ? 'disabled'
            : operation === 'test-connection'
              ? 'draft'
              : 'active',
        id: operation === 'rollback' ? 'new-protected-row' : provider.id,
      };
      return route.fulfill({
        json:
          operation === 'test-connection'
            ? { ...provider, test: { ok: true, error: null } }
            : provider,
      });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = route.request().postDataJSON().password === 'correct';
      return route.fulfill({ status: verified ? 200 : 401, json: {} });
    });
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto('/admin/providers');
    await page.evaluate(() => {
      document.documentElement.lang = 'en';
    });
    const names = {
      'test-connection': 'Test connection',
      activate: 'Activate',
      disable: 'Disable',
      rollback: 'Rollback to this version',
    };
    const row = page.getByRole('row').filter({ hasText: 'Protected row' });
    await row.getByRole('button', { name: names[operation], exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input[type="password"]').fill('correct');
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toEqual(
      Array(2).fill(`/api/admin/email-providers/protected-row/${operation}`)
    );
    await expect(row).toBeVisible();
    expect(provider.status).toBe(
      operation === 'disable' ? 'disabled' : operation === 'test-connection' ? 'draft' : 'active'
    );
  });
}

test('provider draft edit preserves its stored secret through step-up', async ({ page }) => {
  const provider = {
    id: 'draft-row',
    transport: 'resend',
    label: 'Existing provider',
    status: 'draft',
    lastTestStatus: 'pending',
  };
  let verified = false;
  const attempts: unknown[] = [];
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/admin/email-providers**', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [provider] });
    expect(route.request().method()).toBe('PUT');
    expect(new URL(route.request().url()).pathname).toBe('/api/admin/email-providers/draft-row');
    attempts.push(route.request().postDataJSON());
    return route.fulfill(
      verified ? { json: provider } : { status: 403, json: { requiresStepUp: true } }
    );
  });
  await page.route('**/api/auth/step-up', (route) => {
    verified = true;
    return route.fulfill({ json: {} });
  });
  await page.goto('/admin/providers');
  await page.evaluate(() => {
    document.documentElement.lang = 'en';
  });
  await page
    .getByRole('row')
    .filter({ hasText: 'Existing provider' })
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await expect(page.getByLabel('API key', { exact: false })).toHaveValue('');
  await page.getByLabel('From email', { exact: false }).fill('changed@example.test');
  await page.locator('button[type="submit"]').click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type="password"]').fill('correct');
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(attempts).toEqual(
    Array(2).fill({ label: 'Existing provider', config: { from_email: 'changed@example.test' } })
  );
});
