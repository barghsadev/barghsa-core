import { test, expect } from './coverage-fixture';
import { mockOppositeNumerals } from './number-preference-fixture';

for (const locale of ['en', 'fa'])
  test(`notification badge and accessible count follow numeral preference (${locale})`, async ({
    page,
  }) => {
    await page.clock.install();
    await page.addInitScript((language) => {
      if (document.documentElement) document.documentElement.lang = language;
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = language;
      }).observe(document, { childList: true });
    }, locale);
    let count = 12;
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await mockOppositeNumerals(page, locale);
    await page.route('**/api/v1/notifications?*', (route) =>
      route.fulfill({ json: { data: [], unread_count: count, next_cursor: null } })
    );
    await page.route('**/api/v1/notifications/unread-count', (route) =>
      route.fulfill({ json: { unread_count: count } })
    );
    await page.goto('/dashboard');
    const bell = page.getByRole('button', {
      name: locale === 'fa' ? /مشاهده اعلان‌ها/ : /View notifications/,
    });
    await expect(bell).toContainText(locale === 'fa' ? '12' : '۱۲');
    await expect(bell).toHaveAccessibleName(
      locale === 'fa' ? 'مشاهده اعلان‌ها (تعداد خوانده‌نشده: 12)' : 'View notifications (۱۲ unread)'
    );
    // Exercise the hidden-document event path; headless tabs do not reliably background.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page).toHaveTitle(
      locale === 'fa' ? '(12) Preference test' : '(۱۲) Preference test'
    );
    await page.evaluate(() => {
      document.title = '(2026) New brand';
    });
    await expect(page).toHaveTitle(
      locale === 'fa' ? '(12) (2026) New brand' : '(۱۲) (2026) New brand'
    );
    count = 101;
    await page.clock.runFor(30001);
    await expect(bell).toContainText(locale === 'fa' ? '99+' : '۹۹+');
    await expect(bell).toHaveAccessibleName(
      locale === 'fa'
        ? 'مشاهده اعلان‌ها (تعداد خوانده‌نشده: 101)'
        : 'View notifications (۱۰۱ unread)'
    );
    await expect(page).toHaveTitle(
      locale === 'fa' ? '(101) (2026) New brand' : '(۱۰۱) (2026) New brand'
    );
  });
