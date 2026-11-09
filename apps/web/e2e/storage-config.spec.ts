import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';

for (const locale of ['en', 'fa'] as const) {
  test(`multipart cleanup loading and recovery keep the provider draft (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await setupCatalogueForms(page, locale, fa);
    let providerReads = 0;
    let cleanupReads = 0;
    let release!: () => void;
    const initialCleanup = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/admin/storage/config', (route) => {
      expect(route.request().method()).toBe('GET');
      providerReads++;
      return route.fulfill({
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
      });
    });
    await page.route('**/api/admin/storage/multipart-cleanup-policy', async (route) => {
      expect(route.request().method()).toBe('GET');
      if (++cleanupReads === 1) {
        await initialCleanup;
        return route.fulfill({ status: 503, json: { message: 'Private provider failure' } });
      }
      return route.fulfill({ json: { hours: 24, version: 3 } });
    });
    try {
      await page.goto('/admin/storage');
      const main = page.getByRole('main');
      const bucket = main.locator('#storage-bucket');
      const hours = main.locator('#storage-cleanup-hours');
      await expect(bucket).toBeEnabled();
      await bucket.fill('unsaved-provider-draft');
      const loading = main.getByRole('status').filter({
        hasText: fa
          ? 'در حال دریافت سیاست پاک‌سازی بارگذاری‌های ناتمام…'
          : 'Loading the incomplete upload cleanup policy…',
      });
      await expect(loading).toBeVisible();
      await expect(hours).toHaveCount(0);
      expect(providerReads).toBe(1);
      expect(cleanupReads).toBe(1);
      release();
      const error = main.getByRole('alert').filter({
        hasText: fa
          ? 'دریافت سیاست پاک‌سازی بارگذاری‌های ناتمام انجام نشد.'
          : 'The incomplete upload cleanup policy could not be loaded.',
      });
      await expect(error).toBeVisible();
      await expect(loading).toHaveCount(0);
      await expect(main).not.toContainText('Private provider failure');
      await expect(bucket).toHaveValue('unsaved-provider-draft');
      await error
        .getByRole('button', { name: fa ? 'تلاش مجدد' : 'Try again', exact: true })
        .press('Enter');
      await expect(hours).toHaveValue('24');
      await expect(error).toHaveCount(0);
      await expect(bucket).toHaveValue('unsaved-provider-draft');
      expect(providerReads).toBe(1);
      expect(cleanupReads).toBe(2);
    } finally {
      release();
    }
  });
}

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
