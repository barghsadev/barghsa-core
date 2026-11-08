import { mockPublicAuthCsrf } from './public-auth-fixture';
import { test, expect, type Page, type Route } from './coverage-fixture';
import { t } from '@barghsa/i18n/auth';
import { passwordRecoveryText } from '@barghsa/i18n/password-recovery-forms';

const password = 'Activated-browser-password-123!';
async function enterPassword(page: Page) {
  await page.locator('#activation-password').fill(password);
  await page.locator('#activation-confirmation').fill(password);
}

for (const locale of ['fa', 'en'] as const) {
  test(`staff activation consumes the fragment token without persisting it (${locale})`, async ({
    page,
  }) => {
    const token = 'a'.repeat(64);
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    await page.route('**/api/auth/activate-staff', (route) =>
      route.fulfill({ json: { activated: true } })
    );
    await page.goto(`/activate#token=${token}`);
    await expect(page).toHaveURL(/\/activate$/);
    await expect(page.locator('#activation-password')).toHaveAttribute('aria-required', 'true');
    await expect(page.locator('#activation-confirmation')).toHaveAttribute('aria-required', 'true');
    await enterPassword(page);
    const submitted = page.waitForRequest('**/api/auth/activate-staff');
    await page.locator('button[type="submit"]').click();
    expect((await submitted).postDataJSON()).toEqual({
      token,
      newPassword: password,
    });
    await expect(page.getByRole('status')).toContainText(locale === 'fa' ? 'وارد شوید' : 'Sign in');
    await expect(page.locator('#activation-password')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain(token);
  });

  test(`activation requires a verified receipt and a fresh link after an uncertain response (${locale})`, async ({
    page,
  }, info) => {
    const heldToken = 'b'.repeat(64);
    const malformedToken = 'c'.repeat(64);
    const freshToken = 'd'.repeat(64);
    const writes: unknown[] = [];
    let held: Route | undefined;
    if (locale === 'fa') await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    await page.clock.install();
    await page.route('**/api/auth/activate-staff', (route) => {
      const request = route.request();
      expect(request.headers()['x-csrf-token']).toBe('c'.repeat(64));
      const payload = request.postDataJSON();
      writes.push(payload);
      if (payload.token === heldToken) {
        held = route;
        return;
      }
      return route.fulfill({ json: { activated: payload.token === freshToken ? true : 'true' } });
    });
    const submit = page.getByRole('button', { name: t('auth.activate.submit', locale) });
    const alert = page
      .getByRole('alert')
      .filter({ hasText: passwordRecoveryText('activationUnconfirmed', locale) });
    const heading = page.getByRole('heading', { name: t('auth.activate.success', locale) });
    const openLink = async (token: string) => {
      await page.evaluate((value) => (window.location.hash = `token=${value}`), token);
      await expect(page).toHaveURL(/\/activate$/);
    };
    await page.goto(`/activate#token=${heldToken}`);
    await enterPassword(page);
    await submit.press('Enter');
    await expect.poll(() => held !== undefined).toBe(true);
    await expect(page.locator('form')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#activation-password')).toBeDisabled();
    await page.locator('form').dispatchEvent('submit');
    await page.clock.fastForward(15_001);
    await expect(alert).toBeVisible();
    await expect(heading).toHaveCount(0);
    await expect(page.locator('form')).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: t('auth.forgotPassword.backToLogin', locale) })
    ).toHaveAttribute('href', '/login');
    if (locale === 'fa')
      await page
        .getByRole('main')
        .screenshot({ path: info.outputPath('activation-unconfirmed-fa.png') });
    await held!.fulfill({ json: { activated: true } }).catch(() => {});
    await openLink(heldToken);
    await expect(alert).toBeVisible();
    expect(writes).toEqual([{ token: heldToken, newPassword: password }]);

    await openLink(malformedToken);
    await expect(page.locator('#activation-password')).toHaveValue('');
    await enterPassword(page);
    await submit.click();
    await expect(alert).toBeVisible();
    await expect(heading).toHaveCount(0);

    await openLink(freshToken);
    await expect(page.locator('#activation-confirmation')).toHaveValue('');
    await enterPassword(page);
    await submit.click();
    await expect(heading).toBeVisible();
    expect(writes).toEqual(
      [heldToken, malformedToken, freshToken].map((token) => ({ token, newPassword: password }))
    );
    const stored = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]));
    for (const secret of [heldToken, malformedToken, freshToken, password])
      expect(stored).not.toContain(secret);
  });
}

test('missing or rejected activation links never show successful activation', async ({ page }) => {
  await page.goto('/activate');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toHaveCount(0);
  await page.route('**/api/auth/activate-staff', (route) =>
    route.fulfill({ status: 401, json: { error: { code: 'AUTH:TOKEN_INVALID' } } })
  );
  await page.goto(`/activate#token=${'b'.repeat(64)}`);
  await enterPassword(page);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('alert')).toContainText('منقضی');
  await expect(page.locator('form')).toHaveCount(0);
});

test.beforeEach(async ({ page }) => {
  await mockPublicAuthCsrf(page);
});
