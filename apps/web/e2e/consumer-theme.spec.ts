import { formatBrowserDate } from './browser-date';
import { fullNavigation } from './navigation-fixture';
import { fulfillDashboard } from './dashboard-fixture';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Locator } from './coverage-fixture';
import { tSaving } from '@barghsa/i18n/saving';
import { providerText } from '@barghsa/i18n/providers';
import { t } from '@barghsa/i18n/admin-ui';
import { measureControlContrast } from './control-contrast';
import { approveRiskConfirmation } from './confirmation-fixture';

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
    test(`saving and email provider actions retain contrast at rest and on hover (${locale}, dark=${dark})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' });
      await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
      const primaryColor = dark ? '#767676' : '#757575';
      const profileId = '10000000-0000-4000-8000-000000000001';
      let staff = false;
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/auth/user', (route) =>
        route.fulfill({
          json: {
            userId: 'theme-owner',
            isStaff: staff,
            operatingContext: staff ? 'staff' : 'customer',
            canSwitchContext: false,
            requiresTosAcceptance: false,
            ...(staff ? { navigation: fullNavigation('staff') } : {}),
          },
        })
      );
      await page.route('**/api/profiles', (route) =>
        route.fulfill({
          json: {
            profiles: [{ id: profileId, profileType: 'INDIVIDUAL', title: 'Buyer' }],
            activeProfileId: profileId,
            hasDefault: true,
          },
        })
      );
      await page.route('**/api/profiles/verification-status', (route) =>
        route.fulfill({
          json: { activeProfileId: profileId, profileStatus: 'ACTIVE', isVerified: true },
        })
      );
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            appTitle: 'Theme checks',
            appTitleFa: 'آزمون نمایش',
            supportEmail: 'support@example.test',
            supportPhone: '02126658042',
            supportMobile: '09002550292',
            slogan: '',
            primaryColor,
            secondaryColor: '#64748b',
            accentColor: '#f59e0b',
            logoUrl: null,
            faviconUrl: null,
            darkMode: dark,
          },
        })
      );
      const available = {
        id: '10000000-0000-4000-8000-000000000002',
        title: { en: 'Available plan', fa: 'طرح در دسترس' },
        description: null,
        status: 'active',
        available: true,
        price: '100000',
        hardware: [],
        agreement: null,
      };
      const unavailable = {
        ...available,
        id: '10000000-0000-4000-8000-000000000003',
        title: { en: 'Unavailable plan', fa: 'طرح خارج از دسترس' },
        description: { en: 'Read this plan', fa: 'شرایط این طرح' },
        available: false,
      };
      await page.route('**/api/saving/plans', (route) =>
        route.fulfill({ json: { plans: [available, unavailable] } })
      );
      await page.route('**/api/admin/sms-providers', (route) => route.fulfill({ json: [] }));
      const provider = {
        id: 'theme-draft-email',
        label: 'Draft provider',
        transport: 'resend',
        status: 'draft',
        lastTestStatus: 'passed',
        maskedConfig: { from_email: 'mail@example.test' },
      };
      const disabled = { ...provider, id: 'theme-disabled-email', status: 'disabled' };
      const restored = {
        ...provider,
        id: 'theme-restored-email',
        label: 'Restored provider',
        status: 'active',
      };
      let rollbackAttempts = 0;
      await page.route(`**/api/admin/email-providers/${disabled.id}/rollback`, (route) => {
        expect(route.request().method()).toBe('POST');
        rollbackAttempts++;
        return rollbackAttempts === 1
          ? route.fulfill({ status: 400, json: {} })
          : route.fulfill({ json: restored });
      });
      await page.route('**/api/admin/email-providers', (route) =>
        route.fulfill({
          json: [
            provider,
            disabled,
            rollbackAttempts >= 2
              ? restored
              : {
                  ...provider,
                  id: 'theme-active-email',
                  label: 'Active provider',
                  status: 'active',
                },
          ],
        })
      );

      const theme = page.locator('html');
      const expectBrand = async () =>
        expect
          .poll(() => theme.evaluate((element) => element.style.getPropertyValue('--primary')))
          .toBe(primaryColor);
      const setHighContrast = (high: boolean) =>
        theme.evaluate((element, enabled) => {
          if (enabled) element.dataset.contrast = 'more';
          else delete element.dataset.contrast;
        }, high);
      const checkAction = async (action: Locator) => {
        await expect(action).toBeEnabled();
        expect(await measureControlContrast(action, 'text')).toBeGreaterThanOrEqual(4.5);
        await action.hover();
        expect(await action.evaluate((element) => element.matches(':hover'))).toBe(true);
        expect(await measureControlContrast(action, 'text')).toBeGreaterThanOrEqual(4.5);
        await page.mouse.move(0, 0);
      };

      await page.goto('/savings');
      await expectBrand();
      const order = page.getByRole('link', { name: tSaving('startOrder', locale), exact: true });
      const unavailableCard = page.locator('[data-slot=card]').filter({
        has: page.getByRole('heading', { name: unavailable.title[locale], exact: true }),
      });
      await expect(order).toHaveAttribute('href', '/savings/order');
      await expect(unavailableCard.getByRole('link')).toHaveCount(0);
      for (const high of [false, true]) {
        await setHighContrast(high);
        await checkAction(order);
        await expect(unavailableCard).toHaveCSS('opacity', '1');
        const description = unavailableCard.getByText(unavailable.description[locale], {
          exact: true,
        });
        expect(await measureControlContrast(description, 'text')).toBeGreaterThanOrEqual(4.5);
      }

      staff = true;
      await page.goto('/admin/providers');
      await expectBrand();
      for (const high of [false, true]) {
        await setHighContrast(high);
        for (const name of ['new', 'activate', 'disable'])
          await checkAction(
            page.getByRole('button', {
              name: providerText(`admin.providers.${name}`, locale),
              exact: true,
            })
          );
      }

      const rollback = async () => {
        await page
          .getByRole('button', {
            name: providerText('admin.providers.rollback', locale),
            exact: true,
          })
          .click();
        const confirm = page
          .getByRole('dialog')
          .getByRole('button', { name: t('team.confirm', locale), exact: true });
        await expect(confirm).toBeDisabled();
        await approveRiskConfirmation(page, locale, 'destructive');
        await confirm.click();
      };
      for (const [kind, label] of [
        ['error', t('admin.notifications.dismissError', locale)],
        ['notice', providerText('admin.providers.dismissNotice', locale)],
      ]) {
        await rollback();
        const dismiss = page.getByRole('button', { name: label, exact: true });
        await expect(dismiss).toBeVisible();
        for (const high of [false, true]) {
          await setHighContrast(high);
          expect
            .soft(await measureControlContrast(dismiss, 'text'), `${kind} at rest, high=${high}`)
            .toBeGreaterThanOrEqual(4.5);
          await dismiss.hover();
          expect(await dismiss.evaluate((element) => element.matches(':hover'))).toBe(true);
          expect
            .soft(await measureControlContrast(dismiss, 'text'), `${kind} hovered, high=${high}`)
            .toBeGreaterThanOrEqual(4.5);
          await page.mouse.move(0, 0);
        }
        await dismiss.click();
        await expect(dismiss).toHaveCount(0);
      }
      await expect(
        page.getByText(restored.label, { exact: true }).filter({ visible: true })
      ).toBeVisible();
      expect(rollbackAttempts).toBe(2);
    });

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
          localStorage.setItem('barghsa.locale', value);
          const apply = () => {
            if (document.documentElement) document.documentElement.lang = value;
          };
          apply();
          new MutationObserver(apply).observe(document, { childList: true });
        }, locale);
        await page.route('**/api/**', (route) => route.fulfill({ status: 503, json: {} }));
        let staffMode = false;
        await page.route('**/api/auth/user', (route) =>
          route.fulfill({
            json: {
              isStaff: staffMode,
              operatingContext: staffMode ? 'staff' : 'customer',
              userId: 'theme-owner',
              requiresTosAcceptance: false,
            },
          })
        );
        // Admit the known owner through bootstrap; the page's business reads still fail below.
        await page.route('**/api/profiles', (route) =>
          route.fulfill({
            json: {
              profiles: [
                {
                  id: 'theme-profile',
                  profileType: 'INDIVIDUAL',
                  isDefault: true,
                  status: 'VERIFIED',
                  title: null,
                  firstName: 'Theme',
                  lastName: 'Owner',
                  nationalId: null,
                },
              ],
              hasDefault: true,
              activeProfileId: 'theme-profile',
            },
          })
        );
        await page.route('**/api/user/settings/timezone', (route) =>
          route.fulfill({ json: { timezone: 'America/New_York' } })
        );
        await page.route('**/api/public/branding/config', (route) =>
          route.fulfill({
            json: {
              appTitle: 'Theme checks',
              appTitleFa: 'آزمون نمایش',
              supportEmail: 'support@example.test',
              supportPhone: '+98 21 12345678',
              supportMobile: '+98 912 1234567',
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
          staffMode = path.startsWith('/admin');
          await page.goto(path);
          await expect
            .poll(() => page.locator('html').evaluate((e) => e.style.getPropertyValue('--primary')))
            .toBe('#777777');
          const main = page.locator(
            path.startsWith('/admin') ? 'main[data-area=admin]' : 'main[data-area=dashboard]'
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
        localStorage.setItem('barghsa.locale', value);
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
        route.fulfill({
          json: {
            isStaff: false,
            userId: 'theme-owner',
            requiresTosAcceptance: false,
            navigation: {
              ...fullNavigation('customer'),
              profileId: '99111111-1111-4111-8111-111111111111',
            },
          },
        })
      );
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            appTitle: 'Theme checks',
            appTitleFa: 'آزمون نمایش',
            supportEmail: 'support@example.test',
            supportPhone: '+98 21 12345678',
            supportMobile: '+98 912 1234567',
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
                id: '99111111-1111-4111-8111-111111111111',
                profileType: 'INDIVIDUAL',
                isDefault: true,
                status: 'VERIFIED',
                title: null,
                firstName: 'Theme',
                lastName: 'Owner',
                nationalId: null,
              },
              {
                id: '99222222-2222-4222-8222-222222222222',
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
            activeProfileId: '99111111-1111-4111-8111-111111111111',
          },
        })
      );
      await page.route('**/api/dashboard{,/**}', (route) =>
        fulfillDashboard(route, {
          json: {
            profile: { id: '99111111-1111-4111-8111-111111111111', name: 'Theme Owner' },
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
        const main = page.locator('main[data-area=dashboard]');
        await expect(main.getByRole('heading').first()).toBeVisible();
        await page.locator('button[aria-controls$="navigation"]').click();
        const profile = page.locator('#profile-switcher');
        await expect(profile).toContainText('Theme Owner');
        await profile.click();
        await expect(
          page.locator('[data-profile-id="99111111-1111-4111-8111-111111111111"]')
        ).toBeChecked();
        await expect(
          page.locator('[data-profile-id="99222222-2222-4222-8222-222222222222"]')
        ).not.toBeChecked();
        await page.keyboard.press('Escape');
        await expect(profile).toBeFocused();
        await expect
          .poll(() => page.locator('html').evaluate((e) => e.classList.contains('dark')))
          .toBe(dark);
        if (path === '/invoices') {
          const expected = (zone: string) =>
            formatBrowserDate(
              page,
              locale,
              { dateStyle: 'medium', timeStyle: 'short', timeZone: zone },
              issuedAt
            );
          await expect(main).toContainText(await expected(timezone));
          failTimezone = true;
          await page.evaluate(() => window.dispatchEvent(new Event('barghsa:timezone-changed')));
          await expect(main.getByRole('alert')).toBeVisible();
          await expect(main).not.toContainText(await expected(timezone));
          timezone = 'Pacific/Auckland';
          failTimezone = false;
          await main.getByRole('alert').getByRole('button').click();
          await expect(main).toContainText(await expected(timezone));
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
