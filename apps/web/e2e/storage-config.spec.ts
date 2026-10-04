import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
for (const locale of ['en', 'fa'])
  test(`storage editor retains a versioned save through step-up and failure (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await setupCatalogueForms(page, fa ? 'fa' : 'en', false);
    let failLoad = true,
      verified = false,
      failSave = true,
      denied = false;
    const attempts: unknown[] = [];
    await page.route('**/api/admin/storage/multipart-cleanup-policy', (route) =>
      route.fulfill({ json: { hours: 24, version: 0 } })
    );
    await page.route('**/api/admin/storage/config', (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill(
          denied
            ? { status: 403, json: {} }
            : failLoad
              ? { status: 503, json: {} }
              : {
                  json: {
                    endpoint: 'https://objects.example.test',
                    region: 'us-east-1',
                    bucket: 'documents',
                    accessKeyId: 'stored-key',
                    hasSecretKey: true,
                    forcePathStyle: true,
                    privateEndpointUrl: '',
                    publicEndpointUrl: '',
                    version: 7,
                  },
                }
        );
      attempts.push(route.request().postDataJSON());
      if (!verified)
        return route.fulfill({ status: 403, json: { error: { code: 'AUTHZ:STEP_UP_REQUIRED' } } });
      if (failSave)
        return route.fulfill({
          status: 400,
          json: { error: { code: 'STORAGE:CONNECTION_FAILED' } },
        });
      denied = true;
      const { secretAccessKey: _secret, ...publicFields } = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        json: { ...publicFields, hasSecretKey: true, version: 8 },
      });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = route.request().postDataJSON().password === 'correct-password';
      return route.fulfill({ status: verified ? 200 : 401, json: {} });
    });
    await page.goto('/admin/storage');
    await expect(page.getByRole('alert')).toBeVisible();
    failLoad = false;
    await page.getByRole('button', { name: fa ? 'تلاش مجدد' : 'Try again', exact: true }).click();
    const secret = page.getByLabel(fa ? 'کلید محرمانه' : 'Secret key', { exact: true });
    await expect(secret).toHaveValue('');
    await expect(secret).toHaveAttribute('type', 'password');
    await secret.fill('new-test-secret');
    await page
      .getByRole('button', { name: fa ? 'ذخیره و فعال‌سازی' : 'Save and activate', exact: true })
      .click();
    const dialog = page.getByRole('dialog'),
      confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    await confirm.click();
    const password = dialog.locator('input[type="password"]');
    await password.fill('wrong');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await password.fill('correct-password');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toContainText(
      fa ? 'اتصال ناموفق' : 'Connection failed'
    );
    failSave = false;
    await expect(password).toHaveCount(0);
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toHaveLength(3);
    for (const body of attempts)
      expect(body).toEqual({
        endpoint: 'https://objects.example.test',
        region: 'us-east-1',
        bucket: 'documents',
        accessKeyId: 'stored-key',
        forcePathStyle: true,
        privateEndpointUrl: '',
        publicEndpointUrl: '',
        version: 7,
        secretAccessKey: 'new-test-secret',
      });
    await expect(page.getByRole('alert')).toContainText(
      fa ? 'اجازه مدیریت' : 'permission to manage'
    );
    await expect(page.locator('#storage-secret')).toHaveCount(0);
  });
