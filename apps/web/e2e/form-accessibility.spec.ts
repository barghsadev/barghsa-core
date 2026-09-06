import { test, expect, type Page } from '@playwright/test';

async function shell(page: Page, locale = 'en') {
  await page.addInitScript((value) => {
    new MutationObserver(() => {
      if (document.documentElement) document.documentElement.lang = value;
    }).observe(document, { childList: true });
  }, locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  let draft = { version: 0, data: {} as Record<string, string> };
  await page.route('**/api/onboarding/draft/*', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: draft });
    const input = route.request().postDataJSON() as {
      expectedVersion: number;
      data: Record<string, string>;
    };
    if (input.expectedVersion !== draft.version) return route.fulfill({ status: 409, json: {} });
    draft = { version: draft.version + 1, data: input.data };
    return route.fulfill({ json: draft });
  });
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

for (const locale of ['en', 'fa']) {
  test(`legal onboarding requires official address and clears a city after province changes (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    await page.route('**/api/geography/provinces', (route) =>
      route.fulfill({
        json: [
          { id: 'province-a', nameFa: 'استان الف', nameEn: 'Province A' },
          { id: 'province-b', nameFa: 'استان ب', nameEn: 'Province B' },
        ],
      })
    );
    await page.route('**/api/geography/company-types', (route) =>
      route.fulfill({ json: [{ id: 'limited-liability', nameFa: 'شرکت', nameEn: 'Company' }] })
    );
    await page.route('**/api/geography/provinces/*/cities', (route) =>
      route.fulfill({
        json: [
          {
            id: route.request().url().includes('province-a') ? 'city-a' : 'city-b',
            nameFa: 'شهر',
            nameEn: 'City',
          },
        ],
      })
    );
    const documentKey = 'uploads/document/11111111-1111-4111-8111-111111111111.pdf';
    await page.route('**/api/upload/presigned-url', (route) =>
      route.fulfill({ json: { key: documentKey, presignedUrl: '/test-legal-upload' } })
    );
    await page.route('**/test-legal-upload', (route) => route.fulfill({ status: 200 }));
    await page.route('**/api/upload/*/verify', (route) =>
      route.fulfill({ json: { status: 'confirmed' } })
    );
    await page.route('**/api/upload/*/record', (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        purpose: 'legal_profile_document',
        profileId: 'profile-one',
      });
      return route.fulfill({ json: { status: 'recorded' } });
    });
    let submissions = 0;
    await page.route('**/api/onboarding/legal/*', (route) => {
      submissions++;
      expect(route.request().postDataJSON().draftVersion).toBeGreaterThan(0);
      expect(route.request().postDataJSON().documents).toEqual([documentKey]);
      return route.fulfill({ status: 400, json: { message: 'Test response' } });
    });
    await page.goto('/onboarding/legal/profile-one');
    await page.locator('#legalName').fill('Company');
    await page.locator('#nationalIdentifier').fill('12345678901');
    await page.locator('#registrationNumber').fill('123');
    await page.locator('#companyTypeId').selectOption('limited-liability');
    await page.locator('#representativeFirstName').fill('Person');
    await page.locator('#representativeLastName').fill('Owner');
    await page.locator('#representativeNationalId').fill('1234567891');
    await page.locator('#representativeProvinceId').selectOption('province-a');
    await page.locator('#representativeCityId').selectOption('city-a');
    await page.locator('#representativeFullAddress').fill('Representative Street');
    await page.locator('#representativePostalCode').fill('1234567890');
    await page.locator('#representativeTitle').fill('CEO');
    await page.locator('#representativeRelationship').fill('director');
    await page.locator('button[type="submit"]').click();
    expect(submissions).toBe(0);
    await expect(
      page.getByText(locale === 'fa' ? 'آدرس کامل الزامی است' : 'Full address is required', {
        exact: true,
      })
    ).toBeVisible();
    await page.locator('#officialProvinceId').selectOption('province-a');
    await page.locator('#officialCityId').selectOption('city-a');
    await page.locator('#officialProvinceId').selectOption('province-b');
    await expect(page.locator('#officialCityId')).toHaveValue('');
    await expect(page.locator('#officialCityId option[value="city-a"]')).toHaveCount(0);
    await page.locator('#officialCityId').selectOption('city-b');
    await page.locator('#officialFullAddress').fill('Street');
    await page.locator('#officialPostalCode').fill('1234567890');
    await page.locator('#document-upload').setInputFiles({
      name: 'registration.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7 test document'),
    });
    await expect(page.getByText('registration.pdf', { exact: true })).toBeVisible();
    await page.locator('button[type="submit"]').click();
    await expect.poll(() => submissions).toBe(1);
  });
}

for (const locale of ['en', 'fa']) {
  test(`type picker opens the individual form and submits required details (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    await page.route('**/api/onboarding/start', (route) =>
      route.fulfill({ status: 201, json: { profileId: 'profile-one' } })
    );
    await page.route('**/api/geography/provinces', (route) =>
      route.fulfill({ json: [{ id: 'province-one', nameFa: 'استان', nameEn: 'Province' }] })
    );
    await page.route('**/api/geography/provinces/province-one/cities', (route) =>
      route.fulfill({ json: [{ id: 'city-one', nameFa: 'شهر', nameEn: 'City' }] })
    );
    let sent: Record<string, unknown> | undefined;
    await page.route('**/api/onboarding/individual/*', (route) => {
      sent = route.request().postDataJSON();
      return route.fulfill({ status: 400, json: { message: 'Test response' } });
    });
    await page.goto('/onboarding');
    await page
      .getByRole('button')
      .filter({
        has: page.getByRole('heading', {
          name: locale === 'fa' ? 'حقیقی' : 'Individual',
          exact: true,
        }),
      })
      .click();
    await page
      .getByRole('button', { name: locale === 'fa' ? 'ادامه' : 'Continue', exact: true })
      .click();
    await expect(page).toHaveURL(/\/onboarding\/individual\/profile-one$/);
    await expect(page.locator('#firstName')).toHaveAccessibleName(
      locale === 'fa' ? /نام/ : /First Name/i
    );
    await page.locator('#firstName').fill('Person');
    await page.locator('#lastName').fill('Owner');
    await page.locator('#nationalId').fill('1234567891');
    await page.locator('#provinceId').selectOption('province-one');
    await page.locator('#cityId').selectOption('city-one');
    await page.locator('#fullAddress').fill('Street');
    await page.locator('#postalCode').fill('1234567890');
    await page.locator('button[type="submit"]').click();
    await expect
      .poll(() => sent)
      .toMatchObject({
        firstName: 'Person',
        lastName: 'Owner',
        nationalId: '1234567891',
        provinceId: 'province-one',
        cityId: 'city-one',
        fullAddress: 'Street',
        postalCode: '1234567890',
      });
  });
}

for (const locale of ['en', 'fa']) {
  test(`legal autosave preserves later edits, retries failures and restores saved geography (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    let stored = {
      version: 1,
      data: {
        legalName: 'Restored',
        officialProvinceId: 'province-one',
        officialCityId: 'city-one',
        representativeProvinceId: 'province-one',
        representativeCityId: 'city-one',
      } as Record<string, string>,
    };
    let delayed: import('@playwright/test').Route | undefined;
    let hold = true,
      fail = false;
    await page.route('**/api/onboarding/draft/*', async (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: stored });
      if (hold) {
        delayed = route;
        return;
      }
      if (fail) return route.fulfill({ status: 503, json: {} });
      const input = route.request().postDataJSON() as {
        expectedVersion: number;
        data: Record<string, string>;
      };
      expect(input.expectedVersion).toBe(stored.version);
      stored = { version: stored.version + 1, data: input.data };
      return route.fulfill({ json: stored });
    });
    await page.route('**/api/geography/provinces', (route) =>
      route.fulfill({ json: [{ id: 'province-one', nameFa: 'استان', nameEn: 'Province' }] })
    );
    await page.route('**/api/geography/provinces/*/cities', (route) =>
      route.fulfill({ json: [{ id: 'city-one', nameFa: 'شهر', nameEn: 'City' }] })
    );
    await page.route('**/api/geography/company-types', (route) => route.fulfill({ json: [] }));
    await page.goto('/onboarding/legal/profile-one');
    await expect(page.locator('#legalName')).toHaveValue('Restored');
    await expect(page.locator('#officialCityId')).toHaveValue('city-one');
    await expect(page.locator('#representativeCityId')).toHaveValue('city-one');
    await page.locator('#legalName').fill('First edit');
    await expect.poll(() => !!delayed).toBe(true);
    await page.locator('#legalName').fill('Latest edit');
    hold = false;
    const input = delayed!.request().postDataJSON() as { data: Record<string, string> };
    stored = { version: stored.version + 1, data: input.data };
    await delayed!.fulfill({ json: stored });
    await expect.poll(() => stored.data.legalName).toBe('Latest edit');
    await expect(
      page.getByText(locale === 'fa' ? 'پیش‌نویس ذخیره شد' : 'Draft saved', { exact: true })
    ).toBeVisible();
    fail = true;
    await page.locator('#legalName').fill('Retry edit');
    await expect(
      page.getByText(
        locale === 'fa'
          ? 'پیش‌نویس ذخیره نشده است. دوباره تلاش کنید.'
          : 'Draft is not saved. Please retry.',
        { exact: true }
      )
    ).toBeVisible();
    expect(stored.data.legalName).toBe('Latest edit');
    fail = false;
    await page
      .getByRole('button', { name: locale === 'fa' ? 'تلاش دوباره' : 'Retry', exact: true })
      .click();
    await expect.poll(() => stored.data.legalName).toBe('Retry edit');
    await expect(
      page.getByText(locale === 'fa' ? 'پیش‌نویس ذخیره شد' : 'Draft saved', { exact: true })
    ).toBeVisible();
    await page.reload();
    await expect(page.locator('#legalName')).toHaveValue('Retry edit');
    await expect(page.locator('#officialCityId')).toHaveValue('city-one');
  });
}
test('legal autosave stops at a version conflict until the user reloads the saved draft', async ({
  page,
}) => {
  await shell(page);
  let writes = 0;
  await page.route('**/api/onboarding/draft/*', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: { version: writes ? 2 : 1, data: { legalName: writes ? 'Other tab' : 'Initial' } },
      });
    writes++;
    return route.fulfill({ status: 409, json: { error: 'CONFLICT:VERSION_CONFLICT' } });
  });
  await page.route('**/api/geography/provinces', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/geography/company-types', (route) => route.fulfill({ json: [] }));
  await page.goto('/onboarding/legal/profile-one');
  await expect(page.locator('#legalName')).toHaveValue('Initial');
  await page.locator('#legalName').fill('Local edit');
  await expect(
    page.getByText('This draft changed in another tab. Reload the saved version.', { exact: true })
  ).toBeVisible();
  await page.locator('#legalName').fill('Still local');
  await page.locator('#legalName').press('Tab');
  expect(writes).toBe(1);
  await page.getByRole('button', { name: 'Reload saved draft', exact: true }).click();
  await expect(page.locator('#legalName')).toHaveValue('Other tab');
  expect(writes).toBe(1);
});

test('failed draft load leaves fields untouched until retry succeeds', async ({ page }) => {
  await shell(page);
  let fail = true;
  await page.route('**/api/onboarding/draft/*', (route) => {
    expect(route.request().method()).toBe('GET');
    return route.fulfill(
      fail
        ? { status: 503, json: {} }
        : { json: { version: 2, data: { legalName: 'Recovered draft' } } }
    );
  });
  await page.route('**/api/geography/provinces', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/geography/company-types', (route) => route.fulfill({ json: [] }));
  await page.goto('/onboarding/legal/profile-one');
  await expect(page.locator('#legalName')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Reload saved draft', exact: true })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Reload saved draft', exact: true }).click();
  await expect(page.locator('#legalName')).toBeEnabled();
  await expect(page.locator('#legalName')).toHaveValue('Recovered draft');
});

test('legal document upload reports record failures and keeps successful files across reload', async ({
  page,
}) => {
  await shell(page);
  let stored = { version: 0, data: {} as Record<string, string> };
  await page.route('**/api/onboarding/draft/*', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: stored });
    const input = route.request().postDataJSON();
    stored = { version: stored.version + 1, data: input.data };
    return route.fulfill({ json: stored });
  });
  await page.route('**/api/geography/provinces', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/geography/company-types', (route) => route.fulfill({ json: [] }));
  const key = 'uploads/document/11111111-1111-4111-8111-111111111111.pdf';
  await page.route('**/api/upload/presigned-url', (route) =>
    route.fulfill({ json: { key, presignedUrl: '/test-document-put' } })
  );
  await page.route('**/test-document-put', (route) => route.fulfill({ status: 200 }));
  await page.route('**/api/upload/*/verify', (route) =>
    route.fulfill({ json: { status: 'confirmed' } })
  );
  let fail = true;
  await page.route('**/api/upload/*/record', (route) =>
    route.fulfill(fail ? { status: 503, json: {} } : { json: { status: 'recorded' } })
  );
  await page.goto('/onboarding/legal/profile-one');
  await expect(page.locator('#document-upload')).toBeEnabled();
  const file = {
    name: 'gazette.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7 test document'),
  };
  await page.locator('#document-upload').setInputFiles(file);
  await expect(
    page.getByText('Upload failed. Select a valid file and retry.', { exact: true })
  ).toBeVisible();
  await expect(page.getByText('gazette.pdf', { exact: true })).toHaveCount(0);
  fail = false;
  await page.locator('#document-upload').setInputFiles(file);
  await expect(page.getByText('gazette.pdf', { exact: true })).toBeVisible();
  await expect.poll(() => stored.data.documentKeys).toContain('gazette.pdf');
  await expect(page.getByText('Draft saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('gazette.pdf', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove gazette.pdf', exact: true }).click();
  await expect.poll(() => stored.data.documentKeys).toBe('[]');
});

test('legal profile settings show attachment names and refresh expiring download links', async ({
  page,
}) => {
  await shell(page);
  await page.route('**/api/profiles/profile-one', (route) =>
    route.fulfill({
      json: {
        id: 'profile-one',
        profileType: 'LEGAL',
        status: 'ACTIVE',
        title: 'Company',
        isDefault: true,
        firstName: null,
        lastName: null,
        nationalId: null,
        addresses: [],
        legalInfo: {
          legalName: 'Company',
          nationalIdentifier: '12345678901',
          registrationNumber: '123',
        },
      },
    })
  );
  let reads = 0;
  await page.route('**/api/onboarding/documents/profile-one', (route) => {
    reads++;
    return route.fulfill({
      json: {
        documents: [
          {
            key: 'legal-profile-documents/test/hash',
            name: 'registration.pdf',
            url: `https://storage.example.test/document?version=${reads}`,
          },
        ],
      },
    });
  });
  await page.goto('/settings/profile');
  const link = page.getByRole('link', { name: 'registration.pdf', exact: true });
  await expect(link).toHaveAttribute('href', 'https://storage.example.test/document?version=1');
  await page.getByRole('button', { name: 'Refresh download links', exact: true }).click();
  await expect(link).toHaveAttribute('href', 'https://storage.example.test/document?version=2');
});
