import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import AxeBuilder from '@axe-core/playwright';
import { teamCatalogue, teamProfiles } from '../src/test/team-catalogue-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const theme of ['light', 'dark'] as const) {
    test(`team invitation validation and retained recovery (${locale}, ${theme})`, async ({
      page,
    }) => {
      const fa = locale === 'fa';
      await crmShell(page, locale);
      await page.route('**/api/auth/user', (route) =>
        route.fulfill({
          json: {
            userId: 'owner',
            isStaff: false,
            operatingContext: 'customer',
            canSwitchContext: false,
            requiresTosAcceptance: false,
          },
        })
      );
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            appTitle: 'Team',
            appTitleFa: 'تیم',
            supportEmail: 'support@example.test',
            supportPhone: '+982112345678',
            supportMobile: '+989121234567',
            backgroundColor: '#f6f7f4',
            darkBackgroundColor: '#15201c',
            fontFamily: 'vazirmatn',
            borderRadiusRem: 0.75,
            spacingScale: 1,
            numberStyle: 'locale',
            slogan: '',
            primaryColor: '#2563eb',
            secondaryColor: '#64748b',
            accentColor: '#f59e0b',
            logoUrl: null,
            faviconUrl: null,
            darkMode: theme === 'dark',
          },
        })
      );

      await page.route('**/api/profiles', (route) => route.fulfill({ json: teamProfiles() }));
      await page.route('**/api/profiles/ownership-transfers', (route) =>
        route.fulfill({ json: { transfers: [] } })
      );
      await page.route('**/api/invitations/pending', (route) =>
        route.fulfill({ json: { invitations: [] } })
      );
      await page.route('**/api/profiles/*/agents', (route) =>
        route.fulfill({ json: teamCatalogue() })
      );
      const bodies: unknown[] = [];
      await page.route('**/api/profiles/*/invitations', (route) => {
        bodies.push(route.request().postDataJSON());
        if (bodies.length === 1)
          return route.fulfill({
            status: 400,
            json: {
              error: {
                code: 'VALIDATION:INPUT:INVALID',
                fields: ['message'],
                message: 'raw server text',
              },
            },
          });
        if (bodies.length === 2) return route.fulfill({ status: 409, json: {} });
        if (bodies.length === 3) return route.abort('failed');
        if (bodies.length === 4) return route.fulfill({ status: 201, json: { id: '../unsafe' } });
        return route.fulfill({ status: 201, json: { id: 'accepted-invite' } });
      });
      await page.goto('/settings/team');
      if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
      else await expect(page.locator('html')).not.toHaveClass(/dark/);
      const invite = page.getByRole('button', {
        name: fa ? 'دعوت عضو تیم' : 'Invite a team member',
        exact: true,
      });
      await invite.click();
      const dialog = page.getByRole('dialog');
      const username = dialog.locator('#team-username'),
        message = dialog.locator('#invite-message');
      const submit = dialog.getByRole('button', {
        name: fa ? 'ارسال دعوت‌نامه' : 'Send invitation',
        exact: true,
      });
      await username.fill('bad-destination');
      await message.focus();
      await expect(username).toHaveAttribute('aria-invalid', 'true');
      await submit.click();
      await expect(username).toBeFocused();
      expect(bodies).toHaveLength(0);
      expect(
        (await new AxeBuilder({ page }).include('[role=dialog]').analyze()).violations
      ).toEqual([]);
      await username.fill(' 09121234567 ');
      await message.fill('Retained invitation note');
      await submit.click();
      await expect(message).toBeFocused();
      await expect(message).toHaveAttribute('aria-invalid', 'true');
      await expect(username).toHaveValue(' 09121234567 ');
      await expect(message).toHaveValue('Retained invitation note');
      await expect(dialog).not.toContainText('raw server text');
      expect(bodies[0]).toEqual({
        username: '09121234567',
        role: 'Manager',
        message: 'Retained invitation note',
      });
      expect(
        (await new AxeBuilder({ page }).include('[role=dialog]').analyze()).violations
      ).toEqual([]);
      await message.fill('Corrected invitation note');
      await expect(message).not.toHaveAttribute('aria-invalid', 'true');
      for (let attempt = 2; attempt <= 4; attempt++) {
        await submit.click();
        await expect(dialog.getByRole('alert')).toBeVisible();
        await expect(message).toHaveValue('Corrected invitation note');
        await expect(submit).toBeEnabled();
        expect(bodies).toHaveLength(attempt);
      }
      await submit.click();
      await expect(dialog).toHaveCount(0);
      await expect(invite).toBeFocused();
      expect(bodies).toHaveLength(5);
      await invite.click();
      await expect(username).toHaveValue('');
      await expect(message).toHaveValue('');
    });
    test(`team role validation in both editors (${locale}, ${theme})`, async ({ page }) => {
      const fa = locale === 'fa';
      await crmShell(page, locale);
      await page.route('**/api/auth/user', (route) =>
        route.fulfill({
          json: {
            userId: 'owner',
            isStaff: false,
            operatingContext: 'customer',
            canSwitchContext: false,
            requiresTosAcceptance: false,
          },
        })
      );
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            appTitle: 'Team',
            appTitleFa: 'تیم',
            supportEmail: 'support@example.test',
            supportPhone: '+982112345678',
            supportMobile: '+989121234567',
            backgroundColor: '#f6f7f4',
            darkBackgroundColor: '#15201c',
            fontFamily: 'vazirmatn',
            borderRadiusRem: 0.75,
            spacingScale: 1,
            numberStyle: 'locale',
            slogan: '',
            primaryColor: '#2563eb',
            secondaryColor: '#64748b',
            accentColor: '#f59e0b',
            logoUrl: null,
            faviconUrl: null,
            darkMode: theme === 'dark',
          },
        })
      );

      await page.route('**/api/profiles', (route) => route.fulfill({ json: teamProfiles() }));
      await page.route('**/api/profiles/ownership-transfers', (route) =>
        route.fulfill({ json: { transfers: [] } })
      );
      await page.route('**/api/invitations/pending', (route) =>
        route.fulfill({ json: { invitations: [] } })
      );
      const team = teamCatalogue(),
        member = team.agents[0]!;
      let saved = ['Manager'];
      await page.route('**/api/profiles/*/agents', (route) =>
        route.fulfill({
          json: {
            ...team,
            agents: [
              ...saved.map((role) => ({ ...member, id: `member-${role}`, role })),
              ...team.agents.slice(1),
            ],
          },
        })
      );
      await page.route('**/api/profiles/*/agents/*/activity*', (route) =>
        route.fulfill({
          json: { profileId: team.profileId, userId: member.userId, items: [], nextCursor: null },
        })
      );
      let attempts = 0,
        verified = 0;
      const bodies: { roles: string[] }[] = [];
      await page.route('**/api/auth/step-up', (route) => {
        verified++;
        return route.fulfill({ json: { verified: true } });
      });
      await page.route('**/api/profiles/*/agents/*/roles', (route) => {
        bodies.push(route.request().postDataJSON());
        attempts++;
        if (attempts === 1) return route.fulfill({ status: 403, json: { requiresStepUp: true } });
        if (attempts === 2)
          return route.fulfill({
            status: 400,
            json: {
              error: {
                code: 'VALIDATION:INPUT:INVALID',
                fields: ['roles'],
                message: 'raw server text',
              },
            },
          });
        saved = bodies.at(-1)!.roles;
        return route.fulfill({ json: { roles: saved } });
      });
      await page.goto('/settings/team');
      if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
      else await expect(page.locator('html')).not.toHaveClass(/dark/);
      const saveName = fa ? 'ذخیره نقش‌ها' : 'Save roles';
      const managerName = fa ? 'مدیر' : 'Manager',
        financeName = fa ? 'مالی' : 'Finance',
        legalName = fa ? 'حقوقی' : 'Legal';
      for (const details of [false, true]) {
        attempts = 0;
        if (details)
          await page
            .getByRole('button', { name: fa ? 'مشاهده جزئیات' : 'View details', exact: true })
            .first()
            .click();
        const editor = details ? page.getByRole('dialog') : page.locator('main');
        const manager = editor.getByRole('checkbox', { name: managerName, exact: true });
        const finance = editor.getByRole('checkbox', { name: financeName, exact: true });
        const legal = editor.getByRole('checkbox', { name: legalName, exact: true });
        for (const checkbox of [manager, finance, legal])
          if (await checkbox.isChecked()) await checkbox.uncheck();
        await expect(manager).toHaveAttribute('aria-invalid', 'true');
        await editor.getByRole('button', { name: saveName, exact: true }).click();
        await expect(manager).toBeFocused();
        expect(attempts).toBe(0);
        await finance.check();
        await expect(manager).not.toHaveAttribute('aria-invalid', 'true');
        await editor.getByRole('button', { name: saveName, exact: true }).click();
        let dialog = page.getByRole('dialog');
        const confirm = () =>
          dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
        await confirm().click();
        await dialog.locator('input[type=password]').fill('synthetic-password');
        await confirm().click();
        await expect(finance).toBeChecked();
        await expect(manager).toHaveAttribute('aria-invalid', 'true');
        await expect(manager).toBeFocused();
        await expect(editor).not.toContainText('raw server text');
        expect(attempts).toBe(2);
        await expect(editor).toHaveCSS('opacity', '1');
        expect(
          (await new AxeBuilder({ page }).include(details ? '[role=dialog]' : 'main').analyze())
            .violations
        ).toEqual([]);
        await (details ? manager : legal).check();
        await editor.getByRole('button', { name: saveName, exact: true }).click();
        dialog = page.getByRole('dialog');
        await confirm().click();
        await expect(editor.getByRole('button', { name: saveName, exact: true })).toBeDisabled();
        await expect(finance).toBeChecked();
        await expect(details ? manager : legal).toBeChecked();
        expect(attempts).toBe(3);
        if (details)
          await editor
            .getByRole('button', { name: fa ? 'بستن' : 'Close', exact: true })
            .first()
            .click();
      }
      expect(verified).toBe(2);
      expect(bodies).toHaveLength(6);
      expect(bodies[1]).toEqual(bodies[0]);
      expect(bodies[4]).toEqual(bodies[3]);
    });
  }
