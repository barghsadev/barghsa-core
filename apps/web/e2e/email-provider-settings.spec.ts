import { test, expect } from './coverage-fixture';
import { providerText } from '@barghsa/i18n/providers';

for (const locale of ['en', 'fa'] as const) {
  const text = (key: string) => providerText(`admin.providers.${key}`, locale);
  for (const transport of ['smtp', 'resend'] as const) {
    test(`email ${transport} draft preserves saved configuration and write-only credentials (${locale})`, async ({
      page,
      baseURL,
    }) => {
      await page
        .context()
        .addCookies([{ url: baseURL!, name: 'barghsa_csrf', value: 'email-config-test' }]);
      const config = {
        from_email: 'mail@example.test',
        from_name: 'Saved sender',
        reply_to: 'reply@example.test',
        ...(transport === 'smtp'
          ? {
              host: 'smtp.example.test',
              port: 465,
              security: 'TLS',
              username: 'saved-user',
              connection_timeout: 27,
              command_timeout: 43,
            }
          : { sending_domain: 'example.test' }),
      };
      let row = {
        id: 'saved-email',
        label: 'Saved email',
        transport,
        status: 'draft',
        lastTestStatus: 'pending',
        maskedConfig: {
          ...config,
          [transport === 'smtp' ? 'password' : 'api_key']: '********secret',
        },
      };
      let writes = 0;
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'Asia/Tehran' } })
      );
      await page.route('**/api/admin/email-providers', (route) => route.fulfill({ json: [row] }));
      await page.route('**/api/admin/email-providers/saved-email', (route) => {
        writes++;
        expect(route.request().method()).toBe('PUT');
        expect(route.request().postDataJSON()).toEqual({
          label: 'Renamed email',
          config: { ...config, ...(transport === 'smtp' ? { connection_timeout: 31 } : {}) },
        });
        if (writes === 1) return route.fulfill({ status: 503, json: {} });
        row = { ...row, label: 'Renamed email', lastTestStatus: 'pending' };
        return route.fulfill({ json: row });
      });
      await page.route('**/api/admin/email-providers/saved-email/test-connection', (route) => {
        expect(route.request().postDataJSON()).toEqual({ recipient: 'staff@example.test' });
        row = { ...row, lastTestStatus: 'passed' };
        return route.fulfill({ json: { ...row, test: { ok: true, error: null } } });
      });
      await page.goto('/admin/providers');
      await page.evaluate((lang) => {
        document.documentElement.lang = lang;
      }, locale);
      const providerRow = page.getByRole('row').filter({ hasText: 'Saved email' });
      const send = providerRow.getByRole('button', { name: text('test.run'), exact: false });
      await expect(send).toBeDisabled();
      await providerRow.locator('input[type=email]').fill('staff@example.test');
      await expect(send).toContainText('staff@example.test');
      await send.click();
      await expect(
        providerRow.getByText(text('test.passed'), { exact: true }).first()
      ).toBeVisible();
      const edit = () =>
        page
          .getByRole('row')
          .filter({ hasText: 'Saved email' })
          .getByRole('button', { name: text('update'), exact: true })
          .click();
      await edit();
      const form = page.locator('form').filter({ has: page.locator('#email-provider-label') });
      await expect(form.getByLabel(text('field.fromEmail'), { exact: false })).toHaveValue(
        config.from_email
      );
      await expect(form.getByLabel(text('field.fromName'), { exact: false })).toHaveValue(
        config.from_name
      );
      await expect(form.getByLabel(text('field.replyTo'), { exact: false })).toHaveValue(
        config.reply_to
      );
      await expect(form.locator('input[type=password]')).toHaveValue('');
      await expect(form).not.toContainText('********secret');
      if (transport === 'smtp') {
        await expect(form.getByLabel(text('field.host'), { exact: false })).toHaveValue(
          'smtp.example.test'
        );
        await expect(
          form.getByRole('spinbutton', { name: `${text('field.port')} *`, exact: true })
        ).toHaveValue('465');
        await expect(form.getByLabel(text('field.security'), { exact: false })).toHaveValue('TLS');
        await expect(form.getByLabel(text('field.username'), { exact: false })).toHaveValue(
          'saved-user'
        );
        await expect(
          form.getByLabel(text('field.connectionTimeout'), { exact: false })
        ).toHaveValue('27');
        await expect(form.getByLabel(text('field.commandTimeout'), { exact: false })).toHaveValue(
          '43'
        );
      } else
        await expect(form.getByLabel(text('field.sendingDomain'), { exact: false })).toHaveValue(
          'example.test'
        );
      await form.locator('#email-provider-label').fill('Cancelled edit');
      await form.getByRole('button', { name: text('cancel'), exact: true }).click();
      await edit();
      await expect(form.locator('#email-provider-label')).toHaveValue('Saved email');
      await form.locator('#email-provider-label').fill('Renamed email');
      if (transport === 'smtp')
        await form.getByLabel(text('field.connectionTimeout'), { exact: false }).fill('31');
      await form.locator('button[type=submit]').click();
      await expect(page.getByRole('alert').filter({ hasText: text('error.save') })).toBeVisible();
      await expect(form.locator('#email-provider-label')).toHaveValue('Renamed email');
      await form.locator('button[type=submit]').click();
      await expect(form).toHaveCount(0);
      await expect(page.getByRole('cell', { name: 'Renamed email', exact: true })).toBeVisible();
      await expect(page.getByText(text('test.passed'), { exact: true })).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: text('activate'), exact: true })
      ).toBeDisabled();
      expect(writes).toBe(2);
    });
  }

  test(`email draft refuses missing or malformed saved configuration instead of overwriting defaults (${locale})`, async ({
    page,
  }) => {
    let config: unknown = null;
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'Asia/Tehran' } })
    );
    await page.route('**/api/admin/email-providers', (route) =>
      route.fulfill({
        json: [
          {
            id: 'bad-email',
            label: 'Bad email',
            transport: 'smtp',
            status: 'draft',
            lastTestStatus: 'pending',
            maskedConfig: config,
          },
        ],
      })
    );
    await page.goto('/admin/providers');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    for (const bad of [
      null,
      { host: 'smtp.example.test', from_email: 'mail@example.test', port: '465' },
    ]) {
      config = bad;
      await page
        .getByRole('row')
        .filter({ hasText: 'Bad email' })
        .getByRole('button', { name: text('update'), exact: true })
        .click();
      const alert = page.getByRole('alert').filter({ hasText: text('error.load') });
      await expect(alert).toBeVisible();
      await expect(page.locator('#email-provider-label')).toHaveCount(0);
      config =
        bad === null
          ? { host: 'smtp.example.test', from_email: 'mail@example.test', port: '465' }
          : { host: 'smtp.example.test', from_email: 'mail@example.test', port: 465 };
      await alert.getByRole('button', { name: text('retry'), exact: true }).click();
    }
    await page
      .getByRole('row')
      .filter({ hasText: 'Bad email' })
      .getByRole('button', { name: text('update'), exact: true })
      .click();
    await expect(page.locator('#email-provider-label')).toHaveValue('Bad email');
  });
}
