import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';

const pages = [
  '/dashboard',
  '/wallet',
  '/invoices',
  '/notifications',
  '/admin/notifications',
  '/admin/providers',
  '/admin/tos',
  '/admin/wallet-receipts',
];
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true])
    for (const mobile of [false, true]) {
      test(`page error states remain readable (${locale}, dark=${dark}, mobile=${mobile})`, async ({
        page,
      }) => {
        await page.setViewportSize(
          mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }
        );
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.addInitScript((value) => {
          const apply = () => {
            if (document.documentElement) document.documentElement.lang = value;
          };
          apply();
          new MutationObserver(apply).observe(document, { childList: true });
        }, locale);
        await page.route('**/api/**', (route) => route.fulfill({ status: 503, json: {} }));
        await page.route('**/api/auth/user', (route) =>
          route.fulfill({ json: { userId: 'theme-owner', requiresTosAcceptance: false } })
        );
        await page.route('**/api/user/settings/timezone', (route) =>
          route.fulfill({ json: { timezone: 'America/New_York' } })
        );
        await page.route('**/api/public/branding/config', (route) =>
          route.fulfill({
            json: {
              appTitle: 'Theme checks',
              slogan: '',
              primaryColor: '#777777',
              secondaryColor: '#64748b',
              accentColor: '#f59e0b',
              logoUrl: null,
              faviconUrl: null,
              darkMode: dark,
            },
          })
        );
        for (const path of pages) {
          await page.goto(path);
          await expect
            .poll(() => page.locator('html').evaluate((e) => e.style.getPropertyValue('--primary')))
            .toBe('#777777');
          const main = page.locator(
            path.startsWith('/admin') ? '#admin-content' : '#dashboard-content'
          );
          await expect(main).toBeVisible();
          await expect(
            main.getByRole(path === '/dashboard' ? 'alert' : 'heading').first()
          ).toBeVisible();
          if (mobile) await page.locator('button[aria-controls$="navigation"]').click();
          const button = main.locator('button:visible:not([disabled])').first();
          if (await button.count()) {
            await page.keyboard.press('Tab');
            await button.focus();
            expect
              .soft(
                await button.evaluate((e) => getComputedStyle(e).boxShadow),
                path + ' keyboard ring'
              )
              .toContain('0px 0px 0px 4px');
          }
          const result = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
          expect
            .soft(
              result.violations.map((v) => ({
                id: v.id,
                nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
              })),
              path
            )
            .toEqual([]);
          expect
            .soft(
              await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
              path + ' overflow'
            )
            .toBe(true);
        }
      });
    }

for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true])
    test(`populated pages and timezone changes (${locale}, dark=${dark})`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript((value) => {
        const apply = () => {
          if (document.documentElement) document.documentElement.lang = value;
        };
        apply();
        new MutationObserver(apply).observe(document, { childList: true });
      }, locale);
      let timezone = 'America/New_York';
      let failTimezone = false;
      const issuedAt = '2026-03-08T07:30:00.000Z';
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/auth/user', (route) =>
        route.fulfill({ json: { userId: 'theme-owner', requiresTosAcceptance: false } })
      );
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            appTitle: 'Theme checks',
            slogan: '',
            logoUrl: null,
            faviconUrl: null,
            primaryColor: '#777777',
            secondaryColor: '#64748b',
            accentColor: '#f59e0b',
            darkMode: dark,
          },
        })
      );
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill(failTimezone ? { status: 503, json: {} } : { json: { timezone } })
      );
      await page.route('**/api/profiles', (route) =>
        route.fulfill({
          json: {
            profiles: [
              {
                id: 'profile-one',
                profileType: 'INDIVIDUAL',
                isDefault: true,
                status: 'VERIFIED',
                title: null,
                firstName: 'Theme',
                lastName: 'Owner',
                nationalId: null,
              },
              {
                id: 'profile-two',
                profileType: 'INDIVIDUAL',
                isDefault: false,
                status: 'VERIFIED',
                title: null,
                firstName: 'Other',
                lastName: 'Profile',
                nationalId: null,
              },
            ],
            hasDefault: true,
            activeProfileId: 'profile-one',
          },
        })
      );
      await page.route('**/api/dashboard', (route) =>
        route.fulfill({
          json: {
            profile: { id: 'profile-one', name: 'Theme Owner' },
            wallet: { balance: '120000', currency: 'IRR', lowBalanceWarning: true },
            activeOrders: 2,
            pendingInvoices: 3,
            openTickets: 1,
            contracts: { active: 2, total: 2 },
          },
        })
      );
      await page.route('**/api/invoices', (route) =>
        route.fulfill({
          json: {
            invoices: [
              {
                invoiceId: '11111111-1111-7111-8111-111111111111',
                role: 'original',
                state: 'Paid',
                totalAmount: '100000',
                accountingAmount: '100000',
                adjustmentKind: null,
                issuedAt,
                dueAt: null,
                createdAt: issuedAt,
                explanation: 'Electricity usage',
              },
            ],
          },
        })
      );
      await page.route('**/api/v1/notifications?*', (route) =>
        route.fulfill({
          json: {
            data: [
              {
                id: '10000000-0000-4000-8000-000000000001',
                type: 'payment.invoice_paid',
                titleI18nKey: '',
                bodyI18nKey: '',
                localizedContent: {
                  en: { title: 'Payment received', body: 'Your invoice is paid' },
                  fa: { title: 'پرداخت دریافت شد', body: 'صورتحساب پرداخت شده است' },
                },
                params: {},
                linkRoute: null,
                linkParams: null,
                isRead: false,
                readAt: null,
                createdAt: issuedAt,
              },
            ],
            next_cursor: null,
            unread_count: 1,
          },
        })
      );
      await page.route('**/api/v1/notifications/unread-count', (route) =>
        route.fulfill({ json: { unread_count: 1 } })
      );
      for (const path of ['/dashboard', '/invoices', '/notifications']) {
        await page.goto(path);
        const main = page.locator('#dashboard-content');
        await expect(main.getByRole('heading').first()).toBeVisible();
        await page.locator('button[aria-controls$="navigation"]').click();
        await expect(page.locator('#profile-switcher')).toHaveValue('profile-one');
        await expect
          .poll(() => page.locator('html').evaluate((e) => e.classList.contains('dark')))
          .toBe(dark);
        if (path === '/invoices') {
          const expected = (zone: string) =>
            new Intl.DateTimeFormat(locale, {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: zone,
            }).format(new Date(issuedAt));
          await expect(main).toContainText(expected(timezone));
          failTimezone = true;
          await page.evaluate(() => window.dispatchEvent(new Event('barghsa:timezone-changed')));
          await expect(main.getByRole('alert')).toBeVisible();
          await expect(main).not.toContainText(expected(timezone));
          timezone = 'Pacific/Auckland';
          failTimezone = false;
          await main.getByRole('alert').getByRole('button').click();
          await expect(main).toContainText(expected(timezone));
          await expect(main.getByRole('alert')).toHaveCount(0);
        }
        if (path === '/notifications')
          await expect(
            main.getByRole('button', { name: /Payment received|پرداخت دریافت شد/ })
          ).toBeVisible();
        const result = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
        expect
          .soft(
            result.violations.map((v) => ({
              id: v.id,
              nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
            })),
            path
          )
          .toEqual([]);
        expect
          .soft(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            path + ' overflow'
          )
          .toBe(true);
        if (path === '/dashboard') {
          await page.emulateMedia({ forcedColors: 'active' });
          const action = main.getByRole('link').first();
          await page.keyboard.press('Tab');
          await action.focus();
          expect(await action.evaluate((e) => getComputedStyle(e).outlineWidth)).toBe('2px');
          expect(await action.evaluate((e) => getComputedStyle(e).outlineStyle)).toBe('solid');
          await page.emulateMedia({ forcedColors: 'none' });
        }
      }
    });
