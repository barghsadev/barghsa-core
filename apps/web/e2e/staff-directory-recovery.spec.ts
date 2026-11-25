import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page, type Route } from './coverage-fixture';
import { t } from '@barghsa/i18n/admin-ui';
import {
  staffAccess,
  staffUser,
  staffRoles,
  staffTeam,
  staffMember,
  staffTeamId,
  staffRoutingRules,
} from '../src/test/staff-directory-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
async function shell(page: Page, locale: 'en' | 'fa') {
  await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'admin',
        isStaff: true,
        operatingContext: 'staff',
        canSwitchContext: false,
        requiresTosAcceptance: false,
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
}
async function inspect(page: Page, label: string, locale: string, project: string) {
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'mobile-safari')
    await page.screenshot({
      path: `/tmp/barghsa-staff-directory-${label}-fa-mobile-safari.png`,
      fullPage: true,
    });
}
for (const locale of ['en', 'fa'] as const) {
  const u = (key: string) => t(`admin.staff.${key}`, locale),
    g = (key: string) => t(`admin.teams.${key}`, locale);
  test(`staff role, permission and team records have restorable URLs (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    await page.route('**/api/admin/staff-access', (route) => route.fulfill({ json: staffAccess }));
    await page.route('**/api/admin/staff-role-options', (route) =>
      route.fulfill({ json: staffRoles })
    );
    await page.route('**/api/admin/staff?*', (route) =>
      route.fulfill({ json: { items: [staffUser], total: 1 } })
    );
    await page.route(`**/api/admin/users/${staffUser.userId}/effective-permissions`, (route) =>
      route.fulfill({
        json: {
          userId: staffUser.userId,
          isAdmin: false,
          roleIds: staffRoles.map((role) => role.roleId),
          roleNames: staffRoles.map((role) => role.name),
          permissions: [{ permission: 'finance:read', group: 'finance' }],
          isWildcard: false,
        },
      })
    );
    const accountPath = `/admin/users/${staffUser.userId}`;
    await page.route(`**/api/admin/staff/accounts/${staffUser.userId}`, (route) =>
      route.fulfill({ json: staffUser })
    );
    await page.goto(`/admin/users?page=2&roleEditor=${staffUser.userId}`);
    await expect(page).toHaveURL(
      (url) => url.pathname === accountPath + '/roles' && url.search === '?page=2'
    );
    const reason = page.locator('#staff-role-reason');
    await reason.fill('Inactive draft reason');
    await page.reload();
    await expect(reason).toHaveValue('');
    await page.getByRole('link', { name: 'Finance Alice', exact: true }).click();
    await page
      .getByRole('link', { name: t('admin.roles.effective.inspect', locale), exact: true })
      .click();
    await expect(page).toHaveURL((url) => url.pathname === accountPath + '/permissions');
    const permissions = page.getByTestId('effective-permissions');
    await expect(permissions).toContainText('finance:read');
    await page.reload();
    await expect(permissions).toContainText('finance:read');
    await page.goBack();
    await expect(permissions).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Finance Alice', exact: true })).toBeVisible();
    await page.goto(`/admin/users?permissionView=${staffUser.userId}`);
    await expect(page).toHaveURL(
      (url) => url.pathname === accountPath + '/permissions' && !url.search
    );
    await expect(permissions).toContainText('finance:read');

    await page.route('**/api/admin/staff-teams', (route) => route.fulfill({ json: [staffTeam] }));
    await page.route('**/api/admin/staff-teams/members?*', (route) =>
      route.fulfill({ json: { items: [staffMember], selected: [staffMember], hasMore: false } })
    );
    await page.route('**/api/admin/config/assignment-rules', (route) =>
      route.fulfill({ json: staffRoutingRules })
    );
    await page.route(`**/api/admin/staff-teams/${staffTeamId}`, (route) =>
      route.fulfill({ json: staffTeam })
    );
    await page.goto('/admin/staff-teams');
    await page.getByRole('link', { name: staffTeam.name, exact: true }).click();
    await page.getByRole('link', { name: g('edit'), exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/staff-teams/${staffTeamId}/edit$`));
    const teamName = page.locator('#staff-team-name');
    await expect(teamName).toHaveValue(staffTeam.name);
    await page.reload();
    await expect(teamName).toHaveValue(staffTeam.name);
    await page.goBack();
    await expect(page.getByRole('heading', { name: staffTeam.name, exact: true })).toBeVisible();
    await expect(teamName).toHaveCount(0);
    await page.goto(`/admin/staff-teams?selected=${staffTeamId}`);
    await expect(page).toHaveURL(new RegExp(`/admin/staff-teams/${staffTeamId}/edit$`));
  });

  test(`staff account retries preserve its role draft and permission denial clears work (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    let status = 200;
    let listReads = 0;
    await page.route('**/api/admin/staff-access', (route) => route.fulfill({ json: staffAccess }));
    await page.route('**/api/admin/staff-role-options', (route) =>
      route.fulfill({ json: staffRoles })
    );
    await page.route('**/api/admin/staff?*', (route) => {
      listReads++;
      return route.fulfill({ json: { items: [staffUser], total: 51 } });
    });
    await page.route(`**/api/admin/staff/accounts/${staffUser.userId}`, (route) =>
      route.fulfill({ status, json: status === 200 ? staffUser : {} })
    );
    await page.goto(`/admin/users/${staffUser.userId}/roles?page=2`);
    const reason = page.locator('#staff-role-reason');
    await reason.fill('Retained role reason');
    status = 503;
    await page.getByRole('button', { name: u('refresh'), exact: true }).click();
    await expect(page.getByRole('button', { name: u('retry'), exact: true })).toBeVisible();
    await expect(reason).toHaveValue('Retained role reason');
    status = 200;
    await page.getByRole('button', { name: u('retry'), exact: true }).click();
    await expect(page.getByRole('button', { name: u('retry'), exact: true })).toHaveCount(0);
    await expect(reason).toHaveValue('Retained role reason');
    await inspect(page, 'users', locale, info.project.name);
    status = 403;
    await page.getByRole('button', { name: u('refresh'), exact: true }).click();
    await expect(reason).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText(u('forbidden'));
    expect(listReads).toBe(0);
  });
  test(`staff access and role choices recover without discarding drafts (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    let accessStatus = 200,
      optionsStatus = 200,
      canCreate = true,
      listReads = 0,
      withdrawnRoles = false;
    await page.route('**/api/admin/staff-access', (route) =>
      route.fulfill(
        accessStatus === 200
          ? { json: { ...staffAccess, canCreate } }
          : { status: accessStatus, json: {} }
      )
    );
    await page.route('**/api/admin/staff-role-options', (route) =>
      route.fulfill(
        optionsStatus === 200
          ? { json: withdrawnRoles ? [] : staffRoles }
          : { status: optionsStatus, json: {} }
      )
    );
    await page.route('**/api/admin/staff?*', (route) => {
      ++listReads;
      return route.fulfill({ json: { items: [staffUser], total: 1 } });
    });
    await page.route(`**/api/admin/staff/accounts/${staffUser.userId}`, (route) =>
      route.fulfill({ json: staffUser })
    );
    await page.goto('/admin/users/new');
    await page.locator('#staff-firstName').fill('Retained role draft');
    optionsStatus = 503;
    await page.getByRole('button', { name: u('refresh'), exact: true }).click();
    await expect(page.getByRole('button', { name: u('optionsRetry'), exact: true })).toBeVisible();
    const reads = listReads;
    optionsStatus = 200;
    await page.getByRole('button', { name: u('optionsRetry'), exact: true }).click();
    await expect(page.getByRole('button', { name: u('optionsRetry'), exact: true })).toHaveCount(0);
    expect(listReads).toBe(reads);
    await expect(page.locator('#staff-firstName')).toHaveValue('Retained role draft');
    accessStatus = 503;
    await page.getByRole('button', { name: u('refresh'), exact: true }).click();
    await expect(page.getByRole('button', { name: u('accessRetry'), exact: true })).toBeVisible();
    await expect(page.locator('#staff-firstName')).toHaveValue('Retained role draft');
    accessStatus = 200;
    canCreate = false;
    await page.getByRole('button', { name: u('accessRetry'), exact: true }).click();
    await expect(page.locator('#staff-firstName')).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText(u('forbidden'));
    expect(listReads).toBe(0);
    await page.goto(`/admin/users/${staffUser.userId}/roles`);
    await page.locator('#staff-role-reason').fill('Remove withdrawn role');
    withdrawnRoles = true;
    await page.getByRole('button', { name: u('refresh'), exact: true }).click();
    await expect(page.getByRole('button', { name: u('refresh'), exact: true })).toBeEnabled();
    await page.locator('main details > summary').click();
    const withdrawn = page.getByRole('checkbox', { name: new RegExp(u('unavailableRole')) });
    await withdrawn.click();
    await expect(withdrawn).toHaveCount(0);
    await expect(page.locator('#staff-role-reason')).toHaveValue('Remove withdrawn role');
    await expect(page.getByRole('button', { name: u('saveRoles'), exact: true })).toBeEnabled();
  });
  test(`team retries retain editor and unsaved routing independently (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    let teamStatus = 200,
      rulesStatus = 0,
      memberStatus = 200,
      rulesReads = 0;
    const memberQueries: string[] = [];
    await page.route('**/api/admin/staff-teams', (route) =>
      route.fulfill(teamStatus === 200 ? { json: [staffTeam] } : { status: teamStatus, json: {} })
    );
    await page.route(`**/api/admin/staff-teams/${staffTeamId}`, (route) =>
      route.fulfill(teamStatus === 200 ? { json: staffTeam } : { status: teamStatus, json: {} })
    );
    await page.route('**/api/admin/config/assignment-rules', (route) => {
      ++rulesReads;
      if (rulesStatus === 0) return;
      return route.fulfill(
        rulesStatus === 200 ? { json: staffRoutingRules } : { status: rulesStatus, json: {} }
      );
    });
    await page.route('**/api/admin/staff-teams/members?*', (route) => {
      memberQueries.push(new URL(route.request().url()).search);
      if (memberStatus === 0) return;
      return route.fulfill(
        memberStatus === 200
          ? { json: { items: [staffMember], selected: [staffMember], hasMore: false } }
          : { status: memberStatus, json: {} }
      );
    });
    await page.clock.install();
    await page.goto('/admin/staff-teams/assignment');
    await page.locator('#team-ticket').selectOption(staffTeamId);
    await expect.poll(() => rulesReads).toBe(1);
    await page.clock.fastForward(15_001);
    rulesStatus = 200;
    await page.getByRole('button', { name: g('rulesRetry'), exact: true }).click();
    await expect(page.getByRole('button', { name: g('rulesRetry'), exact: true })).toHaveCount(0);
    await expect(page.locator('#team-ticket')).toHaveValue(staffTeamId);
    await page.goto(`/admin/staff-teams/${staffTeamId}/edit`);
    await expect(page.locator('#staff-team-lead')).toHaveValue(staffMember.id);
    await page.locator('#staff-team-description').fill('Keep team explanation');
    teamStatus = 503;
    await page.getByRole('button', { name: g('refresh'), exact: true }).click();
    await expect(page.getByRole('button', { name: g('retry'), exact: true })).toBeVisible();
    const reads = rulesReads;
    await page.locator('#staff-team-name').fill('Editable during recovery');
    teamStatus = 200;
    await page.getByRole('button', { name: g('retry'), exact: true }).click();
    await expect(page.getByRole('button', { name: g('retry'), exact: true })).toHaveCount(0);
    expect(rulesReads).toBe(reads);
    await expect(page.locator('#staff-team-description')).toHaveValue('Keep team explanation');
    await expect(page.locator('#team-ticket')).toHaveCount(0);
    memberStatus = 0;
    await page.locator('#staff-team-search').fill('finance & review');
    await expect
      .poll(() => new URLSearchParams(memberQueries.at(-1)).get('q'))
      .toBe('finance & review');
    await page.clock.fastForward(15_001);
    await expect(page.getByRole('button', { name: g('memberRetry'), exact: true })).toBeVisible();
    const failed = memberQueries.at(-1);
    memberStatus = 200;
    await page.getByRole('button', { name: g('memberRetry'), exact: true }).click();
    await expect(page.getByRole('button', { name: g('memberRetry'), exact: true })).toHaveCount(0);
    expect(memberQueries.at(-1)).toBe(failed);
    await expect(page.locator('#staff-team-lead')).toHaveValue(staffMember.id);
    await expect(page.getByRole('button', { name: g('saveTeam'), exact: true })).toBeEnabled();
    await page.locator('#staff-team-lead').scrollIntoViewIfNeeded();
    await inspect(page, 'teams', locale, info.project.name);
  });
  test(`late team responses cannot revive a denied assignment editor (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    let hold = false,
      held: Route | undefined,
      denyMembers = false;
    await page.route(`**/api/admin/staff-teams/${staffTeamId}`, (route) => {
      if (hold) {
        held = route;
        return;
      }
      return route.fulfill({ json: staffTeam });
    });
    await page.route('**/api/admin/config/assignment-rules', (route) =>
      route.fulfill({ json: staffRoutingRules })
    );
    await page.route('**/api/admin/staff-teams/members?*', (route) =>
      route.fulfill(
        denyMembers
          ? { status: 403, json: {} }
          : { json: { items: [staffMember], selected: [staffMember], hasMore: false } }
      )
    );
    await page.goto(`/admin/staff-teams/${staffTeamId}/edit`);
    await page.locator('#staff-team-name').fill('Private draft');
    hold = true;
    await page.getByRole('button', { name: g('refresh'), exact: true }).click();
    await expect.poll(() => !!held).toBe(true);
    denyMembers = true;
    await page.locator('#staff-team-search').fill('Fresh staff');
    await expect(page.getByRole('alert')).toContainText(g('forbidden'));
    await held!.fulfill({ json: staffTeam });
    await expect(page.locator('#staff-team-name')).toHaveCount(0);
    await expect(page.getByText(staffTeam.name, { exact: true })).toHaveCount(0);
  });
}
