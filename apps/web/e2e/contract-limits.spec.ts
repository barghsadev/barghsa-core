import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { electricityLimits } from '../src/test/contract-settings-fixtures';
for (const locale of ['en', 'fa'])
  test(`contract limits recover from failures without losing the proposal (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await crmShell(page, locale);
    let failed = true,
      verified = false,
      denied = false;
    const attempts: unknown[] = [];
    await page.route('**/api/admin/config/contract-electricity-limits', (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill(
          denied
            ? { status: 403, json: {} }
            : failed
              ? { status: 503, json: {} }
              : {
                  json: {
                    maxQuantityIncreasePercent: 20,
                    maxContractDuration: 24,
                    leadTimeDays: 0,
                  },
                }
        );
      attempts.push(route.request().postDataJSON());
      if (!verified)
        return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
      denied = true;
      return route.fulfill({ json: { ...electricityLimits, leadTimeDays: 14 } });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = route.request().postDataJSON().password === 'correct';
      return route.fulfill({ status: verified ? 200 : 401, json: {} });
    });
    await page.goto('/admin/contract-limits');
    await expect(page.getByRole('alert')).toBeVisible();
    failed = false;
    await page.getByRole('button', { name: fa ? 'تلاش مجدد' : 'Retry', exact: true }).click();
    const lead = page.getByLabel(fa ? 'حداقل فاصله تا شروع (روز)' : 'Minimum lead time (days)', {
      exact: true,
    });
    await lead.fill('-1');
    await page
      .getByRole('button', { name: fa ? 'ذخیره محدودیت‌ها' : 'Save limits', exact: true })
      .click();
    await expect(lead).toHaveAttribute('aria-invalid', 'true');
    await expect(lead).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await lead.fill('14');
    await page
      .getByRole('button', { name: fa ? 'ذخیره محدودیت‌ها' : 'Save limits', exact: true })
      .click();
    const dialog = page.getByRole('dialog'),
      confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    await confirm.click();
    const password = dialog.locator('input[type="password"]');
    await password.fill('wrong');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await password.fill('correct');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toEqual([
      { max_quantity_increase_percent: 20, max_contract_duration_months: 24, lead_time_days: 14 },
      { max_quantity_increase_percent: 20, max_contract_duration_months: 24, lead_time_days: 14 },
    ]);
    await expect(page.getByRole('alert')).toContainText(
      fa ? 'اجازه مدیریت' : 'permission to manage'
    );
    await expect(
      page.locator('[id^="contract-limit-"] input, input[id^="contract-limit-"]')
    ).toHaveCount(0);
  });
