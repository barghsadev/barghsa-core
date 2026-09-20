import AxeBuilder from '@axe-core/playwright';
import { formatBrowserDate } from './browser-date';
import { test, expect, type Page } from './coverage-fixture';

const profileId = '00000000-0000-4000-8000-000000000001';
const transferId = '00000000-0000-4000-8000-000000000002';
async function shell(
  page: Page,
  locale = 'en',
  canTransfer = true,
  memberName: string | null = null
) {
  await page.addInitScript((value) => {
    if (document.documentElement) document.documentElement.lang = value;
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
  await page.route('**/api/auth/step-up', (route) => route.fulfill({ json: { verified: true } }));
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
            name: memberName,
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

async function chooseOwner(page: Page, locale = 'en') {
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel(locale === 'fa' ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password')
    .fill('Team-password-123!');
  await dialog
    .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
    .click();
  await dialog.getByLabel(locale === 'fa' ? 'مالک جدید' : 'New owner').selectOption('member');
  await dialog
    .getByRole('button', { name: locale === 'fa' ? 'ادامه' : 'Continue', exact: true })
    .click();
}

for (const locale of ['fa', 'en'] as const) {
  test(`dashboard invitations stay visible until a decision and sit above the header (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    let decisions = 0;
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await page.route('**/api/invitations/pending', (route) =>
      route.fulfill({
        json: {
          invitations: [
            {
              id,
              profileId,
              profileName: 'Dashboard company',
              role: 'Finance',
              invitedBy: 'owner',
              inviterName: 'owner@example.test',
              createdAt: '2026-09-01T01:00:00Z',
              expiresAt: '2099-09-08T01:00:00Z',
            },
          ],
        },
      })
    );
    const decision = locale === 'fa' ? 'decline' : 'accept';
    await page.route(`**/api/invitations/${id}/${decision}`, async (route) => {
      decisions++;
      await pending;
      return route.fulfill({
        json: {
          message: `Invitation ${decision === 'accept' ? 'accepted' : 'declined'} successfully.`,
        },
      });
    });
    await page.goto('/dashboard');
    const banner = page.getByRole('alert').filter({ hasText: 'Dashboard company' });
    await expect(banner).toContainText('owner@example.test');
    await expect(banner).toContainText(locale === 'fa' ? 'مالی' : 'Finance');
    await expect(banner.getByRole('button')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(banner).toBeVisible();
    expect(decisions).toBe(0);
    const box = await banner.boundingBox(),
      header = await page.locator('header').first().boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(header!.y + 1);
    const action = banner.getByRole('button', {
      name: locale === 'fa' ? 'رد کردن' : 'Accept',
      exact: true,
    });
    await action.click();
    try {
      await expect.poll(() => decisions).toBe(1);
      await expect(banner).toBeVisible();
      for (const button of await banner.getByRole('button').all())
        await expect(button).toBeDisabled();
    } finally {
      finish();
    }
    await expect(banner).toHaveCount(0);
    expect(decisions).toBe(1);
  });

  test(`invitation modal previews the entity, cancels safely and retries without losing input (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await shell(page, locale);
    const sent: unknown[] = [];
    await page.route(`**/api/profiles/${profileId}/invitations`, (route) => {
      sent.push(route.request().postDataJSON());
      expect(route.request().headers()['x-csrf-token']).toBe('invitation-current-csrf');
      return route.fulfill(
        sent.length === 1
          ? { status: 429, json: {} }
          : { status: 201, json: { id: 'new-invitation' } }
      );
    });
    await page
      .context()
      .addCookies([
        { name: 'barghsa_csrf', value: 'invitation-current-csrf', url: 'http://127.0.0.1:5173' },
      ]);
    await page.goto('/settings/team');
    // Scope is a real accessible table; invitees expose no registration detail.
    const table = page.getByRole('table');
    await expect(table.getByRole('columnheader')).toHaveCount(5);
    const pendingRow = table.getByRole('row').filter({ hasText: 'invited@example.test' });
    await expect(pendingRow).toContainText(fa ? 'در انتظار' : 'Pending');
    const trigger = page.getByRole('button', {
      name: fa ? 'دعوت عضو تیم' : 'Invite a team member',
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    const input = dialog.getByLabel(fa ? 'ایمیل یا شماره موبایل' : 'Email or mobile number');
    await expect(input).toBeFocused();
    await input.fill('new@example.test');
    await dialog.getByLabel(fa ? 'نقش' : 'Role', { exact: true }).selectOption('Finance');
    await expect(dialog.getByRole('status')).toContainText('Example company');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(sent).toEqual([]);
    await trigger.click();
    const send = dialog.getByRole('button', { name: fa ? 'ارسال دعوت‌نامه' : 'Send invitation' });
    await expect(input).toHaveValue('new@example.test');
    await send.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(input).toHaveValue('new@example.test');
    for (const dark of [false, true]) {
      await page.evaluate(async (value) => {
        document.documentElement.classList.toggle('dark', value);
        await Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
            .map((a) => a.finished.catch(() => {}))
        );
      }, dark);
      expect(
        (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations
      ).toEqual([]);
    }
    await send.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#dashboard-content').getByRole('status')).toContainText(
      fa ? 'دعوت‌نامه ارسال شد' : 'Invitation sent'
    );
    await expect(trigger).toBeFocused();
    expect(sent).toEqual([
      { username: 'new@example.test', role: 'Finance' },
      { username: 'new@example.test', role: 'Finance' },
    ]);
  });

  test(`invitation banner retries loading and shows private details before a decision (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await shell(page, locale);
    let loads = 0,
      decisions = 0;
    const decision = fa ? 'decline' : 'accept';
    await page.route('**/api/invitations/pending', (route) =>
      route.fulfill(
        ++loads === 1
          ? { status: 503, json: {} }
          : {
              json: {
                invitations: [
                  {
                    id: 'detail-invitation',
                    profileId,
                    profileName: 'Inviting company',
                    role: 'Finance',
                    invitedBy: 'owner',
                    inviterName: 'owner@example.test',
                    createdAt: '2026-09-01T01:00:00Z',
                    expiresAt: '2026-09-08T01:00:00Z',
                    entity: { nationalIdentifier: '12345678901', registrationNumber: '7654321' },
                  },
                ],
              },
            }
      )
    );
    await page.route(`**/api/invitations/detail-invitation/${decision}`, (route) => {
      expect(route.request().method()).toBe('POST');
      return route.fulfill(++decisions === 1 ? { status: 409, json: {} } : { json: {} });
    });
    await page.goto('/settings/team');
    const retry = page
      .getByRole('alert')
      .getByRole('button', { name: fa ? 'تلاش دوباره' : 'Retry' });
    await retry.click();
    const banner = page.getByRole('alert').filter({ hasText: 'Inviting company' });
    await expect(banner).toContainText(fa ? 'مالی' : 'Finance');
    const details = banner.locator('summary');
    await details.focus();
    await page.keyboard.press('Enter');
    const dialog = banner.locator('details');
    await expect(dialog).toHaveAttribute('open', '');
    await expect(dialog).toContainText('owner@example.test');
    await expect(dialog).toContainText('12345678901');
    await expect(dialog).toContainText('7654321');
    await expect(dialog).toContainText(fa ? 'کیف پول' : 'wallet');
    await expect(dialog).toHaveAttribute('dir', fa ? 'rtl' : 'ltr');
    await expect(dialog.locator('time')).toHaveCount(2);
    for (const dark of [false, true]) {
      await page.evaluate(async (value) => {
        document.documentElement.classList.toggle('dark', value);
        await Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
            .map((a) => a.finished.catch(() => {}))
        );
      }, dark);
      expect((await new AxeBuilder({ page }).include('details').analyze()).violations).toEqual([]);
    }
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    await details.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).not.toHaveAttribute('open', '');
    await expect(details).toBeFocused();
    expect(decisions).toBe(0);
    const act = banner.getByRole('button', { name: fa ? 'رد کردن' : 'Accept', exact: true });
    await act.click();
    await expect(
      page.getByRole('alert').filter({ hasText: fa ? 'خطا' : 'Error processing invitation' })
    ).toBeVisible();
    await expect(act).toBeEnabled();
    await act.click();
    await expect(banner).toHaveCount(0);
    expect(decisions).toBe(2);
  });

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
      .getByRole('button', {
        name: locale === 'fa' ? 'دعوت عضو تیم' : 'Invite a team member',
        exact: true,
      })
      .click();
    await page
      .getByLabel(locale === 'fa' ? 'ایمیل یا شماره موبایل' : 'Email or mobile number')
      .fill('new@example.test');
    await page.locator('#invite-role').selectOption('Legal');
    await expect(page.getByRole('dialog').getByRole('status')).toHaveText(
      locale === 'fa'
        ? 'دعوت new@example.test به عنوان حقوقی برای Example company.'
        : 'Invite new@example.test as Legal to Example company.'
    );
    await page
      .getByRole('button', { name: locale === 'fa' ? 'ارسال دعوت‌نامه' : 'Send invitation' })
      .click();
    await expect(page.locator('#dashboard-content').getByRole('status')).toContainText(
      locale === 'fa' ? 'دعوت‌نامه ارسال شد' : 'Invitation sent'
    );
    const member = page
      .getByRole('row')
      .filter({ has: page.getByRole('heading', { name: 'member@example.test' }) });
    await expect(member.locator('time')).toHaveText(
      await formatBrowserDate(
        page,
        locale,
        {
          timeZone: 'America/Los_Angeles',
          dateStyle: 'medium',
        },
        '2026-08-01T01:00:00Z'
      )
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
    await formatBrowserDate(
      page,
      'en',
      { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' },
      '2026-09-13T00:00:00Z'
    )
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
    if (action.suffix === 'transfer-ownership') await chooseOwner(page);
    expect(requests).toBe(0);
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(requests).toBe(1);
    await expect(page.locator('#dashboard-content').getByRole('status')).toContainText(
      action.suffix === 'transfer-ownership'
        ? 'Transfer request sent to member@example.test. They must accept.'
        : 'Change saved'
    );
  });
}

for (const locale of ['en', 'fa'] as const) {
  test(`ownership verifies before selection and preserves the recipient through expiry and retry (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa',
      recipientName = fa ? 'نماینده نمونه' : 'Example Agent';
    await shell(page, locale, true, recipientName);
    let verifies = 0;
    const attempts: unknown[] = [];
    await page.route('**/api/auth/step-up', (route) => {
      verifies++;
      expect(route.request().postDataJSON()).toEqual({ password: 'Team-password-123!' });
      return route.fulfill(
        verifies === 1
          ? { status: 401, json: { error: { code: 'AUTH:UNAUTHENTICATED' } } }
          : {
              json: { verified: true },
              headers: { 'Set-Cookie': `barghsa_csrf=verified-${verifies}; Path=/; SameSite=Lax` },
            }
      );
    });
    await page.route(`**/api/profiles/${profileId}/transfer-ownership`, (route) => {
      attempts.push(route.request().postDataJSON());
      expect(route.request().headers()['x-csrf-token']).toBe(`verified-${verifies}`);
      return route.fulfill(
        attempts.length === 1
          ? { status: 403, json: { error: { code: 'AUTHZ:STEP_UP_REQUIRED' } } }
          : attempts.length === 2
            ? { status: 409, json: { error: { code: 'CONFLICT:INVALID_STATE' } } }
            : { status: 201, json: { id: transferId } }
      );
    });
    await page.goto('/settings/team');
    const success = fa
      ? 'درخواست انتقال مالکیت برای نماینده نمونه ارسال شد. گیرنده باید آن را بپذیرد.'
      : 'Transfer request sent to Example Agent. They must accept.';
    await page
      .getByRole('button', { name: fa ? 'انتقال مالکیت' : 'Transfer ownership', exact: true })
      .click();
    const dialog = page.getByRole('dialog'),
      password = dialog.getByLabel(fa ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password');
    const confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    await expect(password).toBeFocused();
    await expect(dialog.getByRole('combobox')).toHaveCount(0);
    await password.fill('Team-password-123!');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.getByRole('combobox')).toHaveCount(0);
    expect(attempts).toHaveLength(0);
    await password.fill('Team-password-123!');
    await confirm.click();
    const picker = dialog.getByLabel(fa ? 'مالک جدید' : 'New owner');
    await expect(picker).toBeFocused();
    await expect(picker).toHaveValue('');
    await expect(picker.getByRole('option')).toHaveText([
      fa ? 'انتخاب مالک جدید' : 'Select the new owner',
      recipientName,
    ]);
    const next = dialog.getByRole('button', { name: fa ? 'ادامه' : 'Continue', exact: true });
    await expect(next).toBeDisabled();
    await picker.selectOption('member');
    for (const dark of [false, true]) {
      await page.evaluate(async (value) => {
        document.documentElement.classList.toggle('dark', value);
        await Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
            .map((a) => a.finished.catch(() => {}))
        );
      }, dark);
      expect(
        (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations
      ).toEqual([]);
    }
    await expect(dialog).toHaveAttribute('dir', fa ? 'rtl' : 'ltr');
    await next.click();
    await expect(dialog).toContainText(recipientName);
    await expect(password).toHaveCount(0);
    expect(attempts).toHaveLength(0);
    await confirm.click();
    await expect(password).toBeVisible();
    await password.fill('Team-password-123!');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(page.getByText(success, { exact: true })).toHaveCount(0);
    await password.fill('Team-password-123!');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(success, { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: fa ? 'انتقال مالکیت' : 'Transfer ownership', exact: true })
    ).toBeFocused();
    expect(attempts).toEqual(Array.from({ length: 3 }, () => ({ newOwnerUserId: 'member' })));
    expect(verifies).toBe(4);
    expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain(
      'Team-password-123!'
    );
    await expect(page).toHaveURL(/\/settings\/team$/);
    for (const dark of [false, true]) {
      await page.evaluate(async (value) => {
        document.documentElement.classList.toggle('dark', value);
        await Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
            .map((a) => a.finished.catch(() => {}))
        );
      }, dark);
      expect(
        (await new AxeBuilder({ page }).include('#dashboard-content').analyze()).violations
      ).toEqual([]);
    }
  });
  test(`ownership cancellation at every stage sends no transfer (${locale})`, async ({ page }) => {
    const fa = locale === 'fa';
    await shell(page, locale);
    let sends = 0,
      verifies = 0;
    await page.route('**/api/auth/step-up', (route) => {
      verifies++;
      return route.fulfill({ json: { verified: true } });
    });
    await page.route(`**/api/profiles/${profileId}/transfer-ownership`, (route) => {
      sends++;
      return route.fulfill({ status: 201, json: { id: transferId } });
    });
    await page.goto('/settings/team');
    const start = page.getByRole('button', {
      name: fa ? 'انتقال مالکیت' : 'Transfer ownership',
      exact: true,
    });
    await start.click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(start).toBeFocused();
    expect(verifies).toBe(0);
    await start.click();
    let dialog = page.getByRole('dialog');
    await dialog
      .getByLabel(fa ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password')
      .fill('Team-password-123!');
    await dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true }).click();
    await expect(dialog.getByRole('combobox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(start).toBeFocused();
    await start.click();
    await chooseOwner(page, locale);
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: fa ? 'انصراف' : 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(start).toBeFocused();
    expect(sends).toBe(0);
    expect(verifies).toBe(2);
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
      await formatBrowserDate(
        page,
        locale,
        {
          timeZone: 'America/Los_Angeles',
          dateStyle: 'long',
        },
        stamp
      )
    );
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    const banner = page.getByRole('alert').filter({ hasText: 'Inviting company' });
    await expect(banner).toContainText(
      await formatBrowserDate(
        page,
        locale,
        {
          timeZone: 'America/Los_Angeles',
          dateStyle: 'medium',
        },
        stamp
      )
    );
  });
}

for (const locale of ['en', 'fa'] as const) {
  for (const operation of ['roles', 'remove'] as const) {
    test(`own ${operation} change follows server sign-out (${locale})`, async ({ page }) => {
      await shell(page, locale, false);
      await page.route(
        `**/api/profiles/${profileId}/agents/member${operation === 'roles' ? '/roles' : ''}`,
        (route) => route.fulfill({ json: { sessionRevoked: true } })
      );
      await page.goto('/settings/team');
      const member = page
        .getByRole('row')
        .filter({ has: page.getByRole('heading', { name: 'member@example.test' }) });
      if (operation === 'roles') {
        await member
          .getByRole('checkbox', { name: locale === 'fa' ? 'مالی' : 'Finance', exact: true })
          .check();
        await member
          .getByRole('button', { name: locale === 'fa' ? 'ذخیره نقش‌ها' : 'Save roles' })
          .click();
      } else {
        await member
          .getByRole('button', { name: locale === 'fa' ? 'حذف عضو' : 'Remove member' })
          .click();
      }
      await page
        .getByRole('dialog')
        .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
        .click();
      await expect(page).toHaveURL(/\/login$/);
    });
  }
}
