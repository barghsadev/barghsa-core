import { providerOtpSend, startProviderOtp, providerOtpProof } from './provider-otp-fixture';
import { t } from '@barghsa/i18n/admin-ui';
import { providerFormText } from '@barghsa/i18n/provider-forms';
import { providerText } from '@barghsa/i18n/providers';
import { crmShell } from './crm-shell-fixture';
import { cookieResponse } from './cookie-response';
import { test, expect } from './coverage-fixture';

for (const locale of ['en', 'fa'] as const) {
  test(`provider list rejects malformed data and recovers (${locale})`, async ({ page }) => {
    await crmShell(page, locale);
    await providerOtpSend(page);
    let valid = false;
    await page.route('**/api/admin/email-providers', (route) =>
      route.fulfill({ json: valid ? [] : null })
    );
    await page.goto('/admin/providers');

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
    await crmShell(page, locale);
    await providerOtpSend(page);
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
                maskedConfig: { from_email: 'sender@example.test', api_key: '********cret' },
                label: 'Recovery',
                status: 'draft',
                lastTestStatus: 'pending',
              },
      });
    });
    await page.goto('/admin/providers');

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
    await expect(page.locator('form button[type=submit]')).toBeDisabled();
    await page
      .getByRole('button', { name: providerText('admin.providers.refresh', locale), exact: true })
      .click();
    await page
      .getByRole('button', { name: providerFormText('reset', locale), exact: true })
      .click();
    await page.locator('#email-provider-label').fill('Recovery');
    await page.locator('#email-provider-transport').selectOption('resend');
    await page.locator('#email-provider-apiKey').fill('test-provider-secret');
    await page.locator('#email-provider-fromEmail').fill('sender@example.test');
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
    await crmShell(page, locale);
    await providerOtpSend(page);
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

    const row = page.getByRole('row').filter({ hasText: 'Lifecycle provider' });
    const activate = row.getByRole('button', { name: fa ? 'فعال‌سازی' : 'Activate', exact: true });
    const connection = row.getByRole('button', {
      name: fa ? 'ارسال ایمیل آزمایشی' : 'Send test email',
      exact: false,
    });
    await expect(connection).toBeDisabled();
    await row.locator('input[type=email]').fill('staff@example.test');
    await expect(connection).toContainText('staff@example.test');
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
  test(`provider save completes OTP step-up with the captured configuration (${locale})`, async ({
    page,
    baseURL,
  }) => {
    const fa = locale === 'fa';
    let verified = false;
    let currentCsrf = 'provider-ui-csrf';
    await page.context().addCookies([{ url: baseURL!, name: 'barghsa_csrf', value: currentCsrf }]);
    const attempts: unknown[] = [];
    await crmShell(page, locale);
    await providerOtpSend(page);
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
                maskedConfig: { from_email: 'sender@example.test', api_key: '********-key' },
                label: 'Protected provider',
                status: 'draft',
                lastTestStatus: 'pending',
              },
            }
          : { status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } }
      );
    });
    await page.route('**/api/auth/step-up/otp/verify', (route) => {
      expect(route.request().headers()['x-csrf-token']).toBe(currentCsrf);
      verified = route.request().postDataJSON().code === '123456';
      if (!verified) return route.fulfill({ status: 401, json: {} });
      currentCsrf = 'rotated-provider-csrf';
      return cookieResponse(route, {
        headers: { 'set-cookie': `barghsa_csrf=${currentCsrf}; Path=/; SameSite=Strict` },
        json: providerOtpProof(),
      });
    });
    await page.goto('/admin/providers');

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
    await startProviderOtp(page, locale);
    const confirm = dialog.getByRole('button', {
      name: t('admin.stepUp.verify', locale),
      exact: true,
    });
    await dialog.locator('input[autocomplete=one-time-code]').fill('000000');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(attempts).toHaveLength(1);
    await dialog.locator('input[autocomplete=one-time-code]').fill('123456');
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
  test(`provider ${operation} resumes after OTP verification`, async ({ page }) => {
    let verified = false;
    const initialState =
      operation === 'disable' ? 'active' : operation === 'rollback' ? 'disabled' : 'draft';
    let provider = {
      id: 'protected-row',
      transport: operation === 'test-connection' ? 'resend' : 'smtp',
      label: 'Protected row',
      status: initialState,
      lastTestStatus: 'passed',
    };
    const attempts: string[] = [];
    await crmShell(page, 'en');
    await providerOtpSend(page);
    await page.route('**/api/admin/email-providers**', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: [provider] });
      const path = new URL(route.request().url()).pathname;
      attempts.push(path);
      if (operation === 'test-connection')
        expect(route.request().postDataJSON()).toEqual({ recipient: 'staff@example.test' });
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
    await page.route('**/api/auth/step-up/otp/verify', (route) => {
      verified = route.request().postDataJSON().code === '123456';
      return route.fulfill({ status: verified ? 200 : 401, json: providerOtpProof() });
    });
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto('/admin/providers');

    const names = {
      'test-connection': 'Send test email',
      activate: 'Activate',
      disable: 'Disable',
      rollback: 'Rollback to this version',
    };
    const row = page.getByRole('row').filter({ hasText: 'Protected row' });
    if (operation === 'test-connection')
      await row.locator('input[type=email]').fill('staff@example.test');
    await row
      .getByRole('button', { name: names[operation], exact: operation !== 'test-connection' })
      .click();
    const dialog = page.getByRole('dialog');
    await startProviderOtp(page, 'en');
    await dialog.locator('input[autocomplete=one-time-code]').fill('123456');
    await dialog.getByRole('button', { name: t('admin.stepUp.verify', 'en'), exact: true }).click();
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
    maskedConfig: { api_key: '********test', from_email: 'existing@example.test' },
  };
  let verified = false;
  const attempts: unknown[] = [];
  await crmShell(page, 'en');
  await providerOtpSend(page);
  await page.route('**/api/admin/email-providers**', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [provider] });
    expect(route.request().method()).toBe('PUT');
    expect(new URL(route.request().url()).pathname).toBe('/api/admin/email-providers/draft-row');
    attempts.push(route.request().postDataJSON());
    return route.fulfill(
      verified
        ? {
            json: {
              ...provider,
              maskedConfig: { ...provider.maskedConfig, ...route.request().postDataJSON().config },
            },
          }
        : { status: 403, json: { requiresStepUp: true } }
    );
  });
  await page.route('**/api/auth/step-up/otp/verify', (route) => {
    verified = true;
    return route.fulfill({ json: providerOtpProof() });
  });
  await page.goto('/admin/providers');

  await page
    .getByRole('row')
    .filter({ hasText: 'Existing provider' })
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await expect(page.getByLabel('API key', { exact: false })).toHaveValue('');
  await page.getByLabel('From email', { exact: false }).fill('changed@example.test');
  await page.locator('button[type="submit"]').click();
  const dialog = page.getByRole('dialog');
  await startProviderOtp(page, 'en');
  await dialog.locator('input[autocomplete=one-time-code]').fill('123456');
  await dialog.getByRole('button', { name: t('admin.stepUp.verify', 'en'), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(attempts).toEqual(
    Array(2).fill({ label: 'Existing provider', config: { from_email: 'changed@example.test' } })
  );
});
