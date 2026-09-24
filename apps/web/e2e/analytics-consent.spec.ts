import { test, expect } from './coverage-fixture';
import { shellText } from '@barghsa/i18n/shell';

for (const locale of ['fa', 'en'] as const) {
  test(`optional analytics require account consent (${locale})`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    let consent: boolean | null = null;
    const events: unknown[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({ json: { userId: 'owner', requiresTosAcceptance: false } })
    );
    await page.route('**/api/profiles', (route) =>
      route.fulfill({
        json: {
          profiles: [{ id: 'profile', isDefault: true }],
          hasDefault: true,
          activeProfileId: 'profile',
        },
      })
    );
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'Asia/Tehran' } })
    );
    await page.route('**/api/user/analytics/consent', async (route) => {
      if (route.request().method() === 'PUT')
        consent = (route.request().postDataJSON() as { consent: boolean }).consent;
      await route.fulfill({ json: { consent } });
    });
    await page.route('**/api/user/analytics/events', async (route) => {
      events.push(route.request().postDataJSON());
      await route.fulfill({ status: 204, body: '' });
    });

    await page.goto('/dashboard');
    await expect(
      page.getByRole('region', { name: shellText('analyticsTitle', locale) })
    ).toBeVisible();
    expect(events).toEqual([]);
    await page
      .getByRole('button', { name: shellText('analyticsDecline', locale) })
      .first()
      .click();
    await expect(
      page.getByRole('region', { name: shellText('analyticsTitle', locale) })
    ).toHaveCount(0);
    await page.reload();
    expect(events).toEqual([]);

    await page.goto('/settings');
    const settings = page.getByRole('region', { name: shellText('analyticsTitle', locale) });
    await expect(settings).toContainText(shellText('analyticsDeclined', locale));
    await settings.getByRole('button', { name: shellText('analyticsAllow', locale) }).click();
    await expect(settings).toContainText(shellText('analyticsAllowed', locale));
    await expect.poll(() => events.length).toBeGreaterThan(0);
    expect(
      events.every(
        (event) => JSON.stringify(event) === JSON.stringify({ name: 'page_view', area: 'customer' })
      )
    ).toBe(true);
    await settings.getByRole('button', { name: shellText('analyticsDecline', locale) }).click();
    await expect(settings).toContainText(shellText('analyticsDeclined', locale));
    const count = events.length;
    await page.goto('/dashboard');
    expect(events).toHaveLength(count);
  });
}
