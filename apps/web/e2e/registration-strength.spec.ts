import { test, expect, type Page } from './coverage-fixture';

async function openPassword(page: Page, locale: string) {
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/tos/current?*', (route) =>
    route.fulfill({
      json: { id: '00000000-0000-4000-8000-000000000001', versionId: 'v1', content: 'Terms' },
    })
  );
  await page.goto('/register');
  await page.evaluate((lang) => {
    document.documentElement.lang = lang;
  }, locale);
  await page.locator('#username').fill('strength@example.test');
  await page.locator('#username').press('Tab');
  await expect(page.locator('#password')).toBeVisible();
}

for (const locale of ['en', 'fa']) {
  const weak = locale === 'fa' ? 'ضعیف' : 'Weak';
  const strong = locale === 'fa' ? 'قوی' : 'Strong';
  const secret = 'kV9!zmQ2#xrD7@pL4';
  test(`password strength detects patterns locally without changing the minimum policy (${locale})`, async ({
    page,
  }) => {
    await openPassword(page, locale);
    const requests: { url: string; body: string }[] = [];
    page.on('request', (request) =>
      requests.push({ url: request.url(), body: request.postData() ?? '' })
    );
    const password = page.locator('#password');
    const meter = page.getByRole('progressbar');
    await password.fill('Password123!');
    await expect(meter).toHaveAttribute('aria-busy', 'false');
    await expect(meter).toHaveAttribute('aria-valuetext', weak);
    await page.getByRole('checkbox').click();
    // Strength feedback advises; the same server minimum still controls submission.
    await expect(page.locator('button[type=submit]')).toBeEnabled();
    await password.fill(secret);
    await expect(meter).toHaveAttribute('aria-valuetext', strong);
    await expect(meter).toHaveAttribute('aria-valuenow', '100');
    await password.fill('');
    await expect(meter).toHaveAttribute('aria-valuenow', '0');
    await expect(meter).toHaveAttribute('aria-valuetext', weak);
    const origin = new URL(page.url()).origin;
    expect(
      requests.every(
        ({ url, body }) =>
          new URL(url).origin === origin && !url.includes(secret) && !body.includes(secret)
      )
    ).toBe(true);
  });

  test(`password strength loads on use and ignores an earlier value during loading (${locale})`, async ({
    page,
  }) => {
    let requested = false;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/assets/password-strength-*.js', async (route) => {
      requested = true;
      await pending;
      await route.continue();
    });
    await openPassword(page, locale);
    expect(requested).toBe(false);
    const password = page.locator('#password');
    const meter = page.getByRole('progressbar');
    try {
      await password.fill('Password123!');
      await expect.poll(() => requested).toBe(true);
      await expect(meter).toHaveAttribute('aria-busy', 'true');
      await password.fill(secret);
    } finally {
      release();
    }
    await expect(meter).toHaveAttribute('aria-busy', 'false');
    await expect(meter).toHaveAttribute('aria-valuetext', strong);
    await password.press('Tab');
    await expect(page.locator('#password-strength')).toBeHidden();
  });

  test(`password strength reports a failed download and recovers after reload (${locale})`, async ({
    page,
  }) => {
    await page.route('**/assets/password-strength-*.js', (route) => route.abort());
    await openPassword(page, locale);
    await page.locator('#password').fill(secret);
    const meter = page.getByRole('progressbar');
    await expect(meter).toHaveAttribute(
      'aria-valuetext',
      locale === 'fa' ? 'قدرت رمز در دسترس نیست' : 'Strength unavailable'
    );
    await expect(meter).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#password')).toHaveValue(secret);
    await page.unroute('**/assets/password-strength-*.js');
    await page.reload();
    await page.locator('#username').fill('strength@example.test');
    await page.locator('#username').press('Tab');
    await page.locator('#password').fill(secret);
    await expect(meter).toHaveAttribute('aria-valuenow', '100');
  });
}
