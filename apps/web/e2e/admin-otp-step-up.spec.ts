import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { mockOtpStepUp } from './otp-step-up-fixture';
import { t } from '@barghsa/i18n/admin-ui';
import { tWalletReceipts } from '@barghsa/i18n/wallet-receipts';
import { providerText, smsProviderText } from '@barghsa/i18n/providers';
import { staffAccess, staffRoles, staffUser } from '../src/test/staff-directory-fixtures';
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
    template_mappings: [{ event_key: 'otp:login', template_id: '42', variables: { code: 'CODE' } }],
  },
};
for (const locale of ['en', 'fa'] as const)
  for (const theme of ['light', 'dark'] as const)
    for (const action of ['email', 'sms', 'threshold', 'roles'] as const) {
      test(`sensitive action waits for valid OTP (${action}, ${locale}, ${theme})`, async ({
        page,
      }, info) => {
        await crmShell(page, locale);
        await page.route('**/api/public/branding/config', (route) =>
          route.fulfill({
            json: {
              appTitle: 'Barghsa',
              appTitleFa: 'برق‌آسا',
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
        const auth = await mockOtpStepUp(page, true),
          attempts: unknown[] = [],
          writes: unknown[] = [];
        const mutate = async (route: import('./coverage-fixture').Route, receipt: unknown) => {
          const body = route.request().postDataJSON();
          attempts.push(body);
          if (!auth.verified)
            return route.fulfill({
              status: 403,
              json: { error: { code: 'AUTHZ:STEP_UP_REQUIRED' }, requiresOtp: true },
            });
          expect(route.request().headers()['x-csrf-token']).toBe('rotated-otp-proof');
          writes.push(body);
          return route.fulfill({ json: receipt });
        };
        if (action === 'email' || action === 'sms') {
          await page.route('**/api/admin/email-providers', (route) =>
            route.fulfill({ json: [email] })
          );
          await page.route('**/api/admin/sms-providers', (route) => route.fulfill({ json: [sms] }));
          await page.route('**/api/admin/sms-providers/template-event-keys', (route) =>
            route.fulfill({ json: ['otp:login'] })
          );
          await page.route(`**/api/admin/${action}-providers/${action}`, (route) =>
            mutate(route, { ...(action === 'email' ? email : sms), label: 'Reviewed change' })
          );
          await page.goto('/admin/providers');
          if (action === 'email') {
            await page
              .getByRole('listitem')
              .filter({ hasText: 'Saved provider' })
              .getByRole('button', {
                name: providerText('admin.providers.update', locale),
                exact: true,
              })
              .click();
            await page.locator('#email-provider-label').fill('Reviewed change');
          } else {
            await page.getByRole('tab', { name: 'SMS.ir', exact: true }).click();
            await page
              .getByRole('button', { name: smsProviderText('edit', locale), exact: true })
              .click();
            await page.locator('#sms-label').fill('Reviewed change');
          }
          await page.locator('form button[type=submit]').click();
        } else if (action === 'threshold') {
          await page.route('**/api/admin/approval-requests?*', (route) =>
            route.fulfill({ json: [] })
          );
          await page.route('**/api/admin/config/dual-approval-threshold', (route) =>
            route.request().method() === 'GET'
              ? route.fulfill({ json: { thresholdIrR: 100000 } })
              : mutate(route, { thresholdIrR: 250000 })
          );
          await page.goto('/admin/approval-requests');
          await page.locator('#receipt-threshold').fill('250000');
          await page
            .getByRole('button', {
              name: tWalletReceipts('admin.receiptThreshold.save', locale),
              exact: true,
            })
            .click();
        } else {
          await page.route('**/api/admin/staff-access', (route) =>
            route.fulfill({ json: staffAccess })
          );
          await page.route('**/api/admin/staff-role-options', (route) =>
            route.fulfill({ json: staffRoles })
          );
          await page.route('**/api/admin/staff?*', (route) =>
            route.fulfill({ json: { items: [staffUser], total: 1 } })
          );
          await page.route(`**/api/admin/users/${staffUser.userId}/roles`, (route) =>
            mutate(route, {
              userId: staffUser.userId,
              roleIds: ['role-finance'],
              previousRoleIds: ['role-finance'],
            })
          );
          await page.goto('/admin/users');
          await page
            .getByRole('button', { name: t('admin.staff.editRoles', locale), exact: true })
            .click();
          await page.locator('#staff-role-reason').fill('Reviewed finance duties');
          await page
            .getByRole('button', { name: t('admin.staff.saveRoles', locale), exact: true })
            .click();
        }
        await expect(page.locator('html')).toHaveClass(
          theme === 'dark' ? /dark/ : /^(?!.*dark).*$/
        );
        const dialog = page.getByRole('dialog'),
          word = (key: string) => t(`admin.stepUp.${key}`, locale);
        await expect(dialog).toContainText(word('required'));
        expect(writes).toEqual([]);
        await dialog.getByRole('button', { name: word('send'), exact: true }).click();
        const code = dialog.getByLabel(word('code'), { exact: true });
        await expect(code).toBeFocused();
        await code.fill(locale === 'fa' ? '۱۲۳۴۵۶' : '123456');
        await expect(code).toHaveValue('123456');
        expect(
          (await new AxeBuilder({ page }).include('[role=dialog]').analyze()).violations
        ).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        );
        if (locale === 'fa' && info.project.name === 'mobile-safari' && action === 'threshold')
          await dialog.screenshot({ path: `/tmp/barghsa-otp-step-up-${theme}.png` });
        await code.press('Enter');
        await expect(dialog.getByRole('alert')).toContainText(word('invalid'));
        expect(writes).toEqual([]);
        await code.fill('123456');
        await code.press('Enter');
        await expect(dialog).toHaveCount(0);
        expect(writes).toHaveLength(1);
        if (action === 'email' || action === 'sms') expect(attempts[0]).toEqual(attempts[1]);
      });
    }
