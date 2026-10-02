import { test, expect } from './coverage-fixture';
import { fullNavigation } from './navigation-fixture';
import { dismissMessages } from './dismiss-messages';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'retention-staff',
        isStaff: true,
        requiresTosAcceptance: false,
        permissions: ['admin:catalogue:edit'],
        navigation: fullNavigation('staff'),
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/admin/config/wizard-draft-ttl', (route) =>
    route.fulfill({ json: { days: 7 } })
  );
  await page.route('**/api/admin/config/electricity-contract-template', (route) =>
    route.fulfill({ json: { selectedVersionId: null, options: [] } })
  );
});
for (const locale of ['en', 'fa'])
  test(`green rule editor recovers from unavailable config and step-up (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      localStorage.setItem('barghsa.locale', value);
      if (document.documentElement) document.documentElement.lang = value;
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    let failed = true,
      verified = false,
      denied = false;
    const attempts: unknown[] = [];
    const config = {
      simpleOrder: {
        mandatoryGreenEnabled: true,
        averagePowerThresholdKw: 1000,
        mandatoryGreenSharePercent: 4,
      },
      advancedOrder: {
        mandatoryGreenEnabled: false,
        averagePowerThresholdKw: 1000,
        mandatoryGreenSharePercent: 4,
      },
    };
    await page.route('**/api/admin/config/green-electricity-rules', (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill(
          denied
            ? { status: 403, json: {} }
            : failed
              ? { status: 503, json: { error: 'CONFIG:STORED_VALUE_INVALID' } }
              : { json: config }
        );
      attempts.push(route.request().postDataJSON());
      if (!verified)
        return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
      denied = true;
      return route.fulfill({ json: config });
    });
    await page.route('**/api/admin/config/green-electricity-rules/safety-status', (route) =>
      route.fulfill({
        json: {
          simpleOrder: { blocked: false, reasons: [] },
          advancedOrder: { blocked: false, reasons: [] },
        },
      })
    );
    await page.route('**/api/auth/step-up', (route) => {
      verified = route.request().postDataJSON().password === 'correct';
      return route.fulfill({ status: verified ? 200 : 401, json: {} });
    });
    await page.goto('/admin/electricity-rules');
    await expect(page.getByRole('alert')).toBeVisible();
    failed = false;
    await dismissMessages(page, locale as 'en' | 'fa');
    await page.getByRole('button', { name: fa ? 'تلاش مجدد' : 'Retry', exact: true }).click();
    const simple = page.getByRole('group', {
      name: fa ? 'سفارش ساده' : 'Simple orders',
      exact: true,
    });
    await simple.getByRole('spinbutton').fill('1750');
    await page
      .getByRole('button', { name: fa ? 'ذخیره قواعد' : 'Save rules', exact: true })
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
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(attempts[1]);
    expect(attempts[0]).toMatchObject({ simpleOrder: { averagePowerThresholdKw: 1750 } });
    await expect(page.getByRole('alert')).toContainText(
      fa ? 'اجازه مدیریت' : 'permission to manage'
    );
    await expect(simple).toHaveCount(0);
    await expect(page.locator('#electricity-draft-ttl')).toHaveCount(0);
  });

for (const locale of ['en', 'fa'] as const) {
  test(`wizard retention covers all forms and recovers a failed save (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      localStorage.setItem('barghsa.locale', value);
      localStorage.setItem('barghsa.theme', value === 'fa' ? 'dark' : 'light');
    }, locale);
    let days = 7,
      fail = true;
    const writes: unknown[] = [];
    await page.route('**/api/admin/config/green-electricity-rules', (route) =>
      route.fulfill({
        json: {
          simpleOrder: {
            mandatoryGreenEnabled: false,
            averagePowerThresholdKw: 1000,
            mandatoryGreenSharePercent: 4,
          },
          advancedOrder: {
            mandatoryGreenEnabled: false,
            averagePowerThresholdKw: 1000,
            mandatoryGreenSharePercent: 4,
          },
        },
      })
    );
    await page.route('**/api/admin/config/green-electricity-rules/safety-status', (route) =>
      route.fulfill({
        json: {
          simpleOrder: { blocked: false, reasons: [] },
          advancedOrder: { blocked: false, reasons: [] },
        },
      })
    );
    await page.route('**/api/admin/config/wizard-draft-ttl', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { days } });
      writes.push(route.request().postDataJSON());
      if (fail) return route.fulfill({ status: 503, json: {} });
      days = route.request().postDataJSON().days;
      return route.fulfill({ json: { days } });
    });
    await page.goto('/admin/electricity-rules');
    await dismissMessages(page, locale);
    const ttl = page.locator('#electricity-draft-ttl');
    await expect(ttl).toHaveValue('7');
    await expect(
      page.getByRole('heading', {
        name: fa ? 'مدت نگهداری پیش‌نویس فرم‌ها' : 'Customer form draft retention',
        exact: true,
      })
    ).toBeVisible();
    await expect(page.locator('#admin-content')).toContainText(
      fa ? 'درخواست خورشیدی' : 'Profile setup, electricity, saving and solar drafts'
    );
    await ttl.fill('14');
    await page
      .getByRole('button', {
        name: fa ? 'ذخیره مدت نگهداری' : 'Save retention period',
        exact: true,
      })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(fa ? 'همه فرم‌های مشتری' : 'all customer form drafts');
    const confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(days).toBe(7);
    fail = false;
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(ttl).toHaveValue('14');
    expect(writes).toEqual([{ days: 14 }, { days: 14 }]);
    await page.reload();
    await dismissMessages(page, locale);
    await expect(ttl).toHaveValue('14');
    await expect(page.locator('html')).toHaveAttribute('dir', fa ? 'rtl' : 'ltr');
    const accessibility = await new AxeBuilder({ page }).include('#admin-content').analyze();
    expect(accessibility.violations).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
  });
}
