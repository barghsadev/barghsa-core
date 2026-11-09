import { mockPublicAuthCsrf } from './public-auth-fixture';
import { test, expect, type Page, type Route } from './coverage-fixture';
import { t } from '@barghsa/i18n/auth';
import { passwordRecoveryText } from '@barghsa/i18n/password-recovery-forms';
import { createHash } from 'node:crypto';

const password = 'Activated-browser-password-123!';
function invite(character: string) {
  const token = `v2_${character.repeat(64)}`;
  return { token, invitation: createHash('sha256').update(token).digest('hex') };
}
async function enterActivation(page: Page, token: string) {
  await page.locator('#activation-code').fill(token);
  await page.locator('#activation-password').fill(password);
  await page.locator('#activation-confirmation').fill(password);
}

for (const locale of ['fa', 'en'] as const) {
  test(`staff activation submits the separately entered code without persisting it (${locale})`, async ({
    page,
  }) => {
    const proof = invite('a');
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    await page.route('**/api/auth/activate-staff', (route) =>
      route.fulfill({ json: { activated: true } })
    );
    await page.goto(`/activate#invitation=${proof.invitation}`);
    await expect(page).toHaveURL(/\/activate$/);
    await expect(page.locator('#activation-code')).toHaveValue('');
    await expect(page.locator('#activation-code')).toHaveAttribute('aria-required', 'true');
    await expect(page.locator('#activation-password')).toHaveAttribute('aria-required', 'true');
    await expect(page.locator('#activation-confirmation')).toHaveAttribute('aria-required', 'true');
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
    await enterActivation(page, proof.token);
    const submitted = page.waitForRequest('**/api/auth/activate-staff');
    await page.locator('button[type="submit"]').click();
    expect((await submitted).postDataJSON()).toEqual({
      ...proof,
      newPassword: password,
    });
    await expect(page.getByRole('status')).toContainText(locale === 'fa' ? 'وارد شوید' : 'Sign in');
    await expect(page.locator('#activation-password')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain(proof.token);
  });

  test(`activation requires a verified receipt and a fresh link after an uncertain response (${locale})`, async ({
    page,
  }, info) => {
    const heldProof = invite('b');
    const malformedProof = invite('c');
    const freshProof = invite('d');
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
      if (payload.token === heldProof.token) {
        held = route;
        return;
      }
      return route.fulfill({
        json: { activated: payload.token === freshProof.token ? true : 'true' },
      });
    });
    const submit = page.getByRole('button', { name: t('auth.activate.submit', locale) });
    const alert = page
      .getByRole('alert')
      .filter({ hasText: passwordRecoveryText('activationUnconfirmed', locale) });
    const heading = page.getByRole('heading', { name: t('auth.activate.success', locale) });
    const openLink = async (reference: string) => {
      await page.evaluate((value) => (window.location.hash = `invitation=${value}`), reference);
      await expect(page).toHaveURL(/\/activate$/);
    };
    await page.goto(`/activate#invitation=${heldProof.invitation}`);
    await enterActivation(page, heldProof.token);
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
    await openLink(heldProof.invitation);
    await expect(alert).toBeVisible();
    expect(writes).toEqual([{ ...heldProof, newPassword: password }]);

    await openLink(malformedProof.invitation);
    await expect(page.locator('#activation-code')).toHaveValue('');
    await expect(page.locator('#activation-password')).toHaveValue('');
    await enterActivation(page, malformedProof.token);
    await submit.click();
    await expect(alert).toBeVisible();
    await expect(heading).toHaveCount(0);

    await openLink(freshProof.invitation);
    await expect(page.locator('#activation-confirmation')).toHaveValue('');
    await enterActivation(page, freshProof.token);
    await submit.click();
    await expect(heading).toBeVisible();
    expect(writes).toEqual(
      [heldProof, malformedProof, freshProof].map((proof) => ({ ...proof, newPassword: password }))
    );
    const stored = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]));
    for (const secret of [heldProof.token, malformedProof.token, freshProof.token, password])
      expect(stored).not.toContain(secret);
  });
}

test('missing or rejected activation links never show successful activation', async ({ page }) => {
  await page.goto('/activate');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toHaveCount(0);
  await page.goto(`/activate#token=${'b'.repeat(64)}`);
  await expect(page).toHaveURL(/\/activate$/);
  await expect(page.locator('form')).toHaveCount(0);
  await page.route('**/api/auth/activate-staff', (route) =>
    route.fulfill({ status: 401, json: { error: { code: 'AUTH:TOKEN_INVALID' } } })
  );
  const proof = invite('b');
  await page.goto(`/activate#invitation=${proof.invitation}`);
  await enterActivation(page, proof.token);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('alert')).toContainText('منقضی');
  await expect(page.locator('form')).toHaveCount(0);
});

test.beforeEach(async ({ page }) => {
  await mockPublicAuthCsrf(page);
});
