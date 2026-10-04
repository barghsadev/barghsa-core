import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { tStaffTeams as t } from '@barghsa/i18n/staff-team-forms';
import {
  staffTeam,
  staffTeamId,
  staffMember,
  staffRoutingRules,
} from '../src/test/staff-directory-fixtures';
import AxeBuilder from '@axe-core/playwright';
test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    test(`team fields, membership, lead and captured step-up (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
    }, info) => {
      await setupCatalogueForms(page, locale, dark);
      const text = (key: string) => t(`admin.teams.${key}`, locale);
      let saved = structuredClone(staffTeam),
        verified = false,
        invalid = true;
      const writes: unknown[] = [];
      await page.route('**/api/admin/staff-teams', (route) => route.fulfill({ json: [saved] }));
      await page.route('**/api/admin/staff-teams/members?*', (route) =>
        route.fulfill({ json: { items: [staffMember], selected: [staffMember], hasMore: false } })
      );
      await page.route('**/api/admin/config/assignment-rules', (route) =>
        route.fulfill({ json: staffRoutingRules })
      );
      await page.route(`**/api/admin/staff-teams/${staffTeamId}`, (route) => {
        const body = route.request().postDataJSON();
        writes.push(body);
        if (!verified)
          return route.fulfill({
            status: 403,
            json: { error: { code: 'AUTHZ:STEP_UP_REQUIRED' } },
          });
        if (invalid)
          return route.fulfill({
            status: 400,
            json: { error: { code: 'VALIDATION:INPUT:INVALID', fields: ['tags'] } },
          });
        saved = { ...saved, ...body };
        return route.fulfill({ json: saved });
      });
      await page.route('**/api/auth/step-up', (route) => {
        verified = true;
        return route.fulfill({ json: { verified: true } });
      });
      await page.goto('/admin/staff-teams');
      await page.getByRole('button', { name: text('edit'), exact: true }).click();
      const form = page.locator('form').filter({ has: page.locator('#staff-team-name') });
      const name = page.locator('#staff-team-name'),
        tags = page.locator('#staff-team-tags');
      const save = form.getByRole('button', { name: text('saveTeam'), exact: true });
      await name.fill(' ');
      await save.click();
      await expect(name).toBeFocused();
      await expect(name).toHaveAttribute('aria-invalid', 'true');
      expect(writes).toEqual([]);
      await name.fill(' Finance updated ');
      await tags.fill('finance, finance');
      await save.click();
      await expect(tags).toBeFocused();
      await expect(tags).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('#staff-team-lead')).toHaveValue(staffMember.id);
      const box = form.getByRole('checkbox', { name: staffMember.name, exact: true });
      await box.uncheck();
      await expect(page.locator('#staff-team-lead')).toHaveValue('');
      await box.check();
      await page.locator('#staff-team-lead').selectOption(staffMember.id);
      await tags.fill(' finance, billing ');
      await save.click();
      let dialog = page.getByRole('dialog');
      await expect(page.locator('#team-ticket')).toBeDisabled();
      await dialog.locator('button[type=submit]').click();
      await dialog.locator('input[type=password]').fill('synthetic-password');
      await dialog.locator('button[type=submit]').click();
      await expect(dialog).toHaveCount(0);
      await expect(tags).toBeFocused();
      await expect(tags).toHaveValue(' finance, billing ');
      invalid = false;
      await save.click();
      dialog = page.getByRole('dialog');
      await dialog.locator('button[type=submit]').click();
      await expect(dialog).toHaveCount(0);
      expect(writes).toHaveLength(3);
      expect(writes[0]).toEqual(writes[1]);
      expect(writes[1]).toEqual(writes[2]);
      expect(saved).toMatchObject({
        name: 'Finance updated',
        skillTags: ['finance', 'billing'],
        leadUserId: staffMember.id,
        memberUserIds: [staffMember.id],
      });
      await page.getByRole('button', { name: text('edit'), exact: true }).click();
      await expect(tags).toHaveValue('finance, billing');
      const result = await new AxeBuilder({ page })
        .include('section')
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      expect(result.violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && dark && info.project.name === 'mobile-safari') {
        await page.setViewportSize({ width: 390, height: 1800 });
        await form.screenshot({ path: '/tmp/barghsa-staff-team-form-fa-dark.png' });
      }
    });
    test(`team and routing stale drafts, unverified receipts and priority recovery (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
    }, info) => {
      await setupCatalogueForms(page, locale, dark);
      const text = (key: string) => t(`admin.teams.${key}`, locale);
      const alternate = '33333333-3333-4333-8333-333333333333';
      let team = structuredClone(staffTeam),
        rules = structuredClone(staffRoutingRules);
      let fail = false,
        malformed = false,
        wrongReceipt = true,
        denied = false;
      const bodies: unknown[] = [];
      await page.route('**/api/admin/staff-teams', (route) =>
        route.fulfill({ json: [team, { ...staffTeam, id: alternate, name: 'Fallback team' }] })
      );
      await page.route('**/api/admin/staff-teams/members?*', (route) =>
        route.fulfill({ json: { items: [staffMember], selected: [staffMember], hasMore: false } })
      );
      await page.route('**/api/admin/config/assignment-rules', (route) => {
        if (route.request().method() === 'GET')
          return route.fulfill({
            status: denied ? 403 : fail ? 503 : 200,
            json: malformed ? { ticket: {} } : rules,
          });
        const body = route.request().postDataJSON();
        bodies.push(body);
        if (wrongReceipt) return route.fulfill({ json: { ok: true } });
        rules = body;
        return route.fulfill({ json: rules });
      });
      await page.goto('/admin/staff-teams');
      await page
        .locator('li')
        .filter({ has: page.getByRole('heading', { name: staffTeam.name, exact: true }) })
        .getByRole('button', { name: text('edit'), exact: true })
        .click();
      await page.locator('#staff-team-name').fill('Retained team');
      team = { ...team, name: 'Concurrent team' };
      await page.getByRole('button', { name: text('refresh'), exact: true }).click();
      await expect(page.locator('#staff-team-name')).toHaveValue('Retained team');
      await expect(page.locator('#staff-team-name')).toBeDisabled();
      await page.getByRole('button', { name: text('resetTeam'), exact: true }).click();
      await expect(page.locator('#staff-team-name')).toHaveValue('Concurrent team');
      await page.locator('#team-consultation').selectOption(staffTeamId);
      await page
        .getByRole('group', { name: text('consultation'), exact: true })
        .getByRole('button', { name: text('addFallback'), exact: true })
        .click();
      await page.locator('#fallback-strategy-consultation-2').selectOption('expertise');
      const save = page.getByRole('button', { name: text('saveRules'), exact: true });
      await save.click();
      let dialog = page.getByRole('dialog');
      fail = true;
      await dialog.getByRole('button', { name: text('refreshRules'), exact: true }).click();
      await expect(dialog.locator('button[type=submit]')).toBeDisabled();
      fail = false;
      malformed = true;
      await dialog.getByRole('button', { name: text('refreshRules'), exact: true }).click();
      await expect(dialog.locator('button[type=submit]')).toBeDisabled();
      malformed = false;
      await dialog.getByRole('button', { name: text('refreshRules'), exact: true }).click();
      await expect(dialog.locator('button[type=submit]')).toBeEnabled();
      rules = { ...staffRoutingRules, consultation: { teamId: null, strategy: 'load' } };
      await dialog.getByRole('button', { name: text('refreshRules'), exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('#team-consultation')).toHaveValue(staffTeamId);
      await expect(save).toBeDisabled();
      await expect(page.getByRole('alert').filter({ hasText: text('staleRules') })).toBeVisible();
      await page.getByRole('button', { name: text('resetRules'), exact: true }).click();
      await page.locator('#team-consultation').selectOption(staffTeamId);
      await save.click();
      dialog = page.getByRole('dialog');
      await dialog.locator('button[type=submit]').click();
      await expect(dialog).toContainText(text('unverified'));
      await expect(dialog.locator('button[type=submit]')).toBeDisabled();
      await dialog
        .getByRole('button', { name: locale === 'fa' ? 'انصراف' : 'Cancel', exact: true })
        .click();
      await expect(save).toBeDisabled();
      await page.getByRole('button', { name: text('refreshRules'), exact: true }).click();
      await page.getByRole('button', { name: text('resetRules'), exact: true }).click();
      await page.locator('#team-consultation').selectOption(staffTeamId);
      wrongReceipt = false;
      await save.click();
      await page.getByRole('dialog').locator('button[type=submit]').click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toEqual({
        ...staffRoutingRules,
        consultation: { teamId: staffTeamId, strategy: 'load' },
      });
      await expect(page.locator('#team-consultation')).toHaveValue(staffTeamId);
      expect(
        (await new AxeBuilder({ page }).include('form:has(#team-consultation)').analyze())
          .violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (
        (locale === 'fa' && dark && info.project.name === 'mobile-safari') ||
        (locale === 'en' && !dark && info.project.name === 'chromium')
      )
        await page
          .locator('form')
          .filter({ has: page.locator('#team-consultation') })
          .screenshot({
            path: info.outputPath(
              `consultation-rules-${locale}-${dark ? 'dark' : 'light'}-${info.project.name}.png`
            ),
          });
      denied = true;
      await page.getByRole('button', { name: text('refreshRules'), exact: true }).click();
      await expect(page.locator('#staff-team-name')).toHaveCount(0);
      await expect(page.locator('#team-consultation')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
    });
  }
