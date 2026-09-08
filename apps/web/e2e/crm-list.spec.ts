import AxeBuilder from '@axe-core/playwright';
import { mockOppositeNumerals } from './number-preference-fixture';
import { test, expect } from './coverage-fixture';
const user = {
  userId: 'user-one',
  username: 'person@example.test',
  registrationDate: '2026-08-01T00:00:00.000001Z',
  lastLogin: null,
  profileCount: 1,
  hasVerifiedProfile: false,
  profiles: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      profileType: 'INDIVIDUAL',
      status: 'PENDING_VERIFICATION',
      title: 'Example profile',
    },
  ],
};
for (const locale of ['en', 'fa'])
  test(`CRM filters, profile links and cursor navigation (${locale})`, async ({ page }) => {
    await page.addInitScript((value) => {
      if (document.documentElement) document.documentElement.lang = value;
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await mockOppositeNumerals(page, locale);
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'Asia/Tehran' } })
    );
    const requests: URL[] = [];
    await page.route('**/api/crm/users?*', (route) => {
      const url = new URL(route.request().url());
      requests.push(url);
      return route.fulfill({
        json: {
          users: url.searchParams.get('cursor') ? [] : [user],
          cursor: url.searchParams.get('cursor') ? null : 'page-two',
          hasMore: !url.searchParams.get('cursor'),
        },
      });
    });
    await page.goto('/admin/crm?verification=PENDING');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      locale === 'fa' ? 'کاربران مدیریت مشتریان' : 'CRM users'
    );
    await expect(page.getByRole('rowheader', { name: user.username })).toBeVisible();
    expect(requests.at(-1)!.searchParams.get('verification')).toBe('PENDING');
    await page
      .getByRole('button', { name: locale === 'fa' ? 'پروفایل‌ها: 1' : 'Profiles: ۱' })
      .click();
    await expect(page.getByRole('link', { name: /Example profile/ })).toHaveAttribute(
      'href',
      `/admin/crm/profiles/${user.profiles[0]!.id}`
    );
    await page
      .getByRole('button', { name: locale === 'fa' ? 'بستن همه' : 'Collapse all', exact: true })
      .click();
    await expect(page.getByRole('link', { name: /Example profile/ })).toHaveCount(0);
    await page
      .getByRole('button', { name: locale === 'fa' ? 'بعدی' : 'Next', exact: true })
      .click();
    await expect(
      page.getByText(locale === 'fa' ? 'کاربری با این مشخصات پیدا نشد.' : 'No matching users.')
    ).toBeVisible();
    expect(requests.at(-1)!.searchParams.get('cursor')).toBe('page-two');
    await page.locator('#crm-type').selectOption('LEGAL');
    await expect(page.getByRole('rowheader', { name: user.username })).toBeVisible();
    expect(requests.at(-1)!.searchParams.has('cursor')).toBe(false);
    await page.locator('#crm-search').fill('Example');
    await expect.poll(() => requests.at(-1)!.searchParams.get('search')).toBe('Example');
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'پاک کردن فیلترها' : 'Clear filters',
        exact: true,
      })
      .click();
    await expect.poll(() => requests.at(-1)!.searchParams.has('verification')).toBe(false);
  });
test('CRM access errors remain errors and can be retried', async ({ page }) => {
  await page.addInitScript(() => {
    if (document.documentElement) document.documentElement.lang = 'en';
    new MutationObserver(() => {
      if (document.documentElement) document.documentElement.lang = 'en';
    }).observe(document, { childList: true });
  });
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  let allowed = false;
  await page.route('**/api/crm/users?*', (route) =>
    route.fulfill(
      allowed ? { json: { users: [], cursor: null, hasMore: false } } : { status: 403, json: {} }
    )
  );
  await page.goto('/admin/crm');
  await expect(page.getByRole('alert')).toContainText('Check your access');
  allowed = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('No matching users.')).toBeVisible();
});
test('Persian picker uses Jalali month boundaries and sends Gregorian API dates', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (document.documentElement) document.documentElement.lang = 'fa';
    new MutationObserver(() => {
      if (document.documentElement) document.documentElement.lang = 'fa';
    }).observe(document, { childList: true });
  });
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  const requests: URL[] = [];
  await page.route('**/api/crm/users?*', (route) => {
    requests.push(new URL(route.request().url()));
    return route.fulfill({ json: { users: [], cursor: null, hasMore: false } });
  });
  await page.goto('/admin/crm');
  await expect(page.getByRole('combobox', { name: 'ثبت‌نام از', exact: true })).toBeEnabled();
  await page.clock.setFixedTime(new Date('2026-03-21T12:00:00Z'));
  await page.getByRole('combobox', { name: 'ثبت‌نام از', exact: true }).click();
  const calendar = page.locator('[data-slot="calendar"]');
  await expect(calendar).toContainText('فروردین');
  const firstDay = calendar
    .getByRole('button', { name: /فروردین.*۱.*۱۴۰۵|۱.*فروردین.*۱۴۰۵/ })
    .first();
  await firstDay.click();
  await expect
    .poll(() => requests.at(-1)?.searchParams.get('dateFrom'))
    .toBe('2026-03-20T20:30:00.000Z');
  await expect(page.getByRole('combobox', { name: 'ثبت‌نام از', exact: true })).toContainText(
    '۱ فروردین ۱۴۰۵'
  );
});
test('Jalali leap-day selection and keyboard dismissal preserve the date', async ({ page }) => {
  await page.addInitScript(() => {
    if (document.documentElement) document.documentElement.lang = 'fa';
    new MutationObserver(() => {
      if (document.documentElement) document.documentElement.lang = 'fa';
    }).observe(document, { childList: true });
  });
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  const requests: URL[] = [];
  await page.route('**/api/crm/users?*', (route) => {
    requests.push(new URL(route.request().url()));
    return route.fulfill({ json: { users: [], cursor: null, hasMore: false } });
  });
  await page.goto('/admin/crm');
  const trigger = page.getByRole('combobox', { name: 'ثبت‌نام تا', exact: true });
  await expect(trigger).toBeEnabled();
  await page.clock.setFixedTime(new Date('2025-03-20T12:00:00Z'));
  await trigger.focus();
  await page.keyboard.press('Enter');
  const calendar = page.locator('[data-slot="calendar"]');
  await expect(calendar).toContainText('اسفند');
  await calendar.getByRole('button', { name: /۳۰.*اسفند.*۱۴۰۳|اسفند.*۳۰.*۱۴۰۳/ }).click();
  await expect
    .poll(() => requests.at(-1)?.searchParams.get('dateTo'))
    .toBe('2025-03-20T20:29:59.999999Z');
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(calendar).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText('۳۰ اسفند ۱۴۰۳');
});

test('CRM waits for account timezone, retries and displays registration in that zone', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (document.documentElement) document.documentElement.lang = 'en';
    new MutationObserver(() => {
      document.documentElement.lang = 'en';
    }).observe(document, { childList: true });
  });
  let failed = true;
  let queries = 0;
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill(failed ? { status: 503, json: {} } : { json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/crm/users?*', (route) => {
    queries++;
    return route.fulfill({
      json: {
        users: [
          {
            userId: 'zone-user',
            username: 'zone@example.test',
            registrationDate: '2026-03-20T22:00:00Z',
            lastLogin: null,
            profileCount: 0,
            hasVerifiedProfile: false,
            profiles: [],
          },
        ],
        cursor: null,
        hasMore: false,
      },
    });
  });
  await page.goto('/admin/crm');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('#crm-dateFrom')).toBeDisabled();
  expect(queries).toBe(0);
  failed = false;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('#crm-dateFrom')).toBeEnabled();
  await expect(page.getByText('Account timezone: Asia/Tehran', { exact: true })).toBeVisible();
  await expect(page.getByText('21 Mar 2026', { exact: true })).toBeVisible();
});

for (const locale of ['fa', 'en'])
  for (const darkMode of [false, true])
    test(
      'CRM table sorting, complete columns and failure recovery (' +
        locale +
        ', dark=' +
        darkMode +
        ')',
      async ({ page }, testInfo) => {
        await page.addInitScript((locale) => {
          const apply = () => {
            document.documentElement.lang = locale;
            document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
          };
          if (document.documentElement) apply();
          new MutationObserver(apply).observe(document, { childList: true });
        }, locale);
        await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
        await page.route('**/api/public/branding/config', (route) =>
          route.fulfill({
            json: {
              appTitle: 'CRM review',
              slogan: '',
              primaryColor: '#2563eb',
              secondaryColor: '#64748b',
              accentColor: '#f59e0b',
              logoUrl: null,
              faviconUrl: null,
              darkMode,
            },
          })
        );
        await page.route('**/api/user/settings/timezone', (route) =>
          route.fulfill({ json: { timezone: 'Asia/Tehran' } })
        );
        let customerProfileChecks = 0;
        await page.route('**/api/profiles', (route) => {
          customerProfileChecks++;
          return route.fulfill({ json: [] });
        });
        const twoProfiles = {
          ...user,
          profileCount: 2,
          profiles: [
            ...user.profiles,
            {
              id: '22222222-2222-4222-8222-222222222222',
              profileType: 'LEGAL',
              status: 'ACTIVE',
              title: 'Company profile',
            },
          ],
        };
        const withoutProfiles = {
          ...user,
          userId: 'no-profile-user',
          username: 'new@example.test',
          profileCount: 0,
          profiles: [],
        };
        const requests: URL[] = [];
        let override: unknown = undefined;
        await page.route('**/api/crm/users?*', (route) => {
          const url = new URL(route.request().url());
          requests.push(url);
          return route.fulfill({
            json: override ?? {
              users: url.searchParams.has('cursor')
                ? [withoutProfiles]
                : [twoProfiles, withoutProfiles],
              hasMore: !url.searchParams.has('cursor'),
              cursor: url.searchParams.has('cursor') ? null : 'page-two',
            },
          });
        });
        await page.goto('/app/crm?verification=PENDING');
        await expect(page).toHaveURL(/\/admin\/crm\/?\?verification=PENDING$/);
        const main = page.getByRole('main'),
          table = main.getByRole('table');
        await expect(table).toBeVisible();
        expect(customerProfileChecks).toBe(0);
        await expect(table.getByRole('columnheader')).toHaveCount(6);
        await expect(
          table.getByRole('rowheader', { name: user.username, exact: true })
        ).toBeVisible();
        const types = table
          .getByRole('row')
          .filter({ has: page.getByRole('rowheader', { name: user.username, exact: true }) });
        await expect(types).toContainText(locale === 'fa' ? 'حقیقی' : 'Individual');
        await expect(types).toContainText(locale === 'fa' ? 'حقوقی' : 'Legal');
        await expect(types.locator('svg')).toHaveCount(2);
        await expect(
          table
            .getByRole('row')
            .filter({ has: page.getByRole('rowheader', { name: 'new@example.test' }) })
            .getByRole('button')
        ).toBeDisabled();
        await main
          .getByRole('button', { name: locale === 'fa' ? 'بعدی' : 'Next', exact: true })
          .click();
        await expect.poll(() => requests.at(-1)?.searchParams.get('cursor')).toBe('page-two');
        for (const [sort, label] of [
          ['username', locale === 'fa' ? 'نام کاربری' : 'Username'],
          ['lastLogin', locale === 'fa' ? 'آخرین ورود' : 'Last login'],
          ['profileCount', locale === 'fa' ? 'پروفایل‌ها' : 'Profiles'],
          ['createdAt', locale === 'fa' ? 'ثبت‌نام' : 'Registered'],
        ]) {
          const header = table.getByRole('columnheader', { name: label!, exact: true });
          const button = header.getByRole('button');
          for (const order of ['asc', 'desc']) {
            await button.focus();
            await button.press('Enter');
            await expect(header).toHaveAttribute(
              'aria-sort',
              order === 'asc' ? 'ascending' : 'descending'
            );
            await expect.poll(() => requests.at(-1)?.searchParams.get('sort')).toBe(sort);
            await expect.poll(() => requests.at(-1)?.searchParams.get('order')).toBe(order);
            expect(requests.at(-1)?.searchParams.has('cursor')).toBe(false);
            await expect(button).toBeFocused();
          }
        }
        const toggle = types.getByRole('button');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(table.getByRole('link', { name: /Company profile/ })).toBeVisible();
        const scan = await new AxeBuilder({ page })
          .include('#admin-content')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        expect(scan.violations).toEqual([]);
        const region = table.locator('..');
        const regionBounds = (await region.boundingBox())!;
        const companyBounds = (await table
          .getByRole('link', { name: /Company profile/ })
          .boundingBox())!;
        expect(companyBounds.x).toBeGreaterThanOrEqual(regionBounds.x);
        expect(companyBounds.x + companyBounds.width).toBeLessThanOrEqual(
          regionBounds.x + regionBounds.width
        );
        // A horizontal table can clip a text node at the viewport edge.
        // Prove that clipping, reveal each affected node, and rescan it fully.
        const clipped = await Promise.all(
          scan.incomplete
            .filter((item) => item.id === 'color-contrast')
            .flatMap((item) => item.nodes)
            .map(async (node) => {
              expect(
                node.any.some((check) => check.data?.messageKey === 'elmPartiallyObscured')
              ).toBe(true);
              expect(node.target).toHaveLength(1);
              expect(typeof node.target[0]).toBe('string');
              const selector = node.target[0] as string;
              return { selector, bounds: (await page.locator(selector).boundingBox())! };
            })
        );
        for (const { selector, bounds } of clipped) {
          expect(
            bounds.x < regionBounds.x ||
              bounds.x + bounds.width > regionBounds.x + regionBounds.width
          ).toBe(true);
          const node = page.locator(selector);
          await node.scrollIntoViewIfNeeded();
          const visible = (await node.boundingBox())!;
          expect(visible.x).toBeGreaterThanOrEqual(regionBounds.x);
          expect(visible.x + visible.width).toBeLessThanOrEqual(
            regionBounds.x + regionBounds.width
          );
          const revealed = await new AxeBuilder({ page })
            .include(selector)
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze();
          expect(revealed.violations).toEqual([]);
          expect(revealed.incomplete.filter((item) => item.id === 'color-contrast')).toEqual([]);
        }
        await testInfo.attach('revealed-table-contrast', {
          contentType: 'application/json',
          body: JSON.stringify(clipped),
        });

        expect(
          await main.evaluate((node) => node.scrollWidth - node.clientWidth)
        ).toBeLessThanOrEqual(1);
        await main.screenshot({
          path:
            '/tmp/barghsa-crm-list-' +
            locale +
            '-' +
            darkMode +
            '-' +
            testInfo.project.name +
            '.png',
        });
        await main
          .getByRole('button', { name: locale === 'fa' ? 'بستن همه' : 'Collapse all', exact: true })
          .click();
        await expect(table.getByRole('link')).toHaveCount(0);
        for (const bad of [
          { users: 'bad', cursor: null, hasMore: false },
          { users: [{ ...user, profiles: null }], cursor: null, hasMore: false },
          { users: [{ ...user, registrationDate: 'bad' }], cursor: null, hasMore: false },
          { users: [{ ...user, profileCount: 99 }], cursor: null, hasMore: false },
          { users: [user], cursor: null, hasMore: true },
        ]) {
          override = bad;
          await main
            .getByRole('button', { name: locale === 'fa' ? 'تازه‌سازی' : 'Refresh', exact: true })
            .click();
          await expect(main.getByRole('alert')).toBeVisible();
          await expect(table).toHaveCount(0);
        }
        override = { users: [], cursor: null, hasMore: false };
        await main
          .getByRole('button', { name: locale === 'fa' ? 'تازه‌سازی' : 'Refresh', exact: true })
          .click();
        await expect(
          main.getByText(locale === 'fa' ? 'کاربری با این مشخصات پیدا نشد.' : 'No matching users.')
        ).toBeVisible();
      }
    );
