import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import AxeBuilder from '@axe-core/playwright';
import { teamCatalogue, teamProfiles } from '../src/test/team-catalogue-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const theme of ['light', 'dark'] as const) {
    test(`team directory and personal invitation (${locale}, ${theme})`, async ({ page }) => {
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
      let recipient = false;
      const note = 'Please review our accounts.\n<script>plain text</script>';
      await page.route('**/api/invitations/pending', (route) =>
        route.fulfill({
          json: {
            invitations: recipient
              ? [
                  {
                    id: 'recipient-note',
                    profileId: teamProfiles().activeProfileId,
                    profileName: 'Example company',
                    role: 'Finance',
                    invitedBy: 'owner',
                    inviterName: 'Example Owner',
                    createdAt: '2026-09-01T01:00:00Z',
                    expiresAt: '2099-09-08T01:00:00Z',
                    message: note,
                  },
                ]
              : [],
          },
        })
      );
      const team = teamCatalogue();
      team.agents[0] = {
        ...team.agents[0]!,
        name: fa ? 'عضو نمونه' : 'Example Member',
        invitedAt: '2026-07-01T00:00:00Z',
        lastActiveAt: '2026-09-15T00:00:00Z',
      };
      team.agents.unshift({
        ...team.agents[0]!,
        id: 'owner-one',
        userId: 'owner',
        role: 'Owner',
        name: fa ? 'مالک نمونه' : 'Example Owner',
        username: '+989121234567',
        invitedAt: null,
        lastActiveAt: null,
      });
      await page.route('**/api/profiles/*/agents', (route) => route.fulfill({ json: team }));
      let attempts = 0;
      let sent: unknown;
      await page.route('**/api/profiles/*/invitations', (route) => {
        attempts++;
        sent = route.request().postDataJSON();
        return route.fulfill({
          status: attempts === 1 ? 409 : 201,
          json: attempts === 1 ? {} : { id: 'new-note' },
        });
      });
      await page.goto('/settings/team');
      const table = page.getByRole('table');
      await expect(table).toContainText(fa ? 'عضو نمونه' : 'Example Member');
      await expect(table).toContainText('m***@example.test');
      await expect(table).toContainText('i***@example.test');
      await expect(table).toContainText('+989 *** 4567');
      await expect(table).not.toContainText('member@example.test');
      await expect(table).not.toContainText('+989121234567');
      await expect(table.locator('[data-slot=avatar]')).toHaveCount(3);
      await expect(table.locator('time[datetime="2026-09-15T00:00:00Z"]')).toBeVisible();
      const owner = table.getByRole('row').filter({ hasText: fa ? 'مالک نمونه' : 'Example Owner' });
      await expect(
        owner.getByRole('button', {
          name: fa ? 'انتقال مالکیت' : 'Transfer ownership',
          exact: true,
        })
      ).toBeEnabled();
      await expect(
        owner.getByRole('button', { name: fa ? 'حذف عضو' : 'Remove member', exact: true })
      ).toBeDisabled();
      expect(
        (await new AxeBuilder({ page }).include('#dashboard-content').analyze()).violations
      ).toEqual([]);
      expect((await owner.boundingBox())!.height).toBeLessThan(240);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
        )
      ).toBe(true);
      await page.screenshot({
        path: `/tmp/barghsa-team-directory-${locale}-${theme}.png`,
        fullPage: true,
      });
      await page
        .getByRole('button', { name: fa ? 'دعوت عضو تیم' : 'Invite a team member', exact: true })
        .click();
      const dialog = page.getByRole('dialog');
      await dialog.locator('#team-username').fill('new@example.test');
      await dialog.locator('#invite-role').selectOption('Finance');
      await dialog.locator('#invite-role').focus();
      await page.keyboard.press('Tab');
      await expect(dialog.locator('#invite-message')).toBeFocused();
      await dialog.locator('#invite-message').fill(note);
      await expect(dialog.locator('#invite-message')).toHaveAttribute('maxlength', '1000');
      expect(
        (await new AxeBuilder({ page }).include('[role=dialog]').analyze()).violations
      ).toEqual([]);
      const send = dialog.getByRole('button', {
        name: fa ? 'ارسال دعوت‌نامه' : 'Send invitation',
        exact: true,
      });
      await send.click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(dialog.locator('#invite-message')).toHaveValue(note);
      await send.click();
      await expect(dialog).toHaveCount(0);
      expect(sent).toEqual({ username: 'new@example.test', role: 'Finance', message: note });
      await expect(
        page.getByRole('button', {
          name: fa ? 'دعوت عضو تیم' : 'Invite a team member',
          exact: true,
        })
      ).toBeFocused();
      recipient = true;
      await page.goto('/dashboard');
      await page.getByText(fa ? 'مشاهده جزئیات' : 'View details', { exact: true }).click();
      await expect(page.getByText(note, { exact: true })).toBeVisible();
      expect(await page.locator('script').filter({ hasText: 'plain text' }).count()).toBe(0);
    });
  }
