import { test, expect } from './coverage-fixture';

// Client contract checks; real publication/acceptance is covered by the API HTTP suite.
test('registration shows and submits the same terms version', async ({ page }) => {
  const id = '00000000-0000-4000-8000-000000000001';
  let reads = 0;
  await page.route('**/api/tos/current?*', (route) => {
    reads++;
    return route.fulfill({
      json: { id, versionId: 'consent-v1', content: '**قوانین اول نمایش داده شده**' },
    });
  });
  await page.route('**/api/auth/register', (route) =>
    route.fulfill({ status: 400, json: { error: 'AUTH:REGISTER:TOS_NOT_ACCEPTED' } })
  );
  await page.goto('/register');
  await page.locator('#username').fill('consent@example.test');
  await page.locator('#username').press('Tab');
  await page.locator('#password').fill('Browser-consent-password-123!');
  const initialReads = reads;
  await page.locator('#tos-label button').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('قوانین اول نمایش داده شده');
  await expect(dialog).toContainText('consent-v1');
  await expect(dialog.locator('strong')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#tos-label button')).toBeFocused();
  await page.getByRole('checkbox').click();
  const request = page.waitForRequest('**/api/auth/register');
  await page.locator('button[type="submit"]').click();
  expect((await request).postDataJSON().tosVersionId).toBe(id);
  expect(reads).toBe(initialReads);
});

test('unavailable terms prevent consent and registration', async ({ page }) => {
  await page.route('**/api/tos/current?*', (route) => route.fulfill({ status: 503, json: {} }));
  await page.goto('/register');
  await expect(page.getByRole('checkbox')).toBeDisabled();
  await expect(page.locator('button[type="submit"]')).toBeDisabled();
  await expect(page.getByRole('alert')).toBeVisible();
});

for (const locale of ['en', 'fa']) {
  test(`public terms use Tehran dates without requiring an account (${locale})`, async ({
    page,
  }) => {
    const stamp = '2026-08-31T22:00:00Z';
    let timezoneReads = 0;
    await page.route('**/api/user/settings/timezone', (route) => {
      timezoneReads++;
      return route.fulfill({ status: 401, json: {} });
    });
    await page.route('**/api/tos/current?*', (route) =>
      route.fulfill({
        json: { versionId: 'v1', content: 'Public terms', updatedAt: stamp, publishedAt: stamp },
      })
    );
    await page.goto(`/terms?lang=${locale}`);
    await expect(page.getByRole('article')).toContainText(
      new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Tehran', dateStyle: 'long' }).format(
        new Date(stamp)
      )
    );
    expect(timezoneReads).toBe(0);
  });
}

for (const locale of ['fa', 'en']) {
  test(`public terms render formatting without executing embedded markup (${locale})`, async ({
    page,
  }) => {
    await page.route('**/api/tos/current?*', (route) =>
      route.fulfill({
        json: {
          id: 'formatted-terms',
          versionId: 'v1',
          updatedAt: '2026-09-01T00:00:00Z',
          publishedAt: '2026-09-01T00:00:00Z',
          content:
            '## Published heading\n\n**Important**\n\n- First rule\n- Second rule\n\n<script>alert(1)</script>\n\n[Unsafe](javascript:alert(1))',
        },
      })
    );
    await page.goto(`/terms?lang=${locale}`);
    const article = page.getByRole('article');
    await expect(article.getByRole('heading', { name: 'Published heading' })).toBeVisible();
    await expect(article.locator('strong')).toHaveText('Important');
    await expect(article.getByRole('listitem')).toHaveCount(2);
    await expect(article.locator('script')).toHaveCount(0);
    await expect(article.locator('a[href^="javascript:"]')).toHaveCount(0);
    await expect(article.locator('[lang]').last()).toHaveAttribute(
      'dir',
      locale === 'fa' ? 'rtl' : 'ltr'
    );
  });
}

for (const locale of ['en', 'fa']) {
  test(`public terms reject malformed content and recover through retry (${locale})`, async ({
    page,
  }) => {
    let valid = false;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/tos/current?*', (route) =>
      route.fulfill({
        json: {
          versionId: 'v1',
          content: valid ? 'Recovered public terms' : { invalid: true },
          updatedAt: '2026-09-01T00:00:00Z',
          publishedAt: '2026-09-01T00:00:00Z',
        },
      })
    );
    await page.goto(`/terms?lang=${locale}`);
    const retry = page.getByRole('button', {
      name: locale === 'fa' ? 'دریافت دوباره شرایط' : 'Retry loading terms',
      exact: true,
    });
    await expect(retry).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(0);
    expect(errors).toEqual([]);
    valid = true;
    await retry.click();
    await expect(page.getByRole('article')).toContainText('Recovered public terms');
    await expect(retry).toHaveCount(0);
  });
}

test('public terms language changes discard stale content after a failed read', async ({
  page,
}) => {
  await page.route('**/api/tos/current?*', (route) =>
    new URL(route.request().url()).searchParams.get('locale') === 'en'
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({
          json: {
            versionId: 'v1',
            content: 'شرایط فارسی قبلی',
            updatedAt: '2026-09-01T00:00:00Z',
            publishedAt: '2026-09-01T00:00:00Z',
          },
        })
  );
  await page.goto('/terms');
  await expect(page.getByRole('article')).toContainText('شرایط فارسی قبلی');
  await page.getByRole('link', { name: 'English', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retry loading terms', exact: true })
  ).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByText('شرایط فارسی قبلی')).toHaveCount(0);
  await page.getByRole('link', { name: 'فارسی', exact: true }).click();
  await expect(page.getByRole('article')).toContainText('شرایط فارسی قبلی');
});
