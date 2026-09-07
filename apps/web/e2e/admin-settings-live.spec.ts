import { test, expect } from './coverage-fixture';
import { fork, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setup as buildApi } from '../../api/src/test/build-http-app';
let child: ChildProcess;
let fixtureLogs = '';
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
  fixtureLogs = '';
  for (const stream of [child.stdout, child.stderr])
    stream?.on('data', (data) => {
      fixtureLogs = (fixtureLogs + String(data)).slice(-30000);
    });
  http = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error(fixtureLogs || 'Fixture timeout')), 60000);
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
      reject(new Error(fixtureLogs || 'Fixture exited'));
    });
  });
});
test.afterAll(async ({}, testInfo) => {
  if (child && child.exitCode === null && child.connected)
    await new Promise<void>((done) => {
      const timer = setTimeout(() => child.kill('SIGTERM'), 15000);
      child.once('exit', () => {
        clearTimeout(timer);
        done();
      });
      child.send('stop');
    });
  if (testInfo.status !== testInfo.expectedStatus)
    await testInfo.attach('local-api-fixture.log', {
      body: fixtureLogs || 'No fixture output was captured.',
      contentType: 'text/plain',
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

for (const locale of ['en', 'fa'])
  test(`AI model UI persists through the migrated API (${locale})`, async ({ page }) => {
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
      title = `Local AI ${locale}`;
    const confirm = async () => {
      await page
        .getByRole('dialog')
        .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    };
    await page.goto('/admin/ai-models');
    await page.getByRole('button', { name: fa ? 'افزودن مدل' : 'Add model', exact: true }).click();
    await page.getByLabel(fa ? 'عنوان مدل' : 'Model title', { exact: true }).fill(title);
    await page
      .getByLabel(fa ? 'نشانی پایه' : 'Base URL', { exact: true })
      .fill('http://127.0.0.1:1/v1');
    await page
      .getByLabel(fa ? 'شناسه مدل نزد ارائه‌دهنده' : 'Provider model name', { exact: true })
      .fill('local-only-model');
    await page
      .getByLabel(fa ? 'کلید API' : 'API token', { exact: true })
      .fill('browser-test-private-token');
    await page.getByRole('button', { name: fa ? 'ذخیره مدل' : 'Save model', exact: true }).click();
    await confirm();
    const card = page.getByRole('row', { name: title, exact: true });
    await expect(card).toBeVisible();
    await expect(card).not.toContainText('browser-test-private-token');
    await card.getByRole('button', { name: fa ? 'ویرایش' : 'Edit', exact: true }).click();
    await expect(page.locator('#ai-model-token')).toHaveCount(0);
    await page
      .getByLabel(fa ? 'نشانی پایه' : 'Base URL', { exact: true })
      .fill('http://127.0.0.1:2/v1');
    await page.getByRole('button', { name: fa ? 'ذخیره مدل' : 'Save model', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
      fa ? 'دوباره وارد' : 'Re-enter'
    );
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'انصراف' : 'Cancel', exact: true })
      .click();
    await page
      .getByLabel(fa ? 'تغییر کلید' : 'Token change', { exact: true })
      .selectOption('clear');
    await page.getByRole('button', { name: fa ? 'ذخیره مدل' : 'Save model', exact: true }).click();
    await confirm();
    await page.reload();
    await expect(card).toContainText('127.0.0.1:2');
    await expect(card).toContainText(fa ? 'بدون کلید' : 'No token');
    await card
      .getByRole('button', { name: fa ? 'آزمایش اتصال' : 'Test connection', exact: true })
      .click();
    await confirm();
    await expect(card).toContainText(fa ? 'اتصال ناموفق' : 'Unreachable');
    await page.screenshot({ path: `/tmp/ai-models-${locale}.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await page.screenshot({ path: `/tmp/ai-models-mobile-${locale}.png`, fullPage: true });
    await card.getByRole('button', { name: fa ? 'حذف' : 'Delete', exact: true }).click();
    await confirm();
    await expect(card).toHaveCount(0);
  });

for (const locale of ['en', 'fa'])
  test(`knowledge-base UI persists through the migrated API (${locale})`, async ({ page }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        document.documentElement.lang = value;
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
    const confirm = async () => {
      await page
        .getByRole('dialog')
        .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    };
    const name = `KB live ${locale}`,
      renamed = `${name} edited`,
      groupName = `KB group ${locale}`;
    await page.goto('/admin/knowledge-bases');
    await page
      .getByRole('button', { name: fa ? 'افزودن پایگاه دانش' : 'Add knowledge base', exact: true })
      .click();
    await page.getByLabel(fa ? 'عنوان' : 'Title', { exact: true }).fill(name);
    await page.getByLabel(fa ? 'توضیحات' : 'Description', { exact: true }).fill('Meter guidance');
    await page.getByRole('button', { name: fa ? 'ذخیره' : 'Save', exact: true }).click();
    await confirm();
    await page
      .getByRole('button', { name: `${fa ? 'ویرایش' : 'Edit'} ${name}`, exact: true })
      .click();
    await page.getByLabel(fa ? 'عنوان' : 'Title', { exact: true }).fill(renamed);
    await page.getByRole('button', { name: fa ? 'ذخیره' : 'Save', exact: true }).click();
    await confirm();
    await page.reload();
    await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible();
    const headers = { cookie: `barghsa_session=${http.session}` };
    const kbs = (await (
      await page.request.get(`${http.base}/api/admin/knowledge-bases`, { headers })
    ).json()) as Array<{ id: string; title: string; description: string }>;
    const kb = kbs.find((item) => item.title === renamed)!;
    expect(kb.description).toBe('Meter guidance');
    await page
      .getByRole('button', { name: `${fa ? 'باز کردن' : 'Open'} ${renamed}`, exact: true })
      .click();
    await page
      .getByLabel(fa ? 'انتخاب سند' : 'Choose a document', { exact: true })
      .selectOption('uploads/document/kb-ui.pdf');
    await page
      .getByRole('button', { name: fa ? 'پیوست سند' : 'Attach document', exact: true })
      .click();
    await confirm();
    await expect(page.getByText('Knowledge guide.pdf', { exact: true })).toBeVisible();
    const withDocument = await (
      await page.request.get(`${http.base}/api/admin/knowledge-bases/${kb.id}`, { headers })
    ).json();
    expect(withDocument.documents).toEqual([
      expect.objectContaining({
        storageKey: 'uploads/document/kb-ui.pdf',
        processingStatus: 'pending',
      }),
    ]);
    await page
      .getByRole('button', {
        name: `${fa ? 'حذف پیوند سند' : 'Detach document'} Knowledge guide.pdf`,
        exact: true,
      })
      .click();
    await confirm();
    expect(
      (
        await (
          await page.request.get(`${http.base}/api/admin/knowledge-bases/${kb.id}`, { headers })
        ).json()
      ).documents
    ).toEqual([]);
    const candidates = await (
      await page.request.get(`${http.base}/api/admin/knowledge-bases/documents/available`, {
        headers,
      })
    ).json();
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ storageKey: 'uploads/document/kb-ui.pdf' }),
      ])
    );
    await page
      .getByRole('button', {
        name: fa ? 'گروه‌های پایگاه دانش' : 'Knowledge-base groups',
        exact: true,
      })
      .click();
    await page.getByRole('button', { name: fa ? 'افزودن گروه' : 'Add group', exact: true }).click();
    await page.getByLabel(fa ? 'عنوان' : 'Title', { exact: true }).fill(groupName);
    await page.getByRole('button', { name: fa ? 'ذخیره' : 'Save', exact: true }).click();
    await confirm();
    await page
      .getByRole('button', { name: `${fa ? 'باز کردن' : 'Open'} ${groupName}`, exact: true })
      .click();
    await page
      .getByLabel(fa ? 'انتخاب پایگاه دانش' : 'Choose a knowledge base', { exact: true })
      .selectOption(kb.id);
    await page
      .getByRole('button', { name: fa ? 'افزودن به گروه' : 'Add to group', exact: true })
      .click();
    await confirm();
    const groups = (await (
      await page.request.get(`${http.base}/api/admin/kb-groups`, { headers })
    ).json()) as Array<{ id: string; title: string; memberCount: number }>;
    const group = groups.find((item) => item.title === groupName)!;
    expect(group.memberCount).toBe(1);
    await page
      .getByRole('button', {
        name: `${fa ? 'حذف از گروه' : 'Remove from group'} ${renamed}`,
        exact: true,
      })
      .click();
    await confirm();
    expect(
      (
        await (
          await page.request.get(`${http.base}/api/admin/kb-groups/${group.id}`, { headers })
        ).json()
      ).members
    ).toEqual([]);
    await page
      .getByRole('button', { name: `${fa ? 'حذف' : 'Delete'} ${groupName}`, exact: true })
      .click();
    await confirm();
    await expect(page.getByRole('heading', { name: groupName, exact: true })).toHaveCount(0);
    await page
      .getByRole('button', { name: fa ? 'پایگاه‌های دانش' : 'Knowledge bases', exact: true })
      .click();
    await page
      .getByRole('button', { name: `${fa ? 'حذف' : 'Delete'} ${renamed}`, exact: true })
      .click();
    await confirm();
    expect(
      (
        await page.request.get(`${http.base}/api/admin/knowledge-bases/${kb.id}`, { headers })
      ).status()
    ).toBe(404);
  });

for (const locale of ['en', 'fa'])
  test(`AI policy UI persists through the migrated API (${locale})`, async ({ page }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        document.documentElement.lang = value;
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
    const confirm = async () => {
      await page
        .getByRole('dialog')
        .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    };
    const name = `Policy live ${locale}`,
      renamed = `${name} edited`,
      groupName = `Policy group ${locale}`;
    await page.goto('/admin/policies');
    await page
      .getByRole('button', { name: fa ? 'افزودن سیاست' : 'Add policy', exact: true })
      .click();
    await page.getByLabel(fa ? 'عنوان' : 'Title', { exact: true }).fill(name);
    await page.getByLabel(fa ? 'توضیحات' : 'Description', { exact: true }).fill('Meter guidance');
    await page
      .getByLabel(fa ? 'موضوعات مجاز' : 'Allowed topics', { exact: true })
      .fill('Meter readings');
    await page.getByRole('button', { name: fa ? 'ذخیره' : 'Save', exact: true }).click();
    await confirm();
    await page
      .getByRole('button', { name: `${fa ? 'ویرایش' : 'Edit'} ${name}`, exact: true })
      .click();
    await page.getByLabel(fa ? 'عنوان' : 'Title', { exact: true }).fill(renamed);
    await page
      .getByLabel(fa ? 'نوع سیاست' : 'Policy type', { exact: true })
      .selectOption('response_style');
    await page.getByLabel(fa ? 'لحن' : 'Tone', { exact: true }).fill('Clear and concise');
    await page
      .getByLabel(fa ? 'زبان (اختیاری)' : 'Language (optional)', { exact: true })
      .fill(locale);
    await page
      .getByLabel(fa ? 'حداکثر طول (اختیاری)' : 'Maximum length (optional)', { exact: true })
      .fill('1200');
    await page.getByLabel(fa ? 'فعال' : 'Enabled', { exact: true }).uncheck();
    await page.getByRole('button', { name: fa ? 'ذخیره' : 'Save', exact: true }).click();
    await confirm();
    await page.reload();
    await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible();
    const headers = { cookie: `barghsa_session=${http.session}` };
    const kbs = (await (
      await page.request.get(`${http.base}/api/admin/policies`, { headers })
    ).json()) as Array<{ id: string; title: string; description: string }>;
    const kb = kbs.find((item) => item.title === renamed)!;
    expect(kb.description).toBe('Meter guidance');
    expect(kb).toMatchObject({
      policyType: 'response_style',
      enabled: false,
      rules: { tone: 'Clear and concise', language: locale, maxLength: 1200 },
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await page.screenshot({ path: `/tmp/ai-policies-${locale}.png`, fullPage: true });
    await page
      .getByRole('button', {
        name: fa ? 'گروه‌های سیاست' : 'Policy groups',
        exact: true,
      })
      .click();
    await page.getByRole('button', { name: fa ? 'افزودن گروه' : 'Add group', exact: true }).click();
    await page.getByLabel(fa ? 'عنوان' : 'Title', { exact: true }).fill(groupName);
    await page.getByRole('button', { name: fa ? 'ذخیره' : 'Save', exact: true }).click();
    await confirm();
    await page
      .getByRole('button', { name: `${fa ? 'باز کردن' : 'Open'} ${groupName}`, exact: true })
      .click();
    await page
      .getByLabel(fa ? 'انتخاب سیاست' : 'Choose a policy', { exact: true })
      .selectOption(kb.id);
    await page
      .getByRole('button', { name: fa ? 'افزودن به گروه' : 'Add to group', exact: true })
      .click();
    await confirm();
    const groups = (await (
      await page.request.get(`${http.base}/api/admin/policy-groups`, { headers })
    ).json()) as Array<{ id: string; title: string; memberCount: number }>;
    const group = groups.find((item) => item.title === groupName)!;
    expect(group.memberCount).toBe(1);
    await page
      .getByRole('button', {
        name: `${fa ? 'حذف از گروه' : 'Remove from group'} ${renamed}`,
        exact: true,
      })
      .click();
    await confirm();
    expect(
      (
        await (
          await page.request.get(`${http.base}/api/admin/policy-groups/${group.id}`, { headers })
        ).json()
      ).members
    ).toEqual([]);
    await page
      .getByRole('button', { name: `${fa ? 'حذف' : 'Delete'} ${groupName}`, exact: true })
      .click();
    await confirm();
    await expect(page.getByRole('heading', { name: groupName, exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: fa ? 'سیاست‌ها' : 'Policies', exact: true }).click();
    await page
      .getByRole('button', { name: `${fa ? 'حذف' : 'Delete'} ${renamed}`, exact: true })
      .click();
    await confirm();
    expect(
      (await page.request.get(`${http.base}/api/admin/policies/${kb.id}`, { headers })).status()
    ).toBe(404);
  });

for (const locale of ['en', 'fa'])
  test(`agent slot UI persists through the migrated API (${locale})`, async ({ page }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    const headers = {
      cookie: `barghsa_session=${http.session}`,
      'x-csrf-token': http.csrf,
      origin: 'https://app.example.test',
    };
    const modelResponse = await page.request.post(`${http.base}/api/admin/ai-models`, {
      headers,
      data: {
        title: `Slot model ${locale}`,
        providerType: 'openai_compatible',
        baseUrl: 'https://example.test',
        modelName: 'test',
      },
    });
    expect(modelResponse.status()).toBe(201);
    const model = await modelResponse.json();
    const agentResponse = await page.request.post(`${http.base}/api/admin/agents`, {
      headers,
      data: { title: `Slot support ${locale}`, modelId: model.id, kbIds: [], policyIds: [] },
    });
    expect(agentResponse.status()).toBe(201);
    const agent = await agentResponse.json();
    await page.route('**/api/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const response = await route.fetch({
        url: `${http.base}${url.pathname}${url.search}`,
        headers: { ...request.headers(), ...headers, host: new URL(http.base).host },
      });
      await route.fulfill({ response });
    });
    const confirm = async () => {
      await page
        .getByRole('dialog')
        .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    };
    await page.goto('/admin/agent-slots');
    const individual = page.getByLabel(
      fa ? 'عامل · گفت‌وگوی شخص حقیقی' : 'Agent · Individual chatbot',
      { exact: true }
    );
    await individual.selectOption(agent.id);
    await page
      .getByRole('button', {
        name: fa ? 'ذخیره تخصیص گفت‌وگوی شخص حقیقی' : 'Save assignment Individual chatbot',
        exact: true,
      })
      .click();
    await confirm();
    await page.reload();
    await expect(individual).toHaveValue(agent.id);
    await page
      .getByLabel(fa ? 'عامل · گفت‌وگوی کارکنان' : 'Agent · Staff chatbot', { exact: true })
      .selectOption(agent.id);
    await expect(
      page.getByText(
        fa ? 'تخصیص‌یافته به: گفت‌وگوی شخص حقیقی' : 'Also assigned to: Individual chatbot',
        { exact: true }
      )
    ).toBeVisible();
    await page
      .getByRole('button', {
        name: fa ? 'ذخیره تخصیص گفت‌وگوی کارکنان' : 'Save assignment Staff chatbot',
        exact: true,
      })
      .click();
    await confirm();
    const slots = (await (
      await page.request.get(`${http.base}/api/admin/agent-slots`, { headers })
    ).json()) as Array<{ slotKey: string; agent: { id: string } | null; alsoUsedIn: string[] }>;
    expect(slots.find((slot) => slot.slotKey === 'staff_chatbot')).toMatchObject({
      agent: { id: agent.id },
      alsoUsedIn: ['individual_chatbot'],
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await page.screenshot({ path: `/tmp/agent-slots-${locale}.png`, fullPage: true });
    await individual.selectOption('');
    await page
      .getByRole('button', {
        name: fa ? 'ذخیره تخصیص گفت‌وگوی شخص حقیقی' : 'Save assignment Individual chatbot',
        exact: true,
      })
      .click();
    await confirm();
    expect(
      (
        (await (
          await page.request.get(`${http.base}/api/admin/agent-slots`, { headers })
        ).json()) as typeof slots
      ).find((slot) => slot.slotKey === 'individual_chatbot')?.agent
    ).toBeNull();
    await page.request.delete(`${http.base}/api/admin/agents/${agent.id}`, { headers });
    await page.request.delete(`${http.base}/api/admin/ai-models/${model.id}`, { headers });
  });

for (const locale of ['en', 'fa'])
  test(`agent editor persists all link types through the migrated API (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    const headers = {
      cookie: `barghsa_session=${http.session}`,
      'x-csrf-token': http.csrf,
      origin: 'https://app.example.test',
    };
    const create = async (path: string, data: unknown) => {
      const response = await page.request.post(`${http.base}/api/admin/${path}`, { headers, data });
      expect(response.status()).toBe(201);
      return (await response.json()) as { id: string; title: string };
    };
    const model = await create('ai-models', {
      title: `Editor model ${locale}`,
      providerType: 'openai_compatible',
      baseUrl: 'https://example.test',
      modelName: 'test',
    });
    const kb = await create('knowledge-bases', {
      title: `Editor knowledge ${locale}`,
      description: '',
    });
    const policy = await create('policies', {
      title: `Editor policy ${locale}`,
      policyType: 'allowed_topics',
      rules: { topics: ['energy'] },
    });
    const kbGroup = await create('kb-groups', { title: `Editor knowledge group ${locale}` });
    const policyGroup = await create('policy-groups', { title: `Editor policy group ${locale}` });
    await page.route('**/api/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const response = await route.fetch({
        url: `${http.base}${url.pathname}${url.search}`,
        headers: { ...request.headers(), ...headers, host: new URL(http.base).host },
      });
      await route.fulfill({ response });
    });
    const confirm = async () => {
      await page
        .getByRole('dialog')
        .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    };
    const title = `Editor assistant ${locale}`,
      renamed = `${title} revised`;
    await page.goto('/admin/agents');
    await page.getByRole('button', { name: fa ? 'افزودن عامل' : 'Add agent', exact: true }).click();
    await page.getByLabel(fa ? 'عنوان' : 'Title', { exact: true }).fill(title);
    await page.getByLabel(fa ? 'مدل' : 'Model', { exact: true }).selectOption(model.id);
    for (const item of [kb, policy, kbGroup, policyGroup])
      await page.getByLabel(item.title, { exact: true }).check();
    await page.getByRole('button', { name: fa ? 'ذخیره عامل' : 'Save agent', exact: true }).click();
    await confirm();
    const agents = (await (
      await page.request.get(`${http.base}/api/admin/agents`, { headers })
    ).json()) as Array<{ id: string; title: string }>;
    const agent = agents.find((row) => row.title === title)!;
    const detail = async () =>
      await (
        await page.request.get(`${http.base}/api/admin/agents/${agent.id}`, { headers })
      ).json();
    expect(await detail()).toMatchObject({
      modelId: model.id,
      enabled: true,
      kbs: [{ id: kb.id }],
      policies: [{ id: policy.id }],
      kbGroups: [{ id: kbGroup.id }],
      policyGroups: [{ id: policyGroup.id }],
    });
    await page.reload();
    await page
      .getByRole('button', { name: `${fa ? 'ویرایش' : 'Edit'} ${title}`, exact: true })
      .click();
    for (const item of [kb, policy, kbGroup, policyGroup])
      await expect(page.getByLabel(item.title, { exact: true })).toBeChecked();
    await page.getByLabel(fa ? 'عنوان' : 'Title', { exact: true }).fill(renamed);
    await page.getByLabel(fa ? 'فعال' : 'Enabled', { exact: true }).uncheck();
    await page.getByLabel(kb.title, { exact: true }).uncheck();
    await page.getByLabel(policyGroup.title, { exact: true }).uncheck();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await page.screenshot({ path: `/tmp/ai-agents-${locale}.png`, fullPage: true });
    await page.getByRole('button', { name: fa ? 'ذخیره عامل' : 'Save agent', exact: true }).click();
    await confirm();
    expect(await detail()).toMatchObject({
      title: renamed,
      enabled: false,
      kbs: [],
      policies: [{ id: policy.id }],
      kbGroups: [{ id: kbGroup.id }],
      policyGroups: [],
    });
    await page
      .getByRole('button', { name: `${fa ? 'حذف' : 'Delete'} ${renamed}`, exact: true })
      .click();
    await confirm();
    expect(
      (await page.request.get(`${http.base}/api/admin/agents/${agent.id}`, { headers })).status()
    ).toBe(404);
    for (const [path, item] of [
      ['kb-groups', kbGroup],
      ['policy-groups', policyGroup],
      ['knowledge-bases', kb],
      ['policies', policy],
      ['ai-models', model],
    ] as const)
      expect(
        (await page.request.delete(`${http.base}/api/admin/${path}/${item.id}`, { headers })).ok()
      ).toBe(true);
  });

for (const locale of ['en', 'fa'])
  test(`contract template UI persists versions through migrated API (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    const headers = {
      cookie: `barghsa_session=${http.session}`,
      'x-csrf-token': http.csrf,
      origin: 'https://app.example.test',
    };
    await page.route('**/api/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const response = await route.fetch({
        url: `${http.base}${url.pathname}${url.search}`,
        headers: { ...request.headers(), ...headers, host: new URL(http.base).host },
      });
      await route.fulfill({ response });
    });
    const confirm = async () => {
      await page
        .getByRole('dialog')
        .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    };
    const name = `Local template ${locale}`,
      renamed = `${name} revised`;
    await page.goto('/admin/contract-templates');
    await page
      .getByRole('button', { name: fa ? 'افزودن قالب' : 'Add template', exact: true })
      .click();
    await page.getByLabel(fa ? 'نام' : 'Name', { exact: true }).fill(name);
    await page
      .getByRole('button', { name: fa ? 'ذخیره قالب' : 'Save template', exact: true })
      .click();
    await confirm();
    await page
      .getByRole('button', { name: `${fa ? 'باز کردن' : 'Open'} ${name}`, exact: true })
      .click();
    const input = page.getByLabel(fa ? 'فایل قالب' : 'Template file', { exact: true });
    await input.setInputFiles({
      name: 'bad.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7'),
    });
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(
      page.getByRole('button', { name: fa ? 'بارگذاری نسخه' : 'Upload version', exact: true })
    ).toBeDisabled();
    for (const [file, content] of [
      ['first.txt', 'Hello {{customerName}}'],
      ['second.txt', '{{date}} {{amount}}'],
    ]) {
      await input.setInputFiles({
        name: file!,
        mimeType: 'text/plain',
        buffer: Buffer.from(content!),
      });
      await page
        .getByRole('button', { name: fa ? 'بارگذاری نسخه' : 'Upload version', exact: true })
        .click();
      await confirm();
    }
    await expect(page.getByText('{{customerName}}', { exact: true })).toBeVisible();
    await expect(page.getByText('{{date}}, {{amount}}', { exact: true })).toBeVisible();
    await page.getByLabel(fa ? 'نام' : 'Name', { exact: true }).fill(renamed);
    await page.getByLabel(fa ? 'فعال' : 'Active', { exact: true }).uncheck();
    await page
      .getByRole('button', { name: fa ? 'ذخیره قالب' : 'Save template', exact: true })
      .click();
    await confirm();
    await page.reload();
    await page
      .getByRole('button', { name: `${fa ? 'باز کردن' : 'Open'} ${renamed}`, exact: true })
      .click();
    await expect(page.getByLabel(fa ? 'فعال' : 'Active', { exact: true })).not.toBeChecked();
    await expect(page.getByText('first.txt', { exact: true })).toBeVisible();
    await expect(page.getByText('second.txt', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: `${fa ? 'حذف' : 'Delete'} ${renamed}`, exact: true })
    ).toBeDisabled();
    const rows = (await (
      await page.request.get(`${http.base}/api/admin/contract-templates`, { headers })
    ).json()) as Array<{ id: string; name: string }>;
    const row = rows.find((item) => item.name === renamed)!;
    expect(
      await (
        await page.request.get(`${http.base}/api/admin/contract-templates/${row.id}`, { headers })
      ).json()
    ).toMatchObject({
      status: 'inactive',
      versionCount: 2,
      versions: [
        { fileName: 'first.txt', placeholders: ['customerName'] },
        { fileName: 'second.txt', placeholders: ['date', 'amount'] },
      ],
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await page.screenshot({ path: `/tmp/contract-templates-${locale}.png`, fullPage: true });
    await page
      .getByRole('button', { name: fa ? 'افزودن قالب' : 'Add template', exact: true })
      .click();
    await page.getByLabel(fa ? 'نام' : 'Name', { exact: true }).fill(`Empty ${locale}`);
    await page
      .getByRole('button', { name: fa ? 'ذخیره قالب' : 'Save template', exact: true })
      .click();
    await confirm();
    await page
      .getByRole('button', { name: `${fa ? 'حذف' : 'Delete'} Empty ${locale}`, exact: true })
      .click();
    await confirm();
    await expect(page.getByRole('heading', { name: `Empty ${locale}`, exact: true })).toHaveCount(
      0
    );
  });

for (const locale of ['en', 'fa'])
  test(`VAT UI persists rates and product overrides through migrated API (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    const headers = {
      cookie: `barghsa_session=${http.session}`,
      'x-csrf-token': http.csrf,
      origin: 'https://app.example.test',
    };
    const productName = `VAT test ${locale}`;
    const productResponse = await page.request.post(`${http.base}/api/admin/catalogue/products`, {
      headers,
      data: {
        type: 'hardware',
        title: { en: productName, fa: productName },
        price: '1000',
        status: 'active',
      },
    });
    expect(productResponse.status()).toBe(201);
    const product = await productResponse.json();
    await page.route('**/api/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const response = await route.fetch({
        url: `${http.base}${url.pathname}${url.search}`,
        headers: { ...request.headers(), ...headers, host: new URL(http.base).host },
      });
      await route.fulfill({ response });
    });
    const confirm = async () => {
      await page
        .getByRole('dialog')
        .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    };
    const save = async () => {
      await page.getByRole('button', { name: fa ? 'ذخیره نرخ' : 'Save rate', exact: true }).click();
      await confirm();
    };
    const category = fa ? 'saving_plan' : 'consultation';
    await page.goto('/admin/vat');
    await page.getByRole('button', { name: fa ? 'افزودن نرخ' : 'Add rate', exact: true }).click();
    await page.getByLabel(fa ? 'دسته' : 'Category', { exact: true }).selectOption(category);
    await page.getByLabel(fa ? 'نرخ (درصد)' : 'Rate (%)', { exact: true }).fill('7.25');
    await save();
    const rates = (await (
      await page.request.get(`${http.base}/api/admin/finance/vat`, { headers })
    ).json()) as Array<{ id: string; category: string; rateBasisPoints: number }>;
    const rate = rates.find((row) => row.category === category)!;
    expect(rate.rateBasisPoints).toBe(725);
    await page
      .getByRole('button', {
        name: fa ? 'افزودن نرخ اختصاصی محصول' : 'Add product override',
        exact: true,
      })
      .click();
    await page.getByLabel(fa ? 'محصول' : 'Product', { exact: true }).selectOption(product.id);
    await page
      .getByLabel(fa ? 'نرخ ثبت‌شده' : 'Recorded rate', { exact: true })
      .selectOption(rate.id);
    await save();
    const resolve = async () =>
      await (
        await page.request.get(
          `${http.base}/api/admin/finance/vat/resolve?productId=${product.id}`,
          { headers }
        )
      ).json();
    expect(await resolve()).toMatchObject({ rateBasisPoints: 725 });
    await page.reload();
    await page
      .getByRole('button', {
        name: `${fa ? 'پایان نرخ اختصاصی' : 'End override'} ${productName}`,
        exact: true,
      })
      .click();
    await page
      .getByRole('button', { name: fa ? 'پایان دادن به نرخ' : 'End rate', exact: true })
      .click();
    await confirm();
    expect(await resolve()).toMatchObject({ rateBasisPoints: 0 });
    const categoryName = fa ? 'طرح صرفه‌جویی' : 'Consultation';
    await page
      .getByRole('button', {
        name: `${fa ? 'پایان دادن به نرخ' : 'End rate'} ${categoryName}`,
        exact: true,
      })
      .click();
    await page
      .getByRole('button', { name: fa ? 'پایان دادن به نرخ' : 'End rate', exact: true })
      .click();
    await confirm();
    await page.getByRole('button', { name: fa ? 'افزودن نرخ' : 'Add rate', exact: true }).click();
    await page.getByLabel(fa ? 'دسته' : 'Category', { exact: true }).selectOption(category);
    await page.getByLabel(fa ? 'نرخ (درصد)' : 'Rate (%)', { exact: true }).fill('8');
    await page
      .getByLabel(fa ? 'تعیین تاریخ اجرا' : 'Use a specific effective date', { exact: true })
      .check();
    await page
      .getByRole('combobox', { name: fa ? 'تاریخ اجرا' : 'Effective date', exact: true })
      .click();
    await page.getByRole('grid').getByRole('button').last().click();
    await page.getByLabel(fa ? 'ساعت اجرا' : 'Effective time', { exact: true }).fill('23:59');
    await save();
    const persisted = (await (
      await page.request.get(`${http.base}/api/admin/finance/vat`, { headers })
    ).json()) as Array<{
      category: string;
      rateBasisPoints: number;
      status: string;
      effectiveFrom: string;
    }>;
    const scheduled = persisted.find(
      (row) => row.category === category && row.rateBasisPoints === 800
    )!;
    expect(scheduled.status).toBe('scheduled');
    expect(Date.parse(scheduled.effectiveFrom)).toBeGreaterThan(Date.now());
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await page.screenshot({ path: `/tmp/vat-${locale}.png`, fullPage: true });
  });

for (const locale of ['en', 'fa'])
  test(`gift-code UI persists discount scope and validity through migrated API (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    const headers = {
      cookie: `barghsa_session=${http.session}`,
      'x-csrf-token': http.csrf,
      origin: 'https://app.example.test',
    };
    await page.route('**/api/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const response = await route.fetch({
        url: `${http.base}${url.pathname}${url.search}`,
        headers: { ...request.headers(), ...headers, host: new URL(http.base).host },
      });
      await route.fulfill({ response });
    });
    const confirm = async () => {
      await page
        .getByRole('dialog')
        .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    };
    const code = `LOCAL-${locale.toUpperCase()}`,
      form = page.getByRole('form', { name: fa ? 'تنظیمات کد تخفیف' : 'Gift-code settings' });
    const save = async () => {
      await form.getByRole('button', { name: fa ? 'ذخیره کد' : 'Save code', exact: true }).click();
      await confirm();
    };
    await page.goto('/admin/gift-codes');
    await page.getByRole('button', { name: fa ? 'افزودن کد' : 'Add code', exact: true }).click();
    await form.getByLabel(fa ? 'کد' : 'Code', { exact: true }).fill(code.toLowerCase());
    await form
      .getByLabel(fa ? 'مبلغ تخفیف (ریال)' : 'Discount amount (IRR)', { exact: true })
      .fill('1000');
    await form.getByLabel(fa ? 'حداکثر مصرف کل' : 'Total usage limit', { exact: true }).fill('3');
    await form
      .getByLabel(fa ? 'حداکثر مصرف هر پروفایل' : 'Per-profile usage limit', { exact: true })
      .fill('1');
    await form.getByLabel(fa ? 'تجهیزات' : 'Hardware', { exact: true }).check();
    await save();
    const list = (await (
      await page.request.get(`${http.base}/api/admin/promotions/gift-codes`, { headers })
    ).json()) as Array<{ id: string; code: string; validFrom: string }>;
    const created = list.find((row) => row.code === code)!;
    const detail = async () =>
      await (
        await page.request.get(`${http.base}/api/admin/promotions/gift-codes/${created.id}/stats`, {
          headers,
        })
      ).json();
    await page
      .getByRole('button', { name: `${fa ? 'ویرایش' : 'Edit'} ${code}`, exact: true })
      .click();
    await form
      .getByLabel(fa ? 'نوع تخفیف' : 'Discount type', { exact: true })
      .selectOption('percentage');
    await form.getByLabel(fa ? 'درصد تخفیف' : 'Discount (%)', { exact: true }).fill('25');
    await form
      .getByLabel(fa ? 'سقف تخفیف (ریال)' : 'Discount cap (IRR)', { exact: true })
      .fill('5000');
    await expect(form.getByRole('note')).toBeVisible();
    await form
      .getByLabel(fa ? 'افراد مجاز' : 'Eligibility', { exact: true })
      .selectOption('profile');
    await form
      .getByLabel(fa ? 'Gift recipient · حقیقی' : 'Gift recipient · Individual', { exact: true })
      .check();
    await form.getByLabel(fa ? 'تعیین تاریخ پایان' : 'Set an expiry date', { exact: true }).check();
    await form
      .getByRole('combobox', { name: fa ? 'تاریخ پایان' : 'Expiry date', exact: true })
      .click();
    await page.getByRole('grid').getByRole('button').last().click();
    await save();
    const updated = await detail();
    expect(updated.code).toMatchObject({
      discountType: 'percentage',
      discountValue: '2500',
      maxCapIrr: '5000',
      eligibility: 'profile',
      totalLimit: 3,
      perProfileLimit: 1,
      categories: ['hardware'],
      validFrom: created.validFrom,
    });
    expect(updated.code.profileIds).toHaveLength(1);
    expect(Date.parse(updated.code.validUntil)).toBeGreaterThan(Date.now());
    expect(updated.code.usage).toMatchObject({ consumed: 0, released: 0, totalDiscountIrr: '0' });
    await page.reload();
    await page
      .getByRole('button', { name: `${fa ? 'ویرایش' : 'Edit'} ${code}`, exact: true })
      .click();
    await expect(
      form.getByLabel(fa ? 'Gift recipient · حقیقی' : 'Gift recipient · Individual', {
        exact: true,
      })
    ).toBeChecked();
    await form
      .getByLabel(fa ? 'افراد مجاز' : 'Eligibility', { exact: true })
      .selectOption('public');
    await form.getByLabel(fa ? 'حداکثر مصرف کل' : 'Total usage limit', { exact: true }).fill('');
    await save();
    expect((await detail()).code).toMatchObject({
      eligibility: 'public',
      profileIds: [],
      totalLimit: null,
      validFrom: created.validFrom,
      validUntil: updated.code.validUntil,
    });
    await page
      .getByRole('button', { name: `${fa ? 'غیرفعال‌سازی' : 'Deactivate'} ${code}`, exact: true })
      .click();
    await confirm();
    const filters = page.getByRole('form', { name: fa ? 'فیلتر کدها' : 'Gift-code filters' });
    await filters.getByLabel(fa ? 'جست‌وجوی کد' : 'Search code', { exact: true }).fill(code);
    await filters.getByLabel(fa ? 'وضعیت' : 'Status', { exact: true }).selectOption('inactive');
    await filters.getByRole('button', { name: fa ? 'جست‌وجو' : 'Search', exact: true }).click();
    await expect(page.getByRole('heading', { name: code, exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await page.screenshot({ path: `/tmp/gift-codes-${locale}.png`, fullPage: true });
    await page
      .getByRole('button', { name: `${fa ? 'فعال‌سازی' : 'Activate'} ${code}`, exact: true })
      .click();
    await confirm();
    await expect(page.getByRole('heading', { name: code, exact: true })).toHaveCount(0);
    expect((await detail()).code.status).toBe('active');
  });

for (const locale of ['en', 'fa'])
  test(`catalogue UI persists products, prices and system limits (${locale})`, async ({ page }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    const headers = {
      cookie: `barghsa_session=${http.session}`,
      'x-csrf-token': http.csrf,
      origin: 'https://app.example.test',
    };
    await page.route('**/api/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const response = await route.fetch({
        url: `${http.base}${url.pathname}${url.search}`,
        headers: { ...request.headers(), ...headers, host: new URL(http.base).host },
      });
      await route.fulfill({ response });
    });
    const confirm = async () => {
      await page
        .getByRole('dialog')
        .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    };
    const form = page.getByRole('form', { name: fa ? 'ویرایش محصول' : 'Product editor' });
    const save = async () => {
      await form
        .getByRole('button', { name: fa ? 'ذخیره محصول' : 'Save product', exact: true })
        .click();
      await confirm();
    };
    const apiBase = `${http.base}/api/admin/catalogue/products`;
    // Other live checks change this singleton; establish this test's prerequisites explicitly.
    const productsResponse = await page.request.get(apiBase, { headers });
    expect(productsResponse.status()).toBe(200);
    const products = (await productsResponse.json()) as Array<{ id: string; systemKey: string }>;
    const greenProduct = products.find((product) => product.systemKey === 'green_electricity');
    expect(greenProduct).toBeDefined();
    expect(
      (
        await page.request.put(`${apiBase}/${greenProduct!.id}`, {
          headers,
          data: { status: 'active' },
        })
      ).status()
    ).toBe(200);
    expect(
      (
        await page.request.put(`${http.base}/api/admin/config/green-electricity-rules`, {
          headers,
          data: {
            simple_order: {
              mandatory_green_enabled: true,
              average_power_threshold_kw: 1000,
              mandatory_green_share_percent: 4,
            },
            advanced_order: {
              mandatory_green_enabled: false,
              average_power_threshold_kw: 1000,
              mandatory_green_share_percent: 4,
            },
          },
        })
      ).status()
    ).toBe(200);
    await page.goto('/admin/catalogue');
    for (const [type, tab] of [
      ['consultation', fa ? 'مشاوره' : 'Consultation'],
      ['hardware', fa ? 'تجهیزات' : 'Hardware'],
      ['saving_plan', fa ? 'طرح‌های صرفه‌جویی' : 'Saving plans'],
    ]) {
      const name = `Catalogue ${type} ${locale}`;
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await page
        .getByRole('button', { name: fa ? 'افزودن محصول' : 'Add product', exact: true })
        .click();
      await form.getByLabel(fa ? 'عنوان فارسی' : 'Persian title', { exact: true }).fill(name);
      await form.getByLabel(fa ? 'عنوان انگلیسی' : 'English title', { exact: true }).fill(name);
      await form
        .getByLabel(fa ? 'قیمت اولیه (ریال، اختیاری)' : 'Initial price (IRR, optional)', {
          exact: true,
        })
        .fill('9007199254740993');
      if (type === 'consultation')
        await form
          .getByLabel(fa ? 'مشاوره نیروگاه' : 'Generation station consultation', { exact: true })
          .check();
      await save();
      await page
        .getByRole('button', { name: `${fa ? 'ویرایش' : 'Edit'} ${name}`, exact: true })
        .click();
      await expect(
        form.getByLabel(fa ? 'عنوان انگلیسی' : 'English title', { exact: true })
      ).toHaveValue(name);
      const list = (await (
        await page.request.get(`${apiBase}?type=${type}`, { headers })
      ).json()) as Array<{ id: string; title: { en: string } }>;
      const id = list.find((row) => row.title.en === name)!.id;
      const detail = async () =>
        await (await page.request.get(`${apiBase}/${id}`, { headers })).json();
      expect(await detail()).toMatchObject({
        type,
        status: 'inactive',
        price: '9007199254740993',
        categories: type === 'consultation' ? ['electricity_generation_station_consultation'] : [],
      });
      await page.getByRole('button', { name: fa ? 'فعال‌سازی' : 'Activate', exact: true }).click();
      await confirm();
      expect(await detail()).toMatchObject({ status: 'active' });
      await page
        .getByRole('button', { name: `${fa ? 'ویرایش' : 'Edit'} ${name}`, exact: true })
        .click();
      await form
        .getByLabel(fa ? 'توضیحات انگلیسی' : 'English description', { exact: true })
        .fill('Saved description');
      await save();
      expect(await detail()).toMatchObject({ description: { en: 'Saved description' } });
      await page
        .getByRole('button', { name: `${fa ? 'ویرایش' : 'Edit'} ${name}`, exact: true })
        .click();
      await page
        .getByRole('button', { name: fa ? 'افزودن نسخه قیمت' : 'Add price version', exact: true })
        .click();
      const priceForm = page.getByRole('form', { name: fa ? 'ویرایش قیمت' : 'Price editor' });
      await priceForm
        .getByLabel(fa ? 'قیمت (ریال)' : 'Price (IRR)', { exact: true })
        .fill('9007199254740995');
      await priceForm
        .getByLabel(fa ? 'تعیین تاریخ اجرا' : 'Use a specific effective date', { exact: true })
        .check();
      await priceForm
        .getByRole('combobox', { name: fa ? 'تاریخ اجرا' : 'Effective date', exact: true })
        .click();
      await page.getByRole('grid').getByRole('button').last().click();
      await priceForm
        .getByRole('button', { name: fa ? 'ذخیره قیمت' : 'Save price', exact: true })
        .click();
      await confirm();
      const priced = await detail();
      expect(priced.price).toBe('9007199254740993');
      expect(priced.priceHistory).toHaveLength(2);
      expect(priced.priceHistory[1].price).toBe('9007199254740995');
      expect(Date.parse(priced.priceHistory[1].effectiveFrom)).toBeGreaterThan(Date.now());
      expect(new Date(priced.priceHistory[1].effectiveFrom).toISOString()).toMatch(
        /T20:30:00\.000Z$/
      );
      await page
        .getByRole('button', { name: `${fa ? 'ویرایش' : 'Edit'} ${name}`, exact: true })
        .click();
      await expect(
        page
          .getByRole('region', { name: fa ? 'تاریخچه قیمت' : 'Price history' })
          .getByRole('listitem')
      ).toHaveCount(2);
      await page.getByRole('button', { name: fa ? 'بایگانی' : 'Archive', exact: true }).click();
      await confirm();
      expect(await detail()).toMatchObject({ status: 'archived' });
      await page
        .getByRole('button', { name: `${fa ? 'ویرایش' : 'Edit'} ${name}`, exact: true })
        .click();
      await page
        .getByRole('button', {
          name: fa ? 'بازگردانی به غیرفعال' : 'Restore as inactive',
          exact: true,
        })
        .click();
      await confirm();
      expect(await detail()).toMatchObject({ status: 'inactive' });
    }
    await page.getByRole('tab', { name: fa ? 'برق' : 'Electricity', exact: true }).click();
    await expect(
      page.getByRole('button', { name: fa ? 'افزودن محصول' : 'Add product', exact: true })
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: `${fa ? 'ویرایش' : 'Edit'} Green UI`, exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: fa ? 'بایگانی' : 'Archive', exact: true })
    ).toHaveCount(0);
    const minimum = form.getByLabel(fa ? 'حداقل (کیلووات‌ساعت)' : 'Minimum (kWh)', { exact: true });
    await expect(form).toBeVisible();
    if (!(await minimum.count()))
      await form.getByLabel(fa ? 'تعیین محدوده مصرف' : 'Configure consumption limits').check();
    await minimum.fill('100');
    await form
      .getByLabel(fa ? 'حداکثر (کیلووات‌ساعت)' : 'Maximum (kWh)', { exact: true })
      .fill('0');
    await save();
    await page
      .getByRole('button', { name: `${fa ? 'ویرایش' : 'Edit'} Green UI`, exact: true })
      .click();
    await expect(minimum).toHaveValue('100');
    await expect(
      page.getByRole('note').filter({ hasText: fa ? 'قواعد فعال' : 'Enabled or scheduled rules' })
    ).toBeVisible();
    await page
      .getByRole('button', { name: fa ? 'غیرفعال‌سازی' : 'Deactivate', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toContainText(fa ? 'قاعده برق سبز' : 'green rule');
    await confirm();
    await page
      .getByRole('button', { name: `${fa ? 'ویرایش' : 'Edit'} Green UI`, exact: true })
      .click();
    await page.getByRole('button', { name: fa ? 'فعال‌سازی' : 'Activate', exact: true }).click();
    await confirm();
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('button', { name: `${fa ? 'ویرایش' : 'Edit'} Green UI`, exact: true })
      .click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await expect(form).toBeVisible();
    await page.screenshot({ path: `/tmp/catalogue-${locale}.png`, fullPage: true });
  });

for (const locale of ['en', 'fa'] as const) {
  test(`dashboard displays exact live profile balances and recovers failed reads (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    let failDashboard = false;
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (failDashboard && url.pathname === '/api/dashboard') {
        await route.fulfill({ status: 503, json: { message: 'test outage' } });
        return;
      }
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
    await page.goto('/dashboard');
    const main = page.locator('main');
    await expect(
      main.getByRole('heading', {
        name: fa ? 'خوش آمدید، Dashboard Example' : 'Welcome, Dashboard Example',
      })
    ).toBeVisible();
    await expect(main).toContainText(new Intl.NumberFormat(locale).format(9007199254740993n));
    await expect(main).toContainText(new Intl.NumberFormat(locale).format(900719925474099n));
    await expect(main).toContainText(
      fa
        ? 'موجودی کیف پول شما برای پرداخت صورتحساب‌های جاری کافی نیست'
        : 'Your wallet balance is too low to cover pending invoices'
    );
    await expect(
      main.getByRole('link', { name: fa ? 'شارژ کیف پول' : 'Charge Wallet' })
    ).toHaveAttribute('href', '/wallet');
    failDashboard = true;
    await page.reload();
    await expect(main.getByRole('alert')).toHaveText(
      fa
        ? 'دریافت اطلاعات داشبورد انجام نشد. دوباره تلاش کنید.'
        : 'Could not load dashboard data. Try again.'
    );
    await expect(main).not.toContainText(new Intl.NumberFormat(locale).format(9007199254740993n));
    failDashboard = false;
    await main.getByRole('button', { name: fa ? 'تلاش دوباره' : 'Try again' }).click();
    await expect(main).toContainText(new Intl.NumberFormat(locale).format(9007199254740993n));
  });
}

for (const locale of ['en', 'fa'] as const) {
  test(`branding publishes only the saved reviewed version (${locale})`, async ({ page }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    let failTimezone = false;
    const accountTimezone = fa ? 'Asia/Tokyo' : 'America/Los_Angeles';
    expect(
      (
        await page.request.put(`${http.base}/api/user/settings/timezone`, {
          headers: {
            cookie: `barghsa_session=${http.session}`,
            'x-csrf-token': http.csrf,
            origin: 'https://app.example.test',
          },
          data: { timezone: accountTimezone },
        })
      ).status()
    ).toBe(200);
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/user/settings/timezone' && failTimezone) {
        await route.fulfill({ status: 503, json: { error: 'fixture-timezone-unavailable' } });
        return;
      }
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
    const publicTitle = async () =>
      (await (await page.request.get(`${http.base}/api/public/branding/config`)).json()).appTitle;
    const before = await publicTitle();
    await page.goto('/admin/branding');
    const title = page.getByLabel(fa ? 'نام برنامه' : 'App Title', { exact: true });
    const savedTitle = `Brand published ${locale}`;
    await title.fill(savedTitle);
    await page
      .getByLabel(fa ? 'کد هگز رنگ اصلی' : 'Primary hex value', { exact: true })
      .fill('#777777');
    await page
      .getByLabel(fa ? 'بارگذاری نشان' : 'Upload logo', { exact: true })
      .setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
    await expect(page.getByRole('alert')).toContainText(
      fa ? 'بارگذاری نشان ناموفق بود' : 'Logo upload failed'
    );
    await page.getByLabel(fa ? 'بارگذاری نشان' : 'Upload logo', { exact: true }).setInputFiles({
      name: 'brand.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT0kAAAAASUVORK5CYII=',
        'base64'
      ),
    });
    await expect(
      page.getByRole('img', { name: fa ? 'پیش‌نمایش نشان' : 'Logo preview', exact: true })
    ).toHaveAttribute('src', /^blob:/);

    await page
      .getByRole('button', { name: fa ? 'ذخیره پیش‌نویس' : 'Save Draft', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await publicTitle()).toBe(before);
    await page.reload();
    await expect(title).toHaveValue(savedTitle);
    const savedTime = page.locator('main time');
    await expect(savedTime).toHaveCount(1);
    const instant = await savedTime.getAttribute('datetime');
    expect(instant).toBeTruthy();
    const formatted = new Intl.DateTimeFormat(locale, {
      timeZone: accountTimezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(instant!));
    await expect(savedTime).toContainText(formatted);
    failTimezone = true;
    await page.evaluate(() => window.dispatchEvent(new Event('barghsa:timezone-changed')));
    await expect(page.getByRole('alert')).toContainText(
      fa ? 'دریافت منطقه زمانی ناموفق بود' : 'Could not load your timezone'
    );
    await expect(savedTime).toHaveCount(0);
    failTimezone = false;
    await page
      .getByRole('button', {
        name: fa ? 'تلاش دوباره برای منطقه زمانی' : 'Retry timezone',
        exact: true,
      })
      .click();
    await expect(savedTime).toContainText(formatted);

    const preview = page.getByRole('img', {
      name: fa ? 'پیش‌نمایش نشان' : 'Logo preview',
      exact: true,
    });
    await expect(preview).toHaveAttribute('src', /^\/api\/admin\/branding\/assets\//);
    await expect
      .poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBe(1);

    await title.fill('Unsaved change');
    await expect(
      page.getByRole('button', { name: fa ? 'انتشار' : 'Activate', exact: true })
    ).toBeDisabled();
    await title.fill(savedTitle);
    await page.getByRole('button', { name: fa ? 'انتشار' : 'Activate', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await publicTitle()).toBe(savedTitle);
    await expect(page).toHaveTitle(savedTitle);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--primary')))
      .toBe('#777777');
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.style.getPropertyValue('--primary-foreground'))
      )
      .toBe('#000000');
    await title.fill(`Next draft ${locale}`);
    await page
      .getByRole('button', { name: fa ? 'ذخیره پیش‌نویس' : 'Save Draft', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    await expect(title).toHaveValue(`Next draft ${locale}`);
    expect(await publicTitle()).toBe(savedTitle);
  });
}

test('TOS rich draft preview and publication persist through the migrated API', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.documentElement) document.documentElement.lang = 'en';
    }).observe(document, { childList: true });
  });
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
  await page.goto('/admin/tos');
  await page.getByRole('button', { name: 'New Draft', exact: true }).click();
  await page.getByLabel('Version ID').fill('live-terms-v1');
  await page.getByRole('textbox', { name: 'Persian content', exact: true }).fill('شرایط انتشار');
  const english = page.getByRole('textbox', { name: 'English content', exact: true });
  await english.fill('Published terms');
  await english.press('ControlOrMeta+a');
  await page
    .getByRole('group', { name: 'English content: Formatting' })
    .getByRole('button', { name: 'Bold', exact: true })
    .click();
  await page.getByRole('button', { name: 'Create Draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const preview = page.getByRole('region', { name: 'Publish TOS Version', exact: true });
  await expect(preview.getByRole('region', { name: 'Draft preview' }).locator('strong')).toHaveText(
    'Published terms'
  );
  await page.screenshot({ path: testInfo.outputPath('tos-preview.png'), fullPage: true });
  await preview.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(preview).toHaveCount(0);
  const current = await page.request.get(`${http.base}/api/tos/current?locale=en`);
  expect(current.status()).toBe(200);
  expect(await current.json()).toMatchObject({
    versionId: 'live-terms-v1',
    content: '**Published terms**',
  });
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('live-terms-v1');
});
