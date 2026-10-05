import AxeBuilder from '@axe-core/playwright';
import { providerText, smsProviderText } from '@barghsa/i18n/providers';
import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';

const stamp = '2026-09-24T12:00:00Z';
const healthMetrics = {
  attemptCount: 8,
  failureCount: 2,
  averageLatencyMs: 120,
  p50LatencyMs: 100,
  p95LatencyMs: 240,
  p99LatencyMs: 270,
  queueDepth: 2,
  oldestQueuedAt: stamp,
};
const health = {
  degraded: true,
  breakerCooldownUntil: '2099-09-24T12:00:00Z',
  lastFailureAt: stamp,
  healthMetrics,
  alertHistory: [{ kind: 'circuit_open', createdAt: stamp }],
};
const emailDraft = {
  id: 'email-draft',
  label: 'ایمیل پشتیبان',
  transport: 'resend',
  status: 'draft',
  lastTestStatus: 'passed',
  lastTestAt: stamp,
  maskedConfig: { api_key: '********test', from_email: 'sender@example.test' },
};
const emailActive = {
  ...emailDraft,
  ...health,
  id: 'email-active',
  label: 'ایمیل اصلی',
  status: 'active',
  activatedAt: stamp,
  activatedBy: '00000000-0000-4000-8000-000000000009',
};
const smsDraft = {
  id: 'sms-draft',
  transport: 'smsir',
  label: 'پیامک پشتیبان',
  status: 'draft',
  lastTestStatus: 'passed',
  createdAt: stamp,
  maskedConfig: {
    api_key: '********test',
    sender: '3000',
    timeout: 15,
    throughput_limit: 100,
    low_credit_threshold: 2000,
    template_mappings: [{ event_key: 'auth.otp', template_id: '42', variables: { code: 'CODE' } }],
  },
};
const smsActive = {
  ...smsDraft,
  ...health,
  id: 'sms-active',
  label: 'پیامک اصلی',
  status: 'active',
  creditCheckedAt: stamp,
  lowCreditBalance: 1234,
  lowCreditAlertActive: true,
};

for (const locale of ['en', 'fa'] as const) {
  test.describe(locale, () => {
    const emailText = (key: string) => providerText(`admin.providers.${key}`, locale);
    const smsText = (key: Parameters<typeof smsProviderText>[0]) => smsProviderText(key, locale);
    test.beforeEach(async ({ page }) => {
      await crmShell(page, locale);
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'Asia/Tehran' } })
      );
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            appTitle: 'Barghsa',
            appTitleFa: 'برقسا',
            supportEmail: 'support@example.test',
            supportPhone: '+982112345678',
            supportMobile: '+989121234567',
            backgroundColor: '#f6f7f4',
            darkBackgroundColor: '#15201c',
            fontFamily: 'vazirmatn',
            borderRadiusRem: 0.75,
            spacingScale: 1,
            numberStyle: 'western',
            slogan: '',
            primaryColor: '#2563eb',
            secondaryColor: '#64748b',
            accentColor: '#f59e0b',
            logoUrl: null,
            faviconUrl: null,
            darkMode: false,
          },
        })
      );
    });

    test(`email cards share recipient and editor ownership across breakpoints (${locale})`, async ({
      page,
    }, info) => {
      let status = 200,
        reads = 0,
        writes = 0,
        changed = false;
      await page.route('**/api/admin/email-providers**', (route) => {
        if (route.request().method() !== 'GET') {
          writes++;
          return route.fulfill({ status: 500, json: {} });
        }
        reads++;
        return route.fulfill({
          status,
          json: [
            emailActive,
            { ...emailDraft, label: changed ? 'ایمیل تغییرکرده' : emailDraft.label },
          ],
        });
      });
      await page.goto('/admin/providers');
      await page.setViewportSize({ width: 390, height: 844 });
      const cards = page.getByRole('list', { name: emailText('title'), exact: true });
      const draft = cards.locator(':scope > li').filter({ hasText: emailDraft.label });
      const active = cards.locator(':scope > li').filter({ hasText: emailActive.label });
      await expect(active).toContainText(emailText('health.paused'));
      await expect(active).toContainText(emailText('health.alertHistory'));
      await expect(
        active.locator('p').filter({ hasText: emailText('health.failureRate') })
      ).toContainText('25');
      await expect(active.locator('time').first()).toHaveAttribute(
        'datetime',
        stamp.replace('Z', '.000Z')
      );
      await expect(active.locator('time').first()).toContainText(
        locale === 'fa' ? '۱۵:۳۰' : '3:30 PM'
      );
      await draft.locator('input[type=email]').fill('staff@example.test');
      if (locale === 'fa' && info.project.name === 'mobile-safari') {
        await draft.screenshot({
          path: '/Users/majid/.local/state/barghsa-manual-batches/delivery-provider-tables/email-card-fa.png',
        });
      }
      await draft.getByRole('button', { name: emailText('update'), exact: true }).click();
      await page.locator('#email-provider-label').fill('Retained draft');
      await page.getByLabel(emailText('field.apiKey'), { exact: false }).fill('synthetic-kept-key');
      await page.setViewportSize({ width: 1100, height: 900 });
      const desktopDraft = page
        .getByRole('row')
        .filter({ has: page.getByRole('rowheader', { name: emailDraft.label, exact: true }) });
      await expect(desktopDraft.locator('input[type=email]')).toHaveValue('staff@example.test');
      await expect(page.locator('#email-provider-label')).toHaveValue('Retained draft');
      await expect(page.locator('form')).toHaveCount(1);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(draft.locator('input[type=email]')).toHaveValue('staff@example.test');
      await expect(page.getByLabel(emailText('field.apiKey'), { exact: false })).toHaveValue(
        'synthetic-kept-key'
      );
      expect(reads).toBe(1);
      status = 503;
      await page.getByRole('button', { name: emailText('refresh'), exact: true }).click();
      await expect(draft.locator('input[type=email]')).toBeDisabled();
      await expect(draft.locator('input[type=email]')).toHaveValue('staff@example.test');
      await expect(page.locator('form button[type=submit]')).toBeDisabled();
      status = 200;
      await page.getByRole('button', { name: emailText('retry'), exact: true }).click();
      await expect(page.locator('form button[type=submit]')).toBeEnabled();
      await page
        .locator('form')
        .getByRole('button', { name: emailText('cancel'), exact: true })
        .click();
      await page.setViewportSize({ width: 800, height: 844 });
      const viewport = page.getByRole('region', { name: emailText('table'), exact: true });
      await viewport.focus();
      await viewport.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
      await expect
        .poll(() => viewport.evaluate((node) => Math.abs(node.scrollLeft)))
        .toBeGreaterThan(0);
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      await page.setViewportSize({ width: 390, height: 844 });
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      changed = true;
      await page.getByRole('button', { name: emailText('refresh'), exact: true }).click();
      await expect(cards.locator('input[type=email]')).toHaveValue('');
      status = 403;
      await page.getByRole('button', { name: emailText('refresh'), exact: true }).click();
      await expect(cards).toHaveCount(0);
      await expect(page.locator('table, input[type=email], #email-provider-label')).toHaveCount(0);
      expect(writes).toBe(0);
    });

    test(`SMS cards preserve mappings and health through responsive recovery (${locale})`, async ({
      page,
    }, info) => {
      let status = 200,
        reads = 0,
        writes = 0;
      await page.route('**/api/admin/email-providers', (route) => route.fulfill({ json: [] }));
      await page.route('**/api/admin/sms-providers/template-event-keys', (route) =>
        route.fulfill({ json: ['auth.otp'] })
      );
      await page.route('**/api/admin/sms-providers', (route) => {
        if (route.request().method() !== 'GET') {
          writes++;
          return route.fulfill({ status: 500, json: {} });
        }
        reads++;
        return route.fulfill({ status, json: [smsActive, smsDraft] });
      });
      await page.goto('/admin/providers');
      await page.getByRole('tab', { name: 'SMS.ir', exact: true }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      const cards = page.getByRole('list', { name: smsText('title'), exact: true });
      const draft = cards.locator(':scope > li').filter({ hasText: smsDraft.label });
      const active = cards.locator(':scope > li').filter({ hasText: smsActive.label });
      await expect(active).toContainText(smsText('creditLow'));
      await expect(active.locator('p').filter({ hasText: smsText('creditBalance') })).toContainText(
        '1,234'
      );
      await expect(active).toContainText(smsText('healthPaused'));
      await expect(active).toContainText(emailText('health.alertHistory'));
      if (locale === 'fa' && info.project.name === 'mobile-safari') {
        await draft.screenshot({
          path: '/Users/majid/.local/state/barghsa-manual-batches/delivery-provider-tables/sms-card-fa.png',
        });
      }
      await draft.getByRole('button', { name: smsText('edit'), exact: true }).click();
      await page.locator('#sms-label').fill('Retained mapping draft');
      await page.locator('#sms-key').fill('synthetic-kept-key');
      await page.locator('form input[list=sms-events]').fill('auth.otp');
      await page.setViewportSize({ width: 1100, height: 900 });
      await expect(page.locator('#sms-label')).toHaveValue('Retained mapping draft');
      await expect(page.locator('#sms-key')).toHaveValue('synthetic-kept-key');
      await expect(page.locator('form input[list=sms-events]')).toHaveValue('auth.otp');
      await expect(page.locator('form')).toHaveCount(1);
      await page.setViewportSize({ width: 390, height: 844 });
      expect(reads).toBe(1);
      status = 503;
      await page.getByRole('button', { name: smsText('refresh'), exact: true }).click();
      await expect(
        draft.getByRole('button', { name: smsText('edit'), exact: true })
      ).toBeDisabled();
      await expect(page.locator('#sms-key')).toHaveValue('synthetic-kept-key');
      status = 200;
      await page.getByRole('button', { name: smsText('retry'), exact: true }).click();
      await expect(page.locator('form button[type=submit]')).toBeEnabled();
      await page
        .locator('form')
        .getByRole('button', { name: smsText('cancel'), exact: true })
        .click();
      await page.setViewportSize({ width: 800, height: 844 });
      const viewport = page.getByRole('region', { name: smsText('table'), exact: true });
      await viewport.focus();
      await viewport.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
      await expect
        .poll(() => viewport.evaluate((node) => Math.abs(node.scrollLeft)))
        .toBeGreaterThan(0);
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      await page.setViewportSize({ width: 390, height: 844 });
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      status = 403;
      await page.getByRole('button', { name: smsText('refresh'), exact: true }).click();
      await expect(cards).toHaveCount(0);
      await expect(page.locator('table, #sms-key, #sms-label')).toHaveCount(0);
      expect(writes).toBe(0);
    });
  });
}
