import { test, expect } from './coverage-fixture';

const config = {
  appTitle: 'Brand validation',
  slogan: '',
  primaryColor: '#2563eb',
  secondaryColor: '#64748b',
  accentColor: '#f59e0b',
  logoUrl: null,
  faviconUrl: null,
  darkMode: false,
};
const valid = {
  id: '11111111-1111-4111-8111-111111111111',
  version: 1,
  status: 'active',
  config,
  createdBy: 'system',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};
for (const locale of ['en', 'fa'])
  test(`appearance rejects malformed reads and preserves edits on invalid save (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await page.addInitScript((language) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = language;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({ json: { userId: valid.id, requiresTosAcceptance: false } })
    );
    let response: unknown = { ...valid, config: { ...config, numberStyle: ['western'] } };
    let saveResponse = 'invalid';
    const writes: unknown[] = [];
    await page.route('**/api/admin/branding/config', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: response });
      const body = route.request().postDataJSON();
      writes.push(body);
      return route.fulfill({
        json:
          saveResponse === 'invalid'
            ? { ...valid, config: { ...body.config, numberStyle: 'bad' } }
            : saveResponse === 'stale'
              ? { ...valid, status: 'draft', config: body.config }
              : saveResponse === 'wrong-title'
                ? { ...valid, status: 'draft', version: 2, config }
                : saveResponse === 'wrong-status'
                  ? { ...valid, version: 2, config: body.config }
                  : { ...valid, status: 'draft', version: 2, config: body.config },
      });
    });
    let activationResponse = 'wrong-id';
    const activations: unknown[] = [];
    await page.route('**/api/admin/branding/activate', (route) => {
      const body = route.request().postDataJSON();
      activations.push(body);
      return route.fulfill({
        json: {
          ...valid,
          config: { ...config, appTitle: 'Retained draft' },
          id: activationResponse === 'wrong-id' ? 'another-draft' : valid.id,
          version: activationResponse === 'wrong-version' ? 3 : 2,
          status: activationResponse === 'wrong-status' ? 'draft' : 'active',
        },
      });
    });
    await page.goto('/admin/branding');
    const save = page.getByRole('button', {
      name: fa ? 'ذخیره پیش‌نویس' : 'Save Draft',
      exact: true,
    });
    const refresh = page.getByRole('button', { name: fa ? 'تازه‌سازی' : 'Refresh', exact: true });
    for (const malformed of [
      response,
      { ...valid, version: -1 },
      { ...valid, status: 'unknown' },
      { ...valid, config: { ...config, logoUrl: 4 } },
      { ...valid, updatedAt: 'not-a-date' },
    ]) {
      response = malformed;
      await refresh.click();
      await expect(
        page
          .getByRole('alert')
          .filter({ hasText: fa ? 'دریافت تنظیمات برند ناموفق' : 'Could not load branding' })
      ).toBeVisible();
      await expect(save).toBeDisabled();
    }
    expect(writes).toEqual([]);
    response = valid;
    await refresh.click();
    const title = page.getByRole('textbox', {
      name: fa ? 'نام برنامه' : 'App Title',
      exact: true,
      includeHidden: true,
    });
    await expect(title).toHaveValue(config.appTitle);
    await title.fill('Retained draft');
    await save.click();
    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    for (const failure of ['invalid', 'stale', 'wrong-title', 'wrong-status']) {
      saveResponse = failure;
      await confirm.click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(title).toHaveValue('Retained draft');
    }
    saveResponse = 'valid';
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(title).toHaveValue('Retained draft');
    expect(writes).toHaveLength(5);
    for (const write of writes) expect(write).toEqual(writes[0]);
    await page.getByRole('button', { name: fa ? 'انتشار' : 'Activate', exact: true }).click();
    for (const failure of ['wrong-id', 'wrong-version', 'wrong-status']) {
      activationResponse = failure;
      await confirm.click();
      await expect(dialog.getByRole('alert')).toBeVisible();
    }
    activationResponse = 'valid';
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(activations).toEqual(
      Array.from({ length: 4 }, () => ({ draftId: valid.id, expectedVersion: 2 }))
    );
  });
