import { test, expect, type Page } from '@playwright/test';

async function shell(page: Page, locale = 'en') {
  await page.addInitScript((value) => {
    new MutationObserver(() => {
      if (document.documentElement) document.documentElement.lang = value;
    }).observe(document, { childList: true });
  }, locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [
          {
            id: 'profile-one',
            profileType: 'LEGAL',
            status: 'ACTIVE',
            title: 'Profile',
            isDefault: true,
          },
        ],
        activeProfileId: 'profile-one',
        hasDefault: true,
      },
    })
  );
}

for (const locale of ['en', 'fa']) {
  test(`address dialog labels, focus trap and Escape (${locale})`, async ({ page }) => {
    await shell(page, locale);
    await page.route('**/api/profiles/profile-one/addresses', (route) =>
      route.fulfill({ json: { addresses: [] } })
    );
    await page.route('**/api/geography/provinces', (route) => route.fulfill({ json: [] }));
    await page.goto('/settings/addresses');
    const add = page.getByRole('button', {
      name: locale === 'fa' ? 'افزودن آدرس' : 'Add Address',
      exact: true,
    });
    await add.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', {
      name: locale === 'fa' ? 'آدرس جدید' : 'New Address',
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox')).toHaveCount(2);
    const controls = dialog.locator('select, textarea, input');
    for (const control of await controls.all()) {
      await expect(control).toHaveAccessibleName(/.+/);
    }
    for (let index = 0; index < 10; index++) {
      await page.keyboard.press('Tab');
      await expect
        .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
        .toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();
  });
}

test('TOS detail has a name, contains keyboard focus and restores its trigger', async ({
  page,
}) => {
  await shell(page);
  await page.route('**/api/admin/tos/versions', (route) =>
    route.fulfill({
      json: [
        {
          id: 'version-one',
          versionId: 'v1',
          contentFa: 'شرایط',
          contentEn: 'Terms',
          changeType: 'minor',
          status: 'published',
          isActive: true,
          publishedAt: '2026-09-01T00:00:00Z',
          createdAt: '2026-09-01T00:00:00Z',
          updatedAt: '2026-09-01T00:00:00Z',
          createdBy: null,
        },
      ],
    })
  );
  await page.goto('/admin/tos');
  const view = page.getByRole('button', { name: 'View', exact: true });
  await view.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'TOS Version: v1' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'English', exact: true }).click();
  await expect(dialog.getByText('Terms', { exact: true })).toBeVisible();
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press('Tab');
    await expect
      .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
      .toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(view).toBeFocused();
});

test('branding controls have distinct labels and color IDs', async ({ page }) => {
  await shell(page);
  await page.route('**/api/admin/branding/config', (route) =>
    route.fulfill({
      json: {
        id: 'branding-one',
        version: 1,
        status: 'active',
        config: {
          appTitle: 'Barghsa',
          slogan: '',
          primaryColor: '#2563eb',
          secondaryColor: '#64748b',
          accentColor: '#f59e0b',
          logoUrl: null,
          faviconUrl: null,
          darkMode: false,
        },
      },
    })
  );
  await page.goto('/admin/branding');
  await expect(page.getByRole('textbox', { name: 'App Title', exact: true })).toHaveValue(
    'Barghsa'
  );
  for (const control of await page.locator('main input').all()) {
    await expect(control).toHaveAccessibleName(/.+/);
  }
  const ids = await page
    .locator('input[type=color]')
    .evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(ids).toHaveLength(3);
  expect(new Set(ids).size).toBe(3);
  const toggle = page.getByRole('checkbox', { name: 'Dark mode' });
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toBeChecked();
});

for (const locale of ['en', 'fa']) {
  test(`province changes clear the selected city and ignore late results (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    await page.route('**/api/profiles/profile-one/addresses', (route) =>
      route.fulfill({
        json: {
          addresses: [
            {
              id: 'saved',
              provinceId: 'province-one',
              cityId: 'city-one',
              fullAddress: 'Stored street',
              provinceNameFa: 'استان ذخیره‌شده',
              provinceNameEn: 'Saved Province',
              cityNameFa: 'شهر ذخیره‌شده',
              cityNameEn: 'Saved City',
              postalCode: '1234567890',
              mainAddress: true,
            },
          ],
        },
      })
    );
    await page.route('**/api/geography/provinces', (route) =>
      route.fulfill({
        json: [
          { id: 'province-one', nameFa: 'یک', nameEn: 'One' },
          { id: 'province-two', nameFa: 'دو', nameEn: 'Two' },
        ],
      })
    );
    let fail = false;
    await page.route('**/api/geography/provinces/province-one/cities', (route) =>
      route.fulfill(
        fail
          ? { status: 503, json: {} }
          : {
              json: [
                {
                  id: 'city-one',
                  provinceId: 'province-one',
                  nameFa: 'شهر یک',
                  nameEn: 'City One',
                },
              ],
            }
      )
    );
    let delayed: import('@playwright/test').Route | undefined;
    await page.route('**/api/geography/provinces/province-two/cities', (route) => {
      delayed = route;
    });
    await page.goto('/settings/addresses');
    await expect(
      page.getByText(
        locale === 'fa' ? 'استان ذخیره‌شده، شهر ذخیره‌شده' : 'Saved Province، Saved City'
      )
    ).toBeVisible();
    await page
      .getByRole('button', { name: locale === 'fa' ? 'افزودن آدرس' : 'Add Address', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    const province = dialog.getByRole('combobox').nth(0);
    const city = dialog.getByRole('combobox').nth(1);
    await province.selectOption('province-one');
    await expect(city).toBeEnabled();
    await city.selectOption('city-one');
    await province.selectOption('province-two');
    await expect(city).toHaveValue('');
    await expect(city).toBeDisabled();
    await expect.poll(() => !!delayed).toBe(true);
    fail = true;
    await province.selectOption('province-one');
    await expect(dialog.getByRole('alert')).toContainText(
      locale === 'fa' ? 'بارگذاری شهرها با خطا مواجه شد' : 'Failed to load cities'
    );
    fail = false;
    await dialog
      .getByRole('button', { name: locale === 'fa' ? 'تلاش دوباره' : 'Try again' })
      .click();
    await expect(city).toBeEnabled();
    await city.selectOption('city-one');
    // The earlier request may already have been cancelled by AbortController.
    await delayed!
      .fulfill({
        json: [
          { id: 'city-two', provinceId: 'province-two', nameFa: 'شهر دو', nameEn: 'City Two' },
        ],
      })
      .catch(() => {});
    await expect(city).toHaveValue('city-one');
    await expect(city.getByRole('option')).toHaveCount(2);
    await expect(province).toHaveValue('province-one');
  });
}
