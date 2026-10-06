import { test, expect } from './coverage-fixture';
import { fullNavigation } from './navigation-fixture';
import { settingsProfileFixture, settingsProfileId } from './settings-profile-fixture';

for (const locale of ['en', 'fa'] as const) {
  test(`settings default picker uses current company name and legacy personal fallback (${locale})`, async ({
    page,
  }) => {
    const name = locale === 'fa' ? 'شرکت برق نمونه' : 'Current Electricity Company';
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'settings-viewer',
          isStaff: false,
          operatingContext: 'customer',
          requiresTosAcceptance: false,
          navigation: fullNavigation('customer', 'LEGAL'),
        },
      })
    );
    const profile = settingsProfileFixture({
      id: settingsProfileId,
      profileType: 'LEGAL',
      status: 'ACTIVE',
      displayName: name,
      title: 'Old Company Name',
      legalInfo: {
        legalName: name,
        nationalIdentifier: '12345678901',
        registrationNumber: '123',
      },
    });
    const individual = settingsProfileFixture({
      id: '01900000-0000-7000-8000-000000000002',
      profileType: 'INDIVIDUAL',
      status: 'ACTIVE',
      firstName: 'Mina',
      lastName: 'Example',
      isDefault: false,
    });
    await page.route('**/api/profiles', (route) =>
      route.fulfill({
        json: {
          profiles: [profile, individual],
          activeProfileId: settingsProfileId,
          hasDefault: true,
        },
      })
    );
    await page.route(`**/api/profiles/${settingsProfileId}`, (route) =>
      route.fulfill({ json: profile })
    );
    await page.route(`**/api/onboarding/documents/${settingsProfileId}`, (route) =>
      route.fulfill({ json: { documents: [] } })
    );
    await page.goto('/settings/profile');
    const picker = page.locator('#settings-profile-switcher');
    await expect(picker).toBeEnabled();
    await expect(picker.locator(`option[value="${settingsProfileId}"]`)).toHaveText(name);
    await expect(picker.locator('option[value="01900000-0000-7000-8000-000000000002"]')).toHaveText(
      'Mina Example'
    );
    await expect(picker).not.toContainText('Old Company Name');
  });
}
