import { dashboardText } from '@barghsa/i18n/dashboard';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';

for (const locale of ['fa', 'en'])
  for (const darkMode of [false, true])
    test(
      'pending verification widget respects settings and permissions (' +
        locale +
        ', dark=' +
        darkMode +
        ')',
      async ({ page }, testInfo) => {
        await page.addInitScript((locale) => {
          localStorage.setItem('barghsa.locale', locale);
          const apply = () => {
            document.documentElement.lang = locale;
            document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
          };
          if (document.documentElement) apply();
          new MutationObserver(apply).observe(document, { childList: true });
        }, locale);
        await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
        await page.route('**/api/auth/user', (route) =>
          route.fulfill({ json: { userId: 'staff', isStaff: true, requiresTosAcceptance: false } })
        );
        await page.route('**/api/public/branding/config', (route) =>
          route.fulfill({
            json: {
              appTitle: 'CRM review',
              appTitleFa: 'بررسی پروفایل',
              supportEmail: 'support@example.test',
              supportPhone: '+982112345678',
              supportMobile: '+989121234567',
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
        await page.route('**/api/admin/wallet/chargebacks/unresolved-warning', (route) =>
          route.fulfill({
            json: { count: 0, unmatchedCount: 0, reversalFailedCount: 0, items: [] },
          })
        );
        const recentProfiles = Array.from({ length: 5 }, (_, index) => ({
          id: '11111111-1111-4111-8111-' + String(index).padStart(12, '0'),
          profileType: index === 0 ? 'LEGAL' : 'INDIVIDUAL',
          firstName: index === 0 ? null : 'Sara',
          lastName: index === 0 ? null : `Example ${index}`,
          legalName: index === 0 ? 'Solar Co' : null,
          createdAt: '2026-09-01T00:00:00Z',
        }));
        let status = 200;
        let body: unknown = { enabled: true, count: 12, profiles: recentProfiles };
        let requests = 0;
        let release: (() => void) | null = null;
        let hold = false;
        await page.route('**/api/crm/dashboard/pending-verification', async (route) => {
          requests++;
          if (hold)
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          await route.fulfill({ status, json: body });
        });
        await page.clock.install();
        await page.goto('/admin');
        const widget = page.getByRole('region', {
          name: locale === 'fa' ? 'پروفایل‌های منتظر تأیید' : 'Profiles awaiting verification',
        });
        const showAll = page.getByRole('link', {
          name:
            locale === 'fa'
              ? 'نمایش همه پروفایل‌های منتظر تأیید'
              : 'Show all profiles awaiting verification',
        });
        await expect(widget).toBeVisible();
        await expect(showAll).toHaveAttribute('href', '/admin/crm?verification=PENDING');
        await expect(widget).toContainText(locale === 'fa' ? '۱۲' : '12');
        await expect(widget.getByRole('listitem')).toHaveCount(5);
        await expect(widget.getByRole('link', { name: /Solar Co/ })).toHaveAttribute(
          'href',
          `/admin/crm/profiles/${recentProfiles[0]!.id}`
        );
        const scan = await new AxeBuilder({ page })
          .include('#admin-content')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        expect(scan.violations).toEqual([]);
        expect(scan.incomplete.filter((x) => x.id === 'color-contrast')).toEqual([]);
        await widget.screenshot({
          path:
            '/tmp/barghsa-crm-widget-' +
            locale +
            '-' +
            darkMode +
            '-' +
            testInfo.project.name +
            '.png',
        });
        await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
        status = 403;
        await page.clock.runFor(30000);
        await expect(widget).toHaveCount(0);
        await expect(showAll).toHaveCount(0);
        status = 200;
        body = { enabled: false, count: 0, profiles: [] };
        const prior = requests;
        await page.clock.runFor(30000);
        await expect.poll(() => requests).toBeGreaterThan(prior);
        await expect(widget).toHaveCount(0);
        body = { enabled: true, count: 0, profiles: [] };
        await page.clock.runFor(30000);
        await expect(widget).toContainText(locale === 'fa' ? '۰' : '0');
        await expect(showAll).toBeVisible();
        for (const invalid of [
          { count: 12, profiles: [] },
          { enabled: true, count: '12', profiles: [] },
          { enabled: true, count: -1, profiles: [] },
          { enabled: true, count: 1, profiles: [{}] },
        ]) {
          body = invalid;
          await page.clock.runFor(30000);
          await expect(widget).toContainText(dashboardText('widget.error', locale as 'fa' | 'en'));
          await expect(showAll).toHaveCount(0);
        }
        hold = true;
        await page.clock.runFor(30000);
        await expect.poll(() => release !== null).toBe(true);
        const heldRequests = requests;
        await page.clock.runFor(60000);
        expect(requests).toBe(heldRequests);
        status = 401;
        release!();
        await expect(widget).toHaveCount(0);
        hold = false;
        status = 200;
        body = { enabled: true, count: 12, profiles: recentProfiles };
        await page.clock.runFor(30000);
        await expect(showAll).toBeVisible();
        await showAll.focus();
        await showAll.press('Enter');
        await expect(page).toHaveURL(/\/admin\/crm\/?\?verification=PENDING$/);
      }
    );
