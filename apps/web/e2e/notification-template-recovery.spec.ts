import { test, expect } from './coverage-fixture';

const template = {
  id: 'template-recovery',
  eventKey: 'welcome_email',
  channel: 'email',
  locale: 'en',
  subject: 'Recovery subject',
  bodyTemplate: 'Recovery body',
  variables: [],
  status: 'draft',
  isActive: false,
  version: 1,
  publishedAt: null,
};
for (const locale of ['en', 'fa'] as const) {
  test(`notification template list rejects malformed data and retries (${locale})`, async ({
    page,
  }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    let valid = false;
    await page.route('**/api/admin/notifications/templates', (route) =>
      route.fulfill({ json: valid ? [template] : {} })
    );
    await page.goto('/admin/notifications');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    await expect(
      page.getByRole('alert').filter({
        hasText:
          locale === 'fa'
            ? 'خطا در بارگذاری قالب‌های اعلان'
            : 'Failed to load notification templates',
      })
    ).toBeVisible();
    valid = true;
    await page
      .getByRole('alert')
      .filter({
        hasText:
          locale === 'fa'
            ? 'خطا در بارگذاری قالب‌های اعلان'
            : 'Failed to load notification templates',
      })
      .getByRole('button', { name: locale === 'fa' ? 'تلاش مجدد' : 'Retry', exact: true })
      .click();
    await expect(page.getByRole('cell', { name: template.subject, exact: true })).toBeVisible();
  });
  test(`notification create preserves input until valid password-protected acknowledgement (${locale})`, async ({
    page,
  }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    let attempts = 0;
    let verified = false;
    let saved = false;
    const bodies: unknown[] = [];
    await page.route('**/api/admin/notifications/templates', (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: saved ? [template] : [] });
      bodies.push(route.request().postDataJSON());
      if (++attempts === 1) return route.fulfill({ json: null });
      if (!verified)
        return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
      saved = true;
      return route.fulfill({ json: template });
    });
    await page.route('**/api/auth/step-up', (route) => {
      expect(route.request().postDataJSON()).toEqual({ password: 'Local-test-password!' });
      verified = true;
      return route.fulfill({ json: { ok: true } });
    });
    await page.goto('/admin/notifications');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    await page
      .getByRole('button', { name: locale === 'fa' ? 'قالب جدید' : 'New Template', exact: true })
      .click();
    const editor = page
      .locator('form')
      .filter({ has: page.locator('#notification-template-eventKey') });
    await editor.locator('#notification-template-subject').fill(template.subject);
    await editor.locator('#notification-template-bodyTemplate').fill(template.bodyTemplate);
    await editor.locator('button[type=submit]').click();
    await expect(editor).toBeVisible();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: locale === 'fa' ? 'خطا در ذخیره قالب' : 'Failed to save template' })
    ).toBeVisible();
    await editor.locator('button[type=submit]').click();
    await page.locator('#team-step-up-password').fill('Local-test-password!');
    await page.getByRole('dialog').locator('button[type=submit]').click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByRole('cell', { name: template.subject, exact: true })).toBeVisible();
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1]).toEqual(bodies[2]);
  });
}

for (const operation of ['publish', 'unpublish', 'delete', 'test-send', 'edit'] as const) {
  test(`notification ${operation} resumes the captured action after password verification`, async ({
    page,
  }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    let current = {
      ...template,
      subject: template.subject as string | null,
      status: operation === 'unpublish' ? 'active' : 'draft',
      isActive: operation === 'unpublish',
    };
    let deleted = false;
    let verified = false;
    let calls = 0;
    const bodies: unknown[] = [];
    await page.route('**/api/admin/notifications/templates', (route) =>
      route.fulfill({ json: deleted ? [] : [current] })
    );
    const suffix = operation === 'delete' || operation === 'edit' ? '' : `/${operation}`;
    await page.route(`**/api/admin/notifications/templates/${template.id}${suffix}`, (route) => {
      calls++;
      bodies.push(route.request().postData());
      if (!verified)
        return route.fulfill({ status: 403, json: { error: { code: 'AUTHZ:STEP_UP_REQUIRED' } } });
      if (operation === 'delete') {
        deleted = true;
        return route.fulfill({ status: 204 });
      }
      if (operation === 'test-send')
        return route.fulfill({
          json: { ok: true, destination: 'email', lastTestStatus: 'delivered' },
        });
      if (operation === 'edit') {
        expect(route.request().method()).toBe('PUT');
        expect(route.request().postDataJSON()).toEqual({
          subject: null,
          bodyTemplate: 'Edited body',
          variables: [],
        });
        current = { ...current, subject: null, bodyTemplate: 'Edited body' };
      } else {
        current = {
          ...current,
          status: operation === 'publish' ? 'active' : 'archived',
          isActive: operation === 'publish',
        };
      }
      return route.fulfill({ json: current });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = true;
      return route.fulfill({ json: { ok: true } });
    });
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto('/admin/notifications');
    await page.evaluate(() => {
      document.documentElement.lang = 'en';
    });
    const row = page.getByRole('row').filter({ hasText: template.subject });
    if (operation === 'publish') {
      await row.getByRole('button', { name: 'Publish', exact: true }).click();
      await page
        .getByRole('heading', { name: 'Publish Template', exact: true })
        .locator('..')
        .getByRole('button', { name: 'Publish', exact: true })
        .click();
    } else if (operation === 'test-send' || operation === 'edit') {
      await row.getByRole('button', { name: 'Edit', exact: true }).click();
      const editor = page
        .locator('form')
        .filter({ has: page.locator('#notification-template-eventKey') });
      if (operation === 'test-send')
        await editor.getByRole('button', { name: 'Test Send', exact: true }).click();
      else {
        await editor.locator('#notification-template-subject').fill('');
        await editor.locator('#notification-template-bodyTemplate').fill('Edited body');
        await editor.locator('button[type=submit]').click();
      }
    } else {
      await row
        .getByRole('button', { name: operation === 'delete' ? 'Delete' : 'Unpublish', exact: true })
        .click();
    }
    await page.locator('#team-step-up-password').fill('Local-test-password!');
    await page.getByRole('dialog').locator('button[type=submit]').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(calls).toBe(2);
    expect(bodies[0]).toEqual(bodies[1]);
    if (operation === 'delete') await expect(row).toHaveCount(0);
    else if (operation === 'edit')
      await expect(page.locator('#notification-template-bodyTemplate')).toHaveCount(0);
    else if (operation === 'test-send')
      await expect(page.getByText('Test email sent.', { exact: false })).toBeVisible();
    else
      await expect(
        row
          .getByRole('cell', { name: operation === 'publish' ? 'active' : 'Archived', exact: true })
          .first()
      ).toBeVisible();
  });
}

test('notification publication rejects a different template acknowledgement', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/admin/notifications/templates', (route) =>
    route.fulfill({ json: [template] })
  );
  await page.route(`**/api/admin/notifications/templates/${template.id}/publish`, (route) =>
    route.fulfill({ json: { ...template, id: 'other-template', status: 'active', isActive: true } })
  );
  await page.goto('/admin/notifications');
  await page.evaluate(() => {
    document.documentElement.lang = 'en';
  });
  await page
    .getByRole('row')
    .filter({ hasText: template.subject })
    .getByRole('button', { name: 'Publish', exact: true })
    .click();
  const confirm = page
    .getByRole('heading', { name: 'Publish Template', exact: true })
    .locator('..');
  await confirm.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Failed to publish template' })
  ).toBeVisible();
  await expect(confirm).toBeVisible();
});

test('late notification test-send challenge does not reopen a closed editor', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/admin/notifications/templates', (route) =>
    route.fulfill({ json: [template] })
  );
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route(
    `**/api/admin/notifications/templates/${template.id}/test-send`,
    async (route) => {
      started();
      await pending;
      await route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
    }
  );
  await page.goto('/admin/notifications');
  await page.evaluate(() => {
    document.documentElement.lang = 'en';
  });
  await page
    .getByRole('row')
    .filter({ hasText: template.subject })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  const editor = page
    .locator('form')
    .filter({ has: page.locator('#notification-template-eventKey') });
  await editor.getByRole('button', { name: 'Test Send', exact: true }).click();
  await requested;
  const response = page.waitForResponse(
    `**/api/admin/notifications/templates/${template.id}/test-send`
  );
  try {
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  } finally {
    release();
  }
  await (await response).finished();
  await page
    .getByRole('row')
    .filter({ hasText: template.subject })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await expect(editor).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
