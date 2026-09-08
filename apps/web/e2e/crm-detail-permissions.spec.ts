import { formatBrowserDate } from './browser-date';
import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
const id = '11111111-1111-4111-8111-111111111111';
function detail(targetAdmin: boolean, allowed: boolean) {
  return {
    profile: {
      id,
      isDefault: true,
      archived: false,
      archivedAt: null as string | null,
      archivedReason: null as string | null,
      profileType: 'INDIVIDUAL',
      status: 'ACTIVE',
      title: 'Customer profile',
      contactEmail: 'office@example.test',
      contactMobile: '+989121234567',
      firstName: 'Example',
      lastName: 'Customer',
      nationalId: null,
      createdAt: '2026-08-01T01:00:00Z',
      updatedAt: '2026-08-01T01:00:00Z',
    },
    user: {
      userId: 'customer',
      username: 'customer@example.test',
      email: 'signin@example.test',
      mobile: '+989121234568',
      lastLogin: null,
      lastPasswordChange: '2026-08-02T01:00:00.000Z',
      isAdmin: targetAdmin,
      createdAt: '2026-08-01T01:00:00Z',
    },
    viewerPermissions: { canEdit: allowed, canVerify: allowed, canManageUser: allowed },
    legalInfo: null,
    addresses: [],
    sessions: { count: 0, lastActive: null, entries: [] },
    siblingProfiles: [],
  };
}
for (const allowed of [true, false])
  test(`CRM actions follow viewer access, not customer admin flag (${allowed})`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      if (document.documentElement) document.documentElement.lang = 'en';
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = 'en';
      }).observe(document, { childList: true });
    });
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'America/Los_Angeles' } })
    );
    await page.route(`**/api/crm/profiles/${id}`, (route) =>
      route.fulfill({ json: detail(!allowed, allowed) })
    );
    await page.goto(`/admin/crm/profiles/${id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Individual');
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(
      allowed ? 1 : 0
    );
    await expect(
      page.getByRole('button', { name: 'Force Password Change', exact: true })
    ).toHaveCount(allowed ? 1 : 0);
    await expect(page.getByRole('button', { name: 'Expire Sessions', exact: true })).toHaveCount(
      allowed ? 1 : 0
    );
  });

for (const locale of ['fa', 'en'] as const)
  test(`CRM required URL opens the retained archived profile (${locale})`, async ({ page }) => {
    await page.addInitScript((lang) => {
      if (document.documentElement) document.documentElement.lang = lang;
      new MutationObserver(() => {
        document.documentElement.lang = lang;
      }).observe(document, { childList: true });
    }, locale);
    const current = detail(false, true);
    Object.assign(current.profile, {
      isDefault: false,
      archived: true,
      archivedAt: '2026-08-02T01:00:00.000Z',
      archivedReason: 'Customer closure request',
    });
    let profileChecks = 0;
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/profiles', (route) => {
      profileChecks++;
      return route.fulfill({ json: [] });
    });
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'America/Los_Angeles' } })
    );
    await page.route(`**/api/crm/profiles/${id}`, (route) => route.fulfill({ json: current }));
    await page.goto(`/app/crm/profiles/${id}`);
    await expect(page).toHaveURL(new RegExp(`/admin/crm/profiles/${id}$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      locale === 'fa' ? 'بایگانی‌شده' : 'Archived'
    );
    await expect(
      page.getByRole('button', { name: locale === 'fa' ? 'ویرایش' : 'Edit', exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', {
        name: locale === 'fa' ? 'بایگانی پروفایل' : 'Archive profile',
        exact: true,
      })
    ).toHaveCount(0);
    await expect(page.getByRole('combobox')).toHaveCount(0);
    // Account security remains available: only the selected profile is archived.
    await expect(
      page.getByRole('button', {
        name: locale === 'fa' ? 'پایان تمام نشست‌ها' : 'Expire Sessions',
        exact: true,
      })
    ).toBeVisible();
    await page
      .getByRole('tab', {
        name: locale === 'fa' ? 'جزئیات پروفایل' : 'Profile Details',
        exact: true,
      })
      .click();
    const panel = page.getByRole('tabpanel');
    await expect(panel).toContainText('Customer closure request');
    await expect(panel).toContainText(locale === 'fa' ? 'پروفایل پیش‌فرض' : 'Default profile');
    await expect(panel).toContainText(
      await formatBrowserDate(
        page,
        locale,
        { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' },
        current.profile.archivedAt!
      )
    );
    expect(profileChecks).toBe(0);
  });

for (const locale of ['fa', 'en'] as const) {
  test(`CRM profile records support keyboard access, paging and retry (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((lang) => {
      if (document.documentElement) document.documentElement.lang = lang;
      new MutationObserver(() => {
        document.documentElement.lang = lang;
      }).observe(document, { childList: true });
    }, locale);
    const invitation = {
      id: 'invitation:one',
      kind: 'invitation',
      profileId: id,
      profileTitle: 'Example Company',
      username: 'invite@example.test',
      role: 'Legal',
      status: 'Expired',
      createdAt: '2026-08-02T01:00:00.000001Z',
      expiresAt: '2026-08-03T01:00:00.000000Z',
    };
    const verification = {
      id: 'verification-one',
      event: 'verification_change',
      actor: 'reviewer@example.test',
      previousStatus: 'ACTIVE',
      newStatus: 'VERIFIED',
      reason: 'Initial evidence checked',
      createdAt: '2026-08-02T01:00:00.000001Z',
    };
    const current = {
      ...detail(false, true),
      agentRelationships: { items: [invitation], nextCursor: 'older-agents' },
      verificationHistory: { items: [verification], nextCursor: 'older-history' },
    };
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'America/Los_Angeles' } })
    );
    await page.route(`**/api/crm/profiles/${id}`, (route) => route.fulfill({ json: current }));
    let agentAttempts = 0,
      historyAttempts = 0;
    const requests: string[] = [];
    let finishFirst: (() => void) | undefined;
    const firstResponse = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    await page.route(`**/api/crm/profiles/${id}/records/agents?*`, async (route) => {
      requests.push(new URL(route.request().url()).searchParams.get('cursor')!);
      if (++agentAttempts === 1) {
        await firstResponse;
        return route.fulfill({ status: 503, json: {} });
      }
      return route.fulfill({
        json: {
          items: [
            {
              ...invitation,
              id: 'agent:two',
              kind: 'agent',
              username: 'member@example.test',
              status: 'Active',
              expiresAt: null,
            },
          ],
          nextCursor: null,
        },
      });
    });
    await page.route(`**/api/crm/profiles/${id}/records/verification*`, (route) => {
      const cursor = new URL(route.request().url()).searchParams.get('cursor');
      if (!cursor) return route.fulfill({ json: { items: [], nextCursor: null } });
      requests.push(cursor);
      if (++historyAttempts === 1)
        return route.fulfill({ json: { items: 'invalid', nextCursor: null } });
      return route.fulfill({
        json: {
          items: [
            {
              ...verification,
              id: 'verification-two',
              event: 'verification_case_reviewed',
              previousStatus: null,
              newStatus: 'Approved',
              reason: 'Correction approved',
            },
          ],
          nextCursor: null,
        },
      });
    });
    await page.goto(`/admin/crm/profiles/${id}`);
    const tabs = page.getByRole('tablist');
    const first = tabs.getByRole('tab').first();
    await first.focus();
    await first.press('End');
    const backwards = locale === 'fa' ? 'ArrowRight' : 'ArrowLeft';
    await page.getByRole('tab', { selected: true }).press(backwards);
    await expect(page.getByRole('tab', { selected: true })).toHaveText(
      locale === 'fa' ? 'تاریخچه تأیید' : 'Verification History'
    );
    await page.getByRole('tab', { selected: true }).press(backwards);
    const agentTab = page.getByRole('tab', {
      name: locale === 'fa' ? 'دعوت‌نامه نمایندگی' : 'Agent Invites',
      exact: true,
    });
    await expect(agentTab).toBeFocused();
    await expect(tabs.locator('[tabindex="0"]')).toHaveCount(1);
    const panel = page.getByRole('tabpanel');
    await expect(panel).toHaveAccessibleName(
      locale === 'fa' ? 'دعوت‌نامه نمایندگی' : 'Agent Invites'
    );
    await expect(panel).toContainText('invite@example.test');
    await expect(panel).toContainText(locale === 'fa' ? 'منقضی‌شده' : 'Expired');
    await expect(panel).toContainText(
      await formatBrowserDate(
        page,
        locale,
        { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' },
        invitation.createdAt
      )
    );
    const older = page.getByRole('button', {
      name: locale === 'fa' ? 'نمایش سوابق قدیمی‌تر' : 'Load older records',
      exact: true,
    });
    await older.click();
    await expect(panel.getByRole('status')).toBeVisible();
    await expect(older).toBeDisabled();
    finishFirst!();
    await expect(panel.getByRole('alert')).toBeVisible();
    await expect(panel).toContainText('invite@example.test');
    const retry = page.getByRole('button', {
      name: locale === 'fa' ? 'تلاش دوباره' : 'Retry',
      exact: true,
    });
    await retry.click();
    await expect(panel).toContainText('member@example.test');
    await expect(panel).toContainText('invite@example.test');
    await expect(older).toHaveCount(0);
    await page
      .getByRole('tab', {
        name: locale === 'fa' ? 'تاریخچه تأیید' : 'Verification History',
        exact: true,
      })
      .click();
    await expect(panel).toContainText('Initial evidence checked');
    await older.click();
    await expect(panel.getByRole('alert')).toBeVisible();
    await expect(panel).toContainText('Initial evidence checked');
    await retry.click();
    await expect(panel).toContainText('Correction approved');
    await expect(panel).toContainText(
      locale === 'fa' ? 'بررسی اصلاح هویت' : 'Identity correction reviewed'
    );
    expect(requests).toEqual(['older-agents', 'older-agents', 'older-history', 'older-history']);
    await page
      .getByRole('button', { name: locale === 'fa' ? 'تازه‌سازی' : 'Refresh', exact: true })
      .click();
    await expect(panel).toContainText(
      locale === 'fa' ? 'سابقه‌ای ثبت نشده است.' : 'No records yet.'
    );
    await expect(panel.getByRole('table')).toHaveCount(0);
    await page.getByRole('tab', { selected: true }).press('Home');
    await expect(first).toBeFocused();
  });
}
for (const locale of ['fa', 'en'] as const) {
  for (const action of ['expire-sessions', 'force-password-change'] as const)
    test(`CRM ${action} confirms the customer and preserves reason on failure (${locale})`, async ({
      page,
    }) => {
      await page.addInitScript((lang) => {
        if (document.documentElement) document.documentElement.lang = lang;
        new MutationObserver(() => {
          document.documentElement.lang = lang;
        }).observe(document, { childList: true });
      }, locale);
      const title =
        action === 'expire-sessions'
          ? locale === 'fa'
            ? 'پایان تمام نشست‌ها'
            : 'Expire Sessions'
          : locale === 'fa'
            ? 'تغییر اجباری رمز عبور'
            : 'Force Password Change';
      const confirmName = locale === 'fa' ? 'تأیید' : 'Confirm';
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'America/Los_Angeles' } })
      );
      await page.route(`**/api/crm/profiles/${id}`, (route) =>
        route.fulfill({ json: detail(false, true) })
      );
      let verified = false,
        acknowledged = false;
      const bodies: unknown[] = [];
      await page.route(`**/api/crm/users/customer/${action}`, (route) => {
        bodies.push(route.request().postDataJSON());
        if (!verified) return route.fulfill({ status: 403, json: { requiresStepUp: true } });
        return route.fulfill({
          json: acknowledged
            ? { success: true, userId: 'customer', reason: 'Lost device' }
            : { success: true, userId: 'another-customer' },
        });
      });
      await page.route('**/api/auth/step-up', (route) => {
        verified = true;
        return route.fulfill({ json: { verified: true } });
      });
      await page.goto(`/admin/crm/profiles/${id}`);
      await page.getByRole('button', { name: title, exact: true }).click();
      await expect(
        page.getByRole('dialog').getByRole('button', { name: title, exact: true })
      ).toBeDisabled();
      await page.getByRole('dialog').locator('textarea').fill('  Lost device  ');
      await page.getByRole('dialog').getByRole('button', { name: title, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
      await expect(dialog).toContainText('customer@example.test');
      await expect(dialog).toContainText('Lost device');
      const confirm = dialog.getByRole('button', { name: confirmName, exact: true });
      await confirm.click();
      const password = dialog.getByLabel(
        locale === 'fa' ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password'
      );
      await password.fill('Test-password-123!');
      await confirm.click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(dialog).toContainText('Lost device');
      acknowledged = true;
      await password.fill('Test-password-123!');
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      expect(bodies).toEqual(Array(3).fill({ reason: 'Lost device' }));
    });

  for (const action of ['verify', 'unverify', 'reverify'] as const)
    test(`CRM ${action} confirms verification state and rejects invalid acknowledgements (${locale})`, async ({
      page,
    }) => {
      await page.addInitScript((lang) => {
        if (document.documentElement) document.documentElement.lang = lang;
        new MutationObserver(() => {
          document.documentElement.lang = lang;
        }).observe(document, { childList: true });
      }, locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'America/Los_Angeles' } })
      );
      const profile = detail(false, true);
      const previousStatus = action === 'verify' ? 'PENDING_VERIFICATION' : 'VERIFIED';
      const newStatus =
        action === 'verify'
          ? 'VERIFIED'
          : action === 'unverify'
            ? 'ACTIVE'
            : 'PENDING_VERIFICATION';
      profile.profile.status = previousStatus;
      let archiveAllowed = false;
      await page.route(`**/api/crm/profiles/${id}`, (route) =>
        route.request().method() === 'DELETE'
          ? route.fulfill(
              archiveAllowed
                ? { json: { success: true, profileId: id, archivedAt: '2026-09-08T09:00:00.000Z' } }
                : {
                    status: 409,
                    json: { error: { code: 'CRM:PROFILE:DELETION_BLOCKED' } },
                  }
            )
          : route.fulfill({ json: profile })
      );
      let acknowledged = false;
      const bodies: unknown[] = [];
      const reason = action === 'verify' ? '' : 'Evidence expired';
      await page.route(`**/api/crm/profiles/${id}/verify`, (route) => {
        bodies.push(route.request().postDataJSON());
        if (!acknowledged)
          return route.fulfill({
            json:
              action === 'verify' ? {} : { success: true, profileId: id, newStatus: 'VERIFIED' },
          });
        profile.profile.status = newStatus;
        return route.fulfill({
          json: { success: true, profileId: id, previousStatus, newStatus, reason: reason || null },
        });
      });
      await page.goto(`/admin/crm/profiles/${id}`);
      const review = page.getByRole('button', {
        name: locale === 'fa' ? 'بررسی تغییر تأیید هویت' : 'Review verification change',
      });
      const reasonField = page.getByLabel(
        locale === 'fa'
          ? 'دلیل (برای لغو یا تجدید تأیید الزامی است)'
          : 'Reason (required to remove or renew verification)'
      );
      if (action !== 'verify') {
        await expect(review).toBeDisabled();
        await reasonField.fill('   ');
        await expect(review).toBeDisabled();
        await reasonField.fill(reason);
      }
      await page
        .getByLabel(locale === 'fa' ? 'عملیات تأیید هویت' : 'Verification action', { exact: true })
        .selectOption(action);
      await review.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
      await expect(dialog).toContainText('Customer profile');
      const confirm = dialog.getByRole('button', {
        name: locale === 'fa' ? 'تأیید' : 'Confirm',
        exact: true,
      });
      await confirm.click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(reasonField).toHaveValue(reason);
      acknowledged = true;
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      const statusText =
        newStatus === 'VERIFIED'
          ? locale === 'fa'
            ? 'تأیید شده'
            : 'Verified'
          : newStatus === 'ACTIVE'
            ? locale === 'fa'
              ? 'فعال'
              : 'Active'
            : locale === 'fa'
              ? 'در انتظار تأیید'
              : 'Pending verification';
      await expect(page.getByRole('heading', { level: 1 })).toContainText(statusText);
      await expect(page.getByRole('tabpanel')).toContainText(
        newStatus === 'ACTIVE' ? (locale === 'fa' ? 'تأیید نشده' : 'Unverified') : statusText
      );
      expect(bodies).toEqual(Array(2).fill({ action, ...(reason ? { reason } : {}) }));
      if (action === 'reverify') {
        const archive = locale === 'fa' ? 'بایگانی پروفایل' : 'Archive profile';
        await page.getByRole('button', { name: archive, exact: true }).click();
        await dialog.locator('textarea').fill('Closure requested');
        for (const checkbox of await dialog.getByRole('checkbox').all()) await checkbox.check();
        await dialog.getByRole('button', { name: archive, exact: true }).click();
        await confirm.click();
        await expect(dialog.getByRole('alert')).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`/admin/crm/profiles/${id}$`));
        archiveAllowed = true;
        await confirm.click();
        await expect(page).toHaveURL(/\/admin\/crm\/?$/);
      }
    });
}

for (const locale of ['fa', 'en'] as const)
  test(`CRM edits profile contacts while sign-in contacts stay read-only (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((lang) => {
      if (document.documentElement) document.documentElement.lang = lang;
      new MutationObserver(() => {
        document.documentElement.lang = lang;
      }).observe(document, { childList: true });
    }, locale);
    const current = detail(false, true);
    let fail = true;
    const writes: unknown[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'America/Los_Angeles' } })
    );
    await page.route(`**/api/crm/profiles/${id}`, (route) => {
      if (route.request().method() !== 'PUT') return route.fulfill({ json: current });
      const body = route.request().postDataJSON();
      writes.push(body);
      if (fail) return route.fulfill({ status: 500, json: { error: { code: 'SERVER_ERROR' } } });
      current.profile.contactEmail = body.email.trim().toLowerCase();
      current.profile.contactMobile = '+98' + body.mobile.slice(1);
      return route.fulfill({ json: { ...current, updated: true } });
    });
    await page.goto(`/admin/crm/profiles/${id}`);
    await expect(page.getByRole('tabpanel')).toContainText(
      await formatBrowserDate(
        page,
        locale,
        { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' },
        current.user.lastPasswordChange
      )
    );
    await page
      .getByRole('tab', {
        name: locale === 'fa' ? 'جزئیات پروفایل' : 'Profile Details',
        exact: true,
      })
      .click();
    await expect(page.getByRole('tabpanel')).toContainText(
      await formatBrowserDate(
        page,
        locale,
        {
          timeZone: 'America/Los_Angeles',
          dateStyle: 'medium',
          timeStyle: 'short',
        },
        current.profile.createdAt
      )
    );
    await page
      .getByRole('button', { name: locale === 'fa' ? 'ویرایش' : 'Edit', exact: true })
      .click();
    const email = page.getByLabel(locale === 'fa' ? 'ایمیل' : 'Email', { exact: true });
    const mobile = page.getByLabel(locale === 'fa' ? 'شماره موبایل' : 'Mobile', { exact: true });
    await expect(email).toHaveValue('office@example.test');
    await expect(mobile).toHaveValue('+989121234567');
    await expect(page.getByText('signin@example.test', { exact: true })).toBeVisible();
    await expect(page.locator('input[value="signin@example.test"]')).toHaveCount(0);
    await email.fill('NEW-OFFICE@example.test');
    await mobile.fill('09121234569');
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'ذخیره تغییرات' : 'Save Changes',
        exact: true,
      })
      .click();
    const confirm = page
      .getByRole('dialog')
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true });
    await confirm.click();
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    await expect(email).toHaveValue('NEW-OFFICE@example.test');
    await expect(mobile).toHaveValue('09121234569');
    fail = false;
    await confirm.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('new-office@example.test', { exact: true })).toBeVisible();
    await expect(page.getByText('+989121234569', { exact: true })).toBeVisible();
    await expect(page.getByText('signin@example.test', { exact: true })).toBeVisible();
    expect(writes).toEqual(
      Array(2).fill({
        title: 'Customer profile',
        email: 'NEW-OFFICE@example.test',
        mobile: '09121234569',
      })
    );
  });

for (const locale of ['fa', 'en'] as const)
  test(`CRM legal details show localized fields, reference names and calendar dates (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((lang) => {
      if (document.documentElement) document.documentElement.lang = lang;
      new MutationObserver(() => {
        document.documentElement.lang = lang;
      }).observe(document, { childList: true });
    }, locale);
    const province = { nameFa: 'استان تهران', nameEn: 'Tehran province' };
    const city = { nameFa: 'شهر تهران', nameEn: 'Tehran city' };
    const current = {
      ...detail(false, true),
      legalInfo: {
        legalName: 'Example Legal Company',
        nationalIdentifier: '14012345671',
        registrationNumber: 'reg-42',
        companyTypeId: 'limited-liability',
        companyTypeName: { nameFa: 'مسئولیت محدود', nameEn: 'Limited Liability' },
        registrationDate: '2020-03-20',
        economicCode: '87654',
        officialPhone: '02100000000',
        officialEmail: 'company@example.test',
        officialFullAddress: 'Company street',
        officialPostalCode: '2345678901',
        officialProvinceName: province,
        officialCityName: city,
        representativeHonorific: 'Dr',
        representativeFirstName: 'Sara',
        representativeLastName: 'Example',
        representativeNationalId: '0012345678',
        representativeTitle: 'Director',
        representativeRelationship: 'Board member',
        representativeProvinceName: province,
        representativeCityName: city,
        representativeFullAddress: 'Representative street',
        representativePostalCode: '1234567890',
        createdAt: '2026-08-01T01:00:00Z',
        updatedAt: '2026-08-02T01:00:00Z',
      },
      addresses: [
        {
          id: 'address-one',
          provinceId: 'private-province-id',
          cityId: 'private-city-id',
          provinceName: province,
          cityName: city,
          fullAddress: 'Delivery street',
          postalCode: '3456789012',
          mainAddress: true,
          createdAt: '2026-08-01T01:00:00Z',
        },
      ],
    };
    current.profile.profileType = 'LEGAL';
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'America/Los_Angeles' } })
    );
    await page.route(`**/api/crm/profiles/${id}`, (route) => route.fulfill({ json: current }));
    await page.goto(`/admin/crm/profiles/${id}`);
    for (const action of locale === 'fa'
      ? ['ویرایش', 'تغییر اجباری رمز عبور', 'پایان تمام نشست‌ها']
      : ['Edit', 'Force Password Change', 'Expire Sessions']) {
      const button = page.getByRole('button', { name: action, exact: true });
      const bounds = await button.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    await page.screenshot({
      path: '/tmp/barghsa-crm-legal-header-' + locale + '-' + test.info().project.name + '.png',
    });
    const openDetails = () =>
      page
        .getByRole('tab', {
          name: locale === 'fa' ? 'جزئیات پروفایل' : 'Profile Details',
          exact: true,
        })
        .click();
    await openDetails();
    const panel = page.getByRole('tabpanel');
    for (const value of [
      'Example Legal Company',
      'reg-42',
      'Sara',
      '0012345678',
      'Representative street',
      '1234567890',
      'Board member',
    ])
      await expect(panel).toContainText(value);
    for (const label of locale === 'fa'
      ? [
          'شناسه کاربر',
          'عنوان',
          'نام خانوادگی',
          'تاریخ ثبت',
          'نوع شرکت',
          'نام نماینده',
          'کد ملی نماینده',
          'استان نماینده',
          'آخرین تغییر',
        ]
      : [
          'User ID',
          'Title',
          'Last Name',
          'Registration Date',
          'Company Type',
          'Representative first name',
          'Representative national ID',
          'Representative province',
          'Updated',
        ])
      await expect(panel).toContainText(label);
    await expect(panel).toContainText(locale === 'fa' ? 'مسئولیت محدود' : 'Limited Liability');
    await expect(panel).toContainText(locale === 'fa' ? province.nameFa : province.nameEn);
    await expect(panel).toContainText(locale === 'fa' ? city.nameFa : city.nameEn);
    const registration = panel
      .locator('div')
      .filter({
        has: page.getByText(locale === 'fa' ? 'تاریخ ثبت' : 'Registration Date', { exact: true }),
      })
      .last();
    await expect(registration).toContainText(
      await formatBrowserDate(
        page,
        locale,
        { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' },
        '2020-03-20T00:00:00Z'
      )
    );
    await expect(panel).not.toContainText('limited-liability');
    await page
      .getByRole('heading', {
        name: locale === 'fa' ? 'اطلاعات شخص حقوقی' : 'Legal Entity Info',
        exact: true,
      })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: '/tmp/barghsa-crm-legal-fields-' + locale + '-' + test.info().project.name + '.png',
    });
    await page
      .getByRole('tab', { name: locale === 'fa' ? 'آدرس‌ها' : 'Addresses', exact: true })
      .click();
    await expect(panel).toContainText(locale === 'fa' ? 'کد پستی' : 'Postal code');
    await expect(panel).toContainText(locale === 'fa' ? 'اصلی' : 'Main');
    await expect(panel).toContainText(locale === 'fa' ? city.nameFa : city.nameEn);
    await expect(panel).not.toContainText('private-city-id');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    current.legalInfo.registrationDate = '2020-02-31';
    Object.assign(current.legalInfo, { officialProvinceName: null, officialCityName: null });
    await page.reload();
    await openDetails();
    await expect(registration).toContainText(locale === 'fa' ? 'نامشخص' : 'Unknown');
    await expect(panel).toContainText('Representative street');
  });

for (const locale of ['fa', 'en'] as const)
  for (const allowed of [false, true])
    test(`CRM legal documents require access and reject failed or malformed links (${locale}, ${allowed})`, async ({
      page,
    }) => {
      await page.addInitScript((lang) => {
        if (document.documentElement) document.documentElement.lang = lang;
        new MutationObserver(() => {
          document.documentElement.lang = lang;
        }).observe(document, { childList: true });
      }, locale);
      const current = {
        ...detail(false, true),
        legalInfo: { legalName: 'Documents Company' },
        viewerPermissions: { ...detail(false, true).viewerPermissions, canReadDocuments: allowed },
      };
      current.profile.profileType = 'LEGAL';
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'America/Los_Angeles' } })
      );
      await page.route(`**/api/crm/profiles/${id}`, (route) => route.fulfill({ json: current }));
      let attempts = 0;
      let finishFirst!: () => void;
      const first = new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
      const url = 'https://files.example.test/company-proof.pdf?signature=test-only';
      await page.route(`**/api/crm/profiles/${id}/documents`, async (route) => {
        attempts++;
        if (attempts === 1) {
          await first;
          return route.fulfill({ status: 503, json: {} });
        }
        if (attempts === 2)
          return route.fulfill({
            json: { profileId: 'another-profile', documents: [{ name: 'private.pdf', url }] },
          });
        if (attempts === 3)
          return route.fulfill({
            json: {
              profileId: id,
              documents: [{ name: 'unsafe.pdf', url: 'javascript:alert(1)' }],
            },
          });
        if (attempts === 4)
          return route.fulfill({
            json: { profileId: id, documents: [{ name: 'company-proof.pdf', url }] },
          });
        if (attempts === 5) return route.fulfill({ status: 403, json: {} });
        return route.fulfill({ json: { profileId: id, documents: [] } });
      });
      await page.goto(`/admin/crm/profiles/${id}`);
      await page
        .getByRole('tab', {
          name: locale === 'fa' ? 'جزئیات پروفایل' : 'Profile Details',
          exact: true,
        })
        .click();
      const load = page.getByRole('button', {
        name: locale === 'fa' ? 'نمایش مدارک' : 'View documents',
        exact: true,
      });
      if (!allowed) {
        await expect(load).toHaveCount(0);
        await expect(
          page.getByText(
            locale === 'fa'
              ? 'برای مشاهده این مدارک به دسترسی بررسی هویت نیاز دارید.'
              : 'Verification access is required to view these documents.',
            { exact: true }
          )
        ).toBeVisible();
        expect(attempts).toBe(0);
        return;
      }
      await load.click();
      await expect(
        page.getByRole('button', {
          name: locale === 'fa' ? 'در حال بارگذاری مدارک…' : 'Loading documents…',
          exact: true,
        })
      ).toBeDisabled();
      finishFirst();
      const retry = page.getByRole('button', {
        name: locale === 'fa' ? 'تلاش دوباره برای مدارک' : 'Retry documents',
        exact: true,
      });
      await expect(retry).toBeVisible();
      for (let i = 0; i < 2; i++) {
        await retry.click();
        await expect(retry).toBeVisible();
        await expect(page.getByRole('link', { name: /private.pdf|unsafe.pdf/ })).toHaveCount(0);
      }
      await retry.click();
      const link = page.getByRole('link', { name: 'company-proof.pdf', exact: true });
      await expect(link).toHaveAttribute('href', url);
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await page
        .getByRole('button', {
          name: locale === 'fa' ? 'تازه‌سازی پیوندهای مدارک' : 'Refresh document links',
          exact: true,
        })
        .click();
      await expect(retry).toBeVisible();
      await expect(link).toHaveCount(0);
      await retry.click();
      await expect(page.getByRole('tabpanel').getByRole('status')).toContainText(
        locale === 'fa' ? 'مدرکی ثبت نشده است.' : 'No documents are recorded.'
      );
      expect(attempts).toBe(6);
    });

for (const locale of ['en', 'fa'] as const)
  for (const profileType of ['INDIVIDUAL', 'LEGAL'] as const)
    test(`CRM locked fields open the matching correction form (${locale}, ${profileType})`, async ({
      page,
    }) => {
      await page.addInitScript((lang) => {
        if (document.documentElement) document.documentElement.lang = lang;
        new MutationObserver(() => {
          document.documentElement.lang = lang;
        }).observe(document, { childList: true });
      }, locale);
      const current = detail(false, true);
      current.profile.profileType = profileType;
      Object.assign(current.viewerPermissions, { canEditIdentity: true });
      if (profileType === 'LEGAL')
        Object.assign(current, {
          legalInfo: {
            legalName: 'Example Company',
            nationalIdentifier: '12345678901',
            registrationDate: null,
            createdAt: current.profile.createdAt,
            updatedAt: current.profile.updatedAt,
          },
        });
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route(`**/api/crm/profiles/${id}`, (route) => route.fulfill({ json: current }));
      await page.route('**/api/crm/verification-cases?*', (route) =>
        route.fulfill({
          json: {
            cases: [],
            total: 0,
            viewer: { userId: 'creator', canCreate: true, canReview: false },
          },
        })
      );
      const fields =
        profileType === 'LEGAL'
          ? ['legal_name', 'national_identifier']
          : ['first_name', 'last_name', 'national_id'];
      const selected = fields[fields.length - 1]!;
      await page.goto(`/admin/crm/profiles/${id}`);
      const details = page.getByRole('tab', {
        name: locale === 'fa' ? 'جزئیات پروفایل' : 'Profile Details',
        exact: true,
      });
      await details.click();
      const panel = page.getByRole('tabpanel');
      const links = panel.getByRole('link', {
        name: /^Request identity correction:|^درخواست اصلاح هویت:/,
      });
      await expect(links).toHaveCount(fields.length);
      for (const field of fields)
        await expect(panel.locator(`a[href$="fieldName=${field}"]`)).toBeVisible();
      const link = panel.locator(`a[href$="fieldName=${selected}"]`);
      await link.focus();
      await expect(link).toBeFocused();
      await link.press('Enter');
      await expect(page).toHaveURL(new RegExp(`profileId=${id}&fieldName=${selected}$`));
      await expect(page.locator('#correction-field')).toHaveValue(selected);
      await page.locator('#correction-value').fill('Review required');
      // A field from the other profile type cannot preselect an unsupported correction.
      const unsupported = profileType === 'LEGAL' ? 'national_id' : 'legal_name';
      await page.goto(`/admin/crm/corrections?profileId=${id}&fieldName=${unsupported}`);
      await expect(page.locator('#correction-field')).toHaveValue(fields[0]!);
      await expect(
        page.locator('#correction-field').locator(`option[value="${unsupported}"]`)
      ).toHaveCount(0);
      for (const archived of [false, true]) {
        Object.assign(current.viewerPermissions, { canEditIdentity: archived });
        current.profile.archived = archived;
        if (archived)
          Object.assign(current.profile, {
            archivedAt: '2026-09-01T00:00:00Z',
            archivedReason: 'Closed',
          });
        await page.goto(`/admin/crm/profiles/${id}`);
        await details.click();
        await expect(links).toHaveCount(0);
      }
    });

for (const locale of ['fa', 'en'] as const)
  for (const darkMode of [false, true]) {
    test(`CRM archive checklist, blocker details and acknowledgement survive retries (${locale}, dark=${darkMode})`, async ({
      page,
    }, testInfo) => {
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
            appTitle: 'Archive review',
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
        route.fulfill({ json: { timezone: 'UTC' } })
      );
      const blocked =
        locale === 'fa'
          ? 'موجودی ثبت‌شده یا رزروشده کیف پول صفر نیست. پیش از بایگانی، هر دو موجودی باید صفر باشند.'
          : 'The posted or reserved wallet balance is not zero. Both balances must be zero before archiving.';
      let reply: { status: number; json: unknown } = {
        status: 409,
        json: { error: { code: 'CRM:PROFILE:DELETION_BLOCKED', message: blocked } },
      };
      const bodies: unknown[] = [];
      await page.route(`**/api/crm/profiles/${id}`, (route) => {
        if (route.request().method() !== 'DELETE')
          return route.fulfill({ json: detail(false, true) });
        expect(route.request().headers()['accept-language']).toBe(locale);
        bodies.push(route.request().postDataJSON());
        return route.fulfill(reply);
      });
      await page.goto(`/admin/crm/profiles/${id}`);
      const archiveLabel = locale === 'fa' ? 'بایگانی پروفایل' : 'Archive profile';
      const archive = page.getByRole('button', { name: archiveLabel, exact: true });
      await archive.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('Customer profile');
      await expect(dialog.getByRole('checkbox')).toHaveCount(3);
      const reason = dialog.getByRole('textbox');
      await reason.fill('  ');
      for (const checkbox of await dialog.getByRole('checkbox').all()) await checkbox.check();
      await expect(dialog.getByRole('button', { name: archiveLabel, exact: true })).toBeDisabled();
      await reason.fill('Closure requested');
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(archive).toBeFocused();
      await archive.click();
      await expect(dialog.getByRole('checkbox').first()).not.toBeChecked();
      const checks = await dialog.getByRole('checkbox').all();
      for (const checkbox of checks) {
        await expect(
          dialog.getByRole('button', { name: archiveLabel, exact: true })
        ).toBeDisabled();
        await checkbox.focus();
        await checkbox.press('Space');
        await expect(checkbox).toBeChecked();
      }
      await expect(reason).toHaveValue('Closure requested');
      // The button fades from its disabled opacity after the last checkbox.
      // Measure the enabled state once that transition has finished.
      await expect
        .poll(() =>
          dialog
            .getByRole('button', { name: archiveLabel, exact: true })
            .evaluate((node) => getComputedStyle(node).opacity)
        )
        .toBe('1');
      await expect
        .poll(() => page.locator('html').evaluate((node) => node.classList.contains('dark')))
        .toBe(darkMode);
      const a11y = await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(a11y.violations).toEqual([]);
      // Axe can leave wrapped transparent descriptions unresolved on mobile.
      // Verify only that known node using its rendered colors and unobscured text.
      for (const item of a11y.incomplete.filter((item) => item.id === 'color-contrast')) {
        expect(item.nodes).toHaveLength(1);
        expect(item.nodes[0]!.html).toContain('data-slot="dialog-description"');
        const measured = await dialog
          .locator('[data-slot="dialog-description"]')
          .evaluate((node) => {
            const popup = node.closest('[role="dialog"]')!;
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const ctx = canvas.getContext('2d')!;
            const color = (value: string) => {
              ctx.clearRect(0, 0, 1, 1);
              ctx.fillStyle = value;
              ctx.fillRect(0, 0, 1, 1);
              return Array.from(ctx.getImageData(0, 0, 1, 1).data);
            };
            const fg = color(getComputedStyle(node).color),
              bg = color(getComputedStyle(popup).backgroundColor);
            const luminance = (rgb: number[]) =>
              rgb.slice(0, 3).reduce((sum, value, index) => {
                const s = value / 255;
                return (
                  sum +
                  [0.2126, 0.7152, 0.0722][index]! *
                    (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4)
                );
              }, 0);
            const f = luminance(fg),
              b = luminance(bg);
            const range = document.createRange();
            range.selectNodeContents(node);
            const unobscured = Array.from(range.getClientRects()).every((rect) =>
              node.contains(
                document.elementFromPoint(
                  rect.x + Math.min(10, rect.width / 2),
                  rect.y + rect.height / 2
                )
              )
            );
            let opaque = true;
            for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement)
              if (getComputedStyle(ancestor).opacity !== '1') opaque = false;
            return {
              ratio: (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05),
              fg,
              bg,
              unobscured,
              opaque,
            };
          });
        expect(measured.fg[3]).toBe(255);
        expect(measured.bg[3]).toBe(255);
        expect(measured.opaque).toBe(true);
        expect(measured.unobscured).toBe(true);
        expect(measured.ratio).toBeGreaterThanOrEqual(4.5);
        await testInfo.attach('resolved-description-contrast', {
          contentType: 'application/json',
          body: JSON.stringify(measured),
        });
      }
      const bounds = await dialog.boundingBox();
      expect(bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      const titleBounds = await dialog.getByRole('heading').boundingBox();
      const closeBounds = await dialog
        .getByRole('button', { name: 'Close', exact: true })
        .boundingBox();
      expect(titleBounds!.x + titleBounds!.width).toBeLessThanOrEqual(closeBounds!.x);
      await dialog.screenshot({
        path: `/tmp/barghsa-archive-dialog-${locale}-${darkMode ? 'dark' : 'light'}-${testInfo.project.name}.png`,
      });
      expect(bodies).toEqual([]);
      await dialog.getByRole('button', { name: archiveLabel, exact: true }).click();
      const confirm = dialog.getByRole('button', {
        name: locale === 'fa' ? 'تأیید' : 'Confirm',
        exact: true,
      });
      await confirm.click();
      await expect(dialog.getByRole('alert')).toHaveText(blocked);
      for (const json of [
        {},
        { success: false, profileId: id, archivedAt: '2026-09-08T09:00:00.000Z' },
        {
          success: true,
          profileId: '22222222-2222-4222-8222-222222222222',
          archivedAt: '2026-09-08T09:00:00.000Z',
        },
        { success: true, profileId: id },
        { success: true, profileId: id, archivedAt: 'not-a-date' },
        { success: true, profileId: id, archivedAt: '2026-02-30T09:00:00.000Z' },
      ]) {
        reply = { status: 200, json };
        await confirm.click();
        await expect(dialog.getByRole('alert')).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`/admin/crm/profiles/${id}$`));
      }
      reply = {
        status: 200,
        json: { success: true, profileId: id, archivedAt: '2026-09-08T09:00:00.000Z' },
      };
      await confirm.click();
      await expect(page).toHaveURL(/\/admin\/crm\/?$/);
      expect(bodies).toEqual(Array(8).fill({ reason: 'Closure requested' }));
    });
  }

for (const locale of ['fa', 'en'] as const)
  for (const darkMode of [false, true])
    test(`CRM full profile tabs remain readable and contained (${locale}, dark=${darkMode})`, async ({
      page,
    }, testInfo) => {
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
            appTitle: 'Archive review',
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
        route.fulfill({ json: { timezone: 'UTC' } })
      );

      const current = {
        ...detail(false, true),
        addresses: [
          {
            id: 'address-one',
            provinceId: 'province',
            cityId: 'city',
            provinceName: { nameFa: 'تهران', nameEn: 'Tehran' },
            cityName: { nameFa: 'تهران', nameEn: 'Tehran' },
            fullAddress: 'Example retained address',
            postalCode: '1234567890',
            mainAddress: true,
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z',
          },
        ],
        sessions: {
          count: 1,
          lastActive: '2026-08-02T00:00:00.000Z',
          entries: [
            {
              sessionId: 'session-ref:abcdef1234567890',
              createdAt: '2026-08-01T00:00:00.000Z',
              lastActive: '2026-08-02T00:00:00.000Z',
              expiresAt: '2026-08-03T00:00:00.000Z',
              isRevoked: false,
              isActive: true,
              deviceInfo: { browser: 'Chrome' },
            },
          ],
        },
        siblingProfiles: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            profileType: 'LEGAL',
            status: 'VERIFIED',
            isDefault: false,
            title: 'Another company',
          },
        ],
        agentRelationships: { items: [], nextCursor: null },
        verificationHistory: { items: [], nextCursor: null },
      };
      await page.route(`**/api/crm/profiles/${id}`, (route) => route.fulfill({ json: current }));
      await page.goto(`/app/crm/profiles/${id}`);
      const main = page.getByRole('main');
      const tabs = main.getByRole('tab');
      await expect(tabs).toHaveCount(7);
      await expect
        .poll(() => page.locator('html').evaluate((n) => n.classList.contains('dark')))
        .toBe(darkMode);
      const findings = [];
      for (let n = 0; n < 7; n++) {
        await tabs.nth(n).click();
        const panel = main.getByRole('tabpanel');
        await expect(panel).toBeVisible();
        const selected = tabs.nth(n);
        await expect(selected).toHaveAttribute('aria-selected', 'true');
        expect(await selected.getAttribute('aria-controls')).toBe(await panel.getAttribute('id'));
        const overflow = await main.evaluate((n) => n.scrollWidth - n.clientWidth);
        expect.soft(overflow, `tab ${n} page overflow`).toBeLessThanOrEqual(1);
        const result = await new AxeBuilder({ page })
          .include('#admin-content')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        const relevant = {
          tab: n,
          violations: result.violations,
          incomplete: result.incomplete.filter((i) => i.id === 'color-contrast'),
        };
        findings.push(relevant);
        expect
          .soft(
            result.violations.map((i) => ({ id: i.id, nodes: i.nodes.map((n) => n.target) })),
            `tab ${n}`
          )
          .toEqual([]);
        expect.soft(relevant.incomplete, `tab ${n} unresolved contrast`).toEqual([]);
        if (n === 3 || n === 6) {
          const row = n === 3 ? panel.getByRole('row').last() : panel.locator('.rounded-lg');
          await row.hover();
          const hoverScan = await new AxeBuilder({ page })
            .include('#admin-content')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze();
          expect(hoverScan.violations).toEqual([]);
          expect(hoverScan.incomplete.filter((item) => item.id === 'color-contrast')).toEqual([]);
        }
        if (n === 0 || n === 3)
          await main.screenshot({
            path: `/tmp/barghsa-crm-page-${locale}-${darkMode}-${n}-${testInfo.project.name}.png`,
          });
      }
      await testInfo.attach('profile-accessibility', {
        contentType: 'application/json',
        body: JSON.stringify(findings),
      });
      await tabs.first().focus();
      await tabs.first().press('End');
      await expect(tabs.last()).toBeFocused();
      await tabs.last().press('Home');
      await expect(tabs.first()).toBeFocused();
    });

for (const locale of ['fa', 'en'] as const)
  for (const darkMode of [false, true])
    test(`CRM profile loading and errors allow localized retry (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
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
            appTitle: 'Archive review',
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
        route.fulfill({ json: { timezone: 'UTC' } })
      );

      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let phase = 0;
      const requestedPhases: number[] = [];
      const replies = [503, 403, 404, 0, 200, 201];
      await page.route(`**/api/crm/profiles/${id}`, async (route) => {
        const status = replies[phase];
        requestedPhases.push(phase);
        expect(route.request().method()).toBe('GET');
        // Locale initialization can abort and repeat the initial read. Hold both.
        await held;
        if (status === 0) return route.abort('failed');
        if (status === 200)
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: 'invalid json',
          });
        if (status === 201) return route.fulfill({ json: detail(false, false) });
        return route.fulfill({ status, json: { message: 'Internal upstream detail' } });
      });
      await page.goto(`/admin/crm/profiles/${id}`);
      const main = page.getByRole('main');
      await expect(main.getByRole('status')).toHaveText(
        locale === 'fa' ? 'در حال بارگذاری پروفایل…' : 'Loading profile...'
      );
      release();
      const generic =
        locale === 'fa' ? 'بارگذاری پروفایل با خطا مواجه شد' : 'Failed to load profile';
      const messages = [
        generic,
        locale === 'fa' ? 'دسترسی غیرمجاز' : 'Access denied',
        locale === 'fa' ? 'پروفایل یافت نشد' : 'Profile not found',
        generic,
        generic,
      ];
      for (const message of messages) {
        await expect(main.getByRole('alert')).toContainText(message);
        await expect(main).not.toContainText('Internal upstream detail');
        const scan = await new AxeBuilder({ page })
          .include('#admin-content')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        expect(scan.violations).toEqual([]);
        expect(scan.incomplete.filter((i) => i.id === 'color-contrast')).toEqual([]);
        const retry = main.getByRole('button', {
          name: locale === 'fa' ? 'تلاش دوباره' : 'Retry',
          exact: true,
        });
        await retry.focus();
        phase++;
        await retry.press('Enter');
      }
      await expect(main.getByRole('tablist')).toBeVisible();
      expect([...new Set(requestedPhases)]).toEqual([0, 1, 2, 3, 4, 5]);
    });
