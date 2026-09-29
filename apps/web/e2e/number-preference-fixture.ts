import type { Page } from '@playwright/test';

/** Publish digits opposite to the page language without altering the language. */
export async function mockOppositeNumerals(page: Page, locale: string) {
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
      json: {
        appTitle: 'Preference test',
        appTitleFa: 'آزمایش ترجیح نمایش',
        supportEmail: 'support@example.test',
        supportPhone: '+98 21 12345678',
        supportMobile: '+98 912 1234567',
        slogan: '',
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        logoUrl: null,
        faviconUrl: null,
        darkMode: false,
        numberStyle: locale === 'fa' ? 'western' : 'persian',
      },
    })
  );
}
