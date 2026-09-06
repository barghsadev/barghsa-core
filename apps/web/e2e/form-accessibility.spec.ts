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

for (const locale of ['en', 'fa']) {
  test(`completion waits for the selected profile and permits retry after failure (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    let fail = true;
    const requested: string[] = [];
    await page.route('**/api/onboarding/complete/*', (route) => {
      requested.push(route.request().url());
      return route.fulfill(
        fail
          ? { status: 503, json: {} }
          : { json: { id: 'profile-one', status: 'PENDING_VERIFICATION' } }
      );
    });
    await page.goto('/onboarding/complete?profileId=profile-one');
    await expect(
      page.getByRole('heading', {
        name: locale === 'fa' ? 'تکمیل پروفایل انجام نشد' : 'Profile completion failed',
        exact: true,
      })
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: locale === 'fa' ? 'رفتن به داشبورد' : 'Go to dashboard',
        exact: true,
      })
    ).toHaveCount(0);
    fail = false;
    await page
      .getByRole('button', { name: locale === 'fa' ? 'تلاش دوباره' : 'Retry', exact: true })
      .click();
    await expect(
      page.getByRole('heading', {
        name: locale === 'fa' ? 'آماده شروع!' : 'Ready to go!',
        exact: true,
      })
    ).toBeVisible();
    expect(requested).toHaveLength(2);
    expect(requested.every((url) => url.endsWith('/api/onboarding/complete/profile-one'))).toBe(
      true
    );
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'رفتن به داشبورد' : 'Go to dashboard',
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/app$/);
    expect(requested).toHaveLength(2);
  });
}
test('completion does not guess a profile and rejects mismatched success responses', async ({
  page,
}) => {
  await shell(page);
  let requests = 0;
  await page.route('**/api/onboarding/complete/*', (route) => {
    requests++;
    return route.fulfill({ json: { id: 'different-profile', status: 'ACTIVE' } });
  });
  await page.goto('/onboarding/complete');
  await expect(
    page.getByText('No profile was selected for completion. Return to profile setup.', {
      exact: true,
    })
  ).toBeVisible();
  expect(requests).toBe(0);
  await page.goto('/onboarding/complete?profileId=profile-one');
  await expect(
    page.getByRole('heading', { name: 'Profile completion failed', exact: true })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go to dashboard', exact: true })).toHaveCount(0);
  expect(requests).toBe(1);
});

for (const locale of ['en', 'fa']) {
  test(`profile settings save changed fields and reset dependent cities (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    const bodies: Record<string, unknown>[] = [];
    let detail = {
      id: 'profile-one',
      profileType: 'INDIVIDUAL',
      status: 'VERIFIED',
      isDefault: true,
      title: 'Profile',
      firstName: 'Original',
      lastName: 'Owner',
      nationalId: '1234567891',
      canEditIdentity: true,
      addresses: [
        {
          id: 'address-one',
          provinceId: 'province-a',
          cityId: 'city-a',
          fullAddress: 'Old Street',
          postalCode: '1234567890',
          mainAddress: true,
        },
      ],
    };
    await page.route('**/api/profiles/profile-one', async (route) => {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON();
        bodies.push(body);
        detail = { ...detail, ...body };
        if (body.provinceId) detail.addresses = [{ ...detail.addresses[0], ...body }];
      }
      await route.fulfill({ json: detail });
    });
    await page.route('**/api/geography/provinces', (route) =>
      route.fulfill({
        json: [
          { id: 'province-a', nameEn: 'Province A', nameFa: 'استان الف' },
          { id: 'province-b', nameEn: 'Province B', nameFa: 'استان ب' },
        ],
      })
    );
    await page.route('**/api/geography/provinces/*/cities', (route) =>
      route.fulfill({
        json: [
          route.request().url().includes('province-a')
            ? { id: 'city-a', nameEn: 'City A', nameFa: 'شهر الف' }
            : { id: 'city-b', nameEn: 'City B', nameFa: 'شهر ب' },
        ],
      })
    );
    await page.goto('/settings/profile');
    const firstName = page.locator('#profile-first-name');
    await expect(firstName).toBeEnabled();
    await firstName.fill('Changed');
    const save = page.getByRole('button', {
      name: locale === 'fa' ? 'ذخیره تغییرات' : 'Save Changes',
      exact: true,
    });
    await save.click();
    await expect.poll(() => bodies).toEqual([{ firstName: 'Changed' }]);
    await expect(firstName).toHaveValue('Changed');
    const province = page.locator('#profile-province');
    const city = page.locator('#profile-city');
    await expect(province.locator('option:checked')).toHaveText(
      locale === 'fa' ? 'استان الف' : 'Province A'
    );
    await province.selectOption('province-b');
    await expect(city).toHaveValue('');
    await expect(city).toBeEnabled();
    await city.selectOption('city-b');
    await page.locator('#profile-address').fill('New Street');
    await save.click();
    await expect
      .poll(() => bodies[1])
      .toEqual({
        provinceId: 'province-b',
        cityId: 'city-b',
        fullAddress: 'New Street',
        postalCode: '1234567890',
      });
    await expect(page.locator('#profile-address')).toHaveValue('New Street');
    await page.reload();
    await expect(city).toHaveValue('city-b');
    await expect(page.locator('#profile-address')).toHaveValue('New Street');
    detail.canEditIdentity = false;
    await page.reload();
    await expect(firstName).toBeDisabled();
  });
}

for (const locale of ['en', 'fa']) {
  test(`company identity is editable until verified (${locale})`, async ({ page }) => {
    await shell(page, locale);
    const bodies: unknown[] = [];
    const detail = {
      id: 'profile-one',
      profileType: 'LEGAL',
      status: 'ACTIVE',
      title: 'Company',
      addresses: [],
      legalInfo: {
        legalName: 'Original Company',
        nationalIdentifier: '12345678901',
        registrationNumber: '123',
      },
    };
    await page.route('**/api/profiles/profile-one', async (route) => {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON();
        bodies.push(body);
        Object.assign(detail.legalInfo, body);
      }
      await route.fulfill({ json: detail });
    });
    await page.route('**/api/geography/provinces', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/onboarding/documents/profile-one', (route) =>
      route.fulfill({ json: { documents: [] } })
    );
    await page.goto('/settings/profile');
    const name = page.locator('#profile-legalName');
    const identifier = page.locator('#profile-nationalIdentifier');
    await expect(name).toBeEnabled();
    await expect(name).toHaveAccessibleName(locale === 'fa' ? 'نام حقوقی' : 'Legal Name');
    await name.fill('Changed Company');
    await identifier.fill('12345678902');
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'ذخیره تغییرات' : 'Save Changes',
        exact: true,
      })
      .click();
    await expect
      .poll(() => bodies)
      .toEqual([{ legalName: 'Changed Company', nationalIdentifier: '12345678902' }]);
    await expect(name).toHaveValue('Changed Company');
    detail.status = 'VERIFIED';
    await page.reload();
    await expect(name).toBeDisabled();
    await expect(identifier).toBeDisabled();
  });
}

for (const locale of ['en', 'fa']) {
  test(`notification editor and delivery window expose localized control names (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    await page.route('**/api/admin/notifications/templates*', (route) =>
      route.fulfill({ json: [] })
    );
    let writes = 0;
    await page.route('**/api/admin/config/delivery-window', (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: { timezone: 'Asia/Tehran', startHour: 9, endHour: 21 } });
      writes++;
      return route.fulfill({ status: 503, json: { message: 'Unavailable' } });
    });
    await page.goto('/admin/notifications');
    const windowForm = page
      .locator('form')
      .filter({ has: page.locator('#delivery-window-timezone') });
    for (const control of await windowForm.locator('select').all()) {
      await expect(control).toHaveAccessibleName(/.+/);
    }
    await page
      .getByLabel(locale === 'fa' ? 'ساعت شروع' : 'Start time', { exact: false })
      .selectOption('20');
    await windowForm
      .getByRole('button', { name: locale === 'fa' ? 'ذخیره' : 'Save', exact: true })
      .click();
    await expect(windowForm.getByRole('alert')).toContainText(
      locale === 'fa' ? '۴ ساعت' : '4 hours'
    );
    expect(writes).toBe(0);
    await page
      .getByLabel(locale === 'fa' ? 'ساعت شروع' : 'Start time', { exact: false })
      .selectOption('9');
    await windowForm
      .getByRole('button', { name: locale === 'fa' ? 'ذخیره' : 'Save', exact: true })
      .click();
    const error = page.getByRole('alert').filter({ hasText: 'Unavailable' });
    await expect(error).toBeVisible();
    await error
      .getByRole('button', { name: locale === 'fa' ? 'بستن پیام خطا' : 'Dismiss error' })
      .press('Enter');
    await expect(error).toHaveCount(0);
    expect(writes).toBe(1);
    await page
      .getByRole('button', { name: locale === 'fa' ? 'قالب جدید' : 'New Template', exact: true })
      .click();
    const editor = page
      .locator('form')
      .filter({ has: page.locator('#notification-template-eventKey') });
    await expect(editor.locator('select, input, textarea')).toHaveCount(6);
    for (const control of await editor.locator('select, input, textarea').all()) {
      await expect(control).toHaveAccessibleName(/.+/);
    }
    const subject = page.getByLabel(locale === 'fa' ? 'موضوع ایمیل' : 'Subject Line', {
      exact: true,
    });
    await page.locator('label[for="notification-template-subject"]').click();
    await expect(subject).toBeFocused();
    await subject.fill('Test subject');
    await expect(subject).toHaveValue('Test subject');
  });
}

for (const locale of ['en', 'fa']) {
  test(`session revocation dialogs contain focus and protect pending confirmation (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    const time = '2026-09-01T12:00:00.000Z';
    const sessions = [true, false].map((isCurrentSession, index) => ({
      sessionId: 'session-' + index,
      deviceInfo: { userAgent: 'Windows', ip: '192.0.2.1' },
      createdAt: time,
      updatedAt: time,
      expiresAt: time,
      idleDeadline: time,
      isCurrentSession,
    }));
    await page.route('**/api/auth/sessions', (route) => route.fulfill({ json: sessions }));
    let finish: (() => void) | undefined;
    let writes = 0;
    await page.route('**/api/auth/sessions/revoke-all', async (route) => {
      writes++;
      expect(route.request().postDataJSON()).toEqual({ password: 'local-test-password' });
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      await route.fulfill({ status: 503, json: {} });
    });
    let finishSingle: (() => void) | undefined;
    let singleWrites = 0;
    await page.route('**/api/auth/sessions/session-1', async (route) => {
      singleWrites++;
      await new Promise<void>((resolve) => {
        finishSingle = resolve;
      });
      await route.fulfill({ status: 503, json: {} });
    });
    await page.goto('/settings/security');
    const single = page.getByRole('button', {
      name: locale === 'fa' ? 'قطع دسترسی' : 'Revoke',
      exact: true,
    });
    await single.press('Enter');
    const singleDialog = page.getByRole('dialog', {
      name: locale === 'fa' ? 'قطع دسترسی' : 'Revoke',
      exact: true,
    });
    await expect(singleDialog).toBeVisible();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab');
      await expect
        .poll(() => singleDialog.evaluate((node) => node.contains(document.activeElement)))
        .toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(singleDialog).toHaveCount(0);
    await expect(single).toBeFocused();
    await single.press('Enter');
    await singleDialog
      .getByRole('button', { name: locale === 'fa' ? 'قطع دسترسی' : 'Revoke', exact: true })
      .click();
    await expect.poll(() => singleWrites).toBe(1);
    await page.keyboard.press('Escape');
    await expect(singleDialog).toBeVisible();
    await expect(
      singleDialog.getByRole('button', { name: locale === 'fa' ? 'انصراف' : 'Cancel', exact: true })
    ).toBeDisabled();
    finishSingle!();
    await expect(singleDialog.getByRole('alert')).toBeVisible();
    await expect(
      singleDialog.getByRole('button', {
        name: locale === 'fa' ? 'قطع دسترسی' : 'Revoke',
        exact: true,
      })
    ).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(singleDialog).toHaveCount(0);
    await expect(single).toBeFocused();

    const name = locale === 'fa' ? 'قطع دسترسی همه نشست‌های دیگر' : 'Revoke all other sessions';
    const all = page.getByRole('button', { name, exact: true });
    await all.press('Enter');
    const dialog = page.getByRole('dialog', { name, exact: true });
    await expect(dialog).toBeVisible();
    const password = dialog.getByLabel(locale === 'fa' ? 'رمز عبور' : 'Password', { exact: true });
    await password.fill('local-test-password');
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      await expect
        .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
        .toBe(true);
    }
    await dialog.getByRole('button', { name, exact: true }).click();
    await expect.poll(() => writes).toBe(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(password).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: locale === 'fa' ? 'انصراف' : 'Cancel', exact: true })
    ).toBeDisabled();
    finish!();
    await expect(dialog.getByRole('alert')).toContainText(
      locale === 'fa' ? 'خطا در قطع دسترسی' : 'Failed to revoke'
    );
    await expect(password).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(all).toBeFocused();
    expect(writes).toBe(1);
  });
}

for (const locale of ['en', 'fa']) {
  for (const kind of ['notifications', 'marketing-consent']) {
    test(`preferences require a valid read and preserve choices through save failures (${kind}, ${locale})`, async ({
      page,
    }) => {
      await shell(page, locale);
      const marketing = kind === 'marketing-consent';
      const original = marketing
        ? {
            channels: {
              email: { optedIn: false, lastChangedAt: null },
              sms: { optedIn: false, lastChangedAt: null },
            },
          }
        : { channels: ['IN_APP'] };
      const confirmed = marketing
        ? {
            channels: {
              email: { optedIn: true, lastChangedAt: '2026-09-01T12:00:00Z' },
              sms: { optedIn: false, lastChangedAt: null },
            },
          }
        : { channels: ['IN_APP', 'EMAIL'] };
      let reads = 0;
      let writes = 0;
      let finish: (() => void) | undefined;
      await page.route(`**/api/user/settings/${kind}`, async (route) => {
        if (route.request().method() === 'GET') {
          reads++;
          return route.fulfill(
            reads === 1 ? { status: locale === 'en' ? 503 : 200, json: null } : { json: original }
          );
        }
        writes++;
        expect(route.request().postDataJSON()).toEqual(
          marketing ? { email: true, sms: false } : { channels: ['IN_APP', 'EMAIL'] }
        );
        if (writes === 1) {
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          return route.fulfill({ status: 503, json: { message: { invalid: 'message object' } } });
        }
        return route.fulfill({ json: writes === 2 ? original : confirmed });
      });
      await page.goto('/settings');
      const title = marketing
        ? locale === 'fa'
          ? 'اعلان‌های بازاریابی'
          : 'Marketing Notifications'
        : locale === 'fa'
          ? 'تنظیمات اعلان‌ها'
          : 'Notification Preferences';
      const card = page
        .locator('[data-slot="card"]')
        .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
      const save = card.getByRole('button', {
        name: locale === 'fa' ? 'ذخیره تغییرات' : 'Save Changes',
        exact: true,
      });
      await expect(card.getByRole('alert')).toBeVisible();
      await expect(save).toBeDisabled();
      await expect(card.getByRole('switch')).toHaveCount(0);
      expect(writes).toBe(0);
      await card
        .getByRole('button', { name: locale === 'fa' ? 'تلاش دوباره' : 'Try again', exact: true })
        .click();
      const email = card.getByRole('switch', {
        name: marketing
          ? locale === 'fa'
            ? 'دریافت اعلان‌های بازاریابی از طریق ایمیل'
            : 'Receive marketing notifications via email'
          : locale === 'fa'
            ? 'ایمیل'
            : 'Email',
        exact: true,
      });
      await expect(email).toHaveAttribute('aria-checked', 'false');
      await email.press('Space');
      await expect(email).toHaveAttribute('aria-checked', 'true');
      await save.click();
      await expect.poll(() => writes).toBe(1);
      await expect(email).toBeDisabled();
      finish!();
      await expect(card.getByRole('alert')).toBeVisible();
      await expect(email).toHaveAttribute('aria-checked', 'true');
      await expect(save).toBeEnabled();
      await save.click();
      await expect.poll(() => writes).toBe(2);
      await expect(card.getByRole('alert')).toBeVisible();
      await expect(card.getByRole('status')).toHaveCount(0);
      await expect(email).toHaveAttribute('aria-checked', 'true');
      await save.click();
      await expect(card.getByRole('status')).toBeVisible();
      await expect(card.getByRole('alert')).toHaveCount(0);
      expect(writes).toBe(3);
      expect(reads).toBe(2);
    });
  }
}

for (const locale of ['en', 'fa']) {
  test(`email-provider labels identify SMTP and Resend fields (${locale})`, async ({ page }) => {
    await shell(page, locale);
    await page.route('**/api/admin/email-providers', (route) => route.fulfill({ json: [] }));
    await page.goto('/admin/providers');
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'ارائه‌دهنده جدید' : 'New provider',
        exact: true,
      })
      .click();
    const form = page.locator('form').filter({ has: page.locator('#email-provider-label') });
    await expect(form.locator('input, select')).toHaveCount(10);
    for (const control of await form.locator('input, select').all())
      await expect(control).toHaveAccessibleName(/.+/);
    const host = form.getByLabel(locale === 'fa' ? 'میزبان' : 'Host', { exact: false });
    await form.getByText(locale === 'fa' ? 'میزبان' : 'Host', { exact: false }).click();
    await expect(host).toBeFocused();
    await host.fill('smtp.example.test');
    const transport = form.getByLabel(locale === 'fa' ? 'نوع حمل‌ونقل' : 'Transport', {
      exact: false,
    });
    await transport.selectOption('resend');
    await expect(form.locator('input, select')).toHaveCount(7);
    for (const control of await form.locator('input, select').all())
      await expect(control).toHaveAccessibleName(/.+/);
    const key = form.getByLabel(locale === 'fa' ? 'کلید API' : 'API key', { exact: false });
    await expect(key).toHaveAttribute('type', 'password');
    await key.fill('local-fixture-only');
    await expect(key).toHaveValue('local-fixture-only');
  });
}

for (const locale of ['en', 'fa']) {
  test(`order address fields have labels and label-click focus (${locale})`, async ({ page }) => {
    await shell(page, locale);
    await page.route('**/api/profiles/verification-status', (route) =>
      route.fulfill({
        json: { activeProfileId: 'profile-one', verificationRequired: false, isVerified: false },
      })
    );
    await page.route('**/api/profiles/profile-one/addresses', (route) =>
      route.fulfill({ json: { addresses: [] } })
    );
    await page.route('**/api/products', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/geography/provinces', (route) => route.fulfill({ json: [] }));
    await page.goto('/electricity/order');
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'افزودن آدرس جدید' : 'Add New Address',
        exact: true,
      })
      .click();
    for (const id of ['province', 'city', 'fullAddress', 'postalCode']) {
      await expect(page.locator('#order-address-' + id)).toHaveAccessibleName(/.+/);
    }
    await page.locator('label[for="order-address-fullAddress"]').click();
    const address = page.locator('#order-address-fullAddress');
    await expect(address).toBeFocused();
    await address.fill('Local fixture address');
    await expect(address).toHaveValue('Local fixture address');
    await expect(page.locator('#order-address-city')).toBeDisabled();
  });
}

for (const locale of ['en', 'fa']) {
  test(`geography filters and terms error dismissal have localized names (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    await page.goto('/admin/geography');
    const search = page.getByRole('textbox', {
      name: locale === 'fa' ? 'جستجوی استان‌ها' : 'Search provinces',
      exact: true,
    });
    await search.fill('Tehran');
    await expect(search).toHaveValue('Tehran');
    const status = page.getByRole('combobox', {
      name: locale === 'fa' ? 'فیلتر وضعیت' : 'Filter by status',
      exact: true,
    });
    await status.selectOption('active');
    await expect(status).toHaveValue('active');
    await page.route('**/api/admin/tos/versions', (route) =>
      route.fulfill({ status: 503, json: {} })
    );
    await page.goto('/admin/tos');
    const error = page.getByRole('alert');
    await expect(error).toBeVisible();
    await error
      .getByRole('button', {
        name: locale === 'fa' ? 'بستن پیام خطا' : 'Dismiss error',
        exact: true,
      })
      .press('Enter');
    await expect(error).toHaveCount(0);
  });
}

for (const locale of ['en', 'fa']) {
  test(`verification settings require a valid read and keep automatic verification unavailable (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    let reads = 0;
    let writes = 0;
    let mode = locale === 'en' ? 'API' : 'DISABLED';
    let finish: (() => void) | undefined;
    await page.route('**/api/admin/config/profile-verification-mode', async (route) => {
      if (route.request().method() === 'GET') {
        reads++;
        return route.fulfill(
          reads === 1
            ? { status: locale === 'en' ? 503 : 200, json: { mode: 'unknown' } }
            : { json: { mode } }
        );
      }
      writes++;
      expect(route.request().postDataJSON()).toEqual({ mode: 'MANUAL' });
      if (writes === 1) {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return route.fulfill({ status: 503, json: {} });
      }
      if (writes === 2) return route.fulfill({ json: { mode } });
      mode = 'MANUAL';
      return route.fulfill({ json: { mode } });
    });
    await page.goto('/admin/verification');
    const save = page.getByRole('button', {
      name: locale === 'fa' ? 'ذخیره تنظیمات' : 'Save Configuration',
      exact: true,
    });
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(save).toBeDisabled();
    for (const radio of await page.getByRole('radio').all()) await expect(radio).toBeDisabled();
    await page
      .getByRole('button', { name: locale === 'fa' ? 'تلاش دوباره' : 'Try again', exact: true })
      .click();
    const manual = page.locator('#verification-mode-MANUAL');
    const automatic = page.locator('#verification-mode-API');
    await expect(automatic).toBeDisabled();
    await expect(automatic).toHaveAccessibleDescription(
      locale === 'fa' ? /پیکربندی نشده/ : /No identity-verification provider/
    );
    await manual.check();
    await save.click();
    await expect.poll(() => writes).toBe(1);
    await expect(manual).toBeDisabled();
    finish!();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(manual).toBeChecked();
    await expect(save).toBeEnabled();
    await save.click();
    await expect.poll(() => writes).toBe(2);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    await save.click();
    await expect(page.getByRole('status')).toContainText(
      locale === 'fa' ? 'به‌روزرسانی شد' : 'updated'
    );
    await expect(save).toBeDisabled();
    await page.reload();
    await expect(manual).toBeChecked();
    await expect(automatic).toBeDisabled();
    await expect(save).toBeDisabled();
    expect(writes).toBe(3);
  });
}

for (const locale of ['en', 'fa']) {
  test(`delivery window retries failed reads and confirms exact saved values (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    await page.route('**/api/admin/notifications/templates*', (route) =>
      route.fulfill({ json: [] })
    );
    let reads = 0;
    let writes = 0;
    let finish: (() => void) | undefined;
    await page.route('**/api/admin/config/delivery-window', async (route) => {
      if (route.request().method() === 'GET') {
        reads++;
        return route.fulfill(
          reads === 1
            ? {
                status: locale === 'en' ? 503 : 200,
                json: { timezone: 'Invalid', startHour: 9, endHour: 21 },
              }
            : { json: { timezone: 'Asia/Tokyo', startHour: 9, endHour: 21 } }
        );
      }
      writes++;
      expect(route.request().postDataJSON()).toEqual({
        timezone: 'Asia/Tokyo',
        start_hour: 8,
        end_hour: 21,
      });
      if (writes === 1) {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return route.fulfill({ status: 503, json: { message: { invalid: true } } });
      }
      return route.fulfill({
        json: { timezone: 'Asia/Tokyo', startHour: writes === 2 ? 9 : 8, endHour: 21 },
      });
    });
    await page.goto('/admin/notifications');
    const panel = page.getByRole('region', {
      name: locale === 'fa' ? 'پنجره ارسال روزانه' : 'Daily Delivery Window',
      exact: true,
    });
    const save = panel.getByRole('button', {
      name: locale === 'fa' ? 'ذخیره' : 'Save',
      exact: true,
    });
    await expect(panel.getByRole('alert')).toBeVisible();
    await expect(save).toBeDisabled();
    await expect(panel.locator('select').first()).toBeDisabled();
    await panel
      .getByRole('button', { name: locale === 'fa' ? 'تلاش دوباره' : 'Try again', exact: true })
      .click();
    await expect(panel.locator('#delivery-window-timezone')).toHaveValue('Asia/Tokyo');
    const start = panel.locator('#delivery-window-start');
    await start.selectOption('8');
    await save.click();
    await expect.poll(() => writes).toBe(1);
    await expect(start).toBeDisabled();
    finish!();
    await expect(panel.getByRole('alert')).toContainText(
      locale === 'fa' ? 'خطا در ذخیره' : 'Failed to save'
    );
    await expect(start).toHaveValue('8');
    await expect(save).toBeEnabled();
    await save.click();
    await expect.poll(() => writes).toBe(2);
    await expect(panel.getByRole('alert')).toBeVisible();
    await expect(panel.getByRole('status')).toHaveCount(0);
    await save.click();
    await expect(panel.getByRole('status')).toBeVisible();
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await start.selectOption('7');
    await expect(panel.getByRole('status')).toHaveCount(0);
    expect(reads).toBe(2);
    expect(writes).toBe(3);
  });
}

for (const locale of ['en', 'fa']) {
  test(`ordering stays closed on unavailable or malformed verification and supports retry (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    let mode = 'failure';
    let writes = 0;
    await page.route('**/api/profiles/verification-status', (route) => {
      if (mode === 'failure') return route.fulfill({ status: 503, json: {} });
      if (mode === 'unauthorized') return route.fulfill({ status: 401, json: {} });
      if (mode === 'malformed') return route.fulfill({ json: { activeProfileId: 'profile-one' } });
      return route.fulfill({
        json: {
          activeProfileId: mode === 'no-profile' ? null : 'profile-one',
          verificationRequired: mode === 'unverified',
          isVerified: false,
        },
      });
    });
    await page.route('**/api/profiles/profile-one/addresses', (route) => {
      if (route.request().method() !== 'GET') writes++;
      return route.fulfill({ json: { addresses: [] } });
    });
    await page.route('**/api/orders', (route) => {
      writes++;
      return route.fulfill({ status: 500, json: {} });
    });
    await page.route('**/api/products', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/geography/provinces', (route) => route.fulfill({ json: [] }));
    await page.goto('/electricity/order');
    const retry = page.getByRole('button', {
      name: locale === 'fa' ? 'تلاش دوباره' : 'Try again',
      exact: true,
    });
    for (const next of ['unauthorized', 'malformed', 'no-profile', 'ready']) {
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(
        page.getByRole('button', {
          name: locale === 'fa' ? 'افزودن آدرس جدید' : 'Add New Address',
          exact: true,
        })
      ).toHaveCount(0);
      mode = next;
      await retry.click();
    }
    await expect(
      page.getByRole('button', {
        name: locale === 'fa' ? 'افزودن آدرس جدید' : 'Add New Address',
        exact: true,
      })
    ).toBeVisible();
    expect(writes).toBe(0);
    mode = 'unverified';
    await page.reload();
    await expect(
      page.getByRole('button', {
        name: locale === 'fa' ? 'افزودن آدرس جدید' : 'Add New Address',
        exact: true,
      })
    ).toHaveCount(0);
    await expect(
      page.getByRole('heading', {
        name: locale === 'fa' ? 'ثبت سفارش جدید امکان‌پذیر نیست' : 'New orders are not available',
        exact: true,
      })
    ).toBeVisible();
    expect(writes).toBe(0);
  });
}

for (const locale of ['en', 'fa']) {
  test(`ordering city choices ignore background and obsolete province responses (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    await page.route('**/api/profiles/verification-status', (route) =>
      route.fulfill({
        json: { activeProfileId: 'profile-one', verificationRequired: false, isVerified: false },
      })
    );
    await page.route('**/api/products', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/profiles/profile-one/addresses', (route) =>
      route.fulfill({
        json: {
          addresses: [
            {
              id: 'saved',
              provinceId: 'a',
              cityId: 'city-a',
              fullAddress: 'Saved address',
              postalCode: '1234567890',
            },
          ],
        },
      })
    );
    await page.route('**/api/geography/provinces', (route) =>
      route.fulfill({ json: ['a', 'b', 'c'].map((id) => ({ id, nameFa: id, nameEn: id })) })
    );
    let releaseBackground!: () => void;
    let releaseObsolete!: () => void;
    const background = new Promise<void>((resolve) => {
      releaseBackground = resolve;
    });
    const obsolete = new Promise<void>((resolve) => {
      releaseObsolete = resolve;
    });
    let backgroundStarted = false,
      obsoleteStarted = false;
    await page.route('**/api/geography/provinces/*/cities', async (route) => {
      const id = route.request().url().split('/').at(-2)!;
      if (id === 'a') {
        backgroundStarted = true;
        await background;
      }
      if (id === 'c') {
        obsoleteStarted = true;
        await obsolete;
      }
      await route.fulfill({
        json: [{ id: `city-${id}`, provinceId: id, nameFa: `city-${id}`, nameEn: `city-${id}` }],
      });
    });
    try {
      await page.goto('/electricity/order');
      await expect.poll(() => backgroundStarted).toBe(true);
      await page
        .getByRole('button', {
          name: locale === 'fa' ? 'افزودن آدرس جدید' : 'Add New Address',
          exact: true,
        })
        .click();
      const province = page.locator('#order-address-province');
      const city = page.locator('#order-address-city');
      await province.selectOption('b');
      await city.selectOption('city-b');
      const backgroundResponse = page.waitForResponse('**/api/geography/provinces/a/cities');
      releaseBackground();
      await backgroundResponse;
      await expect(city).toHaveValue('city-b');
      await expect(city.locator('option[value="city-a"]')).toHaveCount(0);
      await province.selectOption('c');
      await expect.poll(() => obsoleteStarted).toBe(true);
      await expect(city).toHaveValue('');
      await province.selectOption('b');
      await city.selectOption('city-b');
      const obsoleteResponse = page.waitForResponse('**/api/geography/provinces/c/cities');
      releaseObsolete();
      await obsoleteResponse;
      await expect(city).toHaveValue('city-b');
      await expect(city.locator('option[value="city-c"]')).toHaveCount(0);
    } finally {
      releaseBackground();
      releaseObsolete();
    }
  });
}
