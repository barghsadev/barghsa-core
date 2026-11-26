import { test, expect } from './coverage-fixture';
import { t } from '@barghsa/i18n/admin-ui';
import { knowledgePolicyFormText } from '@barghsa/i18n/knowledge-policy-forms';
import AxeBuilder from '@axe-core/playwright';
import { approveRiskConfirmation } from './confirmation-fixture';
test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'])
  test(`Policy form retries captured input after password verification (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      localStorage.setItem('barghsa.locale', value);
    }, locale);
    let failed = true,
      verified = false,
      denied = false;
    const attempts: unknown[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'admin',
          isStaff: true,
          operatingContext: 'staff',
          canSwitchContext: false,
          requiresTosAcceptance: false,
        },
      })
    );
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
    if (fa)
      await page.route('**/api/admin/knowledge-bases', (route) =>
        route.fulfill({ status: 403, json: {} })
      );
    await page.goto('/admin/policies');
    await expect(page.getByRole('alert')).toBeVisible();
    failed = false;
    await page.getByRole('button', { name: fa ? 'تازه‌سازی' : 'Refresh', exact: true }).click();
    await page.getByRole('link', { name: fa ? 'افزودن سیاست' : 'Add policy', exact: true }).click();
    await page.getByLabel(fa ? 'عنوان' : 'Title', { exact: true }).fill('Local draft');
    await page
      .getByLabel(fa ? 'نوع سیاست' : 'Policy type', { exact: true })
      .selectOption(fa ? 'data_access_scope' : 'disallowed_actions');
    const listText = (key: Parameters<typeof knowledgePolicyFormText>[0]) =>
      knowledgePolicyFormText(key, fa ? 'fa' : 'en');
    if (fa) {
      await expect(page.getByText(listText('scopeReadDenied'), { exact: true })).toBeVisible();
      await page.getByRole('button', { name: listText('scopeManual'), exact: true }).click();
    }
    await page.getByRole('button', { name: listText('editPastedList') }).click();
    await page.locator('textarea#policy-items').fill('Meter readings\n\nBilling\nExtra');
    await page.getByRole('button', { name: listText('editIndividualItems') }).click();
    await expect(page.locator('#policy-items')).toBeFocused();
    await expect(page.locator('#policy-items-2')).toHaveValue('Billing');
    await expect(page.locator('#policy-items-3')).toHaveValue('Extra');
    await page.locator('#policy-items-3').locator('..').getByRole('button').click();
    await expect(page.locator('#policy-items-2')).toBeFocused();
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
        priority: 100,
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
    await page.addInitScript((value) => {
      localStorage.setItem('barghsa.locale', value);
    }, locale);
    const policy = {
      id: '01900000-0000-7000-8000-000000000001',
      title: 'Energy',
      description: '',
      policyType: 'allowed_topics',
      rules: { topics: ['energy'] },
      enabled: true,
      priority: 100,
      priorityOverride: null as number | null,
    };
    const group = { id: '01900000-0000-7000-8000-000000000002', title: 'Support', description: '' };
    const references = [
      {
        id: '01900000-0000-7000-8000-000000000007',
        title: locale === 'fa' ? 'راهنمای کنتور' : 'Meter guide',
      },
      {
        id: '01900000-0000-7000-8000-000000000008',
        title: locale === 'fa' ? 'راهنمای خورشیدی' : 'Solar guide',
      },
    ] as const;
    const policies: Record<string, unknown>[] = [{ ...policy }];
    const writes: unknown[] = [];
    let linked = false,
      memberOverride: number | null = null,
      groupExists = false;
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'admin',
          isStaff: true,
          operatingContext: 'staff',
          canSwitchContext: false,
          requiresTosAcceptance: false,
        },
      })
    );
    await page.route('**/api/admin/policies', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: policies });
      const body = route.request().postDataJSON();
      writes.push(body);
      const created = {
        ...policy,
        ...body,
        id: `01900000-0000-7000-8000-${String(policies.length + 1).padStart(12, '0')}`,
      };
      policies.push(created);
      return route.fulfill({ status: 201, json: created });
    });
    await page.route('**/api/admin/knowledge-bases', (route) =>
      route.fulfill({ json: references })
    );
    await page.route('**/api/admin/policies/*', (route) => {
      const id = new URL(route.request().url()).pathname.split('/').at(-1);
      const index = policies.findIndex((row) => row.id === id);
      if (index < 0) return route.fulfill({ status: 404, json: {} });
      if (route.request().method() !== 'GET') {
        const body = route.request().postDataJSON();
        writes.push(body);
        policies[index] = { ...policies[index], ...body };
      }
      return route.fulfill({ json: policies[index] });
    });
    await page.route('**/api/admin/policy-groups', (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: groupExists ? [group] : [] });
      writes.push(route.request().postDataJSON());
      groupExists = true;
      return route.fulfill({ status: 201, json: group });
    });
    await page.route(`**/api/admin/policy-groups/${group.id}`, (route) =>
      route.fulfill({
        json: {
          ...group,
          members: linked ? [{ ...policies[0], priorityOverride: memberOverride }] : [],
        },
      })
    );
    await page.route(`**/api/admin/policy-groups/${group.id}/members**`, (route) => {
      linked = route.request().method() === 'POST';
      const body = linked ? route.request().postDataJSON() : null;
      if (linked && 'priorityOverride' in body) memberOverride = body.priorityOverride;
      writes.push(linked ? body : { removed: policy.id });
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
    };
    await page.goto('/admin/policies');
    await page.getByRole('link', { name: `${label('edit')} Energy`, exact: true }).click();
    await expect(page.getByLabel(label('allowed_topics'), { exact: true })).toHaveValue('energy');
    await page.getByLabel(label('allowed_topics'), { exact: true }).press('Enter');
    await expect(page.locator('#policy-items-2')).toBeFocused();
    await page.locator('#policy-items-2').fill('solar');
    await page.getByLabel(label('priority'), { exact: true }).fill('25');
    await click('save');
    await confirm();
    expect(writes.at(-1)).toMatchObject({ rules: { topics: ['energy', 'solar'] }, priority: 25 });
    await page.goto('/admin/policies/new');
    await page.getByLabel(label('name'), { exact: true }).fill('Style');
    await page.getByLabel(label('type'), { exact: true }).selectOption('response_style');
    await page.getByLabel(label('tone'), { exact: true }).fill('Concise');
    const language = page.getByRole('combobox', {
      name: knowledgePolicyFormText('responseLanguage', locale),
      exact: true,
    });
    const customLanguage = page.getByRole('textbox', {
      name: knowledgePolicyFormText('customLanguage', locale),
      exact: true,
    });
    await expect(language).toHaveValue('');
    await language.selectOption(locale);
    await expect(customLanguage).toHaveCount(0);
    const length = page.getByLabel(knowledgePolicyFormText('responseLength', locale), {
      exact: true,
    });
    await expect(length).toHaveAccessibleDescription(
      knowledgePolicyFormText('responseLengthHelp', locale)
    );
    await length.fill(locale === 'fa' ? '۵۰۰' : '500');
    await page.getByLabel(label('requireSources'), { exact: true }).check();
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    await click('save');
    await confirm();
    expect(writes.at(-1)).toMatchObject({
      policyType: 'response_style',
      rules: { tone: 'Concise', language: locale, maxLength: 500, requireSources: true },
    });
    const styleId = policies.find((row) => row.title === 'Style')?.id;
    expect(styleId).toEqual(expect.any(String));
    const editStyle = `/admin/policies/${styleId}/edit`;
    await page.goto(editStyle);
    await expect(language).toHaveValue(locale);
    await language.selectOption('custom');
    await customLanguage.fill('fr-CA');
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    await click('save');
    await confirm();
    expect(writes.at(-1)).toMatchObject({
      policyType: 'response_style',
      rules: { tone: 'Concise', language: 'fr-CA', maxLength: 500, requireSources: true },
    });
    await page.goto(editStyle);
    await expect(language).toHaveValue('custom');
    await expect(customLanguage).toHaveValue('fr-CA');
    await page.goto('/admin/policies/new');
    await page.getByLabel(label('name'), { exact: true }).fill('Filter');
    await page.getByLabel(label('type'), { exact: true }).selectOption('content_filter');
    await page.getByLabel(label('content_filter'), { exact: true }).fill('secret');
    await click('save');
    await confirm();
    expect(writes.at(-1)).toMatchObject({
      policyType: 'content_filter',
      rules: { blockedTerms: ['secret'] },
    });
    await page.goto('/admin/policies/new');
    await page.getByLabel(label('name'), { exact: true }).fill('Format');
    await page.getByLabel(label('type'), { exact: true }).selectOption('output_format');
    await page.getByLabel(label('format'), { exact: true }).selectOption('json_object');
    await click('save');
    await confirm();
    expect(writes.at(-1)).toMatchObject({
      policyType: 'output_format',
      rules: { format: 'json_object' },
    });
    await page.goto('/admin/policies/new');
    await page.getByLabel(label('name'), { exact: true }).fill('Limit');
    await page.getByLabel(label('type'), { exact: true }).selectOption('rate_limit');
    await page.getByLabel(label('maxRequests'), { exact: true }).fill('3');
    await page.getByLabel(label('windowSeconds'), { exact: true }).fill('120');
    await click('save');
    await confirm();
    expect(writes.at(-1)).toMatchObject({
      policyType: 'rate_limit',
      rules: { maxRequests: 3, windowSeconds: 120 },
    });
    await page.goto('/admin/policies/new');
    await page.getByLabel(label('name'), { exact: true }).fill('Reference access');
    await page.getByLabel(label('type'), { exact: true }).selectOption('data_access_scope');
    const copy = (key: Parameters<typeof knowledgePolicyFormText>[0]) =>
      knowledgePolicyFormText(key, locale);
    const picker = page.getByRole('combobox', { name: copy('addKnowledgeMember'), exact: true });
    const picked = page.getByRole('list', { name: copy('scopeSelected'), exact: true });
    const allSources = page.getByRole('checkbox', { name: copy('scopeAll'), exact: true });
    await click('save');
    await expect(picker).toBeFocused();
    await expect(picker).toHaveAttribute('aria-invalid', 'true');
    await picker.fill(locale === 'fa' ? 'كنتور' : 'Meter');
    await expect(
      page.getByRole('option', { name: references[0].title, exact: true })
    ).toBeVisible();
    await picker.press('Enter');
    await expect(picked).toContainText(references[0].title);
    await picker.fill(locale === 'fa' ? 'خورشيدي' : 'Solar');
    await page.getByRole('option', { name: references[1].title, exact: true }).click();
    await expect(picked).toContainText(references[1].title);
    await allSources.check();
    await expect(picked).toContainText(references[0].title);
    await expect(allSources).toHaveAccessibleDescription(copy('scopeAllHint'));
    await picked
      .getByRole('button', { name: copy('scopeRemove').replace('{name}', references[0].title) })
      .click();
    await expect(picker).toBeFocused();
    await expect(picked).not.toContainText(references[0].title);
    await click('save');
    await confirm();
    expect(writes.at(-1)).toMatchObject({
      policyType: 'data_access_scope',
      rules: { scopes: [`kb:${references[1].id}`, 'all'] },
    });
    const scopeId = policies.find((row) => row.title === 'Reference access')?.id;
    await page.goto(`/admin/policies/${scopeId}/edit`);
    await expect(picked).toContainText(references[1].title);
    await expect(allSources).toBeChecked();
    await allSources.uncheck();
    await click('save');
    await confirm();
    expect(writes.at(-1)).toMatchObject({ rules: { scopes: [`kb:${references[1].id}`] } });
    await page.goto('/admin/policies/groups/new');
    await page.getByLabel(label('name'), { exact: true }).fill('Support');
    await click('save');
    await confirm();
    expect(writes.at(-1)).toEqual({ title: 'Support', description: '' });
    await expect(page).toHaveURL(`/admin/policies/groups/${group.id}`);
    await page.getByLabel(label('selectPolicy'), { exact: true }).fill(policy.title);
    await page.getByRole('option', { name: policy.title, exact: true }).click();
    await click('link');
    await confirm();
    expect(writes.at(-1)).toEqual({ policyId: policy.id });
    await page.getByLabel(`${label('priorityOverride')} · Energy`).fill('-20');
    await click('updatePriority');
    await confirm();
    expect(writes.at(-1)).toEqual({ policyId: policy.id, priorityOverride: -20 });
    await page.getByRole('button', { name: `${label('unlink')} Energy`, exact: true }).click();
    await approveRiskConfirmation(page, locale, 'destructive');
    await confirm();
    expect(writes.at(-1)).toEqual({ removed: policy.id });
    await expect(
      page.getByRole('button', { name: `${label('unlink')} Energy`, exact: true })
    ).toHaveCount(0);
  });
