import type { Page, Locator } from './coverage-fixture';
import { t } from '@barghsa/i18n/admin-ui';
export async function mockOtpStepUp(page: Page, rejectFirst = false) {
  const state = { verified: false, verifies: 0 };
  await page.route('**/api/auth/step-up/otp/send', (route) =>
    route.fulfill({
      json: {
        challengeId: '00000000-0000-4000-8000-000000000001',
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        channel: 'email',
      },
    })
  );
  await page.route('**/api/auth/step-up/otp/verify', async (route) => {
    const body = route.request().postDataJSON();
    if (body.code !== '123456' || (rejectFirst && ++state.verifies === 1))
      return route.fulfill({ status: 401, json: { error: { code: 'AUTH:OTP_INVALID' } } });
    state.verified = true;
    // WebKit does not persist Set-Cookie from mocked responses. Model the
    // verified server cookie before releasing the response to the application.
    await page.context().addCookies([
      {
        name: 'barghsa_csrf',
        value: 'rotated-otp-proof',
        url: new URL(route.request().url()).origin,
      },
    ]);
    return route.fulfill({
      headers: { 'set-cookie': 'barghsa_csrf=rotated-otp-proof; Path=/; SameSite=Strict' },
      json: { verified: true, stepUpVerifiedAt: new Date().toISOString() },
    });
  });
  return state;
}
export async function completeOtp(dialog: Locator, locale: 'en' | 'fa') {
  const text = (key: string) => t(`admin.stepUp.${key}`, locale);
  await dialog.getByRole('button', { name: text('send'), exact: true }).click();
  await dialog.getByLabel(text('code'), { exact: true }).fill('123456');
  await dialog.getByRole('button', { name: text('verify'), exact: true }).click();
}
