import AxeBuilder from '@axe-core/playwright';
import { ErrorCodes } from '@barghsa/shared/errors';
import { t } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';

const first = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const base = '/api/admin/approval-requests';
function request(id = first) {
  return {
    id,
    actionType: 'bank_payment_confirmation',
    amountIrR: '250000',
    initiatorId: 'finance-1',
    initiatorUsername: 'Finance',
    reason: 'Bank evidence reviewed',
    status: 'pending',
    reviewerId: null,
    reviewerUsername: null,
    reviewReason: null,
    details: { entityType: 'wallet_bank_receipt' },
  };
}
async function shell(page: Page, locale: 'en' | 'fa', darkMode: boolean) {
  await crmShell(page, locale);
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
      json: {
        appTitle: 'Finance',
        appTitleFa: 'امور مالی',
        slogan: '',
        supportEmail: 'support@example.test',
        supportPhone: '+982112345678',
        supportMobile: '+989121234567',
        backgroundColor: '#f6f7f4',
        darkBackgroundColor: '#15201c',
        fontFamily: 'vazirmatn',
        borderRadiusRem: 0.75,
        spacingScale: 1,
        numberStyle: 'locale',
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        logoUrl: null,
        faviconUrl: null,
        darkMode,
      },
    })
  );
  await page.route('**/api/admin/config/dual-approval-threshold', (route) =>
    route.fulfill({ json: { thresholdIrR: 100000, version: 0 } })
  );
}
for (const linked of [false, true]) {
  for (const locale of ['en', 'fa'] as const) {
    for (const darkMode of [false, true]) {
      test(`approval ${linked ? 'handoff' : 'queue'} rejection retains captured reasons through correction and retries (${locale}, ${darkMode ? 'dark' : 'light'})`, async ({
        page,
      }) => {
        await shell(page, locale, darkMode);
        let resolved = false;
        await page.route(/\/api\/admin\/approval-requests\?/, (route) =>
          route.fulfill({
            json: [resolved ? { ...request(), status: 'rejected' } : request(), request(second)],
          })
        );
        await page.route(`**${base}/${first}`, (route) =>
          route.fulfill({ json: resolved ? { ...request(), status: 'rejected' } : request() })
        );
        let verified = false;
        let verifications = 0;
        await page.route('**/api/auth/step-up', (route) => {
          verifications++;
          if (verifications === 1) return route.fulfill({ status: 401, json: {} });
          verified = true;
          return route.fulfill({ json: { verified: true } });
        });
        let mode: 'owned' | 'mixed' | 'service' | 'mismatch' | 'success' = 'owned';
        const writes: unknown[] = [];
        await page.route(`**${base}/${first}/reject`, (route) => {
          writes.push(route.request().postDataJSON());
          if (!verified)
            return route.fulfill({
              status: 403,
              json: { error: { code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code } },
            });
          if (mode === 'owned' || mode === 'mixed')
            return route.fulfill({
              status: 400,
              json: {
                error: {
                  code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
                  fields: mode === 'owned' ? ['reason'] : ['reason', 'reviewerId'],
                },
                message: 'private-approval-diagnostic',
              },
            });
          if (mode === 'service')
            return route.fulfill({ status: 503, json: { message: 'private-approval-diagnostic' } });
          if (mode === 'mismatch')
            return route.fulfill({ json: { ...request(second), status: 'rejected' } });
          resolved = true;
          return route.fulfill({
            json: { ...request(), status: 'rejected', reviewReason: 'Evidence mismatch' },
          });
        });
        await page.goto(`/admin/approval-requests${linked ? `?requestId=${first}` : ''}`);
        await expect(page.locator('html')).toHaveClass(darkMode ? /dark/ : /^(?!.*\bdark\b)/);
        const region = page.getByRole('region', {
          name: t('admin.approvals.title', locale),
          exact: true,
          includeHidden: true,
        });
        const field = page.locator(`#reason-${first}`);
        const companion = page.locator(`#reason-${second}`);
        const form = page.locator('form').filter({ has: field });
        const reject = form.getByRole('button', {
          name: t('admin.approvals.reject', locale),
          exact: true,
          includeHidden: true,
        });
        await expect(reject).toBeEnabled();
        if (!linked) await companion.fill('Retain companion investigation');
        await reject.click();
        await expect(field).toBeFocused();
        await expect(field).toHaveAttribute('aria-invalid', 'true');
        await expect(region.getByRole('alert')).toHaveText(
          t('admin.approvals.invalidReason', locale)
        );
        expect(writes).toEqual([]);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        const raw = '  Evidence mismatch  ';
        await field.fill(raw);
        await expect(field).not.toHaveAttribute('aria-invalid', 'true');
        await reject.evaluate((node: HTMLButtonElement) => {
          node.click();
          node.click();
        });
        const dialog = page.getByRole('dialog');
        await expect(dialog).toContainText(first);
        await expect(dialog).toContainText(raw.trim());
        await expect(field).toBeDisabled();
        await expect(reject).toHaveAttribute('aria-busy', 'true');
        if (!linked) await expect(companion).toBeDisabled();
        const confirm = () =>
          dialog.getByRole('button', { name: appText('team.confirm', locale), exact: true });
        await confirm().evaluate((node: HTMLButtonElement) => {
          node.click();
          node.click();
        });
        await expect.poll(() => writes.length).toBe(1);
        const password = dialog.getByLabel(appText('team.password', locale));
        await password.fill('Test-password-123!');
        await confirm().click();
        await expect(dialog.getByRole('alert')).toHaveText(appText('team.passwordError', locale));
        expect(writes).toHaveLength(1);
        await password.fill('Test-password-123!');
        await confirm().click();
        await expect(dialog).toHaveCount(0);
        await expect(field).toBeFocused();
        await expect(field).toBeEnabled();
        await expect(field).toHaveValue(raw);
        if (!linked) await expect(companion).toHaveValue('Retain companion investigation');
        await expect(region.getByRole('alert')).toHaveText(
          t('admin.approvals.invalidReason', locale)
        );
        expect(await region.getByRole('alert').getAttribute('id')).toBe(
          await field.getAttribute('aria-describedby')
        );
        await expect(region).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
        expect(
          (
            await new AxeBuilder({ page })
              .include('[aria-labelledby="approval-requests-title"]')
              .analyze()
          ).violations
        ).toEqual([]);
        const bounds = await field.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
        if (
          !linked &&
          locale === 'fa' &&
          darkMode &&
          test.info().project.name === 'mobile-safari'
        ) {
          await field.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: '/tmp/barghsa-approval-rejection-validation-fa-dark-mobile.png',
          });
        }
        mode = 'mixed';
        await reject.click();
        await expect(dialog).toBeVisible();
        await confirm().click();
        await expect(dialog.getByRole('alert')).toHaveText(appText('team.error', locale));
        await expect(field).toHaveValue(raw);
        await expect(page.getByText('private-approval-diagnostic')).toHaveCount(0);
        mode = 'service';
        await confirm().click();
        await expect.poll(() => writes.length).toBe(4);
        await expect(confirm()).toBeEnabled();
        await expect(dialog).toContainText(raw.trim());
        mode = 'mismatch';
        await confirm().click();
        await expect.poll(() => writes.length).toBe(5);
        await expect(confirm()).toBeEnabled();
        await expect(dialog).toBeVisible();
        await expect(field).toHaveValue(raw);
        mode = 'success';
        await confirm().click();
        await expect(dialog).toHaveCount(0);
        await expect(field).toHaveCount(0);
        await expect(
          region.getByRole('status').filter({ hasText: t('admin.approvals.saved', locale) })
        ).toBeVisible();
        if (!linked) await expect(companion).toHaveValue('Retain companion investigation');
        expect(writes).toEqual(Array.from({ length: 6 }, () => ({ reason: raw.trim() })));
        expect(verifications).toBe(2);
      });
    }
  }
  for (const status of [401, 403]) {
    test(`approval ${linked ? 'handoff' : 'queue'} denial ${status} clears private drafts before recovery`, async ({
      page,
    }) => {
      await shell(page, 'en', false);
      await page.route(/\/api\/admin\/approval-requests\?/, (route) =>
        route.fulfill({ json: [request(), request(second)] })
      );
      await page.route(`**${base}/${first}`, (route) => route.fulfill({ json: request() }));
      let writes = 0;
      await page.route(`**${base}/${first}/reject`, (route) => {
        writes++;
        return route.fulfill({
          status,
          json: { error: { code: ErrorCodes.AUTHZ_FORBIDDEN.code } },
        });
      });
      await page.goto(`/admin/approval-requests${linked ? `?requestId=${first}` : ''}`);
      const field = page.locator(`#reason-${first}`);
      const region = page.getByRole('region', { name: 'Financial approvals', exact: true });
      await field.fill('Private reason');
      if (!linked) await page.locator(`#reason-${second}`).fill('Private companion');
      await region.getByRole('button', { name: 'Reject', exact: true }).first().click();
      await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(field).toHaveCount(0);
      await expect(page.getByText('Private reason')).toHaveCount(0);
      await expect(region.getByRole('alert')).toContainText(
        t('admin.approvals.loadForbidden', 'en')
      );
      await region.getByRole('button', { name: 'Refresh', exact: true }).click();
      await expect(field).toHaveValue('');
      if (!linked) await expect(page.locator(`#reason-${second}`)).toHaveValue('');
      expect(writes).toBe(1);
    });
  }
}
