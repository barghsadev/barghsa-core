import { test, expect, type Route } from './coverage-fixture';
import { crmShell, mockActiveCustomerProfile } from './crm-shell-fixture';
import { t } from '@barghsa/i18n/app';
import AxeBuilder from '@axe-core/playwright';
import {
  notificationItem as item,
  notificationPage as data,
  notificationCursor,
} from '../src/test/notification-inbox-fixtures';
import { notificationFeedback } from '@barghsa/i18n/notification-feedback';

for (const locale of ['en', 'fa'] as const) {
  test(`notification date groups recover a saved time zone without losing rows (${locale})`, async ({
    page,
  }, info) => {
    await crmShell(page, locale);
    await page.clock.setFixedTime(new Date('2026-11-05T12:00:00Z'));
    let zoneFailed = true;
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({
        status: zoneFailed ? 503 : 200,
        json: { timezone: 'Asia/Tehran' },
      })
    );
    const rows = [
      '2026-11-05T06:00:00Z',
      '2026-11-04T06:00:00Z',
      '2026-11-03T06:00:00Z',
      '2026-10-28T06:00:00Z',
    ].map((date, index) => ({
      ...item(`Date notice ${index}`, `10000000-0000-4000-8000-00000000000${index + 1}`),
      createdAt: date,
    }));
    await page.route('**/api/v1/notifications?*', (route) =>
      route.fulfill({ json: { data: rows, next_cursor: null, unread_count: 4 } })
    );
    await page.route('**/api/v1/notifications/unread-count', (route) =>
      route.fulfill({ json: { unread_count: 4 } })
    );
    await page.goto('/admin/inbox');
    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: /Date notice/ })).toHaveCount(4);
    await expect(main).toContainText(notificationFeedback('datesUnavailable', locale));
    zoneFailed = false;
    await main
      .getByRole('button', { name: notificationFeedback('retry', locale), exact: true })
      .click();
    for (const [index, key] of (['today', 'yesterday', 'week', 'older'] as const).entries()) {
      const group = main.getByRole('region', {
        name: notificationFeedback(key, locale),
        exact: true,
      });
      await expect(
        group.getByRole('heading', { name: notificationFeedback(key, locale), exact: true })
      ).toBeVisible();
      await expect(
        group.getByRole('button', { name: new RegExp(`Date notice ${index}`) })
      ).toBeVisible();
    }
    await expect(main.getByRole('button', { name: /Date notice/ })).toHaveCount(4);
    expect(
      (
        await new AxeBuilder({ page })
          .include('main')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath('notification-date-groups.png'),
      fullPage: true,
    });
  });
}
test.use({ viewport: { width: 390, height: 844 } });
for (const context of ['customer', 'staff'] as const)
  for (const locale of ['en', 'fa'] as const)
    for (const theme of ['light', 'dark'] as const)
      test(`inbox and bell recover with retained pages (${context}, ${locale}, ${theme})`, async ({
        page,
      }) => {
        await crmShell(page, locale);
        if (context === 'customer') await mockActiveCustomerProfile(page);
        await page.route('**/api/auth/user', (route) =>
          route.fulfill({
            json: {
              userId: 'inbox-user',
              isStaff: context === 'staff',
              operatingContext: context,
              canSwitchContext: false,
              requiresTosAcceptance: false,
            },
          })
        );
        await page.route('**/api/public/branding/config', (route) =>
          route.fulfill({
            json: {
              appTitle: 'Inbox',
              appTitleFa: 'اعلان‌ها',
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
        let failed = false,
          denied = false,
          writeFailed = true,
          holdBell = false,
          heldBell: Route | undefined,
          bellReads = 0;
        const cursors: Array<string | null> = [];
        await page.route('**/api/v1/notifications/unread-count', (route) =>
          route.fulfill({ json: { unread_count: 2 } })
        );
        await page.route('**/api/v1/notifications?*', (route) => {
          const q = new URL(route.request().url()).searchParams;
          if (q.get('limit') === '10') {
            bellReads++;
            if (holdBell) {
              holdBell = false;
              heldBell = route;
              return;
            }
            return route.fulfill({
              status: denied ? 403 : failed ? 503 : 200,
              json: data('Bell notice'),
            });
          }
          cursors.push(q.get('cursor'));
          return route.fulfill({
            status: denied ? 403 : failed ? 503 : 200,
            json: {
              data: [
                item(
                  q.has('cursor') ? 'Older notice' : 'Current notice',
                  q.has('cursor') ? '10000000-0000-4000-8000-000000000002' : item().id
                ),
              ],
              next_cursor: q.has('cursor') ? null : notificationCursor(),
              unread_count: 2,
            },
          });
        });
        await page.route('**/api/v1/notifications/*/read', (route) =>
          route.fulfill({ status: writeFailed ? 503 : 200, json: { unread_count: 1 } })
        );
        await page.goto(context === 'staff' ? '/admin/inbox' : '/notifications');
        await expect(page.locator('html')).toHaveClass(
          theme === 'dark' ? /dark/ : /^(?!.*dark).*$/
        );
        const main = page.getByRole('main'),
          text = (key: string) => t(`notifications.${key}`, locale);
        const current = main.getByRole('button', { name: /Current notice/ });
        await expect(current).toBeVisible();
        failed = true;
        await main.getByRole('button', { name: text('loadMore'), exact: true }).click();
        const pageError = main.getByRole('alert').filter({ hasText: text('error.load') });
        const retryPage = pageError.getByRole('button', { name: text('retry'), exact: true });
        await expect(retryPage).toBeVisible();
        await expect(current).toBeVisible();
        await expect(current).toBeDisabled();
        failed = false;
        await retryPage.click();
        await expect(main.getByRole('button', { name: /Older notice/ })).toBeVisible();
        expect(cursors.slice(0, 3)).toEqual([null, notificationCursor(), notificationCursor()]);
        // Refresh remains independent of a retry for the failed older page.
        failed = true;
        await main.getByRole('button', { name: text('refresh'), exact: true }).click();
        await expect(main.getByRole('button', { name: /Older notice/ })).toBeVisible();
        await expect(main.getByRole('alert')).toBeVisible();
        failed = false;
        await main
          .getByRole('alert')
          .getByRole('button', { name: text('retry'), exact: true })
          .click();
        await current.click();
        await expect(main.getByRole('alert')).toContainText(text('error.write'));
        await expect(page.locator('[data-sonner-toast][data-type="warning"]')).toBeVisible();
        const header = await page.locator('header').first().boundingBox();
        const warning = await page
          .locator('[data-sonner-toast][data-type="warning"]')
          .boundingBox();
        expect(header).not.toBeNull();
        expect(warning).not.toBeNull();
        expect(warning!.y).toBeGreaterThanOrEqual(header!.y + header!.height + 8);
        await expect(current).toBeVisible();
        writeFailed = false;
        await main
          .getByRole('alert')
          .getByRole('button', { name: text('retry'), exact: true })
          .click();
        await current.click();
        await expect(current).toBeEnabled();
        const bell = page.getByTestId('notification-bell');
        const unread = page.locator('[data-testid=notification-bell] + [role=status]');
        await expect(unread).toHaveRole('status');
        await expect(unread).toHaveAttribute('aria-atomic', 'true');
        await expect(unread).toHaveText((await bell.getAttribute('aria-label'))!);
        const previousCount = await unread.textContent();
        const liveRegion = await unread.elementHandle();
        await bell.click();
        const panel = page.getByTestId('notification-panel');
        await expect(panel.getByRole('button', { name: /Bell notice/ })).toBeVisible();
        await page.keyboard.press('Escape');
        failed = true;
        await bell.click();
        await expect(panel.getByRole('alert')).toBeVisible();
        await expect(panel.getByRole('button', { name: /Bell notice/ })).toBeVisible();
        await expect(panel.getByRole('button', { name: /Bell notice/ })).toBeDisabled();
        failed = false;
        await panel.getByRole('button', { name: text('retry'), exact: true }).click();
        await expect(panel.getByRole('button', { name: /Bell notice/ })).toBeEnabled();
        if (theme === 'light') {
          await page.keyboard.press('Escape');
          await page.clock.install();
          holdBell = true;
          const previousReads = bellReads;
          const retainedNotice = panel.getByRole('button', { name: /Bell notice/ });
          try {
            await bell.click();
            await expect.poll(() => Boolean(heldBell)).toBe(true);
            await expect(retainedNotice).toBeDisabled();
            await page.clock.fastForward(15_200);
            const error = panel.getByRole('alert');
            await expect(error).toContainText(text('error.load'));
            await expect(retainedNotice).toBeVisible();
            await expect(retainedNotice).toBeDisabled();
            await heldBell!.fulfill({ json: data('Late preview') }).catch(() => {});
            await expect(panel.getByRole('button', { name: /Late preview/ })).toHaveCount(0);
            expect(bellReads).toBe(previousReads + 1);
            await panel.getByRole('button', { name: text('retry'), exact: true }).click();
            await expect(error).toHaveCount(0);
            await expect(retainedNotice).toBeEnabled();
            expect(bellReads).toBe(previousReads + 2);
          } finally {
            await heldBell?.abort().catch(() => {});
          }
        }
        expect(
          (await new AxeBuilder({ page }).include('[data-testid=notification-panel]').analyze())
            .violations
        ).toEqual([]);
        const notice = panel.getByRole('button', { name: /Bell notice/ });
        const viewAll = panel.getByRole('link', { name: text('viewAll'), exact: true });
        await expect(viewAll).toHaveAttribute(
          'href',
          context === 'staff' ? '/admin/inbox' : '/notifications'
        );
        await notice.focus();
        await page.keyboard.press('Tab');
        await expect(viewAll).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(notice).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(bell).toBeFocused();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        );
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        await page.screenshot({
          path: `/tmp/barghsa-inbox-${context}-${locale}-${theme}.png`,
          fullPage: true,
        });
        denied = true;
        await main.getByRole('button', { name: text('refresh'), exact: true }).click();
        await expect(current).toHaveCount(0);
        await expect(bell.locator('.barghsa-notification-count')).toHaveCount(0);
        await expect(unread).not.toHaveText(previousCount!);
        await expect(unread).toHaveText((await bell.getAttribute('aria-label'))!);
        expect(await liveRegion!.evaluate((node) => node.isConnected)).toBe(true);
        await bell.click();
        await expect(panel.getByRole('button', { name: /Bell notice/ })).toHaveCount(0);
        await expect(panel.getByRole('alert')).toContainText(text('error.denied'));
        denied = false;
        await panel.getByRole('button', { name: text('retry'), exact: true }).click();
        await expect(panel.getByRole('button', { name: /Bell notice/ })).toBeVisible();
        await page.keyboard.press('Escape');
        await main
          .getByRole('alert')
          .getByRole('button', { name: text('retry'), exact: true })
          .click();
        await expect(current).toBeVisible();
      });
