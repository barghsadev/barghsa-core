import type { Page } from '@playwright/test';
import { t } from '@barghsa/i18n/admin-ui';
export async function providerOtpSend(page: Page) {
  await page.route('**/api/auth/step-up/otp/send', (route) =>
    route.fulfill({
      json: {
        challengeId: '00000000-0000-4000-8000-000000000001',
        channel: 'email',
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      },
    })
  );
}
export async function startProviderOtp(page: Page, locale: 'en' | 'fa') {
  await page
    .getByRole('dialog')
    .getByRole('button', { name: t('admin.stepUp.send', locale), exact: true })
    .click();
}
export const providerOtpProof = () => ({
  verified: true,
  stepUpVerifiedAt: new Date().toISOString(),
});
