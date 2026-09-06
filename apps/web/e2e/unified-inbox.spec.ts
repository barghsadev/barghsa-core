import { test, expect } from '@playwright/test';
for (const locale of ['fa', 'en'] as const) {
  test(`canonical inbox renders preserved text and safe profile navigation (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/profiles', (route) =>
      route.fulfill({
        json: {
          profiles: [{ id: 'profile', profileType: 'LEGAL', status: 'ACTIVE', isDefault: true }],
          activeProfileId: 'profile',
          hasDefault: true,
        },
      })
    );
    await page.route('**/api/invitations/pending', (route) =>
      route.fulfill({ json: { invitations: [] } })
    );
    let marked = false;
    const title = locale === 'fa' ? 'پروفایل تأیید شد' : 'Profile verified';
    const item = {
      id: 'legacy-notice',
      type: 'profile_verified',
      titleI18nKey: 'notifications.legacy.title',
      bodyI18nKey: 'notifications.legacy.body',
      localizedContent: {
        original: { title, body: 'Preserved <img src=x onerror=alert(1)> text' },
      },
      params: {},
      linkRoute: '/app/settings/profile',
      linkParams: null,
      isRead: false,
      readAt: null,
      createdAt: new Date().toISOString(),
    };
    await page.route('**/api/v1/notifications**', (route) => {
      if (route.request().method() === 'PATCH') {
        marked = true;
        return route.fulfill({ json: { unread_count: 0 } });
      }
      return route.fulfill({
        json: { data: [item], next_cursor: null, unread_count: marked ? 0 : 1 },
      });
    });
    await page.goto('/notifications');
    await expect(page.locator('main')).toContainText(title);
    await expect(page.locator('main')).toContainText('Preserved <img src=x onerror=alert(1)> text');
    await expect(page.locator('main img')).toHaveCount(0);
    const notice = page.getByRole('button', { name: new RegExp(title) });
    await expect(notice).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
    await notice.click();
    await expect(page).toHaveURL(/\/settings\/profile$/);
    expect(marked).toBe(true);
  });
}
