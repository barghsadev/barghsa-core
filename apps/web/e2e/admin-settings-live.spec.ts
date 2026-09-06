import { test, expect } from '@playwright/test';
import { fork, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setup as buildApi } from '../../api/src/test/build-http-app';
let child: ChildProcess;
let http: {
  base: string;
  session: string;
  csrf: string;
  jobs: Record<string, { first: string; second: string; dead: string }>;
};
test.beforeAll(async () => {
  test.setTimeout(90000);
  buildApi();
  const require = createRequire(
    fileURLToPath(new URL('../../../packages/db/package.json', import.meta.url))
  );
  child = fork(
    require.resolve('tsx/cli'),
    [fileURLToPath(new URL('../../api/scripts/admin-ui-fixture.ts', import.meta.url))],
    { silent: true }
  );
  let logs = '';
  for (const stream of [child.stdout, child.stderr])
    stream?.on('data', (data) => {
      logs = (logs + String(data)).slice(-10000);
    });
  http = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error(logs || 'Fixture timeout')), 60000);
    child.once('message', (message) => {
      clearTimeout(timer);
      done(message as typeof http);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(timer);
      reject(new Error(logs || 'Fixture exited'));
    });
  });
});
test.afterAll(async () => {
  if (child && child.exitCode === null && child.connected)
    await new Promise<void>((done) => {
      const timer = setTimeout(() => child.kill('SIGTERM'), 15000);
      child.once('exit', () => {
        clearTimeout(timer);
        done();
      });
      child.send('stop');
    });
});

for (const locale of ['en', 'fa'])
  test(`team UI persists through the migrated API (${locale})`, async ({ page }) => {
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    // Forward to the isolated API without mocking any application response.
    await page.route('**/api/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const response = await route.fetch({
        url: `${http.base}${url.pathname}${url.search}`,
        headers: {
          ...request.headers(),
          host: new URL(http.base).host,
          origin: 'https://app.example.test',
          cookie: `barghsa_session=${http.session}`,
          'x-csrf-token': http.csrf,
        },
      });
      await route.fulfill({ response });
    });
    const fa = locale === 'fa',
      name = `Team live ${locale}`;
    await page.goto('/admin/staff-teams');
    await page.getByLabel(fa ? 'نام تیم' : 'Team name', { exact: true }).fill(name);
    await page.getByLabel('Member UI', { exact: true }).check();
    await page
      .getByLabel(fa ? 'سرپرست تیم' : 'Team lead', { exact: true })
      .selectOption('team-ui-member');
    await page.getByRole('button', { name: fa ? 'ذخیره تیم' : 'Save team', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const apiHeaders = { cookie: `barghsa_session=${http.session}` };
    const team = (
      (await (
        await page.request.get(`${http.base}/api/admin/staff-teams`, { headers: apiHeaders })
      ).json()) as Array<{
        id: string;
        name: string;
        memberUserIds: string[];
        leadUserId: string | null;
      }>
    ).find((item) => item.name === name)!;
    expect(team).toBeTruthy();
    expect(team.leadUserId).toBe('team-ui-member');
    expect(team.memberUserIds).toEqual(['team-ui-member']);
    await page
      .getByLabel(fa ? 'تیم مسئول' : 'Assigned team', { exact: true })
      .first()
      .selectOption(team.id);
    await page
      .getByRole('button', {
        name: fa ? 'ذخیره قوانین تخصیص' : 'Save assignment rules',
        exact: true,
      })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(
      (
        await (
          await page.request.get(`${http.base}/api/admin/config/assignment-rules`, {
            headers: apiHeaders,
          })
        ).json()
      ).ticket.teamId
    ).toBe(team.id);
    await page.reload();
    await expect(
      page.getByLabel(fa ? 'تیم مسئول' : 'Assigned team', { exact: true }).first()
    ).toHaveValue(team.id);
    await page.getByRole('button', { name: fa ? 'ویرایش تیم' : 'Edit team', exact: true }).click();
    await page.getByLabel(fa ? 'نام تیم' : 'Team name', { exact: true }).fill(`${name} revised`);
    await page.getByRole('button', { name: fa ? 'ذخیره تیم' : 'Save team', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: `${name} revised`, exact: true })).toBeVisible();
    await page.screenshot({ path: `/tmp/barghsa-staff-teams-${locale}.png`, fullPage: true });
    await page.getByRole('button', { name: fa ? 'حذف تیم' : 'Delete team', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(
      await (
        await page.request.get(`${http.base}/api/admin/staff-teams`, { headers: apiHeaders })
      ).json()
    ).toEqual([]);
  });

for (const locale of ['en', 'fa'])
  test(`response targets persist and disable through the real API (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const response = await route.fetch({
        url: `${http.base}${url.pathname}${url.search}`,
        headers: {
          ...request.headers(),
          host: new URL(http.base).host,
          origin: 'https://app.example.test',
          cookie: `barghsa_session=${http.session}`,
          'x-csrf-token': http.csrf,
        },
      });
      await route.fulfill({ response });
    });
    const fa = locale === 'fa',
      enabled = fa ? 'فعال کردن هشدار — تیکت‌ها' : 'Enable alerts — Tickets',
      hours = fa ? 'ساعت — تیکت‌ها' : 'Hours — Tickets';
    const save = fa ? 'ذخیره زمان‌های هدف' : 'Save response targets',
      confirm = fa ? 'تأیید' : 'Confirm';
    await page.goto('/admin/service-targets');
    await page.getByLabel(enabled, { exact: true }).check();
    await page.getByLabel(hours, { exact: true }).fill('48');
    await page.getByRole('button', { name: save, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: confirm, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel(hours, { exact: true })).toHaveValue('48');
    await page.getByLabel(enabled, { exact: true }).uncheck();
    await page.getByRole('button', { name: save, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: confirm, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel(enabled, { exact: true })).not.toBeChecked();
  });

for (const locale of ['en', 'fa'])
  test(`staff creation, role changes and disabling persist through the migrated API (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const response = await route.fetch({
        url: `${http.base}${url.pathname}${url.search}`,
        headers: {
          ...request.headers(),
          host: new URL(http.base).host,
          origin: 'https://app.example.test',
          cookie: `barghsa_session=${http.session}`,
          'x-csrf-token': http.csrf,
        },
      });
      await route.fulfill({ response });
    });
    const fa = locale === 'fa',
      username = `new-staff-${locale}@example.test`;
    await page.goto('/admin/users');
    await page
      .getByRole('button', { name: fa ? 'ایجاد حساب کارمند' : 'Create staff user', exact: true })
      .click();
    await page.locator('#staff-username').fill(username);
    await page.locator('#staff-firstName').fill('New');
    await page.locator('#staff-lastName').fill(`Staff ${locale}`);
    await page
      .getByRole('radio', {
        name: fa ? 'رمز عبور موقت یک‌بارمصرف' : 'One-time temporary password',
        exact: true,
      })
      .check();
    await page
      .locator('form')
      .getByRole('button', { name: fa ? 'ایجاد حساب کارمند' : 'Create staff user', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const password = await page.locator('#staff-created-password').inputValue();
    expect(password.length).toBeGreaterThanOrEqual(12);
    expect(
      await page.evaluate(() => JSON.stringify({ local: localStorage, session: sessionStorage }))
    ).not.toContain(password);
    await page
      .getByRole('button', { name: fa ? 'بستن نتیجه' : 'Dismiss result', exact: true })
      .click();
    await expect(page.locator('#staff-created-password')).toHaveCount(0);
    const row = page.getByRole('row').filter({ hasText: username });
    await expect(row).toContainText(fa ? 'بدون نقش' : 'No roles');
    await row
      .getByRole('button', { name: fa ? 'ویرایش نقش‌ها' : 'Edit roles', exact: true })
      .click();
    await page.getByRole('checkbox', { name: fa ? /مالی/ : /Finance/ }).check();
    await page.locator('#staff-role-reason').fill('Assign finance duties');
    await page
      .getByRole('button', { name: fa ? 'ذخیره نقش‌ها' : 'Save roles', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row).toContainText(fa ? 'مالی' : 'Finance');
    await row
      .getByRole('button', { name: fa ? 'تاریخچه مجوزها' : 'Permission history', exact: true })
      .click();
    const history = page.getByRole('region', {
      name: fa ? 'تاریخچه مجوزها' : 'Permission history',
      exact: true,
    });
    await expect(history).toContainText('Assign finance duties');
    await expect(history).toContainText('admin-ui@example.test');
    await expect(history).toContainText(fa ? 'نقش‌های افزوده: مالی' : 'Roles added: Finance');
    await history
      .getByRole('button', { name: fa ? 'بستن تاریخچه' : 'Close history', exact: true })
      .click();
    await row
      .getByRole('button', { name: fa ? 'غیرفعال‌سازی حساب' : 'Disable account', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    await expect(row).toContainText(fa ? 'غیرفعال' : 'Disabled');
    await expect(page.locator('#staff-created-password')).toHaveCount(0);
    const response = await page.request.get(`${http.base}/api/admin/staff`, {
      headers: { cookie: `barghsa_session=${http.session}` },
    });
    const result = await response.json();
    expect(
      result.items.find((user: { username: string }) => user.username === username)
    ).toMatchObject({ status: 'disabled', isAdmin: false, roles: [{ roleId: 'role-finance' }] });
  });

for (const locale of ['en', 'fa'])
  test(`expired staff activation can be reissued through the real API (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const response = await route.fetch({
        url: `${http.base}${url.pathname}${url.search}`,
        headers: {
          ...request.headers(),
          host: new URL(http.base).host,
          origin: 'https://app.example.test',
          cookie: `barghsa_session=${http.session}`,
          'x-csrf-token': http.csrf,
        },
      });
      await route.fulfill({ response });
    });
    const fa = locale === 'fa',
      username = `pending-${locale}@example.test`;
    await page.goto('/admin/users');
    const row = page.getByRole('row').filter({ hasText: username });
    await expect(row).toContainText(fa ? 'در انتظار فعال‌سازی' : 'Awaiting activation');
    await row
      .getByRole('button', {
        name: fa ? 'ارسال دوباره فعال‌سازی' : 'Resend activation',
        exact: true,
      })
      .click();
    await expect(page.getByRole('dialog')).toContainText(username);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page.getByText(
        fa
          ? 'ایمیل فعال‌سازی در صف ارسال قرار گرفت.'
          : 'The activation email is queued for delivery.',
        { exact: true }
      )
    ).toBeVisible();
    const response = await page.request.get(`${http.base}/api/admin/staff`, {
      headers: { cookie: `barghsa_session=${http.session}` },
    });
    const result = await response.json();
    const account = result.items.find((user: { username: string }) => user.username === username);
    expect(account.activationPending).toBe(true);
    expect(new Date(account.activationExpiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(account).not.toHaveProperty('activationToken');
  });

for (const locale of ['en', 'fa'])
  test(`failed jobs can be retried in bulk, resolved, and recovered from dead letter (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const response = await route.fetch({
        url: `${http.base}${url.pathname}${url.search}`,
        headers: {
          ...request.headers(),
          host: new URL(http.base).host,
          origin: 'https://app.example.test',
          cookie: `barghsa_session=${http.session}`,
          'x-csrf-token': http.csrf,
        },
      });
      await route.fulfill({ response });
    });
    const fa = locale === 'fa',
      ids = http.jobs[locale]!;
    await page.goto('/admin/failed-jobs');
    const row = (id: string) => page.locator(`[data-job-id="${id}"]`);
    await expect(row(ids.first)).toContainText('Local worker transport failed');
    await row(ids.first).getByRole('checkbox').check();
    await row(ids.second).getByRole('checkbox').check();
    await page
      .getByRole('button', { name: fa ? /اجرای دوباره موارد انتخاب‌شده/ : /Retry selected/ })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(row(ids.first)).toHaveCount(0);
    await page
      .getByRole('button', { name: fa ? 'در انتظار اجرای دوباره' : 'Retrying', exact: true })
      .click();
    await expect(row(ids.first)).toBeVisible();
    await expect(row(ids.second)).toBeVisible();
    await row(ids.first)
      .getByRole('button', { name: fa ? 'حل‌شده علامت زدن' : 'Resolve', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toContainText(
      fa ? 'اجرای کارهای دوره‌ای ادامه' : 'Recurring jobs will continue'
    );
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(row(ids.first)).toHaveCount(0);
    await page.getByRole('button', { name: fa ? 'حل‌شده' : 'Resolved', exact: true }).click();
    await row(ids.first)
      .getByText(fa ? 'جزئیات' : 'Details', { exact: true })
      .click();
    await expect(row(ids.first)).toContainText('admin-ui@example.test');
    await page
      .getByRole('button', { name: fa ? 'تلاش‌های پایان‌یافته' : 'Dead letter', exact: true })
      .click();
    await row(ids.dead)
      .getByRole('button', { name: fa ? 'اجرای دوباره' : 'Retry', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(row(ids.dead)).toHaveCount(0);
    await page.reload();
    await page
      .getByRole('button', { name: fa ? 'در انتظار اجرای دوباره' : 'Retrying', exact: true })
      .click();
    await expect(row(ids.dead)).toBeVisible();
    await expect(row(ids.second)).toBeVisible();
  });

for (const locale of ['en', 'fa'])
  test(`failed notification actions persist through the migrated API (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const response = await route.fetch({
        url: `${http.base}${url.pathname}${url.search}`,
        headers: {
          ...request.headers(),
          host: new URL(http.base).host,
          origin: 'https://app.example.test',
          cookie: `barghsa_session=${http.session}`,
          'x-csrf-token': http.csrf,
        },
      });
      await route.fulfill({ response });
    });
    await page.goto('/admin/failed-notifications');
    for (const [action, label, status] of [
      ['retry', fa ? 'تلاش مجدد' : 'Retry', 'retried'],
      ['resolve', fa ? 'حل‌شده' : 'Resolve', 'resolved'],
      ['dismiss', fa ? 'بستن' : 'Dismiss', 'dismissed'],
    ]) {
      const event = `triage.${locale}.${action}`;
      const row = page.locator('tbody tr').filter({ hasText: event });
      await expect(row).toBeVisible();
      await row.locator('summary').click();
      await expect(row).toContainText('***');
      await expect(row).not.toContainText('private-secret');
      await expect(row).not.toContainText('private@example.test');
      await row.getByRole('button', { name: `${label} ${event}`, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(event);
      await dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(row).toHaveCount(0);
      const response = await page.request.get(
        `${http.base}/api/admin/failed-notifications?status=${status}`,
        { headers: { cookie: `barghsa_session=${http.session}` } }
      );
      expect(response.status()).toBe(200);
      const records = (await response.json()) as Array<{
        eventKey: string;
        status: string;
        resolvedById: string;
      }>;
      expect(records.find((record) => record.eventKey === event)).toMatchObject({
        status,
        resolvedById: 'team-ui-admin',
      });
    }
    await page.reload();
    await expect(page.locator('tbody tr').filter({ hasText: `triage.${locale}.` })).toHaveCount(0);
  });

for (const locale of ['en', 'fa'])
  test(`upload policies edit, retain history and end through the real API (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa',
      category = fa ? 'image' : 'document',
      name = fa ? 'تصاویر' : 'Documents';
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const response = await route.fetch({
        url: `${http.base}${url.pathname}${url.search}`,
        headers: {
          ...request.headers(),
          host: new URL(http.base).host,
          origin: 'https://app.example.test',
          cookie: `barghsa_session=${http.session}`,
          'x-csrf-token': http.csrf,
        },
      });
      await route.fulfill({ response });
    });
    await page.goto('/admin/upload-policies');
    const row = page
      .locator('tbody tr')
      .filter({ has: page.getByRole('rowheader', { name, exact: true }) });
    await expect(row).toContainText(fa ? 'پیش‌فرض استقرار' : 'Deployment defaults');
    for (const value of ['1', '2']) {
      await row
        .getByRole('button', { name: `${fa ? 'ویرایش' : 'Edit'} ${name}`, exact: true })
        .click();
      let dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(
        fa ? 'بارگذاری‌های در حال انجام' : 'uploads already in progress'
      );
      for (const checkbox of await dialog.getByRole('checkbox').all()) await checkbox.uncheck();
      await dialog.getByLabel(fa ? '.png' : '.pdf', { exact: true }).check();
      await dialog.locator('#upload-policy-size').fill(value);
      await dialog
        .getByRole('button', { name: fa ? 'ذخیره سیاست' : 'Save policy', exact: true })
        .click();
      dialog = page.getByRole('dialog');
      await expect(dialog).toHaveCount(1);
      await dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(row).toContainText(fa ? 'سیاست ثبت‌شده' : 'Configured policy');
    }
    await row.locator('summary').click();
    await expect(row.locator('ol li')).toHaveCount(2);
    await expect(row.locator('ol')).toContainText(fa ? 'پایان‌یافته' : 'Ended');
    await page.reload();
    await expect(row).toContainText(fa ? 'سیاست ثبت‌شده' : 'Configured policy');
    await row
      .getByRole('button', { name: `${fa ? 'پایان سیاست' : 'End policy'} ${name}`, exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(fa ? 'ممکن است فایل‌های بیشتری' : 'may allow more files');
    await dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toContainText(fa ? 'پیش‌فرض استقرار' : 'Deployment defaults');
    const response = await page.request.get(
      `${http.base}/api/admin/upload-policies?category=${category}`,
      { headers: { cookie: `barghsa_session=${http.session}` } }
    );
    const policies = (await response.json()) as Array<{
      status: string;
      maxSizeBytes: number;
      createdBy: string;
    }>;
    expect(policies).toHaveLength(2);
    expect(
      policies.every(
        (policy) => policy.status === 'expired' && policy.createdBy === 'team-ui-admin'
      )
    ).toBe(true);
    expect(policies.map((policy) => policy.maxSizeBytes)).toEqual([2 * 1024 * 1024, 1024 * 1024]);
  });

for (const locale of ['en', 'fa'])
  test(`storage configuration persists through the real API (${locale})`, async ({ page }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const response = await route.fetch({
        url: `${http.base}${url.pathname}${url.search}`,
        headers: {
          ...request.headers(),
          host: new URL(http.base).host,
          origin: 'https://app.example.test',
          cookie: `barghsa_session=${http.session}`,
          'x-csrf-token': http.csrf,
        },
      });
      await route.fulfill({ response });
    });
    await page.goto('/admin/storage');
    await expect(page.getByLabel(fa ? 'مخزن' : 'Bucket', { exact: true })).toHaveValue(
      'test-evidence'
    );
    await page
      .getByLabel(fa ? 'کلید دسترسی' : 'Access key', { exact: true })
      .fill(`browser-key-${locale}`);
    await page
      .getByLabel(fa ? 'کلید محرمانه' : 'Secret key', { exact: true })
      .fill(`browser-secret-${locale}`);
    await page
      .getByRole('button', { name: fa ? 'آزمایش اتصال' : 'Test connection', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText(fa ? 'ذخیره نشده' : 'not been saved');
    await page
      .getByRole('button', { name: fa ? 'ذخیره و فعال‌سازی' : 'Save and activate', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByLabel(fa ? 'کلید محرمانه' : 'Secret key', { exact: true })).toHaveValue(
      ''
    );
    await expect(page.getByRole('status')).toContainText(fa ? 'ذخیره و فعال' : 'saved and active');
    await page.reload();
    await expect(page.getByLabel(fa ? 'کلید دسترسی' : 'Access key', { exact: true })).toHaveValue(
      `browser-key-${locale}`
    );
    const saved = await page.request.get(`${http.base}/api/admin/storage/config`, {
      headers: { cookie: `barghsa_session=${http.session}` },
    });
    expect(await saved.json()).toMatchObject({
      accessKeyId: `browser-key-${locale}`,
      hasSecretKey: true,
    });
    expect(await saved.text()).not.toContain(`browser-secret-${locale}`);
    await page.screenshot({ path: `/tmp/storage-config-${locale}.png`, fullPage: true });
  });

for (const locale of ['en', 'fa'])
  test(`reconciliation review persists through the migrated API (${locale})`, async ({ page }) => {
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const response = await route.fetch({
        url: `${http.base}${url.pathname}${url.search}`,
        headers: {
          ...request.headers(),
          host: new URL(http.base).host,
          origin: 'https://app.example.test',
          cookie: `barghsa_session=${http.session}`,
          'x-csrf-token': http.csrf,
        },
      });
      await route.fulfill({ response });
    });
    const fa = locale === 'fa',
      description = `Reconciliation live ${locale}`;
    await page.goto('/admin/reconciliation');
    await page.getByRole('button', { name: description, exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('9007199254740993');
    await page
      .getByRole('button', { name: fa ? 'شروع بررسی' : 'Investigate', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByLabel(fa ? 'وضعیت' : 'Status', { exact: true }).selectOption('investigating');
    await page
      .getByRole('button', { name: fa ? 'اعمال فیلترها' : 'Apply filters', exact: true })
      .click();
    await page.getByRole('button', { name: description, exact: true }).click();
    await page.getByLabel(fa ? 'توضیح' : 'Explanation', { exact: true }).fill(`Reviewed ${locale}`);
    await page.getByRole('button', { name: fa ? 'رفع مغایرت' : 'Resolve', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    await page.getByLabel(fa ? 'وضعیت' : 'Status', { exact: true }).selectOption('resolved');
    await page
      .getByRole('button', { name: fa ? 'اعمال فیلترها' : 'Apply filters', exact: true })
      .click();
    await page.getByRole('button', { name: description, exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText(`Reviewed ${locale}`);
    await page.screenshot({ path: `/tmp/reconciliation-${locale}.png`, fullPage: true });
    await page.getByLabel(fa ? 'توضیح' : 'Explanation', { exact: true }).fill(`Closed ${locale}`);
    await page
      .getByRole('button', { name: fa ? 'بستن مغایرت' : 'Close exception', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const records = (await (
      await page.request.get(`${http.base}/api/admin/reconciliation/items?status=closed`, {
        headers: { cookie: `barghsa_session=${http.session}` },
      })
    ).json()) as Array<{ description: string; resolutionNote: string }>;
    expect(records.find((row) => row.description === description)?.resolutionNote).toBe(
      `Reviewed ${locale}`
    );
  });

for (const locale of ['en', 'fa'])
  test(`green rules save independent modes and explain unusable products (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const response = await route.fetch({
        url: `${http.base}${url.pathname}${url.search}`,
        headers: {
          ...request.headers(),
          host: new URL(http.base).host,
          origin: 'https://app.example.test',
          cookie: `barghsa_session=${http.session}`,
          'x-csrf-token': http.csrf,
        },
      });
      await route.fulfill({ response });
    });
    const headers = {
        cookie: `barghsa_session=${http.session}`,
        'x-csrf-token': http.csrf,
        origin: 'https://app.example.test',
      },
      fa = locale === 'fa';
    const products = (await (
      await page.request.get(`${http.base}/api/admin/catalogue/products`, { headers })
    ).json()) as Array<{ id: string; systemKey: string }>;
    const product = products.find((p) => p.systemKey === 'green_electricity')!;
    expect(
      (
        await page.request.put(`${http.base}/api/admin/catalogue/products/${product.id}`, {
          headers,
          data: { status: 'active' },
        })
      ).status()
    ).toBe(200);
    await page.goto('/admin/electricity-rules');
    const simple = page.getByRole('group', {
        name: fa ? 'سفارش ساده' : 'Simple orders',
        exact: true,
      }),
      advanced = page.getByRole('group', {
        name: fa ? 'سفارش پیشرفته' : 'Advanced orders',
        exact: true,
      });
    await simple.getByRole('checkbox').check();
    await advanced.getByRole('checkbox').check();
    await simple.getByRole('spinbutton').fill('1500');
    await advanced.getByRole('spinbutton').fill('2100');
    await simple.getByRole('slider').focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowUp');
    await advanced.getByRole('slider').focus();
    await page.keyboard.press('End');
    await page
      .getByRole('button', { name: fa ? 'ذخیره قواعد' : 'Save rules', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    await expect(simple.getByRole('spinbutton')).toHaveValue('1500');
    await expect(advanced.getByRole('spinbutton')).toHaveValue('2100');
    const config = await (
      await page.request.get(`${http.base}/api/admin/config/green-electricity-rules`, { headers })
    ).json();
    expect(config).toMatchObject({
      simpleOrder: {
        mandatoryGreenEnabled: true,
        averagePowerThresholdKw: 1500,
        mandatoryGreenSharePercent: 0.1,
      },
      advancedOrder: {
        mandatoryGreenEnabled: true,
        averagePowerThresholdKw: 2100,
        mandatoryGreenSharePercent: 100,
      },
    });
    expect(
      (
        await page.request.put(`${http.base}/api/admin/catalogue/products/${product.id}`, {
          headers,
          data: { status: 'inactive' },
        })
      ).status()
    ).toBe(200);
    await page.getByRole('button', { name: fa ? 'تازه‌سازی' : 'Refresh', exact: true }).click();
    await expect(simple.getByRole('alert')).toContainText(
      fa ? 'محصول غیرفعال' : 'Product is inactive'
    );
    await page.screenshot({ path: `/tmp/green-rules-${locale}.png`, fullPage: true });
    await page
      .getByRole('button', { name: fa ? 'ذخیره قواعد' : 'Save rules', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'انصراف' : 'Cancel', exact: true })
      .click();
    await simple.getByRole('checkbox').uncheck();
    await advanced.getByRole('checkbox').uncheck();
    await page
      .getByRole('button', { name: fa ? 'ذخیره قواعد' : 'Save rules', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(simple.getByRole('alert')).toHaveCount(0);
  });

for (const locale of ['en', 'fa'])
  test(`contract limits save and reload through the migrated API (${locale})`, async ({ page }) => {
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const response = await route.fetch({
        url: `${http.base}${url.pathname}${url.search}`,
        headers: {
          ...request.headers(),
          host: new URL(http.base).host,
          origin: 'https://app.example.test',
          cookie: `barghsa_session=${http.session}`,
          'x-csrf-token': http.csrf,
        },
      });
      await route.fulfill({ response });
    });
    const fa = locale === 'fa';
    await page.goto('/admin/contract-limits');
    await page
      .getByLabel(fa ? 'حداکثر افزایش مقدار (درصد)' : 'Maximum quantity increase (%)', {
        exact: true,
      })
      .fill('0');
    await page
      .getByLabel(fa ? 'حداکثر مدت (ماه شمسی)' : 'Maximum duration (Jalali months)', {
        exact: true,
      })
      .fill(fa ? '36' : '24');
    await page
      .getByLabel(fa ? 'حداقل فاصله تا شروع (روز)' : 'Minimum lead time (days)', { exact: true })
      .fill('7');
    await page
      .getByRole('button', { name: fa ? 'ذخیره محدودیت‌ها' : 'Save limits', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByLabel(fa ? 'حداکثر افزایش مقدار (درصد)' : 'Maximum quantity increase (%)', {
        exact: true,
      })
    ).toHaveValue('0');
    await expect(
      page.getByLabel(fa ? 'حداکثر مدت (ماه شمسی)' : 'Maximum duration (Jalali months)', {
        exact: true,
      })
    ).toHaveValue(fa ? '36' : '24');
    const config = await (
      await page.request.get(`${http.base}/api/admin/config/contract-electricity-limits`, {
        headers: { cookie: `barghsa_session=${http.session}` },
      })
    ).json();
    expect(config).toEqual({
      maxQuantityIncreasePercent: 0,
      maxContractDuration: fa ? 36 : 24,
      leadTimeDays: 7,
    });
    await page.screenshot({ path: `/tmp/contract-limits-${locale}.png`, fullPage: true });
  });
