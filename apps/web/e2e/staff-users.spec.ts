import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { completeOtp, mockOtpStepUp } from './otp-step-up-fixture';
import { approveRiskConfirmation } from './confirmation-fixture';
import { t } from '@barghsa/i18n/admin-ui';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { staffAccess, staffRoles, staffUser } from '../src/test/staff-directory-fixtures';

test.use({ timezoneId: 'America/Los_Angeles' });

for (const locale of ['en', 'fa'] as const) {
  test(`staff permissions, confirmation and step-up failures remain recoverable (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    const fa = locale === 'fa';
    let allowed = true,
      failLoad = true,
      failSave = true;
    const attempts: unknown[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'admin',
          isStaff: true,
          operatingContext: 'staff',
          canSwitchContext: false,
          requiresTosAcceptance: false,
        },
      })
    );
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'America/Los_Angeles' } })
    );
    await page.route('**/api/admin/staff-access', (route) =>
      route.fulfill({
        json: {
          userId: 'admin',
          canView: allowed,
          canCreate: false,
          canEditRoles: allowed,
          canDisable: allowed,
        },
      })
    );
    await page.route('**/api/admin/staff-role-options', (route) =>
      route.fulfill({
        json: [{ roleId: 'role-finance', name: 'Finance', description: 'Manage finances' }],
      })
    );
    await page.route('**/api/admin/staff?*', (route) =>
      failLoad
        ? route.fulfill({ status: 503, json: {} })
        : route.fulfill({
            json: {
              items: [
                {
                  userId: 'target',
                  username: 'target@example.test',
                  firstName: 'Target',
                  lastName: 'Staff',
                  roles: [],
                  status: 'active',
                  isAdmin: false,
                  lastLoginAt: null,
                },
              ],
              total: 1,
            },
          })
    );
    const auth = await mockOtpStepUp(page);
    await page.route('**/api/admin/users/target/roles', (route) => {
      attempts.push(route.request().postDataJSON());
      if (!auth.verified)
        return route.fulfill({
          status: 403,
          json: { error: 'AUTHZ:STEP_UP_REQUIRED', requiresOtp: true },
        });
      if (failSave) return route.fulfill({ status: 503, json: {} });
      allowed = false;
      return route.fulfill({
        json: { userId: 'target', roleIds: ['role-finance'], previousRoleIds: [] },
      });
    });
    await page.goto('/admin/users');
    await expect(page.getByRole('alert')).toBeVisible();
    failLoad = false;
    await page.getByRole('button', { name: fa ? 'تلاش مجدد' : 'Retry', exact: true }).click();
    await expect(
      page.getByRole('button', {
        name: fa ? 'ایجاد حساب کارمند' : 'Create staff user',
        exact: true,
      })
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: fa ? 'ویرایش نقش‌ها' : 'Edit roles', exact: true })
      .click();
    await page.locator('form summary').click();
    await page.getByRole('checkbox', { name: fa ? /مالی/ : /Finance/ }).check();
    for (const dark of [false, true]) {
      await page.evaluate(async (value) => {
        document.documentElement.classList.toggle('dark', value);
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
            .map((animation) => animation.finished.catch(() => {}))
        );
      }, dark);
      const report = await new AxeBuilder({ page })
        .include('main[data-area=admin] section')
        .analyze();
      expect(report.violations, `staff list and role editor accessibility, dark=${dark}`).toEqual(
        []
      );
    }
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.locator('#staff-role-reason').fill('New duties');
    await page
      .getByRole('button', { name: fa ? 'ذخیره نقش‌ها' : 'Save roles', exact: true })
      .click();
    const dialog = page.getByRole('dialog'),
      word = (key: string) => t(`admin.stepUp.${key}`, locale);
    expect(attempts).toHaveLength(0);
    const send = dialog.getByRole('button', { name: word('send'), exact: true });
    await expect(send).toBeDisabled();
    await approveRiskConfirmation(page, locale, 'destructive');
    await send.click();
    const code = dialog.getByLabel(word('code'), { exact: true });
    await code.fill('111111');
    await dialog.getByRole('button', { name: word('verify'), exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(attempts).toHaveLength(0);
    await code.fill('123456');
    await dialog.getByRole('button', { name: word('verify'), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole('alert').filter({ hasText: confirmationText('unconfirmed', locale) })
    ).toBeVisible();
    expect(attempts).toHaveLength(1);
    failSave = false;
    const save = page.getByRole('button', {
      name: t('admin.staff.saveRoles', locale),
      exact: true,
    });
    await expect(save).toBeDisabled();
    await page.getByRole('button', { name: t('admin.staff.refresh', locale), exact: true }).click();
    await expect(save).toBeEnabled();
    await expect(page.locator('#staff-role-reason')).toHaveValue('New duties');
    expect(attempts).toHaveLength(1);
    await save.click();
    await approveRiskConfirmation(page, locale, 'destructive');
    await completeOtp(dialog, locale);
    await expect(dialog).toHaveCount(0);
    expect(attempts).toEqual(Array(2).fill({ roleIds: ['role-finance'], reason: 'New duties' }));
    await expect(page.locator('table:visible, ol[role=list]:visible')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: fa ? 'ویرایش نقش‌ها' : 'Edit roles', exact: true })
    ).toHaveCount(0);
  });
}

for (const locale of ['en', 'fa'] as const) {
  test(`permission history filters full calendar days and preserves retry (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    const fa = locale === 'fa',
      target = '10000000-0000-4000-8000-000000000003';
    let fail = true;
    let failTimezone = true;
    let historyDenied = false;
    let historyEmpty = false;
    let holdAccess = false;
    let heldAccess = false;
    const queries: URLSearchParams[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'admin',
          isStaff: true,
          operatingContext: 'staff',
          canSwitchContext: false,
          requiresTosAcceptance: false,
        },
      })
    );
    await page.route('**/api/user/settings/timezone', (route) =>
      failTimezone
        ? route.fulfill(fa ? { json: { timezone: 'invalid-zone' } } : { status: 503, json: {} })
        : route.fulfill({ json: { timezone: 'Asia/Tehran' } })
    );
    await page.route('**/api/admin/staff-access', (route) => {
      if (holdAccess) {
        heldAccess = true;
        return;
      }
      return route.fulfill({
        json: {
          userId: 'viewer',
          canView: true,
          canCreate: false,
          canEditRoles: false,
          canDisable: false,
        },
      });
    });
    await page.route('**/api/admin/staff?*', (route) =>
      route.fulfill({
        json: {
          items: [
            {
              userId: target,
              username: 'history@example.test',
              firstName: 'History',
              lastName: 'User',
              roles: [],
              status: 'active',
              isAdmin: false,
              lastLoginAt: null,
            },
          ],
          total: 1,
        },
      })
    );
    await page.route('**/api/admin/staff/audit?*', (route) => {
      const query = new URL(route.request().url()).searchParams;
      queries.push(query);
      if (historyDenied) return route.fulfill({ status: 403, json: {} });
      if (fail) return route.fulfill({ status: 503, json: {} });
      if (historyEmpty) return route.fulfill({ json: { items: [], total: 0 } });
      return route.fulfill({
        json: {
          items: [
            {
              id: query.get('offset') || '0',
              targetUserId: target,
              targetUsername: 'history@example.test',
              actorUserId: 'admin',
              actorUsername: 'actor@example.test',
              addedRoles: [{ roleId: 'role-finance', roleName: 'Finance' }],
              removedRoles: [{ roleId: 'role-customer-support', roleName: 'Customer Support' }],
              reason: 'New duties',
              createdAt: '2026-03-21T12:00:00Z',
            },
          ],
          total: 26,
        },
      });
    });
    await page.goto('/admin/users');
    await page
      .locator('table:visible tbody tr, ol[role=list]:visible > li')
      .filter({ hasText: 'history@example.test' })
      .getByRole('button', { name: fa ? 'تاریخچه مجوزها' : 'Permission history', exact: true })
      .click();
    const history = page.getByRole('region', {
      name: fa ? 'تاریخچه مجوزها' : 'Permission history',
      exact: true,
    });
    // Load timezone Date subclasses before Playwright replaces Date.prototype.
    await page.clock.setFixedTime(new Date('2026-03-21T12:00:00Z'));
    await expect(history.getByRole('alert')).toBeVisible();
    await expect(page.locator('#staff-audit-from')).toBeDisabled();
    failTimezone = false;
    fail = false;
    await history.getByRole('button', { name: fa ? 'تلاش مجدد' : 'Retry', exact: true }).click();
    await expect(history).toContainText('New duties');
    expect(queries.at(-1)?.get('userId')).toBe(target);
    await expect(history).toContainText(
      fa ? 'نقش‌های حذف‌شده: پشتیبانی مشتریان' : 'Roles removed: Customer Support'
    );
    await expect(history).toContainText(fa ? 'نقش‌های افزوده: مالی' : 'Roles added: Finance');
    await expect(history).toContainText('actor@example.test');
    await expect(history.locator('time')).toHaveAttribute('datetime', '2026-03-21T12:00:00Z');
    for (const dark of [false, true]) {
      await page.evaluate(async (value) => {
        document.documentElement.classList.toggle('dark', value);
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
            .map((animation) => animation.finished.catch(() => {}))
        );
      }, dark);
      const report = await new AxeBuilder({ page })
        .include('section[aria-label="' + (fa ? 'تاریخچه مجوزها' : 'Permission history') + '"]')
        .analyze();
      expect(report.violations, `permission history accessibility, dark=${dark}`).toEqual([]);
    }
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await history.getByRole('button', { name: fa ? 'بعدی' : 'Next', exact: true }).click();
    await expect.poll(() => queries.at(-1)?.get('offset')).toBe('25');
    await page.locator('#staff-audit-from').click();
    const calendar = page.locator('[data-slot="calendar"]');
    await expect(
      calendar.getByRole('button', { name: fa ? 'رفتن به ماه بعد' : 'Go to the Next Month' })
    ).toBeVisible();
    await expect(
      calendar.getByRole('button', { name: fa ? 'رفتن به ماه قبل' : 'Go to the Previous Month' })
    ).toBeVisible();
    await expect(calendar.locator('.rdp-today button')).toHaveAccessibleName(
      fa ? /^امروز،.*فروردین.*۱۴۰۵/ : /^Today,.*March.*2026/
    );
    await page.locator('[data-slot="calendar"] .rdp-today button').click();
    await expect(page.locator('[data-slot="calendar"]')).toHaveCount(0);
    await page.locator('#staff-audit-to').click();
    await page.locator('[data-slot="calendar"] .rdp-today button').click();
    await expect(page.locator('[data-slot="calendar"]')).toHaveCount(0);
    await history
      .getByRole('button', { name: fa ? 'اعمال فیلتر' : 'Apply filters', exact: true })
      .click();
    await expect.poll(() => queries.at(-1)?.get('from')).not.toBeNull();
    const expected = { from: '2026-03-20T20:30:00.000Z', to: '2026-03-21T20:29:59.999Z' };
    await expect(history).toContainText('Asia/Tehran');
    expect(queries.at(-1)?.get('from')).toBe(expected.from);
    expect(queries.at(-1)?.get('to')).toBe(expected.to);
    expect(queries.at(-1)?.get('offset')).toBe('0');
    await page.locator('#staff-audit-from').click();
    await expect(calendar.locator('.rdp-today button')).toHaveAccessibleName(
      fa ? /انتخاب شده$/ : /selected$/
    );
    await page.locator('[data-slot="calendar"] .rdp-today button').press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-slot="calendar"]')).toHaveCount(0);
    await expect(
      history.getByRole('button', { name: fa ? 'اعمال فیلتر' : 'Apply filters', exact: true })
    ).toBeDisabled();
    await expect(history.getByRole('alert')).toBeVisible();
    await history
      .getByRole('button', { name: fa ? 'پاک کردن تاریخ‌ها' : 'Clear dates', exact: true })
      .click();
    await expect.poll(() => queries.at(-1)?.get('from')).toBeNull();
    await expect.poll(() => queries.at(-1)?.get('to')).toBeNull();
    historyEmpty = true;
    await history.getByRole('button', { name: fa ? 'بعدی' : 'Next', exact: true }).click();
    await expect(history.getByRole('status')).toHaveText(t('admin.staff.audit.empty', locale));
    holdAccess = true;
    await page.getByRole('button', { name: t('admin.staff.refresh', locale), exact: true }).click();
    await expect.poll(() => heldAccess).toBe(true);
    const abortedAccess = page.waitForEvent('requestfailed', {
      predicate: (request) => new URL(request.url()).pathname === '/api/admin/staff-access',
    });
    historyDenied = true;
    await history.getByRole('button', { name: fa ? 'قبلی' : 'Previous', exact: true }).click();
    await abortedAccess;
    await expect(history).toHaveCount(0);
    await expect(page.getByText('history@example.test', { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('alert').filter({ hasText: t('admin.staff.forbidden', locale) })
    ).toHaveCount(1);
  });
}

for (const locale of ['en', 'fa'] as const) {
  test(`activation resend respects server cooldown and retains its target (${locale})`, async ({
    page,
  }) => {
    await page.clock.install();
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    const fa = locale === 'fa';
    let attempts = 0;
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'admin',
          isStaff: true,
          operatingContext: 'staff',
          canSwitchContext: false,
          requiresTosAcceptance: false,
        },
      })
    );
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'America/Los_Angeles' } })
    );
    await page.route('**/api/admin/staff-access', (route) =>
      route.fulfill({
        json: {
          userId: 'creator',
          canView: true,
          canCreate: true,
          canEditRoles: false,
          canDisable: false,
        },
      })
    );
    await page.route('**/api/admin/staff-role-options', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/admin/staff?*', (route) =>
      route.fulfill({
        json: {
          items: [
            {
              userId: 'pending',
              username: 'pending@example.test',
              firstName: 'Pending',
              lastName: 'Staff',
              roles: [],
              status: 'active',
              isAdmin: false,
              lastLoginAt: null,
              activationPending: true,
              activationExpiresAt: '2026-01-01T00:00:00Z',
            },
          ],
          total: 1,
        },
      })
    );
    await page.route('**/api/admin/users/pending/resend-activation', (route) => {
      attempts++;
      return attempts === 1
        ? route.fulfill({
            status: 429,
            headers: { 'retry-after': '3' },
            json: { error: 'AUTH:OTP:RATE_LIMITED' },
          })
        : route.fulfill({ json: attempts === 2 ? { ok: true } : { deliveryStatus: 'queued' } });
    });
    await page.goto('/admin/users');
    await page
      .getByRole('button', {
        name: fa ? 'ارسال دوباره فعال‌سازی' : 'Resend activation',
        exact: true,
      })
      .click();
    const dialog = page.getByRole('dialog'),
      confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    await confirm.click();
    await expect(confirm).toBeDisabled();
    await expect(dialog.getByRole('status')).toContainText(fa ? 'ثانیه' : 'seconds');
    expect(attempts).toBe(1);
    await page.clock.fastForward(3100);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toBe(2);
    const queued = page.getByText(t('admin.staff.linkQueued', locale), { exact: true });
    const resend = page.getByRole('button', {
      name: t('admin.staff.resendActivation', locale),
      exact: true,
    });
    await expect(queued).toHaveCount(0);
    await expect(resend).toBeDisabled();
    await page.getByRole('button', { name: t('admin.staff.refresh', locale), exact: true }).click();
    await expect(resend).toBeEnabled();
    expect(attempts).toBe(2);
    await resend.click();
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toBe(3);
    await expect(
      page.getByText(
        fa
          ? 'ایمیل فعال‌سازی در صف ارسال قرار گرفت.'
          : 'The activation email is queued for delivery.',
        { exact: true }
      )
    ).toBeVisible();
  });

  test(`a committed staff disable with a lost reply requires fresh authority and directory (${locale})`, async ({
    page,
  }) => {
    await setupCatalogueForms(page, locale, locale === 'fa');
    await page.clock.install();
    const text = (key: string) => t(`admin.staff.${key}`, locale);
    let disabled = false;
    let writes = 0;
    let accessReads = 0;
    await page.route('**/api/admin/staff-access', (route) => {
      accessReads++;
      return route.fulfill({ json: staffAccess });
    });
    await page.route('**/api/admin/staff-role-options', (route) =>
      route.fulfill({ json: staffRoles })
    );
    await page.route('**/api/admin/staff?*', (route) =>
      route.fulfill({
        json: { items: [{ ...staffUser, status: disabled ? 'disabled' : 'active' }], total: 1 },
      })
    );
    await page.route(`**/api/admin/staff/${staffUser.userId}/disable`, (route) => {
      expect(route.request().method()).toBe('POST');
      writes++;
      disabled = true;
    });
    await page.goto('/admin/users');
    const disable = page.getByRole('button', { name: text('disable'), exact: true });
    const refresh = page.getByRole('button', { name: text('refresh'), exact: true });
    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', {
      name: confirmationText('confirm', locale),
      exact: true,
    });
    await disable.click();
    await expect(confirm).toBeDisabled();
    await approveRiskConfirmation(page, locale, 'destructive');
    await confirm.click();
    await expect.poll(() => writes).toBe(1);
    const initialAccessReads = accessReads;
    await page.clock.fastForward(15_001);
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole('alert').filter({ hasText: confirmationText('unconfirmed', locale) })
    ).toBeVisible();
    await expect(disable).toBeDisabled();
    await expect(page.getByText(text('saved'), { exact: true })).toHaveCount(0);
    expect(accessReads).toBe(initialAccessReads);
    await refresh.click();
    await expect(disable).toHaveCount(0);
    await expect(
      page.getByText(text('disabled'), { exact: true }).and(page.locator(':visible'))
    ).toBeVisible();
    expect(accessReads).toBe(initialAccessReads + 1);
    expect(writes).toBe(1);
  });
}
