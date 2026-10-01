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
  test(`staff list retries preserve creation fields and permission denial clears work (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    let fail = false,
      deny = false,
      accessReads = 0,
      optionReads = 0;
    const queries: string[] = [];
    await page.route('**/api/admin/staff-access', (route) => {
      ++accessReads;
      return route.fulfill({ json: staffAccess });
    });
    await page.route('**/api/admin/staff-role-options', (route) => {
      ++optionReads;
      return route.fulfill({ json: staffRoles });
    });
    await page.route('**/api/admin/staff?*', (route) => {
      queries.push(new URL(route.request().url()).search);
      return route.fulfill(
        deny
          ? { status: 403, json: {} }
          : fail
            ? { status: 503, json: {} }
            : { json: { items: [staffUser], total: 51 } }
      );
    });
    await page.goto('/admin/users');
    await page.getByRole('button', { name: u('create'), exact: true }).click();
    await page.locator('#staff-firstName').fill('Retained name');
    const viewport = page
      .getByRole('region', { name: u('title'), exact: true })
      .locator('[data-slot="scroll-area-viewport"]');
    await viewport.focus();
    await viewport.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
    await expect
      .poll(() => viewport.evaluate((node) => Math.abs(node.scrollLeft)))
      .toBeGreaterThan(0);
    fail = true;
    await page.getByRole('button', { name: u('next'), exact: true }).click();
    await expect(page.getByRole('button', { name: u('retry'), exact: true })).toBeVisible();
    await page.locator('#staff-lastName').fill('During recovery');
    const counts = [accessReads, optionReads],
      failed = queries.at(-1);
    fail = false;
    await page.getByRole('button', { name: u('retry'), exact: true }).click();
    await expect(page.getByRole('button', { name: u('retry'), exact: true })).toHaveCount(0);
    expect(queries.at(-1)).toBe(failed);
    expect([accessReads, optionReads]).toEqual(counts);
    await expect(page.locator('#staff-firstName')).toHaveValue('Retained name');
    await expect(page.locator('#staff-lastName')).toHaveValue('During recovery');
    await page.locator('#staff-lastName').scrollIntoViewIfNeeded();
    await inspect(page, 'users', locale, info.project.name);
    deny = true;
    await page.getByRole('button', { name: u('next'), exact: true }).click();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.locator('#staff-firstName')).toHaveCount(0);
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
    await page.goto('/admin/users');
    await page.getByRole('button', { name: u('create'), exact: true }).click();
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
    await expect(page.getByRole('table')).toBeVisible();
    await page.getByRole('button', { name: u('editRoles'), exact: true }).click();
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
      rulesStatus = 503,
      memberStatus = 200,
      rulesReads = 0;
    const memberQueries: string[] = [];
    await page.route('**/api/admin/staff-teams', (route) =>
      route.fulfill(teamStatus === 200 ? { json: [staffTeam] } : { status: teamStatus, json: {} })
    );
    await page.route('**/api/admin/config/assignment-rules', (route) => {
      ++rulesReads;
      return route.fulfill(
        rulesStatus === 200 ? { json: staffRoutingRules } : { status: rulesStatus, json: {} }
      );
    });
    await page.route('**/api/admin/staff-teams/members?*', (route) => {
      memberQueries.push(new URL(route.request().url()).search);
      return route.fulfill(
        memberStatus === 200
          ? { json: { items: [staffMember], selected: [staffMember], hasMore: false } }
          : { status: memberStatus, json: {} }
      );
    });
    await page.goto('/admin/staff-teams');
    await page.getByRole('button', { name: g('edit'), exact: true }).click();
    await expect(page.locator('#staff-team-lead')).toHaveValue(staffMember.id);
    await page.locator('#staff-team-description').fill('Keep team explanation');
    await page.locator('#team-ticket').selectOption(staffTeamId);
    rulesStatus = 200;
    await page.getByRole('button', { name: g('rulesRetry'), exact: true }).click();
    await expect(page.getByRole('button', { name: g('rulesRetry'), exact: true })).toHaveCount(0);
    await expect(page.locator('#team-ticket')).toHaveValue(staffTeamId);
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
    await expect(page.locator('#team-ticket')).toHaveValue(staffTeamId);
    memberStatus = 503;
    await page.locator('#staff-team-search').fill('finance & review');
    await expect(page.getByRole('button', { name: g('memberRetry'), exact: true })).toBeVisible();
    const failed = memberQueries.at(-1);
    memberStatus = 200;
    await page.getByRole('button', { name: g('memberRetry'), exact: true }).click();
    await expect(page.getByRole('button', { name: g('memberRetry'), exact: true })).toHaveCount(0);
    expect(memberQueries.at(-1)).toBe(failed);
    await expect(page.locator('#staff-team-lead')).toHaveValue(staffMember.id);
    await expect(page.getByRole('button', { name: g('saveTeam'), exact: true })).toBeEnabled();
    await page.locator('#team-ticket').scrollIntoViewIfNeeded();
    await inspect(page, 'teams', locale, info.project.name);
  });
  test(`late team responses cannot revive a denied assignment editor (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    let hold = false,
      held: Route | undefined,
      denyMembers = false;
    await page.route('**/api/admin/staff-teams', (route) => {
      if (hold) {
        held = route;
        return;
      }
      return route.fulfill({ json: [staffTeam] });
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
    await page.goto('/admin/staff-teams');
    await expect(page.getByRole('button', { name: g('edit'), exact: true })).toBeVisible();
    await page.locator('#staff-team-name').fill('Private draft');
    hold = true;
    await page.getByRole('button', { name: g('refresh'), exact: true }).click();
    await expect.poll(() => !!held).toBe(true);
    denyMembers = true;
    await page.locator('#staff-team-search').fill('Fresh staff');
    await expect(page.getByRole('alert')).toContainText(g('forbidden'));
    await held!.fulfill({ json: [staffTeam] });
    await expect(page.locator('#staff-team-name')).toHaveCount(0);
    await expect(page.getByText(staffTeam.name, { exact: true })).toHaveCount(0);
  });
}
