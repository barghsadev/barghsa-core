import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { providerText, smsProviderText } from '@barghsa/i18n/providers';
import AxeBuilder from '@axe-core/playwright';
test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    test(`provider linked feedback and retained drafts (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
      baseURL,
    }, info) => {
      await setupCatalogueForms(page, locale, dark);
      await page
        .context()
        .addCookies([{ url: baseURL!, name: 'barghsa_csrf', value: 'provider-forms-fixture' }]);
      let email = {
        id: 'email',
        transport: 'smtp',
        label: 'Saved email',
        status: 'draft',
        lastTestStatus: 'pending',
        maskedConfig: {
          host: 'smtp.example.test',
          port: 587,
          from_email: 'sender@example.test',
          security: 'STARTTLS',
          connection_timeout: 10,
          command_timeout: 15,
        },
      };
      let sms = {
        id: 'sms',
        transport: 'smsir',
        label: 'Saved SMS',
        status: 'draft',
        lastTestStatus: 'pending',
        createdAt: '2026-10-04T00:00:00Z',
        maskedConfig: {
          api_key: '********cret',
          sender: '3000',
          timeout: 15,
          throughput_limit: 100,
          low_credit_threshold: 0,
          template_mappings: [
            { event_key: 'auth.otp', template_id: '42', variables: { code: 'CODE' } },
          ],
        },
      };
      const emailWrites: unknown[] = [],
        smsWrites: unknown[] = [];
      let invalid = true;
      await page.route('**/api/admin/email-providers', (r) => r.fulfill({ json: [email] }));
      await page.route('**/api/admin/email-providers/email', (r) => {
        const body = r.request().postDataJSON();
        emailWrites.push(body);
        if (invalid)
          return r.fulfill({
            status: 400,
            json: { error: { fields: ['port'], message: 'untrusted-secret' } },
          });
        email = {
          ...email,
          label: body.label,
          maskedConfig: { ...email.maskedConfig, ...body.config },
        };
        return r.fulfill({ json: email });
      });
      await page.route('**/api/admin/sms-providers', (r) => r.fulfill({ json: [sms] }));
      await page.route('**/api/admin/sms-providers/template-event-keys', (r) =>
        r.fulfill({ json: ['auth.otp'] })
      );
      await page.route('**/api/admin/sms-providers/sms', (r) => {
        const body = r.request().postDataJSON();
        smsWrites.push(body);
        sms = { ...sms, label: body.label, maskedConfig: { ...sms.maskedConfig, ...body.config } };
        return r.fulfill({ json: sms });
      });
      await page.goto('/admin/providers');
      const emailText = (key: string) => providerText(`admin.providers.${key}`, locale);
      await page
        .locator('table:visible tbody tr, ol[role=list]:visible > li')
        .filter({ hasText: 'Saved email' })
        .getByRole('button', { name: emailText('update'), exact: true })
        .click();
      const port = page.locator('#email-provider-port');
      await port.fill('0');
      await page.locator('form button[type=submit]').click();
      await expect(port).toBeFocused();
      await expect(port).toHaveAttribute('aria-invalid', 'true');
      expect(emailWrites).toHaveLength(0);
      await port.fill('465');
      await page.locator('#email-provider-label').fill('Local email');
      await page.locator('form button[type=submit]').click();
      await expect(port).toBeFocused();
      await expect(page.locator('#email-provider-label')).toHaveValue('Local email');
      await expect(page.locator('form')).not.toContainText('untrusted-secret');
      if (locale === 'fa' && dark)
        await page
          .locator('form')
          .screenshot({ path: `/tmp/barghsa-provider-email-form-${info.project.name}.png` });
      invalid = false;
      await port.fill('465');
      await page.locator('form button[type=submit]').click();
      await expect(page.locator('#email-provider-label')).toHaveCount(0);
      expect(emailWrites).toHaveLength(2);
      await page.getByRole('tab', { name: 'SMS.ir', exact: true }).click();
      const text = (key: Parameters<typeof smsProviderText>[0]) => smsProviderText(key, locale);
      await page.getByRole('button', { name: text('edit'), exact: true }).click();
      await expect(page.locator('#sms-key')).toHaveValue('');
      const timeout = page.locator('#sms-timeout');
      await timeout.fill('301');
      await page.locator('form button[type=submit]').click();
      await expect(timeout).toBeFocused();
      expect(smsWrites).toHaveLength(0);
      await timeout.fill('25');
      const mapping = page.getByRole('textbox', { name: `${text('template')} 1`, exact: true });
      await mapping.fill('0');
      await page.locator('form button[type=submit]').click();
      const event = page.getByRole('combobox', { name: `${text('event')} 1`, exact: true });
      await expect(event).toBeFocused();
      await expect(event).toHaveAttribute('aria-invalid', 'true');
      expect(smsWrites).toHaveLength(0);
      await mapping.fill('42');
      await page.locator('#sms-label').fill('Local SMS');
      expect((await new AxeBuilder({ page }).include('form').analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await page.screenshot({
        path: `/tmp/barghsa-provider-forms-${locale}-${dark ? 'dark' : 'light'}-${info.project.name}.png`,
        fullPage: true,
      });
      await page.locator('form button[type=submit]').click();
      await expect(page.locator('#sms-key')).toHaveCount(0);
      expect(smsWrites).toHaveLength(1);
      expect((smsWrites[0] as { config: Record<string, unknown> }).config).not.toHaveProperty(
        'api_key'
      );
    });
  }
