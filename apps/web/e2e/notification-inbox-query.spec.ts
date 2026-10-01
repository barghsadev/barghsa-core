import { test, expect, type Page } from './coverage-fixture';
import type { Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { crmShell } from './crm-shell-fixture';
import { t } from '@barghsa/i18n/app';
import {
  notificationItem as item,
  notificationCursor,
  notificationPage,
} from '../src/test/notification-inbox-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
const params = (page: Page) => new URL(page.url()).searchParams;
for (const context of ['customer', 'staff'] as const)
  for (const locale of ['en', 'fa'] as const)
    test(`inbox URLs restore exact pages and reject obsolete reads (${context}, ${locale})`, async ({
      page,
    }, info) => {
      await crmShell(page, locale);
      await page.route('**/api/auth/user', (r) =>
        r.fulfill({
          json: {
            userId: 'inbox-user',
            isStaff: context === 'staff',
            operatingContext: context,
            canSwitchContext: false,
            requiresTosAcceptance: false,
          },
        })
      );
      await page.route('**/api/public/branding/config', (r) =>
        r.fulfill({
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
            darkMode: locale === 'fa',
          },
        })
      );
      await page.route('**/api/v1/notifications/unread-count', (r) =>
        r.fulfill({ json: { unread_count: 2 } })
      );
      const cursor = notificationCursor();
      let fail = true;
      let write: Route | undefined;
      const reads: string[] = [];
      await page.route('**/api/v1/notifications?*', (r) => {
        const q = new URL(r.request().url()).searchParams;
        if (q.get('limit') === '10') return r.fulfill({ json: notificationPage('Bell notice') });
        reads.push(q.toString());
        if (fail && q.has('cursor')) return r.fulfill({ status: 503, json: {} });
        const title =
          q.get('filter') === 'unread'
            ? 'Unread notice'
            : q.has('cursor')
              ? 'Older notice'
              : 'Current notice';
        return r.fulfill({
          json: {
            data: [
              {
                ...item(
                  title,
                  q.has('cursor') ? '10000000-0000-4000-8000-000000000002' : item().id
                ),
                linkRoute: context === 'customer' ? '/wallet' : '/admin/invoices',
              },
            ],
            next_cursor: q.has('cursor') ? null : cursor,
            unread_count: 2,
          },
        });
      });
      await page.route('**/api/v1/notifications/*/read', (r) => {
        write = r;
      });
      const path = context === 'staff' ? '/admin/inbox' : '/notifications';
      await page.goto(path);
      const main = page.getByRole('main'),
        copy = (key: string) => t(`notifications.${key}`, locale);
      const current = main.getByRole('button', { name: /Current notice/ });
      const older = main.getByRole('button', { name: /Older notice/ });
      await expect(current).toBeVisible();
      await main.getByRole('button', { name: copy('loadMore'), exact: true }).click();
      await expect(main.getByRole('alert')).toBeVisible();
      expect(params(page).get('cursor')).toBe(cursor);
      await expect(current).toBeVisible();
      await expect(current).toBeDisabled();
      const failed = reads.at(-1);
      fail = false;
      await main.getByRole('button', { name: copy('retry'), exact: true }).click();
      await expect(older).toBeVisible();
      expect(reads.at(-1)).toBe(failed);
      await expect(current).toBeVisible();
      await page.goBack();
      await expect.poll(() => params(page).get('cursor')).toBeNull();
      await expect(current).toBeVisible();
      await expect(older).toHaveCount(0);
      await page.goForward();
      await expect.poll(() => params(page).get('cursor')).toBe(cursor);
      await expect(older).toBeVisible();
      await expect(current).toHaveCount(0);
      await page.reload();
      await expect(older).toBeVisible();
      expect(new URLSearchParams(reads.at(-1)).get('cursor')).toBe(cursor);
      await main.getByRole('tab', { name: copy('unread'), exact: true }).click();
      await expect.poll(() => params(page).get('filter')).toBe('unread');
      expect(params(page).get('cursor')).toBeNull();
      const unread = main.getByRole('button', { name: /Unread notice/ });
      await expect(unread).toBeVisible();
      await page.reload();
      await expect(unread).toBeVisible();
      // History can move while the write is pending; its receipt must not navigate.
      await unread.click();
      await expect.poll(() => !!write).toBe(true);
      await page.goBack();
      await expect(older).toBeVisible();
      const completed = page.waitForResponse((r) => r.url().endsWith('/read'));
      await write!.fulfill({ json: { unread_count: 0 } });
      await (await completed).finished();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      );
      expect(new URL(page.url()).pathname).toBe(path);
      expect(params(page).get('cursor')).toBe(cursor);
      await expect(older).toBeEnabled();
      write = undefined;
      await older.click();
      await expect.poll(() => !!write).toBe(true);
      await page.goBack();
      await expect(current).toBeVisible();
      const secondReceipt = page.waitForResponse((r) => r.url().endsWith('/read'));
      await write!.fulfill({ json: { unread_count: 0 } });
      await (await secondReceipt).finished();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      );
      expect(new URL(page.url()).pathname).toBe(path);
      expect(params(page).get('cursor')).toBeNull();
      await expect(current).toBeEnabled();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
        .toBe(locale === 'fa');
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && info.project.name === 'mobile-safari')
        await page.screenshot({
          path: `/tmp/barghsa-inbox-query-${context}-fa.png`,
          fullPage: true,
        });
      await page.goto(`${path}?filter=other&cursor=private&reason=SECRET`);
      await expect(current).toBeVisible();
      expect(new URLSearchParams(reads.at(-1)).get('cursor')).toBeNull();
      expect(new URLSearchParams(reads.at(-1)).get('filter')).toBe('all');
    });
