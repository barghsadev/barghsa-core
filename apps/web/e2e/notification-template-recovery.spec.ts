import { t } from '@barghsa/i18n/admin-ui';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { notificationFormText } from '@barghsa/i18n/notification-forms';
import { crmShell } from './crm-shell-fixture';
import { notificationTemplate } from '../src/test/content-catalogue-fixtures';
import { test, expect } from './coverage-fixture';
import { approveRiskConfirmation } from './confirmation-fixture';
import { chooseNotificationEvent } from './notification-event-fixture';

test.use({ viewport: { width: 390, height: 844 } });
const template = notificationTemplate();
const details = `/admin/notifications/${template.id}`;
const record = `**/api/admin/notifications/templates/${template.id}`;
const publishReview = (page: import('@playwright/test').Page) =>
  page.getByRole('region', { name: 'Publish Template', exact: true });

for (const locale of ['en', 'fa'] as const) {
  test(`notification template list rejects malformed data and retries (${locale})`, async ({
    page,
  }) => {
    await crmShell(page, locale);
    let valid = false;
    await page.route('**/api/admin/notifications/templates', (route) =>
      route.fulfill({ json: valid ? [template] : {} })
    );
    await page.goto('/admin/notifications');

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
    await expect(
      page
        .getByRole('list', { name: t('admin.notifications.catalogue', locale), exact: true })
        .getByText(template.subject, { exact: true })
    ).toBeVisible();
  });
  test(`notification create preserves input until valid password-protected acknowledgement (${locale})`, async ({
    page,
  }) => {
    await crmShell(page, locale);
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
    await page.route(record, (route) =>
      route.fulfill(saved ? { json: template } : { status: 404, json: {} })
    );
    await page.route('**/api/auth/step-up', (route) => {
      expect(route.request().postDataJSON()).toEqual({ password: 'Local-test-password!' });
      verified = true;
      return route.fulfill({ json: { ok: true } });
    });
    await page.goto('/admin/notifications');

    await page
      .getByRole('link', { name: locale === 'fa' ? 'قالب جدید' : 'New Template', exact: true })
      .click();
    const editor = page
      .locator('form')
      .filter({ has: page.locator('#notification-template-eventKey') });
    await chooseNotificationEvent(page, template.eventKey, locale);
    await editor.getByRole('button', { name: notificationFormText('addVariable', locale) }).click();
    await editor.locator('[data-variable-name]').fill('name');
    await editor.locator('[data-variable-description]').fill('Recipient');
    const reference = editor.getByRole('region', {
      name: t('admin.notifications.variables', locale),
      exact: true,
    });
    await expect(reference.getByRole('heading', { level: 3 })).toBeVisible();
    await expect(reference.getByRole('button', { name: '{{name}}', exact: true })).toBeVisible();
    await editor
      .getByRole('button', {
        name: `${notificationFormText('removeVariable', locale)} name`,
        exact: true,
      })
      .click();
    await expect(reference).toHaveCount(0);
    await editor.locator('#notification-template-subject').fill(template.subject);
    await editor.locator('#notification-template-bodyTemplate').fill(template.bodyTemplate);
    await editor.locator('button[type=submit]').click();
    await expect(editor).toBeVisible();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: locale === 'fa' ? 'خطا در ذخیره قالب' : 'Failed to save template' })
    ).toBeVisible();
    await expect(editor.locator('button[type=submit]')).toBeDisabled();
    await page
      .getByRole('button', { name: t('admin.notifications.refresh', locale), exact: true })
      .click();
    await page
      .getByRole('button', { name: t('admin.notifications.reset', locale), exact: true })
      .click();
    await chooseNotificationEvent(page, template.eventKey, locale);
    await editor.locator('#notification-template-subject').fill(template.subject);
    await editor.locator('#notification-template-bodyTemplate').fill(template.bodyTemplate);
    await editor.locator('button[type=submit]').click();
    await page.locator('#team-step-up-password').fill('Local-test-password!');
    await page.getByRole('dialog').locator('button[type=submit]').click();
    await expect(editor).toHaveCount(0);
    await expect(page).toHaveURL(details);
    await expect(page.getByRole('main').getByText(template.subject, { exact: true })).toBeVisible();
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1]).toEqual(bodies[2]);
  });
}

for (const operation of ['publish', 'unpublish', 'delete', 'test-send', 'edit'] as const) {
  test(`notification ${operation} resumes the captured action after password verification`, async ({
    page,
  }) => {
    await crmShell(page, 'en');
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
    await page.route(record, (route) => route.fulfill({ json: current }));
    const suffix = operation === 'delete' || operation === 'edit' ? '' : `/${operation}`;
    await page.route(record + suffix, (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: current });
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
    await page.goto('/admin/notifications');
    await page.evaluate(() => {
      document.documentElement.lang = 'en';
    });
    const row = page
      .locator(
        'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2,h3)'
      )
      .filter({ hasText: template.subject });
    if (operation === 'publish') {
      await row.getByRole('link', { name: 'Publish', exact: true }).click();
      await expect(page).toHaveURL(details + '/publish');
      await publishReview(page).getByRole('button', { name: 'Publish', exact: true }).click();
    } else if (operation === 'test-send' || operation === 'edit') {
      await row.getByRole('link', { name: 'Edit', exact: true }).click();
      const editor = page
        .locator('form')
        .filter({ has: page.locator('#notification-template-eventKey') });
      if (operation === 'test-send') {
        await editor.locator('#test-destination').fill('staff@example.test');
        await editor.getByRole('button', { name: 'Test Send', exact: true }).click();
      } else {
        await editor.locator('#notification-template-subject').fill('');
        await editor.locator('#notification-template-bodyTemplate').fill('Edited body');
        await editor.locator('button[type=submit]').click();
      }
    } else {
      await row
        .getByRole('button', { name: operation === 'delete' ? 'Delete' : 'Unpublish', exact: true })
        .click();
      const confirm = page
        .getByRole('dialog')
        .getByRole('button', { name: t('team.confirm', 'en'), exact: true });
      await expect(confirm).toBeDisabled();
      expect(calls).toBe(0);
      await approveRiskConfirmation(page, 'en', 'destructive');
      await confirm.click();
    }
    await page.locator('#team-step-up-password').fill('Local-test-password!');
    const submit = page.getByRole('dialog').locator('button[type=submit]');
    if (operation === 'delete') {
      await expect(submit).toBeDisabled();
      expect(calls).toBe(1);
      await approveRiskConfirmation(page, 'en', 'destructive');
    }
    await submit.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(calls).toBe(2);
    expect(bodies[0]).toEqual(bodies[1]);
    if (operation === 'delete') await expect(row).toHaveCount(0);
    else if (operation === 'edit')
      await expect(page.locator('#notification-template-bodyTemplate')).toHaveCount(0);
    else if (operation === 'test-send')
      await expect(page.getByText('Test email sent.', { exact: false })).toBeVisible();
    else if (operation === 'publish') {
      await expect(page).toHaveURL(details);
      await expect(page.getByRole('main').getByText('Active', { exact: true })).toBeVisible();
    } else {
      await expect(row.getByText('Archived', { exact: true }).first()).toBeVisible();
    }
  });
}

test('notification publication rejects a different template acknowledgement', async ({ page }) => {
  await crmShell(page, 'en');
  await page.route('**/api/admin/notifications/templates', (route) =>
    route.fulfill({ json: [template] })
  );
  await page.route(record, (route) => route.fulfill({ json: template }));
  await page.route(record + '/publish', (route) =>
    route.fulfill({ json: { ...template, id: 'other-template', status: 'active', isActive: true } })
  );
  await page.goto('/admin/notifications');

  await page
    .locator('table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2,h3)')
    .filter({ hasText: template.subject })
    .getByRole('link', { name: 'Publish', exact: true })
    .click();
  const confirm = publishReview(page);
  await confirm.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Failed to publish template' })
  ).toBeVisible();
  await expect(confirm).toBeVisible();
});

test('notification publication checks saved status after its acknowledgement stalls', async ({
  page,
}) => {
  await crmShell(page, 'en');
  await page.clock.install();
  let publishCalls = 0;
  let reads = 0;
  await page.route('**/api/admin/notifications/templates', (route) =>
    route.fulfill({ json: [template] })
  );
  await page.route(record, (route) => {
    reads++;
    return route.fulfill({
      json: publishCalls ? { ...template, status: 'active', isActive: true } : template,
    });
  });
  await page.route(`**/api/admin/notifications/templates/${template.id}/publish`, () => {
    publishCalls++;
  });
  await page.goto('/admin/notifications');

  const row = page
    .getByRole('list', { name: t('admin.notifications.catalogue', 'en') })
    .getByRole('listitem')
    .filter({ hasText: template.subject });
  await row.getByRole('link', { name: 'Publish', exact: true }).click();
  const review = publishReview(page);
  const submit = review.getByRole('button', { name: 'Publish', exact: true });
  await submit.click();
  await expect.poll(() => publishCalls).toBe(1);
  const readsBeforeTimeout = reads;
  await page.clock.fastForward(15_001);
  await expect(
    page.locator('main').getByText(confirmationText('unconfirmed', 'en'), { exact: true })
  ).toBeVisible();
  await expect(submit).toBeDisabled();
  expect(reads).toBe(readsBeforeTimeout);
  await page
    .getByRole('button', { name: t('admin.notifications.refresh', 'en'), exact: true })
    .click();
  await expect(review).toHaveCount(0);
  await expect(page.getByRole('main').getByText('Active', { exact: true })).toBeVisible();
  expect(publishCalls).toBe(1);
});

test('notification protected test send stays unconfirmed until catalogue refresh', async ({
  page,
}) => {
  const locale = 'fa';
  await crmShell(page, locale);
  await page.clock.install();
  let calls = 0;
  let passwordChecks = 0;
  await page.route(record, (route) => route.fulfill({ json: template }));
  await page.route('**/api/admin/notifications/templates', (route) =>
    route.fulfill({ json: [template] })
  );
  await page.route(`**/api/admin/notifications/templates/${template.id}/test-send`, (route) => {
    if (++calls === 1)
      return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
  });
  await page.route('**/api/auth/step-up', (route) => {
    passwordChecks++;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/admin/notifications');
  await page
    .getByRole('list', { name: t('admin.notifications.catalogue', locale) })
    .getByRole('listitem')
    .filter({ hasText: template.subject })
    .getByRole('link', { name: t('admin.notifications.edit', locale), exact: true })
    .click();
  const send = page.getByRole('button', {
    name: t('admin.notifications.testSend', locale),
    exact: true,
  });
  await page.locator('#test-destination').fill('staff@example.test');
  await send.click();
  await page.locator('#team-step-up-password').fill('Local-test-password!');
  const dialog = page.getByRole('dialog');
  const submit = dialog.locator('button[type=submit]');
  await submit.click();
  await expect.poll(() => calls).toBe(2);
  await page.clock.fastForward(15_001);
  const notice = page.getByText(notificationFormText('testUnconfirmed', locale), { exact: true });
  await expect(notice).toBeVisible();
  await expect(submit).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(notice).toBeVisible();
  await expect(send).toBeDisabled();
  await expect(
    page.getByText(t('admin.notifications.testSentEmail', locale), { exact: true })
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: t('admin.notifications.refresh', locale), exact: true })
    .click();
  await expect(notice).toHaveCount(0);
  await expect(send).toBeEnabled();
  expect(calls).toBe(2);
  expect(passwordChecks).toBe(1);
});

test('late notification test-send challenge does not reopen a closed editor', async ({ page }) => {
  await crmShell(page, 'en');
  await page.route(record, (route) => route.fulfill({ json: template }));
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

  await page
    .locator('table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2,h3)')
    .filter({ hasText: template.subject })
    .getByRole('link', { name: 'Edit', exact: true })
    .click();
  const editor = page
    .locator('form')
    .filter({ has: page.locator('#notification-template-eventKey') });
  await editor.locator('#test-destination').fill('staff@example.test');
  await editor.getByRole('button', { name: 'Test Send', exact: true }).click();
  await requested;
  const settled = Promise.race([
    page.waitForEvent('requestfailed', {
      predicate: (request) => request.url().endsWith('/test-send'),
    }),
    page.waitForResponse(record + '/test-send'),
  ]);
  try {
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  } finally {
    release();
  }
  await settled;
  await expect(page).toHaveURL(details);
  await page.getByRole('main').getByRole('link', { name: 'Edit', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

for (const requiresStepUp of [false, true]) {
  test(`notification test keeps the editor open after a destination denial (step-up: ${requiresStepUp})`, async ({
    page,
  }) => {
    const locale = 'fa';
    await crmShell(page, locale);
    await page.route(record, (route) => route.fulfill({ json: template }));
    await page.route('**/api/admin/notifications/templates', (route) =>
      route.fulfill({ json: [template] })
    );
    let verified = !requiresStepUp;
    const requests: unknown[] = [];
    await page.route('**/api/auth/step-up', (route) => {
      verified = true;
      return route.fulfill({ json: { ok: true } });
    });
    await page.route(record + '/test-send', (route) => {
      const data = route.request().postDataJSON();
      requests.push(data);
      if (!verified)
        return route.fulfill({ status: 403, json: { error: { code: 'AUTHZ:STEP_UP_REQUIRED' } } });
      if (data.destination === 'unverified@example.test')
        return route.fulfill({
          status: 403,
          json: { error: { code: 'NOTIFICATION_TEMPLATE_TEST_DESTINATION_FORBIDDEN' } },
        });
      return route.fulfill({
        json: { ok: true, destination: 'email', lastTestStatus: 'delivered' },
      });
    });

    await page.goto(details + '/edit');
    const destination = page.locator('#test-destination');
    const send = page.getByRole('button', {
      name: t('admin.notifications.testSend', locale),
      exact: true,
    });
    await destination.fill('unverified@example.test');
    await send.click();
    const dialog = page.getByRole('dialog');
    if (requiresStepUp) {
      await dialog.locator('#team-step-up-password').fill('Local-test-password!');
      await dialog.locator('button[type=submit]').click();
    }
    await expect(dialog).toHaveCount(0);
    await expect(destination).toBeFocused();
    await expect(destination).toHaveValue('unverified@example.test');
    await expect(destination).toHaveAccessibleDescription(
      notificationFormText('testDestinationForbidden', locale)
    );
    expect(requests).toEqual(
      Array(requiresStepUp ? 2 : 1).fill({ destination: 'unverified@example.test' })
    );

    await destination.fill('staff@example.test');
    await send.click();
    await expect(
      page.getByText(t('admin.notifications.testSentEmail', locale), { exact: true })
    ).toBeVisible();
    expect(requests.at(-1)).toEqual({ destination: 'staff@example.test' });
  });
}

for (const locale of ['en', 'fa'] as const) {
  test(`email publication takes the editor directly to the required subject (${locale})`, async ({
    page,
  }) => {
    await crmShell(page, locale);
    const label = (key: string) => t(`admin.notifications.${key}`, locale);
    let draft = { ...template, locale, subject: null as string | null };
    let publishes = 0;
    await page.route(record, (route) => {
      if (route.request().method() === 'PUT')
        draft = { ...draft, ...route.request().postDataJSON() };
      return route.fulfill({ json: draft });
    });
    await page.route(record + '/publish', (route) => {
      publishes++;
      expect(draft.subject).toBe('Invoice ready');
      draft = { ...draft, status: 'active', isActive: true, publishedAt: draft.updatedAt };
      return route.fulfill({ json: draft });
    });
    await page.goto(details + '/publish');
    const review = page.getByRole('region', { name: label('publishTitle'), exact: true });
    await expect(
      review.getByRole('heading', { name: notificationFormText('publishSubjectIssue', locale) })
    ).toBeVisible();
    await expect(review.getByRole('button', { name: label('publish'), exact: true })).toHaveCount(
      0
    );
    expect(publishes).toBe(0);
    await review
      .getByRole('link', { name: notificationFormText('publishSubjectAction', locale) })
      .click();
    await expect(page).toHaveURL(details + '/edit#notification-template-subject');
    const subject = page.locator('#notification-template-subject');
    await expect(subject).toBeFocused();
    await expect(subject).toHaveAccessibleDescription(
      notificationFormText('emailPublishSubjectHint', locale)
    );
    await subject.fill('Invoice ready');
    await page
      .getByRole('form', { name: label('editTitle') })
      .locator('button[type=submit]')
      .click();
    await expect(page).toHaveURL(details);
    await page.getByRole('link', { name: label('publish'), exact: true }).click();
    await review.getByRole('button', { name: label('publish'), exact: true }).click();
    await expect(page).toHaveURL(details);
    await expect(page.getByRole('main').getByText(label('active'), { exact: true })).toBeVisible();
    expect(publishes).toBe(1);
  });
}

test('an email subject rejected after step-up opens the repair action', async ({ page }) => {
  const locale = 'en';
  await crmShell(page, locale);
  await page.route(record, (route) => route.fulfill({ json: template }));
  let publishes = 0;
  await page.route(record + '/publish', (route) =>
    ++publishes === 1
      ? route.fulfill({ status: 403, json: { error: { code: 'AUTHZ:STEP_UP_REQUIRED' } } })
      : route.fulfill({
          status: 400,
          json: { error: { code: 'VALIDATION:INPUT:INVALID', fields: ['subject'] } },
        })
  );
  await page.route('**/api/auth/step-up', (route) => route.fulfill({ json: { ok: true } }));
  await page.goto(details + '/publish');
  await publishReview(page).getByRole('button', { name: 'Publish', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#team-step-up-password').fill('Local-test-password!');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog).toHaveCount(0);
  const edit = publishReview(page).getByRole('link', {
    name: notificationFormText('publishSubjectAction', locale),
  });
  await expect(edit).toBeFocused();
  await expect(page).toHaveURL(details + '/publish');
  expect(publishes).toBe(2);
});
