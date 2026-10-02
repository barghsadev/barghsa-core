import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';
import { fullNavigation } from './navigation-fixture';
import { dismissMessages } from './dismiss-messages';

const profileId = '11111111-1111-4111-8111-111111111111';
const provinceId = '22222222-2222-4222-8222-222222222222';
const cityId = '33333333-3333-4333-8333-333333333333';
const individual = {
  title: '',
  firstName: 'Person',
  lastName: 'Owner',
  nationalId: '1234567891',
  provinceId,
  cityId,
  fullAddress: 'Saved Street',
  postalCode: '1234567890',
};
const legal = {
  representativeHonorific: '',
  representativeFirstName: 'Person',
  representativeLastName: 'Owner',
  representativeNationalId: '1234567891',
  representativeProvinceId: provinceId,
  representativeCityId: cityId,
  representativeFullAddress: 'Representative Street',
  representativePostalCode: '1234567890',
  representativeTitle: 'CEO',
  representativeRelationship: 'director',
  legalName: 'Saved Company',
  nationalIdentifier: '12345678901',
  registrationNumber: '123',
  companyTypeId: 'limited-liability',
  registrationDate: '2026-03-21',
  officialProvinceId: provinceId,
  officialCityId: cityId,
  officialFullAddress: 'Company Street',
  officialPostalCode: '1234567890',
};
async function fixture(
  page: Page,
  locale: 'en' | 'fa',
  type: 'INDIVIDUAL' | 'LEGAL',
  data: Record<string, string> = {}
) {
  const state = {
    draft: { version: 0, data },
    saveStatus: 200,
    loadStatus: 200,
    invalidReceipt: false,
    submissions: [] as Record<string, unknown>[],
    completeRequests: 0,
    saveRequests: [] as Record<string, unknown>[],
    saveGate: null as Promise<void> | null,
    submitGate: null as Promise<void> | null,
  };
  await page.addInitScript((language) => {
    localStorage.setItem('barghsa.locale', language);
  }, locale);
  await page.route('**/api/**', (r) => r.fulfill({ status: 404, json: {} }));
  await page.route('**/api/user/settings/timezone', (r) =>
    r.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/onboarding/drafts', (r) =>
    r.fulfill({ json: { drafts: [], nextAfter: null } })
  );
  await page.route('**/api/invitations/pending', (r) => r.fulfill({ json: { invitations: [] } }));
  await page.route('**/api/auth/user', (r) =>
    r.fulfill({
      json: {
        userId: 'onboarding-viewer',
        isStaff: false,
        requiresTosAcceptance: false,
        navigation: { ...fullNavigation('customer', type), profileId },
      },
    })
  );
  await page.route('**/api/profiles', (r) =>
    r.fulfill({
      json: {
        activeProfileId: profileId,
        hasDefault: true,
        profiles: [
          { id: profileId, profileType: type, status: 'ACTIVE', isDefault: true, title: 'Profile' },
        ],
      },
    })
  );
  await page.route('**/api/geography/provinces', (r) =>
    r.fulfill({ json: [{ id: provinceId, nameFa: 'تهران', nameEn: 'Tehran' }] })
  );
  await page.route('**/api/geography/provinces/*/cities', (r) =>
    r.fulfill({ json: [{ id: cityId, provinceId, nameFa: 'تهران', nameEn: 'Tehran' }] })
  );
  await page.route('**/api/geography/company-types', (r) =>
    r.fulfill({
      json: [{ id: 'limited-liability', nameFa: 'مسئولیت محدود', nameEn: 'Limited liability' }],
    })
  );
  await page.route(`**/api/onboarding/draft/${profileId}`, async (r) => {
    if (r.request().method() === 'GET')
      return r.fulfill({ status: state.loadStatus, json: state.draft });
    const input = r.request().postDataJSON();
    state.saveRequests.push(input);
    await state.saveGate;
    if (state.saveStatus !== 200)
      return r.fulfill({ status: state.saveStatus, json: { error: 'CONFLICT:VERSION_CONFLICT' } });
    expect(input.expectedVersion).toBe(state.draft.version);
    state.draft = { version: state.draft.version + 1, data: input.data };
    return r.fulfill({ json: state.draft });
  });
  const receipt = () => ({
    id: state.invalidReceipt ? 'wrong-profile' : profileId,
    profileType: type,
    status: 'PENDING_VERIFICATION',
    isDefault: true,
    ...(type === 'INDIVIDUAL'
      ? { firstName: state.draft.data.firstName, lastName: state.draft.data.lastName }
      : { title: state.draft.data.legalName }),
  });
  await page.route(`**/api/onboarding/${type.toLowerCase()}/${profileId}`, async (r) => {
    state.submissions.push(r.request().postDataJSON());
    await state.submitGate;
    return r.fulfill({ json: receipt() });
  });
  await page.route(`**/api/onboarding/complete/${profileId}`, (r) => {
    state.completeRequests++;
    return r.fulfill({ json: receipt() });
  });
  return state;
}
const next = async (page: Page, locale: 'en' | 'fa', advance = true) => {
  const current = page.locator('li[aria-current=step]');
  const previous = await current.textContent();
  await page
    .getByRole('button', {
      name: locale === 'fa' ? 'ذخیره و ادامه' : 'Save and continue',
      exact: true,
    })
    .click();
  if (advance) await expect(current).not.toHaveText(previous!);
};
const submit = (page: Page, locale: 'en' | 'fa') =>
  page
    .getByRole('button', { name: locale === 'fa' ? 'ثبت پروفایل' : 'Submit profile', exact: true })
    .click();

function leaveControls(page: Page, locale: 'en' | 'fa') {
  const dialog = page.getByRole('dialog');
  return {
    dialog,
    save: dialog.getByRole('button', {
      name: locale === 'fa' ? 'ذخیره و خروج' : 'Save and leave',
      exact: true,
    }),
    stay: dialog.getByRole('button', { name: locale === 'fa' ? 'ماندن' : 'Stay', exact: true }),
    leave: dialog.getByRole('button', {
      name: locale === 'fa' ? 'خروج بدون ذخیره' : 'Leave without saving',
      exact: true,
    }),
    back: page.getByRole('link', { name: locale === 'fa' ? 'بازگشت' : 'Back', exact: true }),
  };
}

for (const locale of ['en', 'fa'] as const) {
  for (const type of ['INDIVIDUAL', 'LEGAL'] as const) {
    test(`expired ${type} conflict reload clears old fields and returns to the first stage (${locale})`, async ({
      page,
    }) => {
      const state = await fixture(
        page,
        locale,
        type,
        type === 'INDIVIDUAL' ? { ...individual } : { ...legal }
      );
      state.draft.version = 5;
      await page.goto(
        `/onboarding/${type.toLowerCase()}/${profileId}?step=${type === 'INDIVIDUAL' ? 2 : 3}`
      );
      const address = page.locator(type === 'INDIVIDUAL' ? '#fullAddress' : '#officialFullAddress');
      await expect(address).toHaveValue(type === 'INDIVIDUAL' ? 'Saved Street' : 'Company Street');
      state.saveStatus = 409;
      await address.fill('Local edit before expiry');
      await page
        .getByRole('button', {
          name: locale === 'fa' ? 'ذخیره پیش‌نویس' : 'Save draft',
          exact: true,
        })
        .click();
      const reload = page.getByRole('button', {
        name: locale === 'fa' ? 'دریافت نسخه ذخیره‌شده' : 'Reload saved draft',
        exact: true,
      });
      await expect(reload).toBeVisible();
      state.draft = { version: 6, data: {} };
      state.saveStatus = 200;
      await reload.click();
      await expect(page).toHaveURL(/step=1$/);
      const field = page.locator(type === 'INDIVIDUAL' ? '#firstName' : '#representativeFirstName');
      await expect(field).toBeVisible();
      await expect(field).toHaveValue('');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await field.fill('Restarted');
      await page
        .getByRole('button', {
          name: locale === 'fa' ? 'ذخیره پیش‌نویس' : 'Save draft',
          exact: true,
        })
        .click();
      await expect.poll(() => state.draft.version).toBe(7);
      expect(state.saveRequests.at(-1)).toMatchObject({ expectedVersion: 6 });
      expect(state.submissions).toEqual([]);
    });
    test(`expired ${type} draft restarts safely and saves with its retained version (${locale})`, async ({
      page,
    }) => {
      const state = await fixture(page, locale, type);
      state.draft.version = 6;
      await page.goto(`/onboarding/${type.toLowerCase()}/${profileId}?step=4`);
      await dismissMessages(page, locale);
      await expect(page).toHaveURL(/step=1$/);
      const field = page.locator(type === 'INDIVIDUAL' ? '#firstName' : '#representativeFirstName');
      await expect(field).toHaveValue('');
      await field.fill('Fresh draft');
      const controls = leaveControls(page, locale);
      await controls.back.click();
      await expect(controls.dialog).toBeVisible();
      await controls.save.click();
      await expect(page).toHaveURL(/\/onboarding$/);
      expect(state.saveRequests).toHaveLength(1);
      expect(state.saveRequests[0]).toMatchObject({
        expectedVersion: 6,
        data: { [type === 'INDIVIDUAL' ? 'firstName' : 'representativeFirstName']: 'Fresh draft' },
      });
      expect(state.submissions).toEqual([]);
    });
  }
}

for (const locale of ['en', 'fa'] as const) {
  test(`wizard URL restores saved steps, supports browser history and rejects invalid steps (${locale})`, async ({
    page,
  }) => {
    await fixture(page, locale, 'INDIVIDUAL', { ...individual });
    await page.goto(`/onboarding/individual/${profileId}?step=2`);
    await expect(page.locator('#fullAddress')).toBeVisible();
    await expect(page.locator('#fullAddress')).toHaveValue('Saved Street');
    await page.reload();
    await expect(page.locator('#fullAddress')).toBeVisible();
    await next(page, locale);
    await expect(page).toHaveURL(/\?step=3$/);
    await page.goBack();
    await expect(page).toHaveURL(/\?step=2$/);
    await expect(page.locator('#fullAddress')).toBeVisible();
    await page.goForward();
    await expect(page.locator('fieldset:not([hidden]) > section')).toContainText('Saved Street');
    await page.reload();
    await expect(page.locator('fieldset:not([hidden]) > section')).toContainText('Saved Street');
    await page.goto(`/onboarding/individual/${profileId}?step=999&nationalId=private`);
    await expect(page.locator('#firstName')).toBeVisible();
    await expect(page.locator('#firstName')).toHaveValue('Person');
    await fixture(page, locale, 'LEGAL', { ...legal });
    await page.goto(`/onboarding/legal/${profileId}?step=4`);
    await expect(page.locator('fieldset:not([hidden]) #document-upload')).toBeAttached();
    await next(page, locale);
    await expect(page).toHaveURL(/\?step=5$/);
    await page.reload();
    await expect(page.locator('fieldset:not([hidden]) > section')).toContainText('Saved Company');
    await page.goto(`/onboarding/legal/${profileId}?step=0`);
    await expect(page.locator('#representativeFirstName')).toBeVisible();
  });

  test(`wizard leave dialog stays on failed saves and serializes save before leaving (${locale})`, async ({
    page,
    context,
  }) => {
    await page.clock.install();
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await fixture(page, locale, 'INDIVIDUAL', { ...individual });
    state.saveStatus = 503;
    await page.goto(`/onboarding/individual/${profileId}`);
    await expect(page.locator('#firstName')).toHaveValue('Person');
    await page.locator('#firstName').fill('Edited person');
    const actions = leaveControls(page, locale);
    await actions.back.click();
    await expect(actions.dialog).toBeVisible();
    await expect(actions.dialog).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
    expect(
      (await new AxeBuilder({ page }).include('[data-slot="dialog-content"]').analyze()).violations
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await actions.stay.click();
    await expect(actions.dialog).not.toBeVisible();
    await expect(page.locator('#firstName')).toHaveValue('Edited person');
    await actions.back.click();
    await actions.save.click();
    await expect(actions.dialog.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/onboarding/individual/${profileId}(?:\\?step=1)?$`));
    expect(state.draft.data.firstName).toBe('Person');
    // Let the independently scheduled autosave fail before gating the explicit retry.
    await page.clock.fastForward(1100);
    await expect(actions.save).toBeEnabled();
    let finishSave!: () => void;
    state.saveGate = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    state.saveStatus = 200;
    await context.addCookies([
      { name: 'barghsa_csrf', value: 'current-draft-token', url: 'http://127.0.0.1:4173' },
    ]);
    const savedRequests = state.saveRequests.length;
    const request = page.waitForRequest(
      (request) => request.method() === 'PUT' && request.url().includes('/onboarding/draft/')
    );
    await actions.save.click();
    expect((await request).headers()['x-csrf-token']).toBe('current-draft-token');
    await expect(actions.save).toBeDisabled();
    await expect(actions.leave).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(actions.dialog).toBeVisible();
    expect(state.saveRequests).toHaveLength(savedRequests + 1);
    if (locale === 'fa')
      await page.screenshot({
        path: '/tmp/barghsa-wizard-navigation-fa-dialog.png',
        fullPage: true,
      });
    finishSave();
    await expect(page).toHaveURL(/\/onboarding$/);
    expect(state.draft.data.firstName).toBe('Edited person');
    expect(state.submissions).toHaveLength(0);
  });

  test(`browser Back and Forward retain unsaved wizard edits until an explicit leave (${locale})`, async ({
    page,
  }) => {
    const state = await fixture(page, locale, 'INDIVIDUAL', { ...individual });
    await page.goto(`/onboarding/individual/${profileId}`);
    await expect(page.locator('#firstName')).toHaveValue('Person');
    expect(
      await page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      })
    ).toBe(false);
    await next(page, locale);
    state.saveStatus = 503;
    await page.locator('#fullAddress').fill('Unsaved address');
    expect(
      await page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      })
    ).toBe(true);
    await page.goBack();
    await expect(page.locator('#firstName')).toBeVisible();
    await page.goForward();
    await expect(page.locator('#fullAddress')).toBeVisible();
    await expect(page.locator('#fullAddress')).toHaveValue('Unsaved address');
    const actions = leaveControls(page, locale);
    await actions.back.click();
    await expect(actions.dialog).toBeVisible();
    await actions.leave.click();
    await expect(page).toHaveURL(/\/onboarding$/);
    expect(state.draft.data.fullAddress).toBe('Saved Street');
    expect(state.submissions).toHaveLength(0);
  });

  test(`company upload blocks leaving until its verified document can be saved (${locale})`, async ({
    page,
  }) => {
    const state = await fixture(page, locale, 'LEGAL', { ...legal });
    state.saveStatus = 503;
    let finishUpload!: () => void;
    const held = new Promise<void>((resolve) => {
      finishUpload = resolve;
    });
    await page.route('**/api/upload/presigned-url', async (r) => {
      expect(r.request().postDataJSON()).toMatchObject({
        profileId,
        purpose: 'legal_profile_document',
      });
      await held;
      return r.fulfill({
        json: { key: 'verified/company.pdf', presignedUrl: 'http://127.0.0.1:4173/upload-fixture' },
      });
    });
    await page.route('**/upload-fixture', (r) => r.fulfill({ status: 204 }));
    await page.route('**/api/upload/*/verify', (r) => r.fulfill({ json: { status: 'confirmed' } }));
    await page.route('**/api/upload/*/record', (r) => r.fulfill({ json: {} }));
    await page.goto(`/onboarding/legal/${profileId}?step=4`);
    await expect(page.locator('#document-upload')).toBeEnabled();
    await page.locator('#document-upload').setInputFiles({
      name: 'company.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\ncompany document'),
    });
    const actions = leaveControls(page, locale);
    await actions.back.click();
    await expect(actions.dialog).toBeVisible();
    await expect(actions.save).toBeDisabled();
    await expect(actions.leave).toBeDisabled();
    await expect(actions.dialog.getByRole('status')).toContainText(
      locale === 'fa' ? 'در حال بارگذاری مدارک' : 'Uploading documents'
    );
    finishUpload();
    await expect(actions.save).toBeEnabled();
    state.saveStatus = 200;
    await actions.save.click();
    await expect(page).toHaveURL(/\/onboarding$/);
    expect(JSON.parse(state.draft.data.documentKeys!)).toEqual([
      { key: 'verified/company.pdf', name: 'company.pdf' },
    ]);
    expect(state.submissions).toHaveLength(0);
  });

  test(`final submission blocks leaving and its verified receipt opens the result (${locale})`, async ({
    page,
  }) => {
    const state = await fixture(page, locale, 'INDIVIDUAL', { ...individual });
    let finishSubmit!: () => void;
    state.submitGate = new Promise<void>((resolve) => {
      finishSubmit = resolve;
    });
    await page.goto(`/onboarding/individual/${profileId}?step=3`);
    await expect(page.locator('fieldset:not([hidden]) > section')).toContainText('Saved Street');
    await expect(page.locator('fieldset:not([hidden]) > section')).toContainText(
      locale === 'fa' ? 'تهران' : 'Tehran'
    );
    await submit(page, locale);
    await expect.poll(() => state.submissions.length).toBe(1);
    const actions = leaveControls(page, locale);
    await actions.back.click();
    await expect(actions.dialog).toBeVisible();
    await expect(actions.leave).toBeDisabled();
    await expect(actions.save).toBeDisabled();
    finishSubmit();
    await expect(page).toHaveURL(new RegExp(`/onboarding/complete\\?profileId=${profileId}$`));
    await expect(page.locator('dl[aria-label]')).toContainText('Person Owner');
    expect(state.submissions).toHaveLength(1);
  });
}

for (const locale of ['en', 'fa'] as const) {
  test(`personal wizard saves stages, reviews edits and only celebrates a valid receipt (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await fixture(page, locale, 'INDIVIDUAL');
    await page.goto(`/onboarding/individual/${profileId}`);
    await next(page, locale, false);
    await expect(page.locator('#firstName')).toBeFocused();
    expect(state.submissions).toHaveLength(0);
    await page.locator('#firstName').fill(individual.firstName);
    await page.locator('#lastName').fill(individual.lastName);
    await page.locator('#nationalId').fill(locale === 'fa' ? '۱۲۳۴۵۶۷۸۹۱' : '١٢٣٤٥٦٧٨٩١');
    state.saveStatus = 503;
    await next(page, locale, false);
    await expect(
      page.getByText(
        locale === 'fa'
          ? 'پیش‌نویس ذخیره نشده است. دوباره تلاش کنید.'
          : 'Draft is not saved. Please retry.',
        { exact: true }
      )
    ).toBeVisible();
    await expect(page.locator('#firstName')).toBeVisible();
    await expect(page.locator('#firstName')).toHaveValue('Person');
    state.saveStatus = 200;
    await next(page, locale);
    await expect(page.locator('#provinceId')).toBeVisible();
    expect(state.draft.data).toMatchObject({ firstName: 'Person', nationalId: '1234567891' });
    await page.locator('#provinceId').selectOption(provinceId);
    await page.locator('#cityId').selectOption(cityId);
    await page.locator('#fullAddress').fill(individual.fullAddress);
    await page.locator('#postalCode').fill('۱۲۳۴۵۶۷۸۹۰');
    await next(page, locale);
    await expect(page.locator('fieldset:not([hidden]) > section')).toContainText('Saved Street');
    await expect(page.locator('fieldset:not([hidden]) > section')).toContainText('1234567890');
    expect(state.submissions).toHaveLength(0);
    await page
      .getByRole('button', { name: locale === 'fa' ? 'مرحله قبل' : 'Back', exact: true })
      .click();
    await page.locator('#fullAddress').fill('Reviewed Street');
    await next(page, locale);
    await expect(page.locator('fieldset:not([hidden]) > section')).toContainText('Reviewed Street');
    expect((await new AxeBuilder({ page }).include('form').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    if (locale === 'fa')
      await page.screenshot({
        path: '/tmp/barghsa-onboarding-wizard-fa-review.png',
        fullPage: true,
      });
    state.invalidReceipt = true;
    await submit(page, locale);
    await expect(page.locator('[data-slot="alert-description"]')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/onboarding/individual/${profileId}\\?step=3$`));
    expect(state.completeRequests).toBe(0);
    state.invalidReceipt = false;
    await submit(page, locale);
    await expect(page).toHaveURL(new RegExp(`/onboarding/complete\\?profileId=${profileId}$`));
    await expect(page.locator('dl[aria-label]')).toContainText('Person Owner');
    await expect(page.locator('dl[aria-label]')).toContainText(
      locale === 'fa' ? 'در انتظار تأیید' : 'Pending verification'
    );
    expect(state.submissions).toHaveLength(2);
    expect(state.submissions[1]).toMatchObject({
      firstName: individual.firstName,
      lastName: individual.lastName,
      nationalId: individual.nationalId,
      provinceId,
      cityId,
      postalCode: individual.postalCode,
      fullAddress: 'Reviewed Street',
      draftVersion: state.draft.version,
    });
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'رفتن به داشبورد' : 'Go to dashboard',
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/app$/);
  });
  test(`company wizard restores drafts, selects a calendar date and confirms its summary (${locale})`, async ({
    page,
  }) => {
    const state = await fixture(page, locale, 'LEGAL', { ...legal });
    await page.goto(`/onboarding/legal/${profileId}`);
    await expect(page.locator('#representativeFirstName')).toHaveValue('Person');
    await next(page, locale);
    await expect(page.locator('#legalName')).toHaveValue('Saved Company');
    const date = page.locator('#registrationDate');
    await date.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('grid')).toHaveAttribute(
      'aria-label',
      locale === 'fa' ? /فروردین/ : /March/
    );
    await dialog
      .getByRole('button', { name: locale === 'fa' ? / ۲-ام فروردین ۱۴۰۵/ : /March 22nd/ })
      .click();
    await next(page, locale);
    await next(page, locale);
    await next(page, locale);
    expect(state.submissions).toHaveLength(0);
    await expect(page.locator('fieldset:not([hidden]) > section')).toContainText('Saved Company');
    await expect(page.locator('fieldset:not([hidden]) > section')).toContainText(
      locale === 'fa' ? 'مسئولیت محدود' : 'Limited liability'
    );
    await expect(page.locator('fieldset:not([hidden]) > section')).toContainText('2026-03-22');
    await submit(page, locale);
    await expect(page).toHaveURL(new RegExp(`/onboarding/complete\\?profileId=${profileId}$`));
    await expect(page.locator('dl[aria-label]')).toContainText('Saved Company');
    expect(state.submissions[0]).toMatchObject({
      registrationDate: '2026-03-22',
      draftVersion: state.draft.version,
      documents: [],
    });
  });
  test(`personal draft reload and conflict recovery keep current data (${locale})`, async ({
    page,
  }) => {
    const state = await fixture(page, locale, 'INDIVIDUAL', { ...individual });
    state.loadStatus = 503;
    await page.goto(`/onboarding/individual/${profileId}`);
    await expect(page.locator('#firstName')).toBeDisabled();
    state.loadStatus = 200;
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'دریافت نسخه ذخیره‌شده' : 'Reload saved draft',
        exact: true,
      })
      .click();
    await expect(page.locator('#firstName')).toHaveValue('Person');
    await next(page, locale);
    await page.locator('#fullAddress').fill('Local edit');
    state.saveStatus = 409;
    await next(page, locale, false);
    await expect(
      page.getByText(
        locale === 'fa'
          ? 'این پیش‌نویس تغییر کرده یا منقضی شده است. نسخه ذخیره‌شده را دوباره دریافت کنید.'
          : 'This draft changed or expired. Reload the saved version.',
        { exact: true }
      )
    ).toBeVisible();
    await expect(page.locator('#fullAddress')).toHaveValue('Local edit');
    state.draft = { version: 7, data: { ...individual, firstName: 'Other tab' } };
    state.saveStatus = 200;
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'دریافت نسخه ذخیره‌شده' : 'Reload saved draft',
        exact: true,
      })
      .click();
    await expect(page.locator('#firstName')).toBeVisible();
    await expect(page.locator('#firstName')).toHaveValue('Other tab');
    await page.reload();
    await expect(page.locator('#firstName')).toHaveValue('Other tab');
    expect(state.submissions).toHaveLength(0);
  });
}

const companyId = '44444444-4444-4444-8444-444444444444';
const journeyId = '55555555-5555-4555-8555-555555555555';
async function combinedFixture(page: Page, locale: 'en' | 'fa') {
  const original = await fixture(page, locale, 'INDIVIDUAL', { ...individual });
  const state = {
    started: false,
    personalDone: false,
    companyDone: false,
    completed: false,
    active: profileId,
    starts: [] as Record<string, unknown>[],
    finishes: [] as Record<string, unknown>[],
    startStatus: 201,
    finishMode: 'success' as 'success' | 'fail' | 'malformed',
  };
  const personal = () => ({
    id: profileId,
    profileType: 'INDIVIDUAL',
    status: state.personalDone ? 'ACTIVE' : 'DRAFT',
    isDefault: true,
    firstName: 'Person',
    lastName: 'Owner',
  });
  const company = () => ({
    id: companyId,
    profileType: 'LEGAL',
    status: state.companyDone ? 'VERIFIED' : 'DRAFT',
    isDefault: false,
    title: 'Saved Company',
  });
  const journey = () => ({
    id: journeyId,
    profiles: [personal(), company()],
    completed: state.completed,
    selectedProfileId: state.completed ? state.active : null,
    activeProfileId: state.active,
  });
  await page.route('**/api/onboarding/journeys/active', (r) =>
    r.fulfill({ json: { journey: state.started && !state.completed ? journey() : null } })
  );
  await page.route('**/api/onboarding/journeys', (r) => {
    state.starts.push(r.request().postDataJSON());
    state.started = true;
    return r.fulfill({
      status: state.startStatus,
      json: state.startStatus === 201 ? journey() : {},
    });
  });
  await page.route(`**/api/onboarding/journeys/${journeyId}`, (r) =>
    r.fulfill({ json: journey() })
  );
  await page.route(`**/api/onboarding/journeys/${journeyId}/finish`, (r) => {
    const input = r.request().postDataJSON();
    state.finishes.push(input);
    if (state.finishMode === 'fail') return r.fulfill({ status: 503, json: {} });
    if (state.finishMode === 'malformed')
      return r.fulfill({
        json: {
          ...journey(),
          completed: true,
          selectedProfileId: input.selectedProfileId,
          activeProfileId: profileId,
        },
      });
    state.active = input.selectedProfileId;
    state.completed = true;
    return r.fulfill({ json: journey() });
  });
  await page.route(`**/api/onboarding/individual/${profileId}`, (r) => {
    original.submissions.push(r.request().postDataJSON());
    state.personalDone = true;
    return r.fulfill({ json: personal() });
  });
  await page.route(`**/api/onboarding/complete/${profileId}`, (r) =>
    r.fulfill({ json: { ...personal(), journey: journey() } })
  );
  let companyDraft = { version: 0, data: { ...legal } };
  await page.route(`**/api/onboarding/draft/${companyId}`, (r) => {
    if (r.request().method() === 'PUT') {
      const input = r.request().postDataJSON();
      expect(input.expectedVersion).toBe(companyDraft.version);
      companyDraft = { version: companyDraft.version + 1, data: input.data };
    }
    return r.fulfill({ json: companyDraft });
  });
  await page.route(`**/api/onboarding/legal/${companyId}`, (r) => {
    expect(r.request().postDataJSON().draftVersion).toBe(companyDraft.version);
    state.companyDone = true;
    return r.fulfill({ json: company() });
  });
  await page.route(`**/api/onboarding/complete/${companyId}`, (r) =>
    r.fulfill({ json: { ...company(), journey: journey() } })
  );
  await page.route('**/api/auth/user', (r) =>
    r.fulfill({
      json: {
        userId: 'onboarding-viewer',
        isStaff: false,
        requiresTosAcceptance: false,
        navigation: {
          ...fullNavigation('customer', state.active === companyId ? 'LEGAL' : 'INDIVIDUAL'),
          profileId: state.active,
        },
      },
    })
  );
  await page.route('**/api/profiles', (r) =>
    r.fulfill({
      json: { activeProfileId: state.active, hasDefault: true, profiles: [personal(), company()] },
    })
  );
  return state;
}
for (const locale of ['en', 'fa'] as const) {
  test(`combined setup resumes saved wizards, reviews both profiles and saves an explicit dashboard choice (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await combinedFixture(page, locale);
    await page.goto('/onboarding');
    await page
      .getByRole('checkbox', { name: locale === 'fa' ? 'حقوقی' : 'Legal Entity', exact: true })
      .check();
    await page
      .getByRole('checkbox', { name: locale === 'fa' ? 'حقیقی' : 'Individual', exact: true })
      .check();
    expect(
      (await new AxeBuilder({ page }).include('main, .container').analyze()).violations
    ).toEqual([]);
    await page
      .getByRole('button', { name: locale === 'fa' ? 'ادامه' : 'Continue', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/onboarding/individual/${profileId}(?:\\?step=1)?$`));
    expect(state.starts[0]).toMatchObject({
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      profileTypes: ['INDIVIDUAL', 'LEGAL'],
    });
    await page.reload();
    await expect(page.locator('#firstName')).toHaveValue('Person');
    await next(page, locale);
    await next(page, locale);
    await submit(page, locale);
    await expect(page).toHaveURL(new RegExp(`/onboarding/legal/${companyId}(?:\\?step=1)?$`));
    await expect(page.locator('#representativeFirstName')).toHaveValue('Person');
    expect(state.finishes).toHaveLength(0);
    await dismissMessages(page, locale);
    await next(page, locale);
    await next(page, locale);
    await next(page, locale);
    await next(page, locale);
    await submit(page, locale);
    await expect(page.locator('dl[aria-label]')).toHaveCount(2);
    await expect(page.locator('dl[aria-label]').first()).toContainText('Person Owner');
    await expect(page.locator('dl[aria-label]').last()).toContainText('Saved Company');
    await expect(page.locator('dl[aria-label]').last()).toContainText(
      locale === 'fa' ? 'تأیید شده' : 'Verified'
    );
    await dismissMessages(page, locale);
    await expect(page.getByRole('radio', { name: 'Person Owner', exact: true })).toBeChecked();
    expect(state.finishes).toHaveLength(0);
    await page.getByRole('radio', { name: 'Saved Company', exact: true }).check();
    expect((await new AxeBuilder({ page }).include('.container').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    if (locale === 'fa')
      await page.screenshot({
        path: '/tmp/barghsa-onboarding-journeys-fa-summary.png',
        fullPage: true,
      });
    const done = page.getByRole('button', {
      name: locale === 'fa' ? 'پایان و ورود به داشبورد' : 'Done and open dashboard',
      exact: true,
    });
    state.finishMode = 'fail';
    await done.click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Saved Company', exact: true })).toBeChecked();
    state.finishMode = 'malformed';
    await done.click();
    await expect.poll(() => state.finishes.length).toBe(2);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/onboarding\/complete/);
    state.finishMode = 'success';
    await done.click();
    await expect(page).toHaveURL(/\/app$/);
    expect(state.finishes).toEqual(
      Array.from({ length: 3 }, () => ({ selectedProfileId: companyId }))
    );
    expect(state.starts).toHaveLength(1);
  });
  test(`lost setup response recovers the same unfinished profiles without another creation (${locale})`, async ({
    page,
  }) => {
    const state = await combinedFixture(page, locale);
    state.startStatus = 503;
    await page.goto('/onboarding');
    await page
      .getByRole('checkbox', { name: locale === 'fa' ? 'حقیقی' : 'Individual', exact: true })
      .check();
    await page
      .getByRole('checkbox', { name: locale === 'fa' ? 'حقوقی' : 'Legal Entity', exact: true })
      .check();
    await page
      .getByRole('button', { name: locale === 'fa' ? 'ادامه' : 'Continue', exact: true })
      .click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page
      .getByRole('button', { name: locale === 'fa' ? 'تلاش دوباره' : 'Retry', exact: true })
      .click();
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'ادامه تنظیم پروفایل' : 'Resume profile setup',
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(new RegExp(`/onboarding/individual/${profileId}(?:\\?step=1)?$`));
    expect(state.starts).toHaveLength(1);
    await expect(
      page.getByRole('button', {
        name: locale === 'fa' ? 'ذخیره و ادامه' : 'Save and continue',
        exact: true,
      })
    ).toBeVisible();
    await page.goto('/onboarding');
    state.personalDone = true;
    state.companyDone = true;
    await page.reload();
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'ادامه تنظیم پروفایل' : 'Resume profile setup',
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(new RegExp(`/onboarding/complete\\?journeyId=${journeyId}$`));
    await expect(page.locator('dl[aria-label]')).toHaveCount(2);
    expect(state.finishes).toHaveLength(0);
  });
  test(`setup read failure blocks creation and app routes require at least one profile (${locale})`, async ({
    page,
  }) => {
    const state = await combinedFixture(page, locale);
    let unavailable = true;
    await page.route('**/api/onboarding/journeys/active', (r) =>
      r.fulfill({ status: unavailable ? 503 : 200, json: { journey: null } })
    );
    await page.goto('/onboarding');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('checkbox').first()).toBeDisabled();
    expect(state.starts).toHaveLength(0);
    unavailable = false;
    await page
      .getByRole('button', { name: locale === 'fa' ? 'تلاش دوباره' : 'Retry', exact: true })
      .click();
    await expect(page.getByRole('checkbox').first()).toBeEnabled();
    await page.route('**/api/profiles', (r) =>
      r.fulfill({ json: { profiles: [], activeProfileId: null, hasDefault: false } })
    );
    for (const path of ['/app', '/app/unknown']) {
      await page.goto(path, { waitUntil: 'commit' });
      await expect(page).toHaveURL(/\/onboarding$/);
    }
    expect(state.starts).toHaveLength(0);
  });
}

const draftSummary = (id: string, type: 'INDIVIDUAL' | 'LEGAL', expired = false) => ({
  id,
  profileType: type,
  name: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  hasDraft: true,
  expired,
});
for (const locale of ['en', 'fa'] as const) {
  for (const type of ['INDIVIDUAL', 'LEGAL'] as const) {
    test(`unfinished ${type} resumes its saved fields without creating another profile (${locale})`, async ({
      page,
    }) => {
      const state = await fixture(page, locale, type, type === 'INDIVIDUAL' ? individual : legal);
      let starts = 0;
      await page.route('**/api/onboarding/journeys/active', (r) =>
        r.fulfill({ json: { journey: null } })
      );
      await page.route('**/api/onboarding/journeys', (r) => {
        starts++;
        return r.fulfill({ status: 500, json: {} });
      });
      await page.route('**/api/onboarding/drafts', (r) =>
        r.fulfill({ json: { drafts: [draftSummary(profileId, type)], nextAfter: null } })
      );
      await page.goto('/onboarding');
      const section = page.getByRole('region', {
        name: locale === 'fa' ? 'پروفایل‌های ناتمام' : 'Unfinished profiles',
      });
      await expect(section.getByRole('link')).toHaveAttribute(
        'href',
        `/onboarding/${type.toLowerCase()}/${profileId}?step=1`
      );
      expect((await new AxeBuilder({ page }).include('.container').analyze()).violations).toEqual(
        []
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      await section.getByRole('link').click();
      await expect(
        page.locator(type === 'INDIVIDUAL' ? '#firstName' : '#representativeFirstName')
      ).toHaveValue('Person');
      expect(starts).toBe(0);
      expect(state.submissions).toHaveLength(0);
    });
  }
}
for (const type of ['INDIVIDUAL', 'LEGAL'] as const) {
  test(`expired ${type} restarts the form on the same profile`, async ({ page }) => {
    const state = await fixture(page, 'en', type);
    state.draft.version = 5;
    await page.route('**/api/onboarding/journeys/active', (r) =>
      r.fulfill({ json: { journey: null } })
    );
    await page.route('**/api/onboarding/drafts', (r) =>
      r.fulfill({ json: { drafts: [draftSummary(profileId, type, true)], nextAfter: null } })
    );
    await page.goto('/onboarding');
    await page.getByRole('link', { name: 'Restart form' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/onboarding/${type.toLowerCase()}/${profileId}\\?step=1$`)
    );
    await expect(
      page.locator(type === 'INDIVIDUAL' ? '#firstName' : '#representativeFirstName')
    ).toHaveValue('');
    expect(state.draft.version).toBe(5);
    expect(state.saveRequests).toHaveLength(0);
  });
}
test('unfinished profile pages retain accepted rows and retry the same cursor', async ({
  page,
}) => {
  await fixture(page, 'en', 'INDIVIDUAL');
  await page.route('**/api/onboarding/journeys/active', (r) =>
    r.fulfill({ json: { journey: null } })
  );
  const id = (n: number) => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
  let later = 0;
  const cursors: string[] = [];
  await page.route('**/api/onboarding/drafts*', (r) => {
    const after = new URL(r.request().url()).searchParams.get('after');
    if (!after)
      return r.fulfill({
        json: {
          drafts: Array.from({ length: 50 }, (_, n) => draftSummary(id(100 - n), 'INDIVIDUAL')),
          nextAfter: id(51),
        },
      });
    cursors.push(after);
    return later++ === 0
      ? r.fulfill({ status: 503, json: {} })
      : r.fulfill({ json: { drafts: [draftSummary(id(50), 'LEGAL')], nextAfter: null } });
  });
  await page.goto('/onboarding');
  const section = page.getByRole('region', { name: 'Unfinished profiles' });
  await section.getByRole('button', { name: 'More profiles' }).click();
  await expect(section.getByRole('alert')).toBeVisible();
  await expect(section.getByRole('listitem')).toHaveCount(50);
  await section.getByRole('button', { name: 'Retry' }).click();
  await expect(section.getByRole('listitem')).toHaveCount(51);
  expect(cursors).toEqual([id(51), id(51)]);
});
test('a failed draft directory read blocks new profiles until retry succeeds', async ({ page }) => {
  const state = await combinedFixture(page, 'en');
  let reads = 0;
  await page.route('**/api/onboarding/drafts', (r) =>
    reads++ === 0
      ? r.fulfill({ status: 503, json: {} })
      : r.fulfill({ json: { drafts: [], nextAfter: null } })
  );
  await page.goto('/onboarding');
  await page.getByRole('checkbox', { name: 'Individual', exact: true }).check();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  expect(state.starts).toHaveLength(0);
  await page
    .getByRole('region', { name: 'Unfinished profiles' })
    .getByRole('button', { name: 'Retry' })
    .click();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
});
test('an existing setup remains resumable when the separate draft list is unavailable', async ({
  page,
}) => {
  const state = await combinedFixture(page, 'en');
  state.started = true;
  await page.route('**/api/onboarding/drafts', (r) => r.fulfill({ status: 503, json: {} }));
  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Resume profile setup' }).click();
  await expect(page.locator('#firstName')).toHaveValue('Person');
  expect(state.starts).toHaveLength(0);
});

for (const locale of ['en', 'fa'] as const)
  for (const type of ['INDIVIDUAL', 'LEGAL'] as const) {
    test(`${type} review sections return to the matching form without losing fields (${locale})`, async ({
      page,
    }) => {
      const state = await fixture(page, locale, type, type === 'INDIVIDUAL' ? individual : legal);
      const last = type === 'INDIVIDUAL' ? 3 : 5;
      await page.goto(`/onboarding/${type.toLowerCase()}/${profileId}?step=${last}`);
      const sections = page.locator('[data-review-section]');
      await expect(sections).toHaveCount(last - 1);
      await expect(sections.locator('input,select,textarea')).toHaveCount(0);
      await sections.first().getByRole('button').click();
      await expect(page).toHaveURL(/step=1$/);
      const field = page.locator(type === 'INDIVIDUAL' ? '#firstName' : '#representativeFirstName');
      await expect(field).toHaveValue('Person');
      await field.fill('Edited person');
      for (let stage = 1; stage < last; stage++) await next(page, locale);
      await expect(page.locator('[data-review-section="1"]')).toContainText('Edited person');
      expect(state.submissions).toHaveLength(0);
      expect((await new AxeBuilder({ page }).include('.container').analyze()).violations).toEqual(
        []
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      const addressSection = page.locator(
        `[data-review-section="${type === 'INDIVIDUAL' ? 2 : 3}"]`
      );
      await addressSection.getByRole('button').click();
      await expect(page).toHaveURL(new RegExp(`step=${type === 'INDIVIDUAL' ? 2 : 3}$`));
      await expect(
        page.locator(type === 'INDIVIDUAL' ? '#fullAddress' : '#officialFullAddress')
      ).toHaveValue(type === 'INDIVIDUAL' ? 'Saved Street' : 'Company Street');
    });
  }
