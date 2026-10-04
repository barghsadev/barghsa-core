import type { Page } from '@playwright/test';
import { fullNavigation } from './navigation-fixture';
export async function setupCatalogueForms(
  page: Page,
  locale: 'fa' | 'en',
  darkMode: boolean,
  backgrounds: { backgroundColor?: string; darkBackgroundColor?: string } = {}
) {
  await page.addInitScript((locale) => localStorage.setItem('barghsa.locale', locale), locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        isStaff: true,
        operatingContext: 'staff',
        canSwitchContext: true,
        requiresTosAcceptance: false,
        navigation: fullNavigation('staff'),
      },
    })
  );
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
      json: {
        appTitle: 'Catalogue',
        appTitleFa: 'محصولات',
        supportEmail: 'support@example.test',
        supportPhone: '+982112345678',
        supportMobile: '+989121234567',
        backgroundColor: backgrounds.backgroundColor ?? '#f6f7f4',
        darkBackgroundColor: backgrounds.darkBackgroundColor ?? '#15201c',
        fontFamily: 'vazirmatn',
        borderRadiusRem: 0.75,
        spacingScale: 1,
        slogan: '',
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        logoUrl: null,
        faviconUrl: null,
        darkMode,
        numberStyle: locale === 'fa' ? 'persian' : 'western',
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
}
