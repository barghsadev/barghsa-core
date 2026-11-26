import { crmShell } from './crm-shell-fixture';
import { notificationTemplate } from '../src/test/content-catalogue-fixtures';
import { test, expect } from './coverage-fixture';
import { t } from '@barghsa/i18n/admin-ui';
import { notificationFormText } from '@barghsa/i18n/notification-forms';
test.use({ viewport: { width: 390, height: 844 } });

test('new notification drafts inherit delivery filters from the catalogue', async ({ page }) => {
  await crmShell(page, 'fa');
  await page.route(
    (url) => url.pathname === '/api/admin/notifications/templates',
    (route) => route.fulfill({ json: [] })
  );
  await page.goto('/admin/notifications?eventKey=payment.invoice_reminder&channel=sms&locale=fa');
  await page
    .getByRole('link', { name: t('admin.notifications.newTemplate', 'fa'), exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/notifications\/new\?/);
  const event = page.locator('#notification-template-eventKey');
  await expect(event).toHaveValue('payment.invoice_reminder');
  await expect(page.locator('#notification-template-channel')).toHaveValue('sms');
  await expect(page.locator('#notification-template-locale')).toHaveValue('fa');
  await expect(page.locator('#notification-template-subject')).toHaveCount(0);
  await event.selectOption('contract.signed');
  await page
    .getByRole('button', { name: t('admin.notifications.refresh', 'fa'), exact: true })
    .click();
  await expect(event).toHaveValue('contract.signed');
});

for (const locale of ['en', 'fa'] as const) {
  test(`template authoring supports registered and custom events, native drag and keyboard insertion (${locale})`, async ({
    page,
    baseURL,
  }) => {
    await page
      .context()
      .addCookies([{ url: baseURL!, name: 'barghsa_csrf', value: 'authoring-test' }]);
    await crmShell(page, locale);
    let saved: Record<string, unknown> | null = null;
    const description = 'Recipient name, as shown on the invoice.\nKeep the original spelling.';
    const templateId = notificationTemplate().id;
    await page.route(`**/api/admin/notifications/templates/${templateId}`, (route) =>
      route.fulfill(saved ? { json: saved } : { status: 404, json: {} })
    );
    await page.route('**/api/admin/notifications/templates', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: saved ? [saved] : [] });
      const body = route.request().postDataJSON();
      expect(body.eventKey).toBe('billing.installment_ready');
      expect(body.subject).toBe('Notice for {{user.name}}');
      expect(body.bodyTemplate).toBe('Hello {{user.name}}');
      expect(body.variables).toEqual([{ name: 'user.name', description }]);
      saved = {
        ...notificationTemplate(),
        ...body,
        subject: body.subject ?? null,
        id: templateId,
        status: 'draft',
        isActive: false,
        version: 1,
        publishedAt: null,
      };
      return route.fulfill({ status: 201, json: saved });
    });
    await page.goto('/admin/notifications');

    await page
      .getByRole('link', { name: locale === 'fa' ? 'قالب جدید' : 'New Template', exact: true })
      .click();
    const editor = page
      .locator('form')
      .filter({ has: page.locator('#notification-template-eventKey') });
    for (const field of ['eventKey', 'channel', 'locale', 'bodyTemplate']) {
      const control = editor.locator(`#notification-template-${field}`);
      await expect(control).toHaveAccessibleName(/\S/);
      await expect(control).toHaveAttribute('aria-required', 'true');
    }
    await expect(editor.locator('#notification-template-subject')).not.toHaveAttribute(
      'aria-required',
      'true'
    );
    const event = editor.locator('#notification-template-eventKey');
    await expect(event).toHaveValue('');
    await event.selectOption('auth.refresh_token_reused');
    await expect(event).toHaveValue('auth.refresh_token_reused');
    await event.selectOption({ label: notificationFormText('customEvent', locale) });
    await expect(event).toHaveAccessibleDescription(
      notificationFormText('customEventHelp', locale)
    );
    await event.fill('billing.installment_ready');
    const channel = editor.locator('#notification-template-channel');
    const title = editor.locator('#notification-template-subject');
    await channel.selectOption('in_app');
    await expect(title).toHaveAccessibleName(notificationFormText('inboxTitle', locale));
    await expect(title).toHaveAccessibleDescription(notificationFormText('inboxTitleHint', locale));
    await title.fill('Notice for {{user.name}}');
    await channel.selectOption('sms');
    await expect(title).toHaveCount(0);
    await channel.selectOption('in_app');
    await expect(title).toHaveValue('Notice for {{user.name}}');
    await editor.locator('#notification-template-locale').selectOption(locale);
    const add = editor.getByRole('button', { name: notificationFormText('addVariable', locale) });
    const name = editor.locator('[data-variable-name]');
    await add.click();
    await expect(name).toBeFocused();
    await name.fill('user.name');
    await editor.locator('[data-variable-description]').fill(description);
    const body = editor.locator('#notification-template-bodyTemplate');
    await body.fill('Hello ');
    const variable = editor.getByRole('button', { name: '{{user.name}}', exact: true });
    await expect(variable).toHaveAttribute('draggable', 'true');
    await variable.scrollIntoViewIfNeeded();
    await body.scrollIntoViewIfNeeded();
    await variable.dragTo(body, { targetPosition: { x: 48, y: 20 } });
    await expect(body).toHaveValue(/\{\{user\.name\}\}/);
    expect((await body.inputValue()).match(/\{\{user\.name\}\}/g)).toHaveLength(1);
    await body.fill('Hello selected');
    await body.evaluate((element) => element.setSelectionRange(6, 14));
    await variable.focus();
    await page.keyboard.press('Enter');
    await expect(body).toHaveValue('Hello {{user.name}}');
    await expect(editor.getByText('Notice for user.name', { exact: true })).toBeVisible();
    await expect(editor).toContainText(t('admin.notifications.insertHint', locale));
    await add.click();
    await name.last().fill('user.name');
    await editor.locator('button[type=submit]').click();
    await expect(name.last()).toHaveAttribute('aria-invalid', 'true');
    await expect(name.last()).toBeFocused();
    expect(saved).toBeNull();
    await editor
      .getByRole('button', {
        name: `${notificationFormText('removeVariable', locale)} user.name`,
        exact: true,
      })
      .last()
      .click();
    await expect(name).toBeFocused();
    await editor.locator('button[type=submit]').click();
    await expect(editor).toHaveCount(0);
    await expect(page).toHaveURL(`/admin/notifications/${templateId}`);
    await expect(
      page
        .getByRole('main')
        .getByRole('heading', { name: 'billing.installment_ready', exact: true })
    ).toBeVisible();
    expect(saved).not.toBeNull();
  });
}

test('a new SMS omits the other channel’s title and an existing SMS can clear its stored subject', async ({
  page,
  baseURL,
}) => {
  await page
    .context()
    .addCookies([{ url: baseURL!, name: 'barghsa_csrf', value: 'sms-title-test' }]);
  await crmShell(page, 'fa');
  let saved = {
    ...notificationTemplate(),
    channel: 'sms',
    subject: 'Previously imported subject' as string | null,
  };
  const newId = '30000000-0000-4000-8000-000000000002';
  let created: typeof saved | null = null;
  const writes: unknown[] = [];
  await page.route(`**/api/admin/notifications/templates/${newId}`, (route) =>
    route.fulfill({ json: created })
  );
  await page.route(`**/api/admin/notifications/templates/${saved.id}`, (route) => {
    if (route.request().method() === 'PUT') {
      const data = route.request().postDataJSON();
      writes.push(data);
      saved = { ...saved, ...data };
    }
    return route.fulfill({ json: saved });
  });
  await page.route('**/api/admin/notifications/templates', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [saved] });
    const data = route.request().postDataJSON();
    writes.push(data);
    created = { ...saved, ...data, subject: null, id: newId };
    return route.fulfill({ status: 201, json: created });
  });
  await page.goto('/admin/notifications/new');
  const title = page.locator('#notification-template-subject');
  const body = page.locator('#notification-template-bodyTemplate');
  const editor = page.locator('form').filter({ has: body });
  await title.fill('Unknown {{name}}');
  await title.blur();
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await editor.locator('#notification-template-channel').selectOption('sms');
  await expect(title).toHaveCount(0);
  await body.fill('A new SMS');
  await editor.locator('button[type=submit]').click();
  const event = editor.locator('#notification-template-eventKey');
  await expect(event).toHaveAttribute('aria-invalid', 'true');
  await expect(event).toBeFocused();
  expect(writes).toEqual([]);
  await event.selectOption('payment.invoice_reminder');
  await editor.locator('button[type=submit]').click();
  await expect(editor).toHaveCount(0);
  await expect(page).toHaveURL(`/admin/notifications/${newId}`);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ channel: 'sms', bodyTemplate: 'A new SMS' });
  expect(writes[0]).not.toHaveProperty('subject');

  await page.goto(`/admin/notifications/${saved.id}/edit`);
  await expect(title).toHaveAccessibleName(notificationFormText('legacySmsSubject', 'fa'));
  await expect(title).toHaveValue('Previously imported subject');
  await title.clear();
  await expect(title).toBeVisible();
  await editor.locator('button[type=submit]').click();
  await expect(editor).toHaveCount(0);
  expect(writes[1]).toMatchObject({ subject: null, bodyTemplate: saved.bodyTemplate });
});
