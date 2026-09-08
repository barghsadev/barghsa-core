import { formatBrowserDate } from './browser-date';
import { test, expect } from './coverage-fixture';
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
                ? { json: { success: true, profileId: id } }
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
