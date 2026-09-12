import { test, expect } from './coverage-fixture';
import { t } from '@barghsa/i18n/admin-ui';
import AxeBuilder from '@axe-core/playwright';
for (const locale of ['en', 'fa'])
  test(`Policy form retries captured input after password verification (${locale})`, async ({
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
    await page.route('**/api/admin/policies', (route) => {
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
    await page.goto('/admin/policies');
    await expect(page.getByRole('alert')).toBeVisible();
    failed = false;
    await page.getByRole('button', { name: fa ? 'تازه‌سازی' : 'Refresh', exact: true }).click();
    await page
      .getByRole('button', { name: fa ? 'افزودن سیاست' : 'Add policy', exact: true })
      .click();
    await page.getByLabel(fa ? 'عنوان' : 'Title', { exact: true }).fill('Local draft');
    await page
      .getByLabel(fa ? 'نوع سیاست' : 'Policy type', { exact: true })
      .selectOption(fa ? 'data_access_scope' : 'disallowed_actions');
    await page
      .getByLabel(fa ? 'محدوده دسترسی به داده' : 'Disallowed actions', { exact: true })
      .fill('Meter readings\nBilling');
    await page.getByRole('button', { name: fa ? 'ذخیره' : 'Save', exact: true }).click();
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
        description: '',
        policyType: fa ? 'data_access_scope' : 'disallowed_actions',
        rules: fa
          ? { scopes: ['Meter readings', 'Billing'] }
          : { actions: ['Meter readings', 'Billing'] },
        enabled: true,
      })
    );
    await expect(page.getByRole('alert')).toContainText(
      fa ? 'اجازه مدیریت' : 'permission to manage'
    );
    await expect(page.locator('input')).toHaveCount(0);
  });

for (const locale of ['en', 'fa'] as const)
  test(`policy types and group membership persist through the editor (${locale})`, async ({
    page,
  }) => {
    const label = (key: string) => t(`admin.policies.${key}`, locale);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((value) => {
      const apply = () => {
        document.documentElement.lang = value;
      };
      if (document.documentElement) apply();
      new MutationObserver(apply).observe(document, { childList: true });
    }, locale);
    const policy = {
      id: '01900000-0000-7000-8000-000000000001',
      title: 'Energy',
      description: '',
      policyType: 'allowed_topics',
      rules: { topics: ['energy'] },
      enabled: true,
    };
    const group = { id: '01900000-0000-7000-8000-000000000002', title: 'Support', description: '' };
    const writes: unknown[] = [];
    let linked = false,
      groupExists = false;
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/admin/policies', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: [policy] });
      writes.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, json: policy });
    });
    await page.route(`**/api/admin/policies/${policy.id}`, (route) => {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: policy });
    });
    await page.route('**/api/admin/policy-groups', (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: groupExists ? [group] : [] });
      writes.push(route.request().postDataJSON());
      groupExists = true;
      return route.fulfill({ status: 201, json: group });
    });
    await page.route(`**/api/admin/policy-groups/${group.id}`, (route) =>
      route.fulfill({ json: { ...group, members: linked ? [policy] : [] } })
    );
    await page.route(`**/api/admin/policy-groups/${group.id}/members**`, (route) => {
      linked = route.request().method() === 'POST';
      writes.push(linked ? route.request().postDataJSON() : { removed: policy.id });
      return route.fulfill({ status: 204 });
    });
    const click = async (key: string) =>
      page.getByRole('button', { name: label(key), exact: true }).click();
    const confirm = async () => {
      await page
        .getByRole('dialog')
        .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(
        page
          .getByRole('button', { name: label('addPolicy'), exact: true })
          .or(page.getByRole('button', { name: label('addGroup'), exact: true }))
      ).toBeVisible();
    };
    await page.goto('/admin/policies');
    await page.getByRole('button', { name: `${label('edit')} Energy`, exact: true }).click();
    await expect(page.getByLabel(label('allowed_topics'), { exact: true })).toHaveValue('energy');
    await page.getByLabel(label('allowed_topics'), { exact: true }).fill('energy\nsolar');
    await click('save');
    await confirm();
    expect(writes.at(-1)).toMatchObject({ rules: { topics: ['energy', 'solar'] } });
    await click('addPolicy');
    await page.getByLabel(label('name'), { exact: true }).fill('Style');
    await page.getByLabel(label('type'), { exact: true }).selectOption('response_style');
    await page.getByLabel(label('tone'), { exact: true }).fill('Concise');
    await page.getByLabel(label('language'), { exact: true }).fill(locale);
    await page.getByLabel(label('maxLength'), { exact: true }).fill('500');
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    await click('save');
    await confirm();
    expect(writes.at(-1)).toMatchObject({
      policyType: 'response_style',
      rules: { tone: 'Concise', language: locale, maxLength: 500 },
    });
    await click('policy-groups');
    await click('addGroup');
    await page.getByLabel(label('name'), { exact: true }).fill('Support');
    await click('save');
    await confirm();
    expect(writes.at(-1)).toEqual({ title: 'Support', description: '' });
    await page.getByRole('button', { name: `${label('open')} Support`, exact: true }).click();
    await page.getByLabel(label('selectPolicy'), { exact: true }).selectOption(policy.id);
    await click('link');
    await confirm();
    expect(writes.at(-1)).toEqual({ policyId: policy.id });
    await page.getByRole('button', { name: `${label('unlink')} Energy`, exact: true }).click();
    await confirm();
    expect(writes.at(-1)).toEqual({ removed: policy.id });
    await expect(
      page.getByRole('button', { name: `${label('unlink')} Energy`, exact: true })
    ).toHaveCount(0);
  });
