import { test, expect } from './coverage-fixture';
for (const locale of ['en', 'fa'])
  for (const area of ['admin', 'customer']) {
    test(`shell navigation works on mobile and desktop (${area}, ${locale})`, async ({ page }) => {
      const fa = locale === 'fa';
      await page.addInitScript((value) => {
        new MutationObserver(() => {
          if (document.documentElement) document.documentElement.lang = value;
        }).observe(document, { childList: true });
      }, locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/admin/failed-notifications/access', (route) =>
        route.fulfill({ json: { canView: true, canRetry: false } })
      );
      await page.route('**/api/admin/failed-notifications?*', (route) =>
        route.fulfill({ json: [] })
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(area === 'admin' ? '/admin/failed-notifications' : '/dashboard');
      const nav = page.locator(area === 'admin' ? '#admin-navigation' : '#dashboard-navigation');
      const menu = page.getByRole('button', { name: fa ? 'فهرست' : 'Menu', exact: true });
      await expect(nav).toBeHidden();
      await expect(menu).toHaveAttribute('aria-expanded', 'false');
      await menu.focus();
      await page.keyboard.press('Enter');
      await expect(nav).toBeVisible();
      await expect(menu).toHaveAttribute('aria-expanded', 'true');
      if (area === 'admin') {
        await expect(
          nav.getByRole('link', {
            name: fa ? 'نقش‌ها و مجوزها' : 'Roles & Permissions',
            exact: true,
          })
        ).toBeVisible();
        await expect(
          nav.getByRole('link', { name: fa ? 'پروفایل‌های مشتریان' : 'CRM Profiles', exact: true })
        ).toBeVisible();
      }
      await menu.click();
      await expect(nav).toBeHidden();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      const skip = page.getByRole('link', {
        name: fa ? 'رفتن به محتوای اصلی' : 'Skip to main content',
      });
      await skip.focus();
      await page.keyboard.press('Enter');
      await expect(
        page.locator(area === 'admin' ? '#admin-content' : '#dashboard-content')
      ).toBeFocused();
      await page.setViewportSize({ width: 1280, height: 720 });
      await expect(menu).toBeHidden();
      await expect(nav).toBeVisible();
      if (area === 'admin') {
        await nav
          .getByRole('link', { name: fa ? 'پروفایل‌های مشتریان' : 'CRM Profiles', exact: true })
          .focus();
        const box = await nav
          .getByRole('link', { name: fa ? 'پروفایل‌های مشتریان' : 'CRM Profiles', exact: true })
          .boundingBox();
        expect(box!.y + box!.height).toBeLessThanOrEqual(720);
      }
    });
  }

for (const locale of ['en', 'fa'])
  test(`admin terms dialog uses the active language (${locale})`, async ({ page }) => {
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    let requestedLocale: string | null = null;
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: { requiresTosAcceptance: true, userId: 'test-user', username: 'Test' },
      })
    );
    await page.route('**/api/tos/current?*', (route) => {
      requestedLocale = new URL(route.request().url()).searchParams.get('locale');
      return route.fulfill({
        json: {
          id: 'test-version',
          versionId: 'v1',
          content: '**' + (locale === 'fa' ? 'شرایط آزمایشی' : 'Test terms') + '**',
          updatedAt: '2026-09-01T00:00:00Z',
          publishedAt: '2026-09-01T00:00:00Z',
        },
      });
    });
    await page.goto('/admin/failed-notifications');
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', {
        name: locale === 'fa' ? 'قوانین استفاده' : 'Terms of Service',
        exact: true,
      })
    ).toBeVisible();
    await expect(dialog).toContainText(locale === 'fa' ? 'شرایط آزمایشی' : 'Test terms');
    await expect(dialog.locator('strong')).toBeVisible();
    expect(requestedLocale).toBe(locale);
  });

test('terms acceptance waits for the document renderer to load', async ({ page }) => {
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.documentElement) document.documentElement.lang = 'en';
    }).observe(document, { childList: true });
  });
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({ json: { requiresTosAcceptance: true, userId: 'test-user', username: 'Test' } })
  );
  await page.route('**/api/tos/current?*', (route) =>
    route.fulfill({
      json: {
        id: 'delayed-terms',
        versionId: 'v1',
        content: '**Read before accepting**',
        updatedAt: '2026-09-01T00:00:00Z',
        publishedAt: '2026-09-01T00:00:00Z',
      },
    })
  );
  let release!: () => void;
  const pending = new Promise<void>((done) => {
    release = done;
  });
  await page.route('**/assets/TosContent-*.js', async (route) => {
    await pending;
    await route.continue();
  });
  try {
    await page.goto('/admin/failed-notifications', { waitUntil: 'domcontentloaded' });
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('status')).toHaveText('Loading terms of service...');
    await expect(dialog.getByRole('button', { name: 'I Accept', exact: true })).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.getByRole('dialog').locator('strong')).toHaveText('Read before accepting');
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'I Accept', exact: true })
  ).toBeEnabled();
});

for (const path of ['/tickets', '/invoices', '/invoices/record-one', '/admin/tickets']) {
  test(`terms modal waits for manual review on exempt record/support route ${path}`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = 'en';
      }).observe(document, { childList: true });
    });
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: { requiresTosAcceptance: true, userId: 'test-user', username: 'Test' },
      })
    );
    let termsReads = 0;
    await page.route('**/api/tos/current?*', (route) => {
      termsReads++;
      return route.fulfill({
        json: {
          id: 'exempt-terms',
          versionId: 'v1',
          content: 'Manual review terms',
          updatedAt: '2026-09-01T00:00:00Z',
          publishedAt: '2026-09-01T00:00:00Z',
        },
      });
    });
    await page.goto(path);
    const review = page.getByRole('button', { name: 'Review', exact: true });
    await expect(review).toBeVisible();
    await review.focus();
    await expect(review).toBeFocused();
    expect(termsReads).toBe(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await review.click();
    await expect(page.getByRole('dialog')).toContainText('Manual review terms');
    expect(termsReads).toBe(1);
  });
}

test('malformed terms never enable consent', async ({ page }) => {
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.documentElement) document.documentElement.lang = 'en';
    }).observe(document, { childList: true });
  });
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({ json: { requiresTosAcceptance: true, userId: 'test-user', username: 'Test' } })
  );
  await page.route('**/api/tos/current?*', (route) =>
    route.fulfill({ json: { versionId: 'v1', content: 'No immutable identity' } })
  );
  await page.goto('/admin/failed-notifications');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('An error occurred while loading the terms of service');
  await expect(dialog.getByRole('button', { name: 'I Accept', exact: true })).toBeDisabled();
});
