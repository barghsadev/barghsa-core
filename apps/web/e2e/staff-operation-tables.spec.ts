import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { crmShell } from './crm-shell-fixture';
import { mockOppositeNumerals } from './number-preference-fixture';
import { tStaffTeams } from '@barghsa/i18n/staff-team-forms';
import { tConsultation } from '@barghsa/i18n/consultation';
import { staffTeam, staffMember, staffRoutingRules } from '../src/test/staff-directory-fixtures';
import {
  consultationContextRows,
  consultationContextDetail,
} from '../src/test/consultation-assignment-fixtures';

const screenshotRoot = process.env['BARGHSA_SCREENSHOT_DIR'] ?? '/tmp';
const visibleRecords =
  'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2,h3)';
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    test(`staff team metadata, one draft and deletion focus survive responsive views (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
    }, info) => {
      await setupCatalogueForms(page, locale, dark, {
        numberStyle: locale === 'fa' ? 'western' : 'persian',
      });
      const text = (key: string) => tStaffTeams(`admin.teams.${key}`, locale);
      const team = {
        ...structuredClone(staffTeam),
        name: 'Finance <script>',
        description: 'Saved financial support',
        skillTags: ['finance', 'energy'],
        isActive: true,
      };
      const teams = [
        team,
        {
          ...team,
          id: 'f0000000-0000-4000-8000-000000000002',
          name: 'Operations',
          description: null,
          memberUserIds: [],
          leadUserId: null,
          skillTags: [],
          isActive: false,
        },
      ];
      let reads = 0,
        writes = 0,
        stepUps = 0,
        failed = false,
        denied = false;
      await page.route('**/api/admin/staff-teams', (route) => {
        expect(route.request().method()).toBe('GET');
        reads++;
        return route.fulfill({
          status: denied ? 403 : failed ? 503 : 200,
          json: denied || failed ? {} : teams,
        });
      });
      await page.route('**/api/admin/config/assignment-rules', (route) =>
        route.fulfill({ json: staffRoutingRules })
      );
      await page.route('**/api/admin/staff-teams/*', (route) => {
        writes++;
        return route.fulfill({ status: 403, json: { error: { code: 'AUTHZ:STEP_UP_REQUIRED' } } });
      });
      // A literal-path handler wins over the wildcard used to count mutation attempts.
      await page.route('**/api/admin/staff-teams/members?*', (route) =>
        route.fulfill({ json: { items: [staffMember], selected: [staffMember], hasMore: false } })
      );
      await page.route('**/api/auth/step-up', (route) => {
        stepUps++;
        return route.fulfill({ json: { verified: true } });
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/admin/staff-teams');
      const root = page.locator('[data-slot=list-page]');
      const records = root.locator(visibleRecords),
        selected = records.filter({ hasText: team.name });
      await expect(records).toHaveCount(2);
      await expect(selected).toContainText(staffMember.name);
      await expect(selected).toContainText('finance, energy');
      await expect(selected).toContainText(text('active'));
      await expect(selected.locator('script,img')).toHaveCount(0);
      const members = selected
        .locator('dl > div')
        .filter({ hasText: text('memberCount') })
        .locator('dd');
      const expectedCount =
        locale === 'fa'
          ? String(team.memberUserIds.length)
          : String(team.memberUserIds.length).replace(
              /\d/g,
              (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]!
            );
      await expect(members).toHaveText(expectedCount);
      expect(
        (await new AxeBuilder({ page }).include('[data-slot=list-page]').analyze()).violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && dark && info.project.name === 'mobile-safari') {
        await page.setViewportSize({ width: 390, height: 1800 });
        await selected.screenshot({ path: `${screenshotRoot}/staff-team-fa-dark.png` });
        await page.setViewportSize({ width: 390, height: 844 });
      }
      await selected.getByRole('button', { name: text('edit'), exact: true }).click();
      const name = page.locator('#staff-team-name');
      await name.fill(' Private changed team ');
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(
        root.getByRole('region', { name: text('catalogue'), exact: true })
      ).toBeVisible();
      await expect(records).toHaveCount(2);
      await expect(selected.locator('th[scope=row]')).toContainText(team.name);
      await expect(name).toHaveValue(' Private changed team ');
      await expect(page.locator('#staff-team-name')).toHaveCount(1);
      expect(reads).toBe(1);
      await selected.getByRole('button', { name: text('delete'), exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(team.name);
      await dialog
        .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
        .click();
      await dialog.locator('input[type=password]').fill('synthetic-password');
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(dialog.locator('input[type=password]')).toHaveValue('synthetic-password');
      await dialog
        .getByRole('button', { name: locale === 'fa' ? 'انصراف' : 'Cancel', exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(name).toHaveValue(' Private changed team ');
      const refresh = page.getByRole('button', { name: text('refresh'), exact: true });
      await expect(refresh).toBeFocused();
      expect(writes).toBe(1);
      expect(stepUps).toBe(0);
      failed = true;
      await refresh.click();
      await expect(records).toHaveCount(2);
      await expect(name).toHaveValue(' Private changed team ');
      await expect(
        selected.getByRole('button', { name: text('edit'), exact: true })
      ).toBeDisabled();
      denied = true;
      await refresh.click();
      await expect(records).toHaveCount(0);
      await expect(page.locator('#staff-team-name')).toHaveCount(0);
      expect(writes).toBe(1);
      expect(stepUps).toBe(0);
    });

    test(`consultation queue metadata, selection and one reason draft survive responsive views (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
    }, info) => {
      await crmShell(page, locale);
      await mockOppositeNumerals(page, locale, dark);
      const copy = (key: string) => tConsultation(key, locale);
      const rows = consultationContextRows().slice(0, 2);
      rows[0]!.status = 'under_review';
      let reads = 0,
        details = 0,
        writes = 0,
        failed = false,
        denied = false;
      await page.route(
        (url) => url.pathname === '/api/admin/consultations/requests',
        (route) => {
          expect(route.request().method()).toBe('GET');
          reads++;
          return route.fulfill({
            status: denied ? 403 : failed ? 503 : 200,
            json: denied || failed ? {} : { requests: rows, nextAfter: null },
          });
        }
      );
      for (const row of rows)
        await page.route(`**/api/admin/consultations/requests/${row.id}`, (route) => {
          expect(route.request().method()).toBe('GET');
          details++;
          return route.fulfill({ json: consultationContextDetail(row) });
        });
      await page.route('**/api/admin/consultations/requests/*/*', (route) => {
        writes++;
        return route.fulfill({ status: 500, json: {} });
      });
      await page.route('**/api/admin/consultations/teams', (route) =>
        route.fulfill({ json: { teams: [{ name: 'Energy Team' }] } })
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/admin/consultations');
      const root = page.getByRole('region', { name: copy('staffTitle'), exact: true });
      const records = root.locator(visibleRecords),
        selected = records.filter({ hasText: rows[0]!.id });
      await expect(records).toHaveCount(2);
      await expect(selected).toContainText(rows[0]!.profile_name);
      await expect(selected).toContainText('Reviewer <script>');
      await expect(selected).toContainText(copy('status_under_review'));
      await expect(selected.locator('script,img')).toHaveCount(0);
      await expect(selected.locator('time')).toHaveAttribute(
        'datetime',
        new Date(rows[0]!.submitted_at).toISOString()
      );
      expect(
        (
          await new AxeBuilder({ page })
            .include('section[aria-label="' + copy('staffTitle') + '"]')
            .analyze()
        ).violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && !dark && info.project.name === 'mobile-safari') {
        await page.setViewportSize({ width: 390, height: 1800 });
        await selected.screenshot({ path: `${screenshotRoot}/consultation-queue-fa-light.png` });
        await page.setViewportSize({ width: 390, height: 844 });
      }
      await selected.getByRole('button', { name: new RegExp(copy('openRequest')) }).click();
      const detail = page.getByRole('region', { name: copy('details'), exact: true });
      await expect(detail).toBeVisible();
      await detail.getByRole('button', { name: copy('reject'), exact: true }).click();
      const reason = detail.getByRole('textbox', { name: copy('note'), exact: true });
      await reason.fill('Private reason retained');
      const detailReads = details;
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(
        root.getByRole('region', { name: copy('queueCatalogue'), exact: true })
      ).toBeVisible();
      await expect(records).toHaveCount(2);
      await expect(
        selected.getByRole('button', { name: new RegExp(copy('openRequest')) })
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(reason).toHaveCount(1);
      await expect(reason).toHaveValue('Private reason retained');
      expect(reads).toBe(1);
      expect(details).toBe(detailReads);
      expect(writes).toBe(0);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(reason).toHaveValue('Private reason retained');
      failed = true;
      await page.getByRole('button', { name: copy('refresh'), exact: true }).click();
      await expect(root.getByRole('alert')).toContainText(copy('loadError'));
      // Toolbar refresh begins a fresh queue snapshot while preserving selected detail work.
      await expect(records).toHaveCount(0);
      await expect(reason).toHaveValue('Private reason retained');
      failed = false;
      await root.getByRole('button', { name: copy('retry'), exact: true }).click();
      await expect(records).toHaveCount(2);
      await expect(reason).toHaveValue('Private reason retained');
      denied = true;
      await page.getByRole('button', { name: copy('refresh'), exact: true }).click();
      await expect(root.getByRole('alert')).toContainText(copy('queueForbidden'));
      await expect(records).toHaveCount(0);
      await expect(reason).toHaveCount(0);
      expect(writes).toBe(0);
    });
  }
