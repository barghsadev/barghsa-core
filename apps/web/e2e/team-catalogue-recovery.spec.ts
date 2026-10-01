import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import AxeBuilder from '@axe-core/playwright';
import {
  teamCatalogue,
  teamProfiles,
  ownershipTransfer,
} from '../src/test/team-catalogue-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const theme of ['light', 'dark'] as const) {
    test(`customer team and ownership recovery (${locale}, ${theme})`, async ({ page }) => {
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
      let memberFailed = false,
        transferFailed = false,
        profileFailed = false,
        changed = false,
        memberDenied = false,
        memberStatus = 403,
        accountDenied = false;
      await page.route('**/api/invitations/pending', (route) =>
        route.fulfill({ json: { invitations: [] } })
      );
      await page.route('**/api/profiles', (route) =>
        route.fulfill({
          status: accountDenied ? 403 : profileFailed ? 503 : 200,
          json: teamProfiles(),
        })
      );
      await page.route('**/api/profiles/ownership-transfers', (route) =>
        route.fulfill({
          status: transferFailed ? 503 : 200,
          json: { transfers: [ownershipTransfer()] },
        })
      );
      await page.route('**/api/profiles/*/agents', (route) =>
        route.fulfill({
          status: memberDenied ? memberStatus : memberFailed ? 503 : 200,
          json: changed
            ? { ...teamCatalogue(), agents: [{ ...teamCatalogue().agents[0], role: 'Legal' }] }
            : teamCatalogue(),
        })
      );
      await page.route('**/api/profiles/*/agents/*/roles', (route) =>
        route.fulfill({ status: 403, json: { requiresStepUp: true } })
      );
      await page.goto('/settings/team');
      const refreshMembers = fa ? 'بازخوانی اعضا' : 'Refresh members';
      const refreshProfiles = fa ? 'بازخوانی پروفایل' : 'Refresh profile';
      const refreshTransfers = fa ? 'بازخوانی درخواست‌های مالکیت' : 'Refresh ownership requests';
      const finance = page.getByRole('checkbox', { name: fa ? 'مالی' : 'Finance', exact: true });
      await finance.check();
      memberFailed = true;
      await page.getByRole('button', { name: refreshMembers, exact: true }).click();
      const save = page.getByRole('button', {
        name: fa ? 'ذخیره نقش‌ها' : 'Save roles',
        exact: true,
      });
      await expect(finance).toBeChecked();
      await expect(save).toBeDisabled();
      await expect(page.getByText('Transfer company', { exact: true })).toBeVisible();
      memberFailed = false;
      await page.getByRole('button', { name: refreshMembers, exact: true }).click();
      await expect(save).toBeEnabled();
      await save.click();
      let dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true }).click();
      const password = dialog.locator('input[type=password]');
      await password.fill('synthetic-password');
      memberFailed = true;
      await dialog.getByRole('button', { name: refreshMembers, exact: true }).click();
      await expect(password).toHaveValue('synthetic-password');
      await expect(
        dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      ).toBeDisabled();
      expect(
        (await new AxeBuilder({ page }).include('[role=dialog]').analyze()).violations
      ).toEqual([]);
      changed = true;
      memberFailed = false;
      await dialog.getByRole('button', { name: refreshMembers, exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('button', { name: refreshMembers, exact: true })).toBeFocused();
      await expect(finance).toBeChecked();
      await page
        .getByRole('button', {
          name: fa ? 'بازنشانی با نقش‌های ذخیره‌شده' : 'Reset to saved roles',
          exact: true,
        })
        .click();
      await expect(finance).not.toBeChecked();
      await page
        .getByRole('button', { name: fa ? 'دعوت عضو تیم' : 'Invite a team member', exact: true })
        .click();
      dialog = page.getByRole('dialog');
      const username = dialog.locator('#team-username');
      await username.fill('local@example.test');
      profileFailed = true;
      // The profile toolbar remains independently reachable outside the modal.
      await page.getByRole('button', { name: fa ? 'انصراف' : 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: refreshProfiles, exact: true }).click();
      await expect(
        page.getByRole('button', {
          name: fa ? 'دعوت عضو تیم' : 'Invite a team member',
          exact: true,
        })
      ).toBeDisabled();
      profileFailed = false;
      await page.getByRole('button', { name: refreshProfiles, exact: true }).click();
      await page
        .getByRole('button', { name: fa ? 'دعوت عضو تیم' : 'Invite a team member', exact: true })
        .click();
      await expect(username).toHaveValue('local@example.test');
      memberFailed = true;
      await dialog.getByRole('button', { name: refreshMembers, exact: true }).click();
      await expect(username).toHaveValue('local@example.test');
      await expect(
        dialog.getByRole('button', {
          name: fa ? 'ارسال دعوت‌نامه' : 'Send invitation',
          exact: true,
        })
      ).toBeDisabled();
      const box = await dialog.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(391);
      expect(
        (await new AxeBuilder({ page }).include('[role=dialog]').analyze()).violations
      ).toEqual([]);
      memberFailed = false;
      await dialog.getByRole('button', { name: refreshMembers, exact: true }).click();
      await expect(
        dialog.getByRole('button', {
          name: fa ? 'ارسال دعوت‌نامه' : 'Send invitation',
          exact: true,
        })
      ).toBeEnabled();
      await dialog
        .getByRole('button', { name: fa ? 'انصراف' : 'Cancel', exact: true })
        .press('Enter');
      await expect(
        page.getByRole('button', {
          name: fa ? 'دعوت عضو تیم' : 'Invite a team member',
          exact: true,
        })
      ).toBeFocused();
      await page
        .getByRole('button', { name: fa ? 'رد درخواست' : 'Decline request', exact: true })
        .click();
      dialog = page.getByRole('dialog');
      transferFailed = true;
      await dialog.getByRole('button', { name: refreshTransfers, exact: true }).click();
      await expect(
        dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      ).toBeDisabled();
      transferFailed = false;
      await dialog.getByRole('button', { name: refreshTransfers, exact: true }).click();
      await expect(
        dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      ).toBeEnabled();
      await dialog
        .getByRole('button', { name: fa ? 'انصراف' : 'Cancel', exact: true })
        .press('Enter');
      const region = page.getByRole('region', {
        name: fa ? 'اعضا و دعوت‌نامه‌ها' : 'Members and invitations',
        exact: true,
      });
      await region.focus();
      await expect(region).toBeFocused();
      await page.keyboard.press('ArrowRight');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      expect(
        (await new AxeBuilder({ page }).include('#dashboard-content').analyze()).violations
      ).toEqual([]);
      await page.screenshot({ path: `/tmp/barghsa-team-${locale}-${theme}.png` });
      memberDenied = true;
      await page.getByRole('button', { name: refreshMembers, exact: true }).click();
      await expect(page.getByRole('table')).toHaveCount(0);
      await expect(page.getByText('Transfer company', { exact: true })).toBeVisible();
      memberDenied = false;
      await page.getByRole('button', { name: refreshMembers, exact: true }).click();
      await expect(page.getByRole('table')).toBeVisible();
      accountDenied = true;
      await page.getByRole('button', { name: refreshProfiles, exact: true }).click();
      await expect(page.getByRole('table')).toHaveCount(0);
      await expect(page.getByText('Transfer company', { exact: true })).toHaveCount(0);
      expect(
        (await new AxeBuilder({ page }).include('#dashboard-content').analyze()).violations
      ).toEqual([]);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      accountDenied = false;
      await page.getByRole('button', { name: refreshProfiles, exact: true }).click();
      await expect(page.getByRole('table')).toBeVisible();
      memberDenied = true;
      memberStatus = 401;
      await page.getByRole('button', { name: refreshMembers, exact: true }).click();
      await expect(page.getByRole('table')).toHaveCount(0);
      await expect(page.getByText('Transfer company', { exact: true })).toHaveCount(0);
      memberDenied = false;
      await page.getByRole('button', { name: refreshProfiles, exact: true }).click();
      await expect(page.getByRole('table')).toBeVisible();
    });
  }
