import { fullNavigation } from './navigation-fixture';
import type { Page } from './coverage-fixture';
export async function crmShell(page: Page, locale: string = 'en') {
  await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'reviewer',
        isStaff: true,
        navigation: fullNavigation('staff'),
        operatingContext: 'staff',
        canSwitchContext: false,
        requiresTosAcceptance: false,
      },
    })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({ json: { profiles: [], activeProfileId: null, hasDefault: false } })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
}

export async function mockActiveCustomerProfile(
  page: Page,
  profileId = '33333333-3333-4333-8333-333333333333'
) {
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        activeProfileId: profileId,
        hasDefault: true,
        profiles: [
          { id: profileId, profileType: 'INDIVIDUAL', title: 'Customer', status: 'ACTIVE' },
        ],
      },
    })
  );
  await page.route('**/api/profiles/verification-status', (route) =>
    route.fulfill({ json: { activeProfileId: profileId } })
  );
}
