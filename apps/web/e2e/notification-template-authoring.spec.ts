import { test, expect } from './coverage-fixture';
import { t } from '@barghsa/i18n/admin-ui';

for (const locale of ['en', 'fa'] as const) {
  test(`template authoring supports new event keys, native variable drag and keyboard insertion (${locale})`, async ({
    page,
    baseURL,
  }) => {
    await page
      .context()
      .addCookies([{ url: baseURL!, name: 'barghsa_csrf', value: 'authoring-test' }]);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    let saved: Record<string, unknown> | null = null;
    await page.route('**/api/admin/notifications/templates', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: saved ? [saved] : [] });
      const body = route.request().postDataJSON();
      expect(body.eventKey).toBe('auth.refresh_token_reused');
      expect(body.bodyTemplate).toBe('Hello {{user.name}}');
      expect(body.variables).toEqual([{ name: 'user.name', description: 'Recipient name' }]);
      saved = {
        ...body,
        subject: body.subject ?? null,
        id: 'new-event-template',
        status: 'draft',
        isActive: false,
        version: 1,
        publishedAt: null,
      };
      return route.fulfill({ status: 201, json: saved });
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
    await editor.locator('#notification-template-eventKey').fill('auth.refresh_token_reused');
    await editor.locator('#notification-template-channel').selectOption('in_app');
    await editor.locator('#notification-template-locale').selectOption(locale);
    await editor.locator('#notification-template-variablesLabel').fill('user.name: Recipient name');
    const body = editor.locator('#notification-template-bodyTemplate');
    await body.fill('Hello ');
    const variable = editor.getByRole('button', { name: '{{user.name}}', exact: true });
    await expect(variable).toHaveAttribute('draggable', 'true');
    await variable.dragTo(body);
    await expect(body).toHaveValue(/\{\{user\.name\}\}/);
    expect((await body.inputValue()).match(/\{\{user\.name\}\}/g)).toHaveLength(1);
    await body.fill('Hello selected');
    await body.evaluate((element) => element.setSelectionRange(6, 14));
    await variable.focus();
    await page.keyboard.press('Enter');
    await expect(body).toHaveValue('Hello {{user.name}}');
    await expect(editor).toContainText(t('admin.notifications.insertHint', locale));
    await editor.locator('button[type=submit]').click();
    await expect(editor).toHaveCount(0);
    await expect(
      page.getByRole('row').filter({ hasText: 'auth.refresh_token_reused' })
    ).toBeVisible();
    expect(saved).not.toBeNull();
  });
}
