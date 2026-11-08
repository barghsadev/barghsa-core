import { mockPublicAuthCsrf } from './public-auth-fixture';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { fullNavigation } from './navigation-fixture';
import { DEFAULT_BRAND_CONFIG } from '../src/lib/brand-config';
import { feedbackText } from '@barghsa/i18n/feedback';
import { shellText } from '@barghsa/i18n/shell';
import { tSolar } from '@barghsa/i18n/solar';

const baseBrand = {
  ...DEFAULT_BRAND_CONFIG,
  supportEmail: 'support@example.test',
  supportPhone: '+982112345678',
  supportMobile: '+989121234567',
};

async function feedbackWorkspace(page: Page, locale: 'en' | 'fa') {
  await crmShell(page, locale);
  await page.route('**/api/public/branding/config', (route) => route.fulfill({ json: baseBrand }));
  const profileId = '10000000-0000-4000-8000-000000000001';
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'feedback-user',
        isStaff: false,
        operatingContext: 'customer',
        navigation: fullNavigation('customer'),
        canSwitchContext: false,
        requiresTosAcceptance: false,
      },
    })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        activeProfileId: profileId,
        hasDefault: true,
        profiles: [
          {
            id: profileId,
            profileType: 'INDIVIDUAL',
            status: 'ACTIVE',
            isDefault: true,
            title: null,
            firstName: 'Feedback',
            lastName: 'Owner',
            nationalId: null,
          },
        ],
      },
    })
  );
  await page.route('**/api/profiles/verification-status', (route) =>
    route.fulfill({
      json: {
        activeProfileId: profileId,
        profileStatus: 'ACTIVE',
        isVerified: true,
        verificationRequired: false,
        verificationMethod: 'manual',
        canAutoVerify: false,
      },
    })
  );
}

for (const locale of ['en', 'fa'] as const) {
  test(`auth bootstrap errors provide safe details, retry and a support reference (${locale})`, async ({
    page,
    browserName,
    baseURL,
  }) => {
    await page.addInitScript((value) => {
      if (document.documentElement) document.documentElement.lang = value;
      new MutationObserver(() => {
        document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await feedbackWorkspace(page, locale);
    await mockPublicAuthCsrf(page);
    const reports: unknown[] = [];
    await page.route('**/api/route-errors', async (route) => {
      expect(route.request().method()).toBe('POST');
      const headers = await route.request().allHeaders();
      const origin = new URL(baseURL!).origin;
      expect(headers.origin).toBe(origin);
      expect(headers.referer).toBe(origin + '/');
      reports.push(route.request().postDataJSON());
      await route.fulfill({ status: 503, json: {} });
    });
    let failed = true;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/auth/user', async (route) => {
      if (failed) await pending;
      await route.fulfill({
        status: failed ? 503 : 401,
        json: { error: 'PRIVATE-DATABASE-DETAIL' },
      });
    });
    await page.goto('/register');
    const main = page.getByRole('main');
    const skip = page.getByRole('link', {
      name: locale === 'fa' ? 'رفتن به محتوای اصلی' : 'Skip to main content',
      exact: true,
    });
    try {
      await expect(
        page.getByRole('status', {
          name: locale === 'fa' ? 'در حال بارگذاری صفحه' : 'Loading page',
          exact: true,
        })
      ).toBeVisible();
      await expect(main).toHaveAttribute('id', 'main-content');
      const heading = main.getByRole('heading', { level: 1 });
      await expect(heading).toHaveCount(1);
      await expect(heading).toHaveText(locale === 'fa' ? 'در حال بارگذاری صفحه' : 'Loading page');
      await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
      await expect(skip).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(main).toBeFocused();
    } finally {
      release();
    }
    const alert = page.getByRole('alert');
    await expect(alert).toContainText(locale === 'fa' ? 'خطایی رخ داد' : 'Something went wrong');
    await expect(main.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('#main-content')).toHaveCount(1);
    await skip.press('Enter');
    await expect(main).toBeFocused();
    await expect(page.locator('body')).not.toContainText('PRIVATE-DATABASE-DETAIL');
    const details = alert.locator('details');
    await expect(details).not.toHaveAttribute('open');
    await details.locator('summary').click();
    await expect(details).toContainText('ROUTE_RENDER_FAILED');
    const reference = (await details.textContent())!.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
    )![0];
    await expect.poll(() => reports).toEqual([{ code: 'ROUTE_RENDER_FAILED', reference }]);
    const support = alert.getByRole('link', {
      name: locale === 'fa' ? 'تماس با پشتیبانی' : 'Contact support',
      exact: true,
    });
    await expect(support).toHaveAttribute('href', `/support?reference=${reference}`);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[role="alert"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations
    ).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath('route-error-safe-details.png'),
      fullPage: true,
    });
    failed = false;
    await alert
      .getByRole('button', { name: locale === 'fa' ? 'تلاش دوباره' : 'Try again', exact: true })
      .click();
    await expect(page.locator('#username')).toBeVisible();
    await page.goto(`/support?reference=${reference}`);
    await expect(page.getByRole('main')).toContainText(reference);
    await expect(page.locator('a[href^="mailto:"]')).toHaveAttribute(
      'href',
      new RegExp(encodeURIComponent(reference))
    );
    expect(reports).toHaveLength(1);
  });

  test(`unknown routes keep one localized main and the first skip target (${locale})`, async ({
    page,
    browserName,
  }) => {
    await page.addInitScript((lang) => localStorage.setItem('barghsa.locale', lang), locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 401, json: {} }));
    await page.goto('/unmatched-route-for-accessibility');
    const main = page.getByRole('main');
    await expect(
      main.getByRole('heading', {
        name: locale === 'fa' ? 'صفحه پیدا نشد' : 'Page not found',
        level: 1,
        exact: true,
      })
    ).toBeVisible();
    await expect(page.locator('#main-content')).toHaveCount(1);
    const skip = page.getByRole('link', {
      name: locale === 'fa' ? 'رفتن به محتوای اصلی' : 'Skip to main content',
      exact: true,
    });
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(main).toBeFocused();
    await expect(main.getByRole('link')).toHaveAttribute('href', '/');
  });

  test(`a missing route and recovery chunk leave a localized reload path (${locale})`, async ({
    page,
    baseURL,
  }, info) => {
    await feedbackWorkspace(page, locale);
    const reports: unknown[] = [];
    await page
      .context()
      .addCookies([{ name: 'barghsa_csrf', value: 'fixture-route-csrf', url: baseURL! }]);
    await page.route('**/api/route-errors', async (route) => {
      expect(route.request().headers()['x-csrf-token']).toBe('fixture-route-csrf');
      reports.push(route.request().postDataJSON());
      await route.abort('failed');
    });
    const dist = process.env['BARGHSA_BROWSER_COVERAGE'] === '1' ? 'dist-coverage' : 'dist';
    const manifest = JSON.parse(readFileSync(resolve(dist, '.vite/manifest.json'), 'utf8'));
    const routeChunk = manifest['src/pages/SolarRequestDetailPage.tsx']?.file;
    const recoveryChunk = manifest['src/components/RouteErrorBoundary.tsx']?.file;
    expect(routeChunk).toBeTruthy();
    expect(recoveryChunk).toBeTruthy();
    let routeFailures = 0;
    let recoveryFailures = 0;
    let stale = true;
    const detailPath = '/solar/requests/10000000-0000-4000-8000-000000000002';
    const missingAsset = { status: 404, headers: { 'cache-control': 'no-store' } };
    await page.route(
      (url) => url.pathname === detailPath,
      async (route) => {
        if (!stale) return route.continue();
        const response = await route.fetch();
        const body = (await response.text()).replaceAll('"/assets/', '"/stale-assets/');
        return route.fulfill({ response, body });
      }
    );
    // Serve the previous document's asset paths, except for its missing page and error UI.
    await page.route('**/stale-assets/**', async (route) => {
      const url = new URL(route.request().url());
      const asset = url.pathname.replace(/^\/stale-assets\//, 'assets/');
      if (asset === routeChunk) {
        routeFailures++;
        return route.fulfill(missingAsset);
      }
      if (asset === recoveryChunk) {
        recoveryFailures++;
        return route.fulfill(missingAsset);
      }
      url.pathname = `/${asset}`;
      return route.fulfill({ response: await route.fetch({ url: url.href }) });
    });

    await page.goto(detailPath);
    const main = page.getByRole('main');
    await expect(
      main.getByRole('heading', {
        level: 1,
        name: feedbackText('chunkTitle', locale),
        exact: true,
      })
    ).toBeVisible();
    expect(routeFailures).toBeGreaterThan(0);
    expect(recoveryFailures).toBeGreaterThan(0);
    await expect
      .poll(() => reports)
      .toEqual([
        {
          code: 'CHUNK_LOAD_FAILED',
          reference: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        },
      ]);
    await expect(main).toHaveCount(1);
    await expect(page.locator('#main-content')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Show Error', exact: true })).toHaveCount(0);
    const skip = page.getByRole('link', {
      name: locale === 'fa' ? 'رفتن به محتوای اصلی' : 'Skip to main content',
      exact: true,
    });
    await skip.press('Enter');
    await expect(main).toBeFocused();
    expect(
      (
        await new AxeBuilder({ page })
          .include('#main-content')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations
    ).toEqual([]);
    if (locale === 'fa' && info.project.name === 'mobile-safari')
      await page.screenshot({ path: info.outputPath('stale-route-recovery-fa.png') });

    stale = false;
    await main.getByRole('button', { name: feedbackText('reload', locale), exact: true }).click();
    await expect(
      main.getByRole('heading', { level: 1, name: tSolar('details', locale), exact: true })
    ).toBeVisible();
    expect(reports).toHaveLength(1);
  });
}

for (const locale of ['en', 'fa'] as const) {
  for (const darkMode of [false, true]) {
    test(`registration feedback survives navigation and follows locale/theme (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
      await page.addInitScript((value) => {
        if (document.documentElement) document.documentElement.lang = value;
        new MutationObserver(() => {
          if (document.documentElement) document.documentElement.lang = value;
        }).observe(document, { childList: true });
      }, locale);
      await feedbackWorkspace(page, locale);
      await page.emulateMedia({ colorScheme: darkMode ? 'dark' : 'light' });
      await mockPublicAuthCsrf(page);
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            ...baseBrand,
            appTitle: 'Feedback test',
            slogan: '',
            primaryColor: '#2563eb',
            secondaryColor: '#64748b',
            accentColor: '#f59e0b',
            logoUrl: null,
            faviconUrl: null,
            darkMode,
            themeMode: darkMode ? 'dark' : 'light',
            numberStyle: 'locale',
          },
        })
      );
      const challengeId = '00000000-0000-4000-8000-000000000001';
      let verified = 0;
      await page.route('**/api/auth/register/verify', (route) => {
        expect(route.request().postDataJSON()).toEqual({ challengeId, otp: '123456' });
        verified++;
        return route.fulfill({
          json: {
            userId: 'feedback-user',
            sessionId: 'feedback-session',
            csrfToken: 'feedback-csrf',
            expiresAt: '2030-01-01T00:00:00.000Z',
          },
        });
      });
      await page.goto(
        `/register/verify?challengeId=${challengeId}&destination=feedback@example.test`
      );
      const inputs = page.locator('input[inputmode="numeric"]');
      await expect(inputs).toHaveCount(6);
      for (let index = 0; index < 6; index++) await inputs.nth(index).fill(String(index + 1));
      await expect(page).toHaveURL(/\/app$/);
      const messages = page.getByRole('region', {
        name: locale === 'fa' ? 'پیام‌های برنامه' : 'Application messages',
        exact: true,
      });
      const notice = messages.locator('[data-sonner-toast]');
      await expect(notice).toContainText(
        locale === 'fa' ? 'حساب شما با موفقیت ایجاد شد' : 'Account created successfully'
      );
      await expect(notice).toHaveCount(1);
      await test.info().attach('toast-layout', {
        contentType: 'application/json',
        body: JSON.stringify(
          await page.evaluate(() => ({
            overlays: [
              ...document.querySelectorAll('[role="dialog"], [data-slot="popover-content"]'),
            ].map((node) => ({
              slot: node.getAttribute('data-slot'),
              open: node.hasAttribute('data-open'),
              display: getComputedStyle(node).display,
              visibility: getComputedStyle(node).visibility,
            })),
            toast: [...document.querySelectorAll('[data-sonner-toast]')].map((node) => ({
              visibility: getComputedStyle(node).visibility,
              display: getComputedStyle(node).display,
              rect: node.getBoundingClientRect().toJSON(),
            })),
          }))
        ),
      });
      await expect(notice).toBeVisible();
      await notice.hover();
      await expect(messages).toHaveAttribute('aria-live', 'polite');
      const list = messages.locator('[data-sonner-toaster]');
      await expect(list).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
      await expect(list).toHaveAttribute('data-x-position', locale === 'fa' ? 'left' : 'right');
      await expect(list).toHaveAttribute('data-sonner-theme', darkMode ? 'dark' : 'light');
      // Measure readable, settled content rather than the entrance fade.
      await expect(notice).toHaveCSS('opacity', '1');
      const breadcrumb = page.getByRole('navigation', {
        name: shellText('breadcrumbs', locale),
        exact: true,
      });
      await expect
        .poll(async () => {
          const crumbBottom = await breadcrumb.evaluate(
            (element) => element.getBoundingClientRect().bottom
          );
          const noticeTop = await notice.evaluate((element) => element.getBoundingClientRect().top);
          return noticeTop - crumbBottom;
        })
        .toBeGreaterThanOrEqual(15.5);
      const contrast = await new AxeBuilder({ page })
        .include('[data-sonner-toaster]')
        .withRules(['color-contrast'])
        .analyze();
      expect(contrast.violations).toEqual([]);
      expect(contrast.incomplete).toEqual([]);
      const close = messages.getByRole('button', {
        name: locale === 'fa' ? 'بستن پیام' : 'Dismiss message',
        exact: true,
      });
      await close.focus();
      await close.press('Enter');
      await expect(notice).toHaveCount(0);
      expect(verified).toBe(1);
    });
  }
}

for (const trusted of [false, true]) {
  test(`login submits keyboard-selected trusted device (${trusted})`, async ({ page }) => {
    await feedbackWorkspace(page, 'fa');
    await mockPublicAuthCsrf(page);
    const challengeId = '00000000-0000-4000-8000-000000000001';
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ json: { requiresOtp: true, challengeId } })
    );
    let submitted = false;
    await page.route('**/api/auth/login/verify', (route) => {
      expect(route.request().postDataJSON()).toEqual({
        challengeId,
        otp: '123456',
        trustDevice: trusted,
      });
      submitted = true;
      return route.fulfill({
        json: {
          userId: 'feedback-user',
          sessionId: 'feedback-session',
          csrfToken: 'feedback-csrf',
          expiresAt: '2030-01-01T00:00:00.000Z',
        },
      });
    });
    await page.goto('/login');
    await page.locator('#username').fill('feedback@example.test');
    await page.locator('#username').press('Tab');
    await page.locator('#password').fill('Browser-feedback-password-123!');
    await page.locator('button[type="submit"]').click();
    const checkbox = page.getByRole('checkbox');
    await expect(checkbox).not.toBeChecked();
    await checkbox.focus();
    await checkbox.press('Space');
    await expect(checkbox).toBeChecked();
    if (!trusted) {
      await checkbox.press('Space');
      await expect(checkbox).not.toBeChecked();
    }
    const inputs = page.locator('input[inputmode="numeric"]');
    for (let index = 0; index < 6; index++) await inputs.nth(index).fill(String(index + 1));
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
    expect(submitted).toBe(true);
  });
}

for (const locale of ['en', 'fa'] as const) {
  test(`expired registration shows error after redirect (${locale})`, async ({ page }) => {
    await page.addInitScript((value) => {
      if (document.documentElement) document.documentElement.lang = value;
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await feedbackWorkspace(page, locale);
    await mockPublicAuthCsrf(page);
    await page.route('**/api/auth/register/verify', (route) =>
      route.fulfill({ status: 400, json: { error: { code: 'AUTH:OTP:EXPIRED' } } })
    );
    await page.goto(
      '/register/verify?challengeId=00000000-0000-4000-8000-000000000001&destination=feedback@example.test'
    );
    const inputs = page.locator('input[inputmode="numeric"]');
    for (let index = 0; index < 6; index++) await inputs.nth(index).fill(String(index + 1));
    await expect(page).toHaveURL(/\/register\/?$/);
    const notice = page.locator('[data-sonner-toast]');
    await expect(notice).toHaveCount(1);
    await expect(notice).toHaveAttribute('data-type', 'error');
    await expect(notice).toContainText(
      locale === 'fa'
        ? 'کد تأیید منقضی شده است. لطفاً دوباره ثبت‌نام کنید'
        : 'The verification code has expired. Please register again'
    );
  });
}

test('dashboard shell uses configured brand title and exposes navigation', async ({ page }) => {
  await feedbackWorkspace(page, 'en');
  await mockPublicAuthCsrf(page);
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
      json: {
        ...baseBrand,
        appTitle: 'Configured company',
        slogan: '',
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        logoUrl: null,
        faviconUrl: null,
        darkMode: false,
        numberStyle: 'locale',
      },
    })
  );
  await page.goto('/dashboard');
  const menu = page.locator('button[aria-controls="dashboard-navigation"]');
  await expect(menu).toBeAttached();
  if (await menu.isVisible()) {
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
  }
  await expect(page.locator('#dashboard-navigation > a[href="/app"]')).toHaveText(
    'Configured company'
  );
  await expect(page.locator('#dashboard-navigation nav a[href="/app"]')).toBeVisible();
});
