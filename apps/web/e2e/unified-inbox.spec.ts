import { test, expect } from './coverage-fixture';
import { fullNavigation } from './navigation-fixture';
import { settingsProfileFixture, settingsProfileId } from './settings-profile-fixture';
for (const locale of ['fa', 'en'] as const) {
  test(`canonical inbox renders preserved text and safe profile navigation (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'inbox-customer',
          isStaff: false,
          operatingContext: 'customer',
          canSwitchContext: false,
          requiresTosAcceptance: false,
          navigation: fullNavigation('customer'),
        },
      })
    );
    await page.route('**/api/profiles', (route) =>
      route.fulfill({
        json: {
          profiles: [
            settingsProfileFixture({
              id: settingsProfileId,
              profileType: 'LEGAL',
              status: 'ACTIVE',
            }),
          ],
          activeProfileId: settingsProfileId,
          hasDefault: true,
        },
      })
    );
    await page.route('**/api/invitations/pending', (route) =>
      route.fulfill({ json: { invitations: [] } })
    );
    let marks = 0;
    const title = locale === 'fa' ? 'پروفایل تأیید شد' : 'Profile verified';
    const item = {
      id: '68777777-7777-4777-8777-777777777777',
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
      createdAt: '2026-09-12T10:00:00Z',
    };
    await page.route('**/api/v1/notifications/unread-count', (route) =>
      route.fulfill({ json: { unread_count: marks ? 0 : 1 } })
    );
    await page.route('**/api/v1/notifications?*', (route) => {
      expect(route.request().method()).toBe('GET');
      return route.fulfill({
        json: {
          data: [{ ...item, isRead: marks > 0, readAt: marks ? item.createdAt : null }],
          next_cursor: null,
          unread_count: marks ? 0 : 1,
        },
      });
    });
    await page.route(`**/api/v1/notifications/${item.id}/read`, (route) => {
      expect(route.request().method()).toBe('PATCH');
      marks++;
      return route.fulfill({ json: { unread_count: 0 } });
    });
    await page.goto('/notifications');
    await expect(page.locator('main')).toContainText(title);
    await expect(page.locator('main')).toContainText('Preserved <img src=x onerror=alert(1)> text');
    await expect(page.locator('main img')).toHaveCount(0);
    const notice = page.getByRole('button', { name: new RegExp(title) });
    await expect(notice).toHaveCSS('direction', locale === 'fa' ? 'rtl' : 'ltr');
    await notice.click();
    await expect(page).toHaveURL(/\/settings\/profile$/);
    expect(marks).toBe(1);
  });
}
