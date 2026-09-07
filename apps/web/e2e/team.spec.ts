import { test, expect, type Page } from './coverage-fixture';

const profileId = '00000000-0000-4000-8000-000000000001';
const transferId = '00000000-0000-4000-8000-000000000002';
async function shell(page: Page, locale = 'en', canTransfer = true) {
  await page.addInitScript((value) => {
    new MutationObserver(() => {
      if (document.documentElement) document.documentElement.lang = value;
    }).observe(document, { childList: true });
  }, locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'America/Los_Angeles' } })
  );
  await page.route('**/api/invitations/pending', (route) =>
    route.fulfill({ json: { invitations: [] } })
  );
  await page.route('**/api/v1/notifications**', (route) =>
    route.fulfill({ json: { data: [], unread_count: 0 } })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [{ id: profileId, profileType: 'LEGAL', title: 'Example company' }],
        activeProfileId: profileId,
        hasDefault: true,
      },
    })
  );
  await page.route('**/api/profiles/ownership-transfers', (route) =>
    route.fulfill({ json: { transfers: [] } })
  );
  await page.route(`**/api/profiles/${profileId}/agents`, (route) =>
    route.fulfill({
      json: {
        profileId,
        canTransferOwnership: canTransfer,
        agents: [
          {
            id: 'member-one',
            type: 'agent',
            userId: 'member',
            username: 'member@example.test',
            name: null,
            role: 'Manager',
            status: 'Active',
            joinedAt: '2026-08-01T01:00:00Z',
          },
          {
            id: 'invitation-one',
            type: 'invitation',
            userId: null,
            username: 'invited@example.test',
            name: null,
            role: 'Finance',
            status: 'Pending',
            joinedAt: null,
          },
        ],
      },
    })
  );
}

for (const locale of ['fa', 'en'] as const) {
  test(`invite and save additive roles through password confirmation (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    const requests: unknown[] = [];
    let verified = false;
    await page.route(`**/api/profiles/${profileId}/invitations`, (route) => {
      expect(route.request().postDataJSON()).toEqual({
        username: 'new@example.test',
        role: 'Legal',
      });
      return route.fulfill({ status: 201, json: { id: 'new-invite' } });
    });
    await page.route(`**/api/profiles/${profileId}/agents/member/roles`, (route) => {
      requests.push(route.request().postDataJSON());
      return route.fulfill(
        verified
          ? { json: { roles: ['Manager', 'Finance'] } }
          : { status: 403, json: { requiresStepUp: true } }
      );
    });
    await page.route('**/api/auth/step-up', (route) => {
      expect(route.request().postDataJSON()).toEqual({ password: 'Team-password-123!' });
      verified = true;
      return route.fulfill({ json: { verified: true } });
    });
    await page.goto('/settings/team');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      locale === 'fa' ? 'تیم و مالکیت' : 'Team and ownership'
    );
    await page
      .getByLabel(locale === 'fa' ? 'ایمیل یا شماره موبایل' : 'Email or mobile number')
      .fill('new@example.test');
    await page.locator('#invite-role').selectOption('Legal');
    await page
      .getByRole('button', { name: locale === 'fa' ? 'ارسال دعوت‌نامه' : 'Send invitation' })
      .click();
    await expect(page.locator('#dashboard-content').getByRole('status')).toContainText(
      locale === 'fa' ? 'دعوت‌نامه ارسال شد' : 'Invitation sent'
    );
    const member = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: 'member@example.test' }) });
    await expect(member.locator('time')).toHaveText(
      new Intl.DateTimeFormat(locale, {
        timeZone: 'America/Los_Angeles',
        dateStyle: 'medium',
      }).format(new Date('2026-08-01T01:00:00Z'))
    );
    await member
      .getByRole('checkbox', { name: locale === 'fa' ? 'مالی' : 'Finance', exact: true })
      .check();
    await member
      .getByRole('button', { name: locale === 'fa' ? 'ذخیره نقش‌ها' : 'Save roles' })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await dialog
      .getByLabel(locale === 'fa' ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password')
      .fill('Team-password-123!');
    await dialog
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(requests).toEqual([
      { roles: ['Manager', 'Finance'] },
      { roles: ['Manager', 'Finance'] },
    ]);
    expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain(
      'Team-password-123!'
    );
  });
}

test('manager cannot initiate transfer and cancelling removal sends no request', async ({
  page,
}) => {
  await shell(page, 'en', false);
  let deletes = 0;
  await page.route(`**/api/profiles/${profileId}/agents/member`, (route) => {
    deletes++;
    return route.fulfill({ json: { removed: true } });
  });
  await page.goto('/settings/team');
  await expect(page.getByRole('button', { name: 'Remove member' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Transfer ownership' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove member' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(deletes).toBe(0);
});

test('incoming ownership is visible and acceptance sends the bound transfer then signs out', async ({
  page,
}) => {
  await shell(page);
  await page.route('**/api/profiles/ownership-transfers', (route) =>
    route.fulfill({
      json: {
        transfers: [
          {
            id: transferId,
            profileId,
            profileName: 'Example company',
            expiresAt: '2026-09-13T00:00:00Z',
            direction: 'incoming',
          },
        ],
      },
    })
  );
  await page.route(`**/api/profiles/${profileId}/ownership-accept`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ transferId });
    return route.fulfill({ json: { status: 'Completed' } });
  });
  await page.goto('/dashboard');
  await page.getByRole('link', { name: /pending ownership request/ }).click();
  await expect(page.locator('time[datetime="2026-09-13T00:00:00Z"]')).toHaveText(
    'Sep 12, 2026, 5:00 PM'
  );
  await page.getByRole('button', { name: 'Accept ownership' }).click();
  await expect(page.getByRole('dialog')).toContainText('signs both owners out');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('stale transfer remains an error and never reports acceptance', async ({ page }) => {
  await shell(page);
  await page.route('**/api/profiles/ownership-transfers', (route) =>
    route.fulfill({
      json: {
        transfers: [
          {
            id: transferId,
            profileId,
            profileName: 'Example company',
            expiresAt: '2026-09-13T00:00:00Z',
            direction: 'incoming',
          },
        ],
      },
    })
  );
  await page.route(`**/api/profiles/${profileId}/ownership-accept`, (route) =>
    route.fulfill({ status: 409, json: { error: 'conflict' } })
  );
  await page.goto('/settings/team');
  await page.getByRole('button', { name: 'Accept ownership' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('changed or expired');
  await expect(page).toHaveURL(/\/settings\/team$/);
});

for (const action of [
  {
    label: 'Transfer ownership',
    suffix: 'transfer-ownership',
    method: 'POST',
    body: { newOwnerUserId: 'member' },
  },
  { label: 'Remove member', suffix: 'agents/member', method: 'DELETE', body: null },
  {
    label: 'Withdraw invitation',
    suffix: 'invitations/invitation-one',
    method: 'DELETE',
    body: null,
  },
  { label: 'Decline request', suffix: 'ownership-decline', method: 'POST', body: { transferId } },
  { label: 'Cancel transfer', suffix: 'ownership-cancel', method: 'POST', body: { transferId } },
]) {
  test(`${action.label} confirms the exact target and request`, async ({ page }) => {
    await shell(page);
    await page.route('**/api/profiles/ownership-transfers', (route) =>
      route.fulfill({
        json: {
          transfers: [
            {
              id: transferId,
              profileId,
              profileName: 'Example company',
              expiresAt: '2026-09-13T00:00:00Z',
              direction: action.suffix === 'ownership-cancel' ? 'outgoing' : 'incoming',
            },
          ],
        },
      })
    );
    let requests = 0;
    await page.route(`**/api/profiles/${profileId}/${action.suffix}`, (route) => {
      requests++;
      expect(route.request().method()).toBe(action.method);
      expect(route.request().postDataJSON()).toEqual(action.body);
      return route.fulfill({ json: { saved: true } });
    });
    await page.goto('/settings/team');
    await page.getByRole('button', { name: action.label, exact: true }).click();
    expect(requests).toBe(0);
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(requests).toBe(1);
    await expect(page.locator('#dashboard-content').getByRole('status')).toContainText(
      'Change saved'
    );
  });
}

for (const locale of ['en', 'fa']) {
  test(`invitation and terms review show account-local calendar dates (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    const stamp = '2026-09-01T01:00:00Z';
    await page.route('**/api/invitations/pending', (route) =>
      route.fulfill({
        json: {
          invitations: [
            {
              id: 'invitation-date',
              profileId,
              profileName: 'Inviting company',
              role: 'Manager',
              invitedBy: 'owner',
              inviterName: 'Owner',
              createdAt: stamp,
              expiresAt: null,
            },
          ],
        },
      })
    );
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({ json: { userId: 'user', requiresTosAcceptance: true } })
    );
    await page.route('**/api/tos/current?*', (route) =>
      route.fulfill({
        json: {
          id: 'terms-date',
          versionId: 'v1',
          content: 'Published terms',
          updatedAt: stamp,
          publishedAt: stamp,
        },
      })
    );
    await page.goto('/settings/team');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(
      new Intl.DateTimeFormat(locale, {
        timeZone: 'America/Los_Angeles',
        dateStyle: 'long',
      }).format(new Date(stamp))
    );
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    const banner = page.getByRole('alert').filter({ hasText: 'Inviting company' });
    await expect(banner).toContainText(
      new Intl.DateTimeFormat(locale, {
        timeZone: 'America/Los_Angeles',
        dateStyle: 'medium',
      }).format(new Date(stamp))
    );
  });
}
