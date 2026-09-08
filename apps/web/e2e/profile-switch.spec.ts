import { test, expect, type Page } from './coverage-fixture';

const profile = (id: string) => ({
  id,
  profileType: 'LEGAL',
  isDefault: false,
  status: 'ACTIVE',
  title: id,
  firstName: null,
  lastName: null,
  nationalId: null,
});
async function shell(page: Page) {
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/invitations/pending', (route) =>
    route.fulfill({ json: { invitations: [] } })
  );
  await page.route('**/api/v1/notifications**', (route) =>
    route.fulfill({ json: { data: [], unread_count: 0 } })
  );
}
async function openProfileMenu(page: Page) {
  const menu = page.locator('button[aria-controls="dashboard-navigation"]');
  await expect(menu).toBeAttached();
  if ((await menu.isVisible()) && (await menu.getAttribute('aria-expanded')) === 'false') {
    await menu.click();
  }
}

for (const locale of ['fa', 'en'] as const) {
  test(`profile settings changes the saved default and recovers failed switches (${locale})`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await shell(page);
    await page.addInitScript((value) => {
      if (document.documentElement) document.documentElement.lang = value;
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await page
      .context()
      .addCookies([{ url: baseURL!, name: 'barghsa_csrf', value: 'settings-token' }]);
    let active = 'first';
    let attempts = 0;
    await page.route('**/api/profiles', (route) =>
      route.fulfill({
        json: {
          profiles: [profile('first'), profile('second')],
          activeProfileId: active,
          hasDefault: true,
        },
      })
    );
    await page.route(/\/api\/profiles\/(first|second)$/, (route) => {
      const id = route.request().url().split('/').at(-1)!;
      return route.fulfill({ json: { ...profile(id), addresses: [], legalInfo: null } });
    });
    await page.route('**/api/geography/provinces', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/profiles/switch/second', (route) => {
      expect(route.request().method()).toBe('POST');
      expect(route.request().headers()['x-csrf-token']).toBe('settings-token');
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 503, json: {} });
      if (attempts === 2) return route.fulfill({ json: { activeProfileId: 'wrong-profile' } });
      active = 'second';
      return route.fulfill({ json: { activeProfileId: active } });
    });
    await page.goto('/settings/profile');
    const preferences = page.getByRole('region', {
      name: locale === 'fa' ? 'انتخاب پروفایل پیش‌فرض' : 'Select Default Profile',
    });
    const selector = preferences.getByRole('combobox');
    await expect(selector).toHaveValue('first');
    await page.evaluate(() => {
      document.documentElement.dataset.profileSettingsSentinel = 'retained';
    });
    for (let attempt = 1; attempt <= 2; attempt++) {
      await selector.selectOption('second');
      await expect.poll(() => attempts).toBe(attempt);
      await expect(preferences.getByRole('alert')).toHaveText(
        locale === 'fa' ? 'تغییر پروفایل با خطا مواجه شد' : 'Failed to switch profile'
      );
      await expect(selector).toBeEnabled();
      await expect(selector).toHaveValue('first');
    }
    await selector.selectOption('second');
    await expect(selector).toHaveValue('second');
    await expect(preferences.getByRole('alert')).toHaveCount(0);
    expect(attempts).toBe(3);
    await expect(page.locator('html')).toHaveAttribute(
      'data-profile-settings-sentinel',
      'retained'
    );
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await openProfileMenu(page);
    const sidebarSelector = page.locator('#profile-switcher');
    await expect(sidebarSelector).toHaveValue('second');
    expect(await selector.getAttribute('id')).not.toBe(await sidebarSelector.getAttribute('id'));
    await page.reload();
    await expect(selector).toHaveValue('second');
  });
}

for (const locale of ['fa', 'en'] as const) {
  test(`accepting an invitation refreshes profiles and uses rotated CSRF (${locale})`, async ({
    page,
    baseURL,
  }) => {
    await shell(page);
    await page.addInitScript((value) => {
      if (document.documentElement) document.documentElement.lang = value;
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await page
      .context()
      .addCookies([{ url: baseURL!, name: 'barghsa_csrf', value: 'before-accept' }]);
    let accepted = false,
      attempts = 0,
      active = 'existing';
    await page.route('**/api/invitations/pending', (route) =>
      route.fulfill({
        json: {
          invitations: accepted
            ? []
            : [
                {
                  id: 'invite-cookie',
                  profileId: 'invited',
                  profileName: 'Inviting company',
                  role: 'Finance',
                  invitedBy: 'owner',
                  inviterName: 'Owner',
                  createdAt: '2026-09-01T01:00:00Z',
                  expiresAt: null,
                },
              ],
        },
      })
    );
    await page.route('**/api/profiles', (route) =>
      route.fulfill({
        json: {
          profiles: [profile('existing'), ...(accepted ? [profile('invited')] : [])],
          activeProfileId: active,
          hasDefault: true,
        },
      })
    );
    await page.route('**/api/dashboard', (route) =>
      route.fulfill({
        json: {
          wallet: { balance: 0, currency: 'IRR', lowBalanceWarning: false },
          activeOrders: 0,
          pendingInvoices: 0,
          openTickets: 0,
          contracts: { active: 0, total: 0 },
        },
      })
    );
    await page.route('**/api/invitations/invite-cookie/accept', (route) => {
      expect(route.request().headers()['x-csrf-token']).toBe('before-accept');
      attempts++;
      if (attempts === 1)
        return route.fulfill({ status: 409, json: { error: { code: 'CONFLICT:STATE' } } });
      accepted = true;
      return route.fulfill({
        headers: { 'Set-Cookie': 'barghsa_csrf=after-accept; Path=/; SameSite=Strict' },
        json: { message: 'Invitation accepted successfully.' },
      });
    });
    await page.route('**/api/profiles/switch/invited', (route) => {
      expect(route.request().headers()['x-csrf-token']).toBe('after-accept');
      active = 'invited';
      return route.fulfill({ json: { activeProfileId: active } });
    });
    await page.goto('/dashboard');
    const accept = page.getByRole('button', {
      name: locale === 'fa' ? 'پذیرفتن' : 'Accept',
      exact: true,
    });
    await accept.click();
    await expect(
      page.getByText(locale === 'fa' ? 'خطا در پردازش دعوتنامه' : 'Error processing invitation', {
        exact: true,
      })
    ).toBeVisible();
    await expect(accept).toBeEnabled();
    expect(
      (await page.context().cookies()).find((cookie) => cookie.name === 'barghsa_csrf')?.value
    ).toBe('before-accept');
    await accept.click();
    await expect(
      page.getByText(
        locale === 'fa' ? 'دعوتنامه با موفقیت پذیرفته شد' : 'Invitation accepted successfully',
        { exact: true }
      )
    ).toBeVisible();
    await openProfileMenu(page);
    const selector = page.getByRole('combobox', {
      name: locale === 'fa' ? 'تغییر پروفایل فعال' : 'Switch active profile',
    });
    await expect(selector.locator('option[value="invited"]')).toHaveCount(1);
    await selector.selectOption('invited');
    const menu = page.locator('button[aria-controls="dashboard-navigation"]');
    if (await menu.isVisible()) await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await openProfileMenu(page);
    await expect(selector).toHaveValue('invited');
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(attempts).toBe(2);
  });
  test(`selecting the only remaining profile clears old page data (${locale})`, async ({
    page,
  }) => {
    await shell(page);
    await page.addInitScript((value) => {
      if (document.documentElement) document.documentElement.lang = value;
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    let active: string | null = null;
    let dashboardReads = 0;
    await page.route('**/api/profiles', (route) =>
      route.fulfill({
        json: {
          profiles: [profile('remaining')],
          activeProfileId: active,
          hasDefault: active !== null,
        },
      })
    );
    await page.route('**/api/dashboard', (route) => {
      dashboardReads++;
      return route.fulfill({
        json: {
          wallet: { balance: active ? 987654 : 123456, currency: 'IRR', lowBalanceWarning: false },
          activeOrders: 0,
          pendingInvoices: 0,
          openTickets: 0,
          contracts: { active: 0, total: 0 },
        },
      });
    });
    await page.route('**/api/profiles/switch/remaining', (route) => {
      expect(route.request().method()).toBe('POST');
      active = 'remaining';
      return route.fulfill({ json: { activeProfileId: active } });
    });
    await page.goto('/dashboard');
    await openProfileMenu(page);
    const selector = page.getByRole('combobox', {
      name: locale === 'fa' ? 'تغییر پروفایل فعال' : 'Switch active profile',
    });
    await expect(selector).toHaveValue('');
    await expect(page.locator('main')).toContainText(locale === 'fa' ? '۱۲۳٬۴۵۶' : '123,456');
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).profileSwitchDocument = 'preserved';
    });
    let documentRequests = 0;
    page.on('request', (request) => {
      if (request.resourceType() === 'document') documentRequests++;
    });
    await selector.selectOption('remaining');
    await expect(page.locator('main')).toContainText(locale === 'fa' ? '۹۸۷٬۶۵۴' : '987,654');
    await expect(page.locator('main')).not.toContainText(locale === 'fa' ? '۱۲۳٬۴۵۶' : '123,456');
    await expect(page.locator('#dashboard-navigation select')).toHaveCount(0);
    expect(dashboardReads).toBeGreaterThanOrEqual(2);
    expect(documentRequests).toBe(0);
    expect(
      await page.evaluate(
        () => (window as unknown as Record<string, unknown>).profileSwitchDocument
      )
    ).toBe('preserved');
  });
}

test('a failed switch keeps the existing selection and reports the error', async ({ page }) => {
  await shell(page);
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [profile('first'), profile('second')],
        activeProfileId: 'first',
        hasDefault: true,
      },
    })
  );
  await page.route('**/api/profiles/switch/second', (route) =>
    route.fulfill({ status: 403, json: { error: 'forbidden' } })
  );
  await page.goto('/dashboard');
  await openProfileMenu(page);
  await page.getByRole('combobox').selectOption('second');
  await openProfileMenu(page);
  await expect(page.getByRole('combobox')).toHaveValue('first');
  await expect(page.getByRole('complementary').getByRole('alert')).toHaveText(
    'تغییر پروفایل با خطا مواجه شد'
  );
});

test('the initial radio selection submits from the required profile dialog', async ({ page }) => {
  await shell(page);
  let active: string | null = null;
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [profile('first'), profile('second')],
        activeProfileId: active,
        hasDefault: active !== null,
      },
    })
  );
  await page.route('**/api/profiles/switch/first', (route) => {
    active = 'first';
    return route.fulfill({ json: { activeProfileId: active } });
  });
  await page.goto('/dashboard');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const switched = page.waitForRequest('**/api/profiles/switch/first');
  await dialog.getByRole('button').click();
  await switched;
  await expect(dialog).toHaveCount(0);
  await openProfileMenu(page);
  await expect(page.getByRole('combobox')).toHaveValue('first');
});

test('switching refreshes another open tab without reloading either document', async ({
  context,
}) => {
  let active = 'first';
  const pages = await Promise.all([context.newPage(), context.newPage()]);
  for (const page of pages) {
    await shell(page);
    await page.route('**/api/profiles', (route) =>
      route.fulfill({
        json: {
          profiles: [profile('first'), profile('second')],
          activeProfileId: active,
          hasDefault: true,
        },
      })
    );
    await page.route('**/api/dashboard', (route) =>
      route.fulfill({
        json: {
          wallet: {
            balance: active === 'first' ? 123456 : 987654,
            currency: 'IRR',
            lowBalanceWarning: false,
          },
          activeOrders: 0,
          pendingInvoices: 0,
          openTickets: 0,
          contracts: { active: 0, total: 0 },
        },
      })
    );
    await page.goto('/dashboard');
    await expect(page.locator('main')).toContainText('۱۲۳٬۴۵۶');
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).profileSwitchDocument = 'preserved';
    });
  }
  await pages[0]!.route('**/api/profiles/switch/second', (route) => {
    active = 'second';
    return route.fulfill({ json: { activeProfileId: active } });
  });
  await openProfileMenu(pages[0]!);
  await pages[0]!.getByRole('combobox').selectOption('second');
  for (const page of pages) {
    await openProfileMenu(page);
    await expect(page.getByRole('combobox')).toHaveValue('second');
    await expect(page.locator('main')).toContainText('۹۸۷٬۶۵۴');
    await expect(page.locator('main')).not.toContainText('۱۲۳٬۴۵۶');
    expect(
      await page.evaluate(
        () => (window as unknown as Record<string, unknown>).profileSwitchDocument
      )
    ).toBe('preserved');
  }
});

test('late old-profile responses cannot overwrite the switched page or notification count', async ({
  page,
}) => {
  await shell(page);
  let active = 'first';
  let releaseOld!: () => void;
  const oldReleased = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  let oldReads = 0;
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [profile('first'), profile('second')],
        activeProfileId: active,
        hasDefault: true,
      },
    })
  );
  await page.route('**/api/dashboard', async (route) => {
    const requestedProfile = active;
    if (requestedProfile === 'first') {
      oldReads++;
      await oldReleased;
    }
    await route.fulfill({
      json: {
        wallet: {
          balance: requestedProfile === 'first' ? 123456 : 987654,
          currency: 'IRR',
          lowBalanceWarning: false,
        },
        activeOrders: 0,
        pendingInvoices: 0,
        openTickets: 0,
        contracts: { active: 0, total: 0 },
      },
    });
  });
  await page.route('**/api/v1/notifications**', async (route) => {
    const requestedProfile = active;
    if (requestedProfile === 'first') {
      oldReads++;
      await oldReleased;
    }
    await route.fulfill({
      json: { data: [], unread_count: requestedProfile === 'first' ? 19 : 3 },
    });
  });
  await page.route('**/api/profiles/switch/second', (route) => {
    active = 'second';
    return route.fulfill({ json: { activeProfileId: active } });
  });
  try {
    await page.goto('/dashboard');
    await expect.poll(() => oldReads).toBeGreaterThanOrEqual(3);
    await openProfileMenu(page);
    await page.getByRole('combobox').selectOption('second');
    await expect(page.locator('main')).toContainText('۹۸۷٬۶۵۴');
    await expect(page.getByTestId('notification-bell').getByRole('status')).toHaveText('۳');
    const settled = page.waitForResponse((response) => response.url().endsWith('/api/dashboard'));
    releaseOld();
    await settled;
    await expect(page.locator('main')).toContainText('۹۸۷٬۶۵۴');
    await expect(page.locator('main')).not.toContainText('۱۲۳٬۴۵۶');
    await expect(page.getByTestId('notification-bell').getByRole('status')).toHaveText('۳');
  } finally {
    releaseOld();
  }
});
