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
  };
  await page.addInitScript((language) => {
    localStorage.setItem('barghsa.locale', language);
  }, locale);
  await page.route('**/api/**', (r) => r.fulfill({ status: 404, json: {} }));
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
  await page.route(`**/api/onboarding/draft/${profileId}`, (r) => {
    if (r.request().method() === 'GET')
      return r.fulfill({ status: state.loadStatus, json: state.draft });
    const input = r.request().postDataJSON();
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
  await page.route(`**/api/onboarding/${type.toLowerCase()}/${profileId}`, (r) => {
    state.submissions.push(r.request().postDataJSON());
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
    await expect(page.locator('fieldset:not([hidden]) dl')).toContainText('Saved Street');
    await expect(page.locator('fieldset:not([hidden]) dl')).toContainText('1234567890');
    expect(state.submissions).toHaveLength(0);
    await page
      .getByRole('button', { name: locale === 'fa' ? 'مرحله قبل' : 'Back', exact: true })
      .click();
    await page.locator('#fullAddress').fill('Reviewed Street');
    await next(page, locale);
    await expect(page.locator('fieldset:not([hidden]) dl')).toContainText('Reviewed Street');
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
    await expect(page).toHaveURL(new RegExp(`/onboarding/individual/${profileId}$`));
    expect(state.completeRequests).toBe(0);
    state.invalidReceipt = false;
    await submit(page, locale);
    await expect(page).toHaveURL(new RegExp(`/onboarding/complete\\?profileId=${profileId}$`));
    await expect(page.locator('dl')).toContainText('Person Owner');
    await expect(page.locator('dl')).toContainText(
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
    await expect(page.locator('fieldset:not([hidden]) dl')).toContainText('Saved Company');
    await expect(page.locator('fieldset:not([hidden]) dl')).toContainText(
      locale === 'fa' ? 'مسئولیت محدود' : 'Limited liability'
    );
    await expect(page.locator('fieldset:not([hidden]) dl')).toContainText('2026-03-22');
    await submit(page, locale);
    await expect(page).toHaveURL(new RegExp(`/onboarding/complete\\?profileId=${profileId}$`));
    await expect(page.locator('dl')).toContainText('Saved Company');
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
          ? 'این پیش‌نویس در صفحه دیگری تغییر کرده است. نسخه ذخیره‌شده را دوباره دریافت کنید.'
          : 'This draft changed in another tab. Reload the saved version.',
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
    await expect(page).toHaveURL(new RegExp(`/onboarding/individual/${profileId}$`));
    expect(state.starts[0]).toMatchObject({
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      profileTypes: ['INDIVIDUAL', 'LEGAL'],
    });
    await page.reload();
    await expect(page.locator('#firstName')).toHaveValue('Person');
    await next(page, locale);
    await next(page, locale);
    await submit(page, locale);
    await expect(page).toHaveURL(new RegExp(`/onboarding/legal/${companyId}$`));
    await expect(page.locator('#representativeFirstName')).toHaveValue('Person');
    expect(state.finishes).toHaveLength(0);
    await dismissMessages(page, locale);
    await next(page, locale);
    await next(page, locale);
    await next(page, locale);
    await next(page, locale);
    await submit(page, locale);
    await expect(page.locator('dl')).toHaveCount(2);
    await expect(page.locator('dl').first()).toContainText('Person Owner');
    await expect(page.locator('dl').last()).toContainText('Saved Company');
    await expect(page.locator('dl').last()).toContainText(
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
    await expect(page).toHaveURL(new RegExp(`/onboarding/individual/${profileId}$`));
    expect(state.starts).toHaveLength(1);
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
    await expect(page.locator('dl')).toHaveCount(2);
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
      await page.goto(path);
      await expect(page).toHaveURL(/\/onboarding$/);
    }
    expect(state.starts).toHaveLength(0);
  });
}
