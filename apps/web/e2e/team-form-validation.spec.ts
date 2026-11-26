import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { approveRiskConfirmation } from './confirmation-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/team';
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
      const invite = page.getByRole('link', {
        name: fa ? 'دعوت عضو تیم' : 'Invite a team member',
        exact: true,
      });
      await invite.click();
      const dialog = page.getByRole('form', { name: fa ? 'دعوت عضو تیم' : 'Invite a team member' });
      const username = dialog.locator('#team-username'),
        message = dialog.locator('#invite-message');
      await expect(username).toHaveAttribute('aria-required', 'true');
      await expect(username).toHaveAccessibleDescription(/09.*\+98/);
      await expect(dialog.locator('#invite-role')).toHaveAttribute('aria-required', 'true');
      await expect(dialog.locator('#invite-role')).toHaveAccessibleDescription(
        t('team.roleEffect.Manager', locale)
      );
      await expect(message).not.toHaveAttribute('aria-required', 'true');
      const submit = dialog.getByRole('button', {
        name: fa ? 'ارسال دعوت‌نامه' : 'Send invitation',
        exact: true,
      });
      await username.fill('bad-destination');
      await message.focus();
      await expect(username).toHaveAttribute('aria-invalid', 'true');
      await expect(dialog.getByText(/bad-destination/)).toHaveCount(0);
      await submit.click();
      await expect(username).toBeFocused();
      expect(bodies).toHaveLength(0);
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      await username.fill('person{role}@example.test');
      await expect(dialog.getByText('person{role}@example.test', { exact: true })).toBeVisible();
      const enteredUsername = fa ? ' ۰۹١۲١۲۳۴۵٦۷ ' : ' 09121234567 ';
      await username.fill(enteredUsername);
      await expect(dialog.getByText('+989121234567', { exact: true })).toBeVisible();
      await message.fill('Retained invitation note');
      await submit.click();
      await expect(message).toBeFocused();
      await expect(message).toHaveAttribute('aria-invalid', 'true');
      await expect(username).toHaveValue(enteredUsername);
      await expect(message).toHaveValue('Retained invitation note');
      await expect(dialog).not.toContainText('raw server text');
      expect(bodies[0]).toEqual({
        username: '+989121234567',
        role: 'Manager',
        message: 'Retained invitation note',
      });
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
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
      await expect(page).toHaveURL(/settings\/team\/invitations\/accepted-invite$/);
      await page
        .getByRole('main')
        .getByRole('link', { name: fa ? 'دعوت‌نامه‌ها' : 'Invitations', exact: true })
        .click();
      expect(bodies).toHaveLength(5);
      await invite.click();
      await expect(username).toHaveValue('');
      await expect(message).toHaveValue('');
    });
    test(`team role validation through both editor entry points (${locale}, ${theme})`, async ({
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
      const roleRequirement = fa
        ? 'نقش‌ها (حداقل یک نقش انتخاب کنید)'
        : 'Roles (choose at least one)';
      const invalidRoles = fa
        ? 'حداقل یک نقش معتبر انتخاب کنید؛ هر نقش فقط یک بار.'
        : 'Choose at least one valid role, without duplicates.';
      for (const details of [false, true]) {
        attempts = 0;
        const main = page.getByRole('main');
        await main
          .getByRole('link', { name: fa ? 'ویرایش نقش‌ها' : 'Edit roles', exact: true })
          .click();
        await expect(page).toHaveURL(/settings\/team\/members\/member\/edit$/);
        const editor = main;
        const roles = editor.getByRole('group', { name: roleRequirement, exact: true });
        await expect(roles.getByText(roleRequirement, { exact: true })).toBeVisible();
        const manager = roles.getByRole('checkbox', { name: managerName, exact: true });
        const finance = roles.getByRole('checkbox', { name: financeName, exact: true });
        const legal = roles.getByRole('checkbox', { name: legalName, exact: true });
        const managerEffect = t('team.roleEffect.Manager', locale);
        await expect(manager).toHaveAccessibleDescription(managerEffect);
        for (const checkbox of [manager, finance, legal])
          if (await checkbox.isChecked()) await checkbox.uncheck();
        await expect(manager).toHaveAttribute('aria-invalid', 'true');
        await editor.getByRole('button', { name: saveName, exact: true }).click();
        await expect(manager).toBeFocused();
        await expect(roles).toHaveAccessibleDescription(invalidRoles);
        await expect(manager).toHaveAccessibleDescription(`${managerEffect} ${invalidRoles}`);
        expect(attempts).toBe(0);
        await finance.check();
        await expect(manager).not.toHaveAttribute('aria-invalid', 'true');
        await editor.getByRole('button', { name: saveName, exact: true }).click();
        let dialog = page.getByRole('dialog');
        const confirm = () =>
          dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
        await expect(confirm()).toBeDisabled();
        await approveRiskConfirmation(page, locale, 'destructive');
        await confirm().click();
        await dialog.locator('input[type=password]').fill('synthetic-password');
        await confirm().click();
        await expect(finance).toBeChecked();
        await expect(manager).toHaveAttribute('aria-invalid', 'true');
        await expect(manager).toBeFocused();
        await expect(editor).not.toContainText('raw server text');
        expect(attempts).toBe(2);
        await expect(editor).toHaveCSS('opacity', '1');
        expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
        await (details ? manager : legal).check();
        await editor.getByRole('button', { name: saveName, exact: true }).click();
        dialog = page.getByRole('dialog');
        await expect(confirm()).toBeDisabled();
        await approveRiskConfirmation(page, locale, 'destructive');
        await confirm().click();
        await expect(page).toHaveURL(/settings\/team\/members\/member$/);
        await expect(
          editor.getByRole('heading', { name: fa ? 'جزئیات عضو' : 'Member details', exact: true })
        ).toBeVisible();
        await expect(editor.getByText(financeName, { exact: true })).toBeVisible();
        await expect(
          editor.getByText(details ? managerName : legalName, { exact: true })
        ).toBeVisible();
        expect(attempts).toBe(3);
      }
      expect(verified).toBe(2);
      expect(bodies).toHaveLength(6);
      expect(bodies[1]).toEqual(bodies[0]);
      expect(bodies[4]).toEqual(bodies[3]);
    });
  }
