import { test, expect } from './coverage-fixture';
import { t } from '@barghsa/i18n/admin-ui';

for (const locale of ['en', 'fa'] as const) {
  test(`preview selector and rendered version agree across filters (${locale})`, async ({
    page,
  }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    const base = {
      eventKey: 'fixture.versions',
      channel: 'in_app',
      locale,
      subject: null,
      variables: [{ name: 'user.name', description: 'Recipient name' }],
      publishedAt: null,
    };
    await page.route('**/api/admin/notifications/templates*', (route) =>
      route.fulfill({
        json:
          new URL(route.request().url()).searchParams.get('status') === 'archived'
            ? [
                {
                  ...base,
                  id: 'archived-v1',
                  version: 1,
                  status: 'archived',
                  isActive: false,
                  bodyTemplate: 'Archived {{user.name}}',
                },
              ]
            : [
                {
                  ...base,
                  id: 'draft-v3',
                  version: 3,
                  status: 'draft',
                  isActive: false,
                  bodyTemplate: 'Draft {{user.name}}',
                },
                {
                  ...base,
                  id: 'active-v2',
                  version: 2,
                  status: 'active',
                  isActive: true,
                  bodyTemplate: 'Active {{user.name}}',
                },
                {
                  ...base,
                  id: 'sms-v1',
                  channel: 'sms',
                  version: 1,
                  status: 'draft',
                  isActive: false,
                  bodyTemplate: 'SMS {{user.name}}',
                },
                {
                  ...base,
                  id: 'other-v1',
                  eventKey: 'fixture.other',
                  version: 1,
                  status: 'draft',
                  isActive: false,
                  bodyTemplate: 'Other {{user.name}}',
                },
              ],
      })
    );
    await page.goto('/admin/notifications');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    const version = page.locator('#tpl-preview-version');
    const body = page.locator('pre');
    await expect(body).toHaveText('Active user.name');
    await expect(version).toHaveValue('active-v2');
    await version.selectOption('draft-v3');
    await expect(body).toHaveText('Draft user.name');
    await expect(version).toHaveValue('draft-v3');
    await page.locator('#tpl-preview-channel').selectOption('sms');
    await expect(version).toHaveValue('sms-v1');
    await expect(body).toHaveText('SMS user.name');
    await page.locator('#tpl-preview-channel').selectOption('in_app');
    await page.locator('#tpl-preview-event').selectOption('fixture.other');
    await page.locator('#tpl-preview-locale').selectOption(locale);
    await expect(version).toHaveValue('other-v1');
    await expect(body).toHaveText('Other user.name');
    await expect(body).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
    await expect(page.getByText('Recipient name', { exact: true })).toBeVisible();
    await page
      .getByRole('combobox', { name: t('admin.notifications.allStatus', locale), exact: true })
      .selectOption('archived');
    await expect(version).toHaveValue('archived-v1');
    await expect(body).toHaveText('Archived user.name');
  });
}
