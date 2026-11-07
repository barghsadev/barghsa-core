import { test, expect } from './coverage-fixture';
import { fullNavigation } from './navigation-fixture';
import { checkRoutePresentation } from './route-presentation';

const pages = [
  ['/charts', 'Charts and analytics', 'نمودارها و تحلیل‌ها', 'نمودارهای داده‌های بازار برق.'],
  ['/videos', 'Video uploads', 'بارگذاری ویدیو', 'ویدیوهای بازدید و مدیریت رسانه‌ها.'],
] as const;

for (const locale of ['en', 'fa'] as const) {
  test(`workspace media pages use the current language and landmarks (${locale})`, async ({
    page,
  }, info) => {
    await page.addInitScript(
      (language) => localStorage.setItem('barghsa.locale', language),
      locale
    );
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'media-layout-reader',
          isStaff: false,
          operatingContext: 'customer',
          requiresTosAcceptance: false,
          navigation: fullNavigation('customer'),
        },
      })
    );
    for (const [path, en, fa, description] of pages) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(
        locale === 'fa' ? fa : en
      );
      if (locale === 'fa') {
        await expect(page.getByRole('main')).toContainText(description);
        await expect(page.getByRole('main')).not.toContainText(en);
      }
      await checkRoutePresentation(page, info, locale);
    }
  });
}
