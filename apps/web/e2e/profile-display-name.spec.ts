import { test, expect } from './coverage-fixture';
import { fullNavigation } from './navigation-fixture';
import { t } from '@barghsa/i18n/app';

for (const locale of ['en', 'fa'] as const) {
  for (const requiresSelection of [true, false]) {
    test(`legal profile name appears in ${requiresSelection ? 'default selection' : 'sidebar'} (${locale})`, async ({
      page,
    }) => {
      const legalId = '01900000-0000-7000-8000-000000000001';
      const individualId = '01900000-0000-7000-8000-000000000002';
      const legalName = locale === 'fa' ? 'شرکت برق نمونه' : 'Example Electricity Company';
      let activeProfileId: string | null = requiresSelection ? null : legalId;
      await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/auth/user', (route) =>
        route.fulfill({
          json: {
            userId: 'profile-name-viewer',
            isStaff: false,
            operatingContext: 'customer',
            navigation: fullNavigation('customer', 'LEGAL'),
            requiresTosAcceptance: false,
          },
        })
      );
      await page.route('**/api/profiles', (route) =>
        route.fulfill({
          json: {
            profiles: [
              {
                id: legalId,
                profileType: 'LEGAL',
                status: 'ACTIVE',
                isDefault: false,
                displayName: legalName,
                title: null,
                firstName: null,
                lastName: null,
                nationalId: null,
              },
              {
                id: individualId,
                profileType: 'INDIVIDUAL',
                status: 'ACTIVE',
                isDefault: false,
                title: null,
                firstName: 'Mina',
                lastName: 'Example',
                nationalId: null,
              },
            ],
            activeProfileId,
            hasDefault: activeProfileId !== null,
          },
        })
      );
      await page.route(`**/api/profiles/switch/${legalId}`, (route) => {
        activeProfileId = legalId;
        return route.fulfill({ json: { activeProfileId } });
      });
      await page.goto('/dashboard');
      if (requiresSelection) {
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByText(`${legalName} (${t('dashboard.profile.typeLegal', locale)})`, {
            exact: true,
          })
        ).toBeVisible();
        await expect(
          dialog.getByText(`Mina Example (${t('dashboard.profile.typeIndividual', locale)})`, {
            exact: true,
          })
        ).toBeVisible();
        await dialog.getByRole('button').click();
        await expect(dialog).toHaveCount(0);
      }
      const menu = page.locator('button[aria-controls="dashboard-navigation"]');
      await expect(menu).toBeAttached();
      if ((await menu.isVisible()) && (await menu.getAttribute('aria-expanded')) === 'false')
        await menu.click();
      const switchLabel = t('dashboard.profile.switchLabel', locale);
      const switcher = page.getByRole('button', { name: switchLabel, exact: true });
      await expect(switcher).toBeVisible();
      await expect(switcher).toContainText(legalName);
      await switcher.click();
      const choices = page.getByRole('radiogroup', { name: switchLabel, exact: true });
      await expect(
        choices.getByRole('radio', {
          name: new RegExp(`${legalName}.*${t('dashboard.profile.typeLegal', locale)}`),
        })
      ).toBeChecked();
      await expect(
        choices.getByRole('radio', {
          name: new RegExp(`Mina Example.*${t('dashboard.profile.typeIndividual', locale)}`),
        })
      ).not.toBeChecked();
    });
  }
}
