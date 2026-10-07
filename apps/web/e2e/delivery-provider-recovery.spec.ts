import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import AxeBuilder from '@axe-core/playwright';
import { providerText, smsProviderText } from '@barghsa/i18n/providers';

test.use({ viewport: { width: 390, height: 844 } });
const email = {
  id: 'email',
  transport: 'resend',
  label: 'Saved provider',
  status: 'draft',
  lastTestStatus: 'passed',
  maskedConfig: { api_key: '********test', from_email: 'sender@example.test' },
};
const sms = {
  id: 'sms',
  transport: 'smsir',
  label: 'Saved provider',
  status: 'draft',
  lastTestStatus: 'passed',
  createdAt: '2026-10-01T00:00:00Z',
  maskedConfig: {
    api_key: '********test',
    sender: '3000',
    timeout: 15,
    throughput_limit: 100,
    low_credit_threshold: 0,
    template_mappings: [{ event_key: 'auth.otp', template_id: '42', variables: { code: 'CODE' } }],
  },
};
for (const locale of ['en', 'fa'] as const)
  for (const theme of ['light', 'dark'] as const) {
    test(`email draft and recipient recover without loss (${locale}, ${theme})`, async ({
      page,
    }) => {
      await crmShell(page, locale);
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            appTitle: 'Delivery',
            appTitleFa: 'ارسال',
            supportEmail: 'support@example.test',
            supportPhone: '+982112345678',
            supportMobile: '+989121234567',
            backgroundColor: '#f6f7f4',
            darkBackgroundColor: '#15201c',
            fontFamily: 'vazirmatn',
            borderRadiusRem: 0.75,
            spacingScale: 1,
            numberStyle: 'locale',
            slogan: '',
            primaryColor: '#2563eb',
            secondaryColor: '#64748b',
            accentColor: '#f59e0b',
            logoUrl: null,
            faviconUrl: null,
            darkMode: theme === 'dark',
          },
        })
      );
      let fail = false,
        changed = false;
      await page.route('**/api/admin/email-providers', (route) =>
        route.fulfill({
          status: fail ? 503 : 200,
          json: [{ ...email, label: changed ? 'Changed remotely' : email.label }],
        })
      );
      await page.goto('/admin/providers');
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark).*$/);
      const text = (key: string) => providerText(`admin.providers.${key}`, locale);
      const row = page
        .locator('table:visible tbody tr, ol[role=list]:visible > li')
        .filter({ hasText: 'Saved provider' });
      await row.locator('input[type=email]').fill('staff@example.test');
      await row.getByRole('button', { name: text('update'), exact: true }).click();
      await page.locator('#email-provider-label').fill('Local draft');
      await page.getByLabel(text('field.apiKey'), { exact: false }).fill('synthetic-secret');
      fail = true;
      await page.getByRole('button', { name: text('refresh'), exact: true }).click();
      await expect(page.getByRole('alert').filter({ hasText: text('error.load') })).toBeVisible();
      await expect(row.locator('input[type=email]')).toHaveValue('staff@example.test');
      await expect(page.getByLabel(text('field.apiKey'), { exact: false })).toHaveValue(
        'synthetic-secret'
      );
      await expect(page.locator('form button[type=submit]')).toBeDisabled();
      fail = false;
      await page.getByRole('button', { name: text('retry'), exact: true }).click();
      await expect(page.locator('form button[type=submit]')).toBeEnabled();
      await expect(row.locator('input[type=email]')).toHaveValue('staff@example.test');
      changed = true;
      await page.getByRole('button', { name: text('refresh'), exact: true }).click();
      await expect(page.getByRole('alert').filter({ hasText: text('stale') })).toBeVisible();
      await expect(page.locator('#email-provider-label')).toHaveValue('Local draft');
      await expect(page.locator('form button[type=submit]')).toBeDisabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: `/tmp/barghsa-provider-email-${locale}-${theme}.png`,
        fullPage: true,
      });
    });
    test(`SMS mappings and OTP recover through independent reads (${locale}, ${theme})`, async ({
      page,
    }) => {
      await crmShell(page, locale);
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            appTitle: 'Delivery',
            appTitleFa: 'ارسال',
            supportEmail: 'support@example.test',
            supportPhone: '+982112345678',
            supportMobile: '+989121234567',
            backgroundColor: '#f6f7f4',
            darkBackgroundColor: '#15201c',
            fontFamily: 'vazirmatn',
            borderRadiusRem: 0.75,
            spacingScale: 1,
            numberStyle: 'locale',
            slogan: '',
            primaryColor: '#2563eb',
            secondaryColor: '#64748b',
            accentColor: '#f59e0b',
            logoUrl: null,
            faviconUrl: null,
            darkMode: theme === 'dark',
          },
        })
      );
      let fail = false,
        lists = 0,
        eventReads = 0;
      await page.route('**/api/admin/email-providers', (route) => route.fulfill({ json: [] }));
      await page.route('**/api/admin/sms-providers/template-variable-choices', (route) =>
        route.fulfill({
          json: [
            { eventKey: 'auth.otp', locale: 'en', variables: ['code'] },
            { eventKey: 'auth.otp', locale: 'fa', variables: ['code'] },
          ],
        })
      );
      await page.route('**/api/admin/sms-providers/template-event-keys', (route) => {
        eventReads++;
        return route.fulfill({ status: fail ? 503 : 200, json: ['auth.otp'] });
      });
      await page.route('**/api/admin/sms-providers', (route) => {
        lists++;
        return route.fulfill({ json: [sms] });
      });
      await page.route('**/api/admin/sms-providers/sms', (route) =>
        route.fulfill({ status: 403, json: { requiresStepUp: true } })
      );
      await page.goto('/admin/providers');
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark).*$/);
      await page.getByRole('tab', { name: 'SMS.ir', exact: true }).click();
      const text = (key: Parameters<typeof smsProviderText>[0]) => smsProviderText(key, locale);
      await page.getByRole('button', { name: text('edit'), exact: true }).click();
      const bounds = await page.locator('form').boundingBox();
      for (const selector of ['#sms-label', '#sms-key', '#sms-sender', '#sms-timeout']) {
        const field = await page.locator(selector).boundingBox();
        expect(field!.x).toBeGreaterThanOrEqual(bounds!.x);
        expect(field!.x + field!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
      }
      const mappings = page.locator('form [data-slot=scroll-area-viewport]');
      await expect(mappings).toHaveAttribute('tabindex', '0');
      await mappings.focus();
      const initial = await mappings.evaluate((node) => node.scrollLeft);
      await page.keyboard.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
      await expect.poll(() => mappings.evaluate((node) => node.scrollLeft)).not.toBe(initial);
      expect(
        await page
          .locator('input[list=sms-events]')
          .evaluate((node) => node.getBoundingClientRect().width)
      ).toBeGreaterThanOrEqual(120);
      await page.locator('#sms-key').fill('synthetic-secret');
      await page.locator('#sms-label').fill('Local draft');
      fail = true;
      await page.getByRole('button', { name: text('retryEvents'), exact: true }).click();
      await expect(page.getByRole('alert').filter({ hasText: text('eventsFailed') })).toBeVisible();
      await expect(page.locator('input[list=sms-events]')).toHaveValue('auth.otp');
      await expect(page.locator('#sms-key')).toHaveValue('synthetic-secret');
      await expect(page.locator('form button[type=submit]')).toBeDisabled();
      fail = false;
      await page.getByRole('button', { name: text('retryEvents'), exact: true }).click();
      await expect(page.locator('form button[type=submit]')).toBeEnabled();
      await page.locator('form button[type=submit]').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await page.route('**/api/auth/step-up/otp/send', (route) =>
        route.fulfill({
          json: {
            challengeId: '00000000-0000-4000-8000-000000000001',
            expiresAt: new Date(Date.now() + 300000).toISOString(),
            channel: 'sms',
          },
        })
      );
      await dialog
        .getByRole('button', {
          name: locale === 'en' ? 'Send verification code' : 'ارسال کد تأیید',
          exact: true,
        })
        .click();
      await dialog.locator('input[autocomplete=one-time-code]').fill('123456');
      fail = true;
      await dialog.getByRole('button', { name: text('retryEvents'), exact: true }).click();
      await expect(
        dialog.getByRole('alert').filter({ hasText: text('eventsFailed') })
      ).toBeVisible();
      await expect(dialog.locator('input[autocomplete=one-time-code]')).toHaveValue('123456');
      await expect(dialog.locator('button[type=submit]')).toBeDisabled();
      fail = false;
      await dialog.getByRole('button', { name: text('retryEvents'), exact: true }).click();
      await expect(dialog.locator('button[type=submit]')).toBeEnabled();
      await dialog
        .getByRole('button', { name: locale === 'fa' ? 'انصراف' : 'Cancel', exact: true })
        .click();
      await expect(page.locator('#sms-key')).toHaveValue('synthetic-secret');
      expect(lists).toBe(1);
      expect(eventReads).toBe(5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: `/tmp/barghsa-provider-sms-${locale}-${theme}.png`,
        fullPage: true,
      });
    });
  }
