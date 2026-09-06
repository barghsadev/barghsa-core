import { test, expect } from '@playwright/test';

for (const locale of ['en', 'fa'] as const) {
  test(`staff permissions, confirmation and step-up failures remain recoverable (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    const fa = locale === 'fa';
    let allowed = true,
      failLoad = true,
      verified = false,
      failSave = true;
    const attempts: unknown[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
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
    await page.route('**/api/admin/roles', (route) =>
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
    await page.route('**/api/admin/users/target/roles', (route) => {
      attempts.push(route.request().postDataJSON());
      if (!verified)
        return route.fulfill({
          status: 403,
          json: { error: 'AUTHZ:STEP_UP:REQUIRED', requiresStepUp: true },
        });
      if (failSave) return route.fulfill({ status: 503, json: {} });
      allowed = false;
      return route.fulfill({ json: { roleIds: ['role-finance'] } });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = route.request().postDataJSON().password === 'right-password';
      return route.fulfill({ status: verified ? 200 : 401, json: {} });
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
    await page.getByRole('checkbox', { name: fa ? /مالی/ : /Finance/ }).check();
    await page.locator('#staff-role-reason').fill('New duties');
    await page
      .getByRole('button', { name: fa ? 'ذخیره نقش‌ها' : 'Save roles', exact: true })
      .click();
    const dialog = page.getByRole('dialog'),
      confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    expect(attempts).toHaveLength(0);
    await confirm.click();
    await expect(page.locator('#team-step-up-password')).toBeVisible();
    await page.locator('#team-step-up-password').fill('wrong-password');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(attempts).toHaveLength(1);
    await page.locator('#team-step-up-password').fill('right-password');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(page.locator('#team-step-up-password')).toHaveValue('');
    failSave = false;
    await page.locator('#team-step-up-password').fill('right-password');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toEqual(Array(3).fill({ roleIds: ['role-finance'], reason: 'New duties' }));
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: fa ? 'ویرایش نقش‌ها' : 'Edit roles', exact: true })
    ).toHaveCount(0);
  });
}

for (const locale of ['en', 'fa'] as const) {
  test(`permission history filters full calendar days and preserves retry (${locale})`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-03-21T12:00:00Z'));
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    const fa = locale === 'fa',
      target = '10000000-0000-4000-8000-000000000003';
    let fail = true;
    const queries: URLSearchParams[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/admin/staff-access', (route) =>
      route.fulfill({
        json: {
          userId: 'viewer',
          canView: true,
          canCreate: false,
          canEditRoles: false,
          canDisable: false,
        },
      })
    );
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
      if (fail) return route.fulfill({ status: 503, json: {} });
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
      .getByRole('row')
      .filter({ hasText: 'history@example.test' })
      .getByRole('button', { name: fa ? 'تاریخچه مجوزها' : 'Permission history', exact: true })
      .click();
    const history = page.getByRole('region', {
      name: fa ? 'تاریخچه مجوزها' : 'Permission history',
      exact: true,
    });
    await expect(history.getByRole('alert')).toBeVisible();
    fail = false;
    await history.getByRole('button', { name: fa ? 'تلاش مجدد' : 'Retry', exact: true }).click();
    await expect(history).toContainText('New duties');
    expect(queries.at(-1)?.get('userId')).toBe(target);
    await expect(history).toContainText(
      fa ? 'نقش‌های حذف‌شده: پشتیبانی مشتریان' : 'Roles removed: Customer Support'
    );
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
    const expected = await page.evaluate(() => {
      const start = new Date('2026-03-21T12:00:00Z'),
        end = new Date(start);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { from: start.toISOString(), to: end.toISOString() };
    });
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
  });
}

for (const locale of ['en', 'fa'] as const) {
  test(`activation resend respects server cooldown and retains its target (${locale})`, async ({
    page,
  }) => {
    await page.clock.install();
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    const fa = locale === 'fa';
    let attempts = 0;
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
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
        : route.fulfill({ json: { deliveryStatus: 'queued' } });
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
    await expect(
      page.getByText(
        fa
          ? 'ایمیل فعال‌سازی در صف ارسال قرار گرفت.'
          : 'The activation email is queued for delivery.',
        { exact: true }
      )
    ).toBeVisible();
  });
}
