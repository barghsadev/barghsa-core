import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';

const profileId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';
async function setup(page: Page, locale: string) {
  await page.addInitScript((value) => {
    const apply = () => {
      if (document.documentElement) document.documentElement.lang = value;
    };
    apply();
    new MutationObserver(apply).observe(document, { childList: true });
  }, locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({ json: { userId: profileId, requiresTosAcceptance: false } })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [{ id: profileId, profileType: 'INDIVIDUAL', title: 'Wallet account' }],
        activeProfileId: profileId,
        hasDefault: true,
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'UTC' } })
  );
  let balance = '0';
  await page.route(`**/api/wallet/${profileId}`, (route) =>
    route.fulfill({ json: { balance, currency: 'IRR', onlineTopUpLimit: 2000000000 } })
  );
  await page.goto(`/wallet?paymentOrderId=${orderId}&paymentAuthority=auth-1`);
  await expect(page.getByTestId('payment-return')).toBeVisible();
  await page
    .context()
    .addCookies([{ name: 'barghsa_csrf', value: 'csrf-before', url: new URL(page.url()).origin }]);
  return {
    credit: () => {
      balance = '1000';
    },
  };
}

for (const locale of ['en', 'fa']) {
  test(`payment return waits for customer action and retries a lost result with current CSRF (${locale})`, async ({
    page,
  }) => {
    const { credit } = await setup(page, locale);
    const requests: { method: string; csrf: string | undefined; body: unknown }[] = [];
    await page.route('**/api/wallet/top-ups/return', (route) => {
      const req = route.request();
      requests.push({
        method: req.method(),
        csrf: req.headers()['x-csrf-token'],
        body: req.postDataJSON(),
      });
      credit();
      return requests.length === 1
        ? route.abort('failed')
        : route.fulfill({ json: { ok: true, credited: true, transactionId: orderId } });
    });
    await expect(page.getByTestId('wallet-loaded')).toBeVisible();
    expect(requests).toHaveLength(0);
    await expect(page.getByTestId('payment-return').locator('button')).toHaveText(
      locale === 'fa' ? 'بررسی پرداخت' : 'Check payment'
    );
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="payment-return"]').analyze())
        .violations
    ).toEqual([]);
    await page.getByTestId('payment-return-check').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('payment-return-status')).toHaveAttribute('role', 'alert');
    await page
      .context()
      .addCookies([{ name: 'barghsa_csrf', value: 'csrf-after', url: new URL(page.url()).origin }]);
    await page.getByTestId('payment-return-check').click();
    await expect(page.getByTestId('payment-return-check')).toHaveCount(0);
    await expect(page.getByTestId('payment-return-status')).toHaveText(
      locale === 'fa'
        ? 'پرداخت تأیید شد و مبلغ به کیف پول اضافه شد.'
        : 'Payment confirmed and added to your wallet.'
    );
    expect(requests).toEqual([
      { method: 'POST', csrf: 'csrf-before', body: { orderId, authority: 'auth-1' } },
      { method: 'POST', csrf: 'csrf-after', body: { orderId, authority: 'auth-1' } },
    ]);
    await expect(page.getByTestId('wallet-balance')).toContainText(
      locale === 'fa' ? '۱٬۰۰۰' : '1,000'
    );
    await expect(page.getByTestId('wallet-page')).toHaveAttribute(
      'dir',
      locale === 'fa' ? 'rtl' : 'ltr'
    );
  });

  test(`payment return retains retry after sign-in, unpaid and malformed responses (${locale})`, async ({
    page,
  }) => {
    await setup(page, locale);
    let attempt = 0;
    await page.route('**/api/wallet/top-ups/return', (route) => {
      attempt++;
      if (attempt === 1) return route.fulfill({ status: 401, json: {} });
      return route.fulfill({
        json: {
          ok: true,
          credited: attempt !== 2,
          transactionId: attempt === 2 ? orderId : 'wrong-order',
        },
      });
    });
    const button = page.getByTestId('payment-return-check');
    await button.click();
    const login = page.getByTestId('payment-return').locator('a');
    await expect(login).toHaveAttribute('href', '/login');
    await expect(login).toHaveAttribute('target', '_blank');
    await button.click();
    await expect(page.getByTestId('payment-return-status')).toHaveText(
      locale === 'fa'
        ? 'درگاه هنوز پرداخت را تأیید نکرده است. می‌توانید دوباره بررسی کنید.'
        : 'The provider has not confirmed payment. You can check again.'
    );
    await button.click();
    await expect(page.getByTestId('payment-return-status')).toHaveAttribute('role', 'alert');
    await expect(button).toBeEnabled();
    await expect(page.getByTestId('wallet-balance')).toContainText(locale === 'fa' ? '۰' : '0');
  });
}
