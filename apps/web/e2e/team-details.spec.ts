import { test, expect } from './coverage-fixture';
import { approveRiskConfirmation } from './confirmation-fixture';
import { crmShell } from './crm-shell-fixture';
import AxeBuilder from '@axe-core/playwright';
import { teamCatalogue, teamProfiles } from '../src/test/team-catalogue-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const theme of ['light', 'dark'] as const) {
    test(`team member details and activity (${locale}, ${theme})`, async ({ page }) => {
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
      const team = teamCatalogue();
      team.agents[0]!.name = fa ? 'عضو نمونه' : 'Example Member';
      team.agents[1]!.message = '<script>Plain invitation note</script>';
      await page.route('**/api/profiles/*/agents', (route) => route.fulfill({ json: team }));
      let fail = true;
      const cursors: string[] = [];
      await page.route('**/api/profiles/*/agents/*/activity*', (route) => {
        const cursor = new URL(route.request().url()).searchParams.get('cursor');
        cursors.push(cursor ?? 'first');
        return route.fulfill({
          status: cursor && fail ? 503 : 200,
          json:
            cursor && fail
              ? {}
              : {
                  profileId: team.profileId,
                  userId: 'member',
                  items: [
                    {
                      id: cursor ? 'activity-two' : 'activity-one',
                      kind: cursor ? 'rolesChanged' : 'orderCreated',
                      performed: !cursor,
                      createdAt: '2026-09-01T00:00:00Z',
                    },
                  ],
                  nextCursor: cursor ? null : 'next-page',
                },
        });
      });
      let commands = 0;
      await page.route('**/api/auth/step-up', (route) =>
        route.fulfill({ json: { verified: true } })
      );
      await page.route('**/api/profiles/*/agents/member/roles', (route) => {
        commands++;
        const body = route.request().postDataJSON() as { roles: string[] };
        expect(body.roles).toEqual(['Manager', 'Finance']);
        team.agents.push({ ...team.agents[0]!, id: 'finance-row', role: 'Finance' });
        return route.fulfill({ json: { roles: body.roles, sessionRevoked: false } });
      });
      await page.goto('/settings/team');
      const main = page.getByRole('main');
      const details = fa ? 'مشاهده جزئیات' : 'View details';
      const edit = fa ? 'ویرایش نقش‌ها' : 'Edit roles';
      const member = main
        .getByRole('listitem')
        .filter({ has: page.getByRole('heading', { name: fa ? 'عضو نمونه' : 'Example Member' }) });
      await member.getByRole('link', { name: details, exact: true }).click();
      await expect(page).toHaveURL(/settings\/team\/members\/member$/);
      await expect(
        main.getByRole('heading', { name: fa ? 'جزئیات عضو' : 'Member details' })
      ).toBeFocused();
      await expect(main).toContainText(fa ? 'سفارش ایجاد شد' : 'Order created');
      await expect(main).not.toContainText('member@example.test');
      await page.reload();
      await expect(main).toContainText(fa ? 'سفارش ایجاد شد' : 'Order created');
      await main
        .getByRole('button', { name: fa ? 'فعالیت‌های قدیمی‌تر' : 'Older activity', exact: true })
        .click();
      await expect(main.getByRole('alert')).toBeVisible();
      await expect(main).toContainText(fa ? 'سفارش ایجاد شد' : 'Order created');
      fail = false;
      await main
        .getByRole('button', {
          name: fa ? 'تلاش مجدد برای فعالیت‌ها' : 'Retry activity',
          exact: true,
        })
        .click();
      await expect(main).toContainText(fa ? 'نقش‌های عضو تغییر کرد' : 'Member roles changed');
      expect(cursors.slice(-2)).toEqual(['next-page', 'next-page']);
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
        )
      ).toBe(true);
      await page.screenshot({
        path: `/tmp/barghsa-team-details-${locale}-${theme}.png`,
        fullPage: true,
      });

      await main.getByRole('link', { name: edit, exact: true }).click();
      await expect(page).toHaveURL(/settings\/team\/members\/member\/edit$/);
      const finance = main.getByRole('checkbox', { name: fa ? 'مالی' : 'Finance', exact: true });
      await finance.focus();
      await page.keyboard.press('Space');
      await expect(finance).toBeChecked();
      const save = main.getByRole('button', {
        name: fa ? 'ذخیره نقش‌ها' : 'Save roles',
        exact: true,
      });
      await save.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('m***@example.test');
      expect(commands).toBe(0);
      await dialog.getByRole('button', { name: fa ? 'انصراف' : 'Cancel', exact: true }).click();
      await expect(finance).toBeChecked();
      await save.click();
      const confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
      await expect(confirm).toBeDisabled();
      expect(commands).toBe(0);
      await approveRiskConfirmation(page, locale, 'destructive');
      await expect(confirm).toBeEnabled();
      await confirm.click();
      await expect(
        main.getByRole('heading', { name: fa ? 'جزئیات عضو' : 'Member details', exact: true })
      ).toBeVisible();
      expect(commands).toBe(1);
      const invitations = fa ? 'دعوت‌نامه‌ها' : 'Invitations';
      await main.getByRole('link', { name: invitations, exact: true }).click();
      await main
        .getByRole('listitem')
        .filter({ hasText: 'i***@example.test' })
        .getByRole('link', { name: details, exact: true })
        .click();
      await expect(main).toContainText('<script>Plain invitation note</script>');
      expect(await main.locator('script').count()).toBe(0);
      await main
        .getByRole('button', {
          name: fa ? 'پس گرفتن دعوت‌نامه' : 'Withdraw invitation',
          exact: true,
        })
        .click();
      await expect(dialog).toContainText('i***@example.test');
      await expect(dialog).toHaveCount(1);
      expect(
        (await new AxeBuilder({ page }).include('[role=dialog]').analyze()).violations
      ).toEqual([]);
    });
  }
