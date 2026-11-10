import { t } from '@barghsa/i18n/app';
import { t as authText } from '@barghsa/i18n/auth';
import { securitySettingsText } from '@barghsa/i18n/security-settings-forms';
import { sessionReference } from '../../api/src/session/session-reference';
import { test, expect, type Page, type Route } from './coverage-fixture';
import { approveRiskConfirmation } from './confirmation-fixture';
import { cookieResponse } from './cookie-response';
import { browserFixtureProxy } from './local-network';
import { fullNavigation } from './navigation-fixture';
import { mockPublicAuthCsrf } from './public-auth-fixture';

for (const path of ['/login', '/register', '/register/verify', '/forgot-password', '/activate'])
  test(`authenticated entry leaves ${path} before rendering a public form`, async ({ page }) => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', async (route) => {
      reads++;
      await ready;
      return route.fulfill({
        json: {
          userId: 'signed-in-owner',
          username: 'private-login@example.test',
          isStaff: true,
          operatingContext: 'staff',
          navigation: fullNavigation('staff'),
          requiresTosAcceptance: false,
        },
      });
    });
    await page.goto(path);
    await expect.poll(() => reads).toBeGreaterThan(0);
    await expect(page.locator('input[type=password],form')).toHaveCount(0);
    await expect(page.getByText('private-login@example.test', { exact: true })).toHaveCount(0);
    release();
    await expect(page).toHaveURL(/\/app$/);
  });

test('an expired session can use the public form without loading workspace data', async ({
  page,
}) => {
  const reads: string[] = [];
  await page.route('**/api/**', (route) => {
    reads.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route('**/api/auth/user', (route) => route.fulfill({ status: 401, json: {} }));
  await page.goto('/login');
  await expect(page.locator('#username')).toBeVisible();
  await expect(page.locator('#password')).toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: /session has ended|نشست شما پایان یافته/ })
  ).toHaveCount(0);
  expect(
    reads.some((path) => /^\/api\/(?:dashboard|profiles|admin|wallet|invoices)(?:\/|$)/.test(path))
  ).toBe(false);
});

for (const [area, locale] of [
  ['customer', 'en'],
  ['staff', 'fa'],
] as const)
  test(`a verified ${area} session announces its expiry once after protected navigation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript((lang) => localStorage.setItem('barghsa.locale', lang), locale);
    let expired = false;
    let deniedReads = 0;
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) => {
      if (expired) {
        deniedReads++;
        return route.fulfill({ status: 401, json: { error: 'AUTH:UNAUTHENTICATED' } });
      }
      return route.fulfill({
        json: {
          userId: 'expiry-test-user',
          isStaff: area === 'staff',
          operatingContext: area,
          navigation: fullNavigation(area),
          requiresTosAcceptance: false,
        },
      });
    });
    await page.route('**/api/profiles', (route) =>
      route.fulfill({
        json: {
          activeProfileId: 'profile-1',
          hasDefault: true,
          profiles: [
            { id: 'profile-1', profileType: 'INDIVIDUAL', status: 'ACTIVE', isDefault: true },
          ],
        },
      })
    );
    await page.goto('/app');
    const link = page.locator(`aside a[href="${area === 'staff' ? '/admin/users' : '/wallet'}"]`);
    await expect(link).toBeVisible();
    expired = true;
    await link.click();
    await expect(page).toHaveURL(/\/login$/);
    expect(deniedReads).toBeGreaterThan(0);
    const notice = page.getByRole('alert').filter({
      hasText:
        locale === 'fa'
          ? 'نشست شما پایان یافته است. برای ادامه دوباره وارد شوید.'
          : 'Your session has ended. Sign in again to continue.',
    });
    await expect(notice).toBeFocused();
    await expect(page.locator('#username')).toBeVisible();
    await page.reload();
    await expect(page.locator('#username')).toBeVisible();
    await expect(notice).toHaveCount(0);
  });

for (const locale of ['fa', 'en'] as const) {
  test(`new-device MFA grants a session and revocation ends only the selected session (${locale})`, async ({
    browser,
    baseURL,
    page,
  }) => {
    test.setTimeout(60_000);
    const userId = 'mfa-journey-user';
    const username = 'mfa-journey@example.test';
    const password = 'Browser-test-password-123!';
    const challengeId = '00000000-0000-4000-8000-000000000051';
    const oldCookie = 'older-browser-session';
    const oldReference = sessionReference(oldCookie);
    const host = new URL(baseURL!).hostname;
    const createdAt = '2026-11-10T10:00:00.000Z';
    const expiresAt = '2030-01-01T00:00:00.000Z';
    let currentCookie = '';
    let csrf = '';
    let revoked = false;
    const steps: string[] = [];
    // WebKit route interception omits Cookie. Use the URL-scoped browser cookie jar.
    const sessionCookie = async (route: Route) => {
      const request = route.request();
      const cookies = await request.frame().page().context().cookies(request.url());
      return cookies.find(({ name }) => name === 'barghsa_session')?.value;
    };
    const session = (value: string) => ({
      name: 'barghsa_session',
      value,
      domain: host,
      path: '/api',
      httpOnly: true,
      sameSite: 'Lax' as const,
    });
    const issue = async (route: Route, value: string) => {
      currentCookie = value;
      csrf = `${value}-csrf`;
      await route
        .request()
        .frame()
        .page()
        .context()
        .addCookies([session(value)]);
      return { 'set-cookie': `barghsa_csrf=${csrf}; Path=/; SameSite=Strict` };
    };
    const installWorkspace = async (target: Page) => {
      await target.addInitScript((lang) => localStorage.setItem('barghsa.locale', lang), locale);
      await target.route('**/api/**', (r) => r.fulfill({ status: 404, json: {} }));
      await target.route('**/api/auth/refresh', (r) => r.fulfill({ status: 401, json: {} }));
      await target.route('**/api/auth/user', async (r) => {
        const token = await sessionCookie(r);
        if (!token || (token !== currentCookie && (token !== oldCookie || revoked)))
          return r.fulfill({ status: 401, json: { error: 'AUTH:UNAUTHENTICATED' } });
        return r.fulfill({
          json: {
            userId,
            isStaff: false,
            operatingContext: 'customer',
            requiresTosAcceptance: false,
            navigation: fullNavigation('customer'),
          },
        });
      });
      await target.route('**/api/profiles', (r) =>
        r.fulfill({
          json: {
            activeProfileId: 'profile-1',
            hasDefault: true,
            profiles: [{ id: 'profile-1', profileType: 'INDIVIDUAL', status: 'ACTIVE' }],
          },
        })
      );
      await target.route('**/api/auth/sessions', async (r) => {
        const token = await sessionCookie(r);
        expect(token === currentCookie || (token === oldCookie && !revoked)).toBe(true);
        const rows = [
          ...(currentCookie
            ? [{ key: currentCookie, id: sessionReference(currentCookie), ip: '192.0.2.1' }]
            : []),
          ...(!revoked ? [{ key: oldCookie, id: oldReference, ip: '192.0.2.2' }] : []),
        ];
        return r.fulfill({
          json: rows.map(({ key, id, ip }) => ({
            sessionId: id,
            isCurrentSession: key === token,
            deviceInfo: { ip, userAgent: 'Windows' },
            createdAt,
            updatedAt: createdAt,
            expiresAt,
            idleDeadline: expiresAt,
          })),
        });
      });
    };
    const publicWrite = (r: Route) => {
      expect(r.request().method()).toBe('POST');
      expect(r.request().headers()['x-csrf-token']).toBe('c'.repeat(64));
    };
    await installWorkspace(page);
    await mockPublicAuthCsrf(page);
    await page.route('**/api/auth/login', async (r) => {
      publicWrite(r);
      expect(await sessionCookie(r)).toBeUndefined();
      expect(r.request().postDataJSON()).toEqual({ username, password });
      steps.push('password');
      return r.fulfill({ json: { requiresOtp: true, challengeId, userIsStaff: false } });
    });
    await page.route('**/api/auth/login/verify', async (r) => {
      publicWrite(r);
      expect(await sessionCookie(r)).toBeUndefined();
      const otp = steps.at(-1) === 'password' ? '000000' : '123456';
      expect(r.request().postDataJSON()).toEqual({ challengeId, otp, trustDevice: false });
      if (otp === '000000') {
        steps.push('rejected-otp');
        return r.fulfill({ status: 401, json: { error: { code: 'AUTH:OTP:INVALID' } } });
      }
      steps.push('verified-otp');
      const headers = await issue(r, 'after-otp');
      return cookieResponse(r, {
        headers,
        json: { userId, sessionId: sessionReference(currentCookie), csrfToken: csrf, expiresAt },
      });
    });
    await page.route('**/api/auth/step-up', async (r) => {
      expect(r.request().method()).toBe('POST');
      expect(await sessionCookie(r)).toBe('after-otp');
      expect(r.request().headers()['x-csrf-token']).toBe(csrf);
      expect(r.request().postDataJSON()).toEqual({ password });
      steps.push('step-up');
      const headers = await issue(r, 'after-step-up');
      return cookieResponse(r, {
        headers,
        json: { message: 'Step-up authentication successful.', stepUpVerifiedAt: createdAt },
      });
    });
    await page.route(`**/api/auth/sessions/${encodeURIComponent(oldReference)}`, async (r) => {
      expect(r.request().method()).toBe('DELETE');
      expect(r.request().headers()['x-csrf-token']).toBe(csrf);
      const token = await sessionCookie(r);
      if (steps.at(-1) !== 'step-up') {
        expect(token).toBe('after-otp');
        steps.push('step-up-required');
        return r.fulfill({ status: 403, json: { error: { code: 'AUTHZ:STEP_UP_REQUIRED' } } });
      }
      expect(token).toBe('after-step-up');
      expect(revoked).toBe(false);
      revoked = true;
      steps.push('revoked');
      return r.fulfill({ json: { message: 'Session revoked.' } });
    });

    const previous = await browser.newContext({ baseURL, proxy: browserFixtureProxy() });
    try {
      const previousPage = await previous.newPage();
      await previous.addCookies([session(oldCookie)]);
      await installWorkspace(previousPage);
      await previousPage.goto('/settings/security');
      const current = t('settings.security.currentSession', locale);
      await expect(previousPage.getByText(current, { exact: true })).toBeVisible();

      await page.goto('/login');
      await page.locator('#username').fill(username);
      await page.locator('#password').fill(password);
      const submitLogin = page.locator('main button[type=submit]');
      await submitLogin.click();
      const digits = page.locator('input[inputmode=numeric]');
      await expect(digits).toHaveCount(6);
      expect(currentCookie).toBe('');
      await digits.first().fill('000000');
      await submitLogin.click();
      await expect(
        page.getByRole('alert').filter({ hasText: authText('auth.otp.error.invalid', locale) })
      ).toBeVisible();
      await expect(page).toHaveURL(/\/login$/);
      expect(currentCookie).toBe('');
      await digits.first().fill(locale === 'fa' ? '۱۲۳۴۵۶' : '123456');
      await submitLogin.click();
      await expect(page).toHaveURL(/\/app$/);
      await expect(page.locator('main#main-content[data-area="dashboard"]')).toBeVisible();

      await page.goto('/settings/security');
      const revoke = t('settings.security.revoke', locale);
      const trigger = page.getByRole('button', { name: revoke, exact: true });
      await expect(page.getByText(current, { exact: true })).toBeVisible();
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: revoke, exact: true });
      const confirm = dialog.getByRole('button', { name: revoke, exact: true });
      await expect(confirm).toBeDisabled();
      expect(revoked).toBe(false);
      await approveRiskConfirmation(page, locale, 'destructive');
      await confirm.click();
      const stepUp = dialog.locator('input[type=password]');
      await expect(stepUp).toBeFocused();
      expect(revoked).toBe(false);
      await stepUp.fill(password);
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByText(securitySettingsText('confirmed', locale), { exact: true })
      ).toBeVisible();
      await expect(page.getByText(current, { exact: true })).toBeVisible();
      await expect(trigger).toHaveCount(0);
      await previousPage.reload();
      await expect(previousPage).toHaveURL(/\/login$/);
      await expect(previousPage.locator('#username')).toBeVisible();
      await expect(previousPage.getByText(current, { exact: true })).toHaveCount(0);
      await page.reload();
      await expect(page.getByText(current, { exact: true })).toBeVisible();
      expect(steps).toEqual([
        'password',
        'rejected-otp',
        'verified-otp',
        'step-up-required',
        'step-up',
        'revoked',
      ]);
    } finally {
      await previous.close();
    }
  });
}
