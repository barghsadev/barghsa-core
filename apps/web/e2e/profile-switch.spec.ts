import { fullNavigation } from './navigation-fixture';
import { fulfillDashboard } from './dashboard-fixture';
import { cookieResponse } from './cookie-response';
import { test, expect, type Page } from './coverage-fixture';
import { tSettingsForms } from '@barghsa/i18n/settings-forms';
import { t } from '@barghsa/i18n/app';

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
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'switch-viewer',
        isStaff: false,
        navigation: fullNavigation('customer', 'LEGAL'),
        operatingContext: 'customer',
        requiresTosAcceptance: false,
      },
    })
  );
  await page.route('**/api/invitations/pending', (route) =>
    route.fulfill({ json: { invitations: [] } })
  );
  await page.route('**/api/v1/notifications**', (route) =>
    route.fulfill({ json: { data: [], next_cursor: null, unread_count: 0 } })
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
      localStorage.setItem('barghsa.locale', value);
      if (document.documentElement) document.documentElement.lang = value;
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await page
      .context()
      .addCookies([{ url: baseURL!, name: 'barghsa_csrf', value: 'settings-token' }]);
    const first = '99111111-1111-4111-8111-111111111111';
    const second = '99222222-2222-4222-8222-222222222222';
    const storedDefault = first;
    const savedProfile = (id: string) => ({
      ...profile(id),
      isDefault: id === storedDefault,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    });
    let active = first;
    let attempts = 0;
    await page.route('**/api/profiles', (route) =>
      route.fulfill({
        json: {
          profiles: [savedProfile(first), savedProfile(second)],
          activeProfileId: active,
          hasDefault: true,
        },
      })
    );
    await page.route(/\/api\/profiles\/99[0-9a-f-]{34}$/, (route) => {
      const id = route.request().url().split('/').at(-1)!;
      return route.fulfill({
        json: {
          ...savedProfile(id),
          addresses: [],
          canEditIdentity: false,
          legalInfo: {
            legalName: 'Example Company',
            nationalIdentifier: '12345678901',
            registrationNumber: '123',
            companyTypeId: 'private-joint-stock',
            economicCode: null,
            representativeFirstName: 'Sara',
            representativeLastName: 'Example',
            representativeNationalId: '0010350829',
            representativeFullAddress: 'Representative address',
            representativePostalCode: '1234567890',
            representativeTitle: 'Director',
            representativeRelationship: 'Authorized representative',
          },
        },
      });
    });
    await page.route('**/api/geography/provinces', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/onboarding/documents/*', (route) =>
      route.fulfill({ json: { documents: [] } })
    );
    await page.route(`**/api/profiles/default/${second}`, (route) => {
      expect(route.request().method()).toBe('POST');
      expect(route.request().headers()['x-csrf-token']).toBe('settings-token');
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 503, json: {} });
      if (attempts === 2) return route.fulfill({ json: { activeProfileId: 'wrong-profile' } });
      active = second;
      return route.fulfill({ json: { activeProfileId: active } });
    });
    await page.goto('/settings/profile');
    const preferences = page.getByRole('region', {
      name: locale === 'fa' ? 'انتخاب پروفایل پیش‌فرض' : 'Select Default Profile',
    });
    const selector = preferences.getByRole('combobox');
    await expect(selector).toHaveValue(first);
    await page.evaluate(() => {
      document.documentElement.dataset.profileSettingsSentinel = 'retained';
    });
    for (let attempt = 1; attempt <= 2; attempt++) {
      await selector.selectOption(second);
      await expect.poll(() => attempts).toBe(attempt);
      await expect(
        preferences.getByRole('alert').filter({
          hasText: locale === 'fa' ? 'تغییر پروفایل با خطا مواجه شد' : 'Failed to switch profile',
        })
      ).toHaveText(locale === 'fa' ? 'تغییر پروفایل با خطا مواجه شد' : 'Failed to switch profile');
      await expect(selector).toBeDisabled();
      await page
        .getByRole('button', { name: tSettingsForms('refreshConfirmation', locale), exact: true })
        .click();
      await expect(
        page.getByRole('alert').filter({ hasText: tSettingsForms('confirmationMismatch', locale) })
      ).toBeVisible();
      expect(attempts).toBe(attempt);
      await page
        .getByRole('button', { name: tSettingsForms('resetCapture', locale), exact: true })
        .click();
      await expect(selector).toBeEnabled();
      await expect(selector).toHaveValue(first);
    }
    await selector.selectOption(second);
    await expect(selector).toHaveValue(second);
    await expect(preferences.getByRole('alert')).toHaveCount(0);
    expect(attempts).toBe(3);
    await expect(page.locator('html')).toHaveAttribute(
      'data-profile-settings-sentinel',
      'retained'
    );
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await openProfileMenu(page);
    const sidebarSelector = page.locator('#profile-switcher');
    await expect(sidebarSelector).toHaveValue(second);
    expect(await selector.getAttribute('id')).not.toBe(await sidebarSelector.getAttribute('id'));
    await page.reload();
    await expect(selector).toHaveValue(second);
  });
}

for (const locale of ['fa', 'en'] as const) {
  test(`accepting an invitation refreshes profiles and uses rotated CSRF (${locale})`, async ({
    page,
    baseURL,
  }) => {
    await shell(page);
    await page.addInitScript((value) => {
      localStorage.setItem('barghsa.locale', value);
      if (document.documentElement) document.documentElement.lang = value;
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await page
      .context()
      .addCookies([{ url: baseURL!, name: 'barghsa_csrf', value: 'before-accept' }]);
    const invitationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const invitedProfileId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
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
                  id: invitationId,
                  profileId: invitedProfileId,
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
          profiles: [profile('existing'), ...(accepted ? [profile(invitedProfileId)] : [])],
          activeProfileId: active,
          hasDefault: true,
        },
      })
    );
    await page.route('**/api/dashboard{,/**}', (route) =>
      fulfillDashboard(route, {
        json: {
          wallet: { balance: 0, currency: 'IRR', lowBalanceWarning: false },
          activeOrders: 0,
          pendingInvoices: 0,
          openTickets: 0,
          contracts: { active: 0, total: 0 },
        },
      })
    );
    await page.route(`**/api/invitations/${invitationId}/accept`, (route) => {
      expect(route.request().headers()['x-csrf-token']).toBe('before-accept');
      expect(route.request().postDataJSON()).toEqual({
        expectedProfileId: invitedProfileId,
        expectedRole: 'Finance',
      });
      attempts++;
      if (attempts === 1)
        return route.fulfill({ status: 409, json: { error: { code: 'CONFLICT:STATE' } } });
      accepted = true;
      return cookieResponse(route, {
        headers: { 'Set-Cookie': 'barghsa_csrf=after-accept; Path=/; SameSite=Strict' },
        json: {
          invitation: {
            id: invitationId,
            profileId: invitedProfileId,
            role: 'Finance',
            status: 'Accepted',
          },
        },
      });
    });
    await page.route(`**/api/profiles/switch/${invitedProfileId}`, (route) => {
      expect(route.request().headers()['x-csrf-token']).toBe('after-accept');
      active = invitedProfileId;
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
    await expect(accept).toBeDisabled();
    await page
      .getByRole('alert')
      .filter({ hasText: t('invitation.banner.error', locale) })
      .getByRole('button', { name: t('team.retry', locale), exact: true })
      .click();
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
    await expect(selector.locator(`option[value="${invitedProfileId}"]`)).toHaveCount(1);
    await selector.selectOption(invitedProfileId);
    const menu = page.locator('button[aria-controls="dashboard-navigation"]');
    if (await menu.isVisible()) await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await openProfileMenu(page);
    await expect(selector).toHaveValue(invitedProfileId);
    await expect(page).toHaveURL(/\/app$/);
    expect(attempts).toBe(2);
  });
  test(`selecting the only remaining profile clears old page data (${locale})`, async ({
    page,
  }) => {
    await shell(page);
    await page.addInitScript((value) => {
      localStorage.setItem('barghsa.locale', value);
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
    await page.route('**/api/dashboard{,/**}', (route) => {
      dashboardReads++;
      return fulfillDashboard(route, {
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
  await page.locator('#profile-switcher').selectOption('second');
  await openProfileMenu(page);
  await expect(page.locator('#profile-switcher')).toHaveValue('first');
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
  await expect(page.locator('#profile-switcher')).toHaveValue('first');
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
    await page.route('**/api/dashboard{,/**}', (route) =>
      fulfillDashboard(route, {
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
  await pages[0]!.locator('#profile-switcher').selectOption('second');
  for (const page of pages) {
    await openProfileMenu(page);
    await expect(page.locator('#profile-switcher')).toHaveValue('second');
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
  let oldDashboardReads = 0;
  let oldDashboardReleased = 0;
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [profile('first'), profile('second')],
        activeProfileId: active,
        hasDefault: true,
      },
    })
  );
  await page.route('**/api/dashboard{,/**}', async (route) => {
    const requestedProfile = active;
    if (requestedProfile === 'first') {
      oldReads++;
      oldDashboardReads++;
      await oldReleased;
      oldDashboardReleased++;
    }
    await fulfillDashboard(route, {
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
      json: { data: [], next_cursor: null, unread_count: requestedProfile === 'first' ? 19 : 3 },
    });
  });
  await page.route('**/api/profiles/switch/second', (route) => {
    active = 'second';
    return route.fulfill({ json: { activeProfileId: active } });
  });
  try {
    await page.goto('/dashboard');
    await expect.poll(() => oldReads).toBeGreaterThanOrEqual(3);
    await expect.poll(() => oldDashboardReads).toBeGreaterThan(0);
    await openProfileMenu(page);
    await page.locator('#profile-switcher').selectOption('second');
    await expect(page.locator('main')).toContainText('۹۸۷٬۶۵۴');
    await expect(page.getByTestId('notification-bell').getByRole('status')).toHaveText('۳');
    releaseOld();
    // The old dashboard context request is aborted on switch; its delayed
    // fulfillment must not populate any of the new profile's widget resources.
    await expect.poll(() => oldDashboardReleased).toBeGreaterThan(0);
    await expect(page.locator('main')).toContainText('۹۸۷٬۶۵۴');
    await expect(page.locator('main')).not.toContainText('۱۲۳٬۴۵۶');
    await expect(page.getByTestId('notification-bell').getByRole('status')).toHaveText('۳');
  } finally {
    releaseOld();
  }
});
