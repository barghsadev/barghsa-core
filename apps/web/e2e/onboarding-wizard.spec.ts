import { t } from '@barghsa/i18n/app';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { t as crmText } from '@barghsa/i18n/crm';
import { loadingText } from '@barghsa/i18n/loading-feedback';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { t as draftText } from '@barghsa/i18n/onboarding-drafts';
import { DEFAULT_VERIFICATION_POLICY } from '@barghsa/shared/verification';
import AxeBuilder from '@axe-core/playwright';
import { skipToMain } from './critical-accessibility';
import { test, expect, type Page, type Route } from './coverage-fixture';
import { fullNavigation } from './navigation-fixture';
import { dismissMessages } from './dismiss-messages';
import { productionManifest } from './production-manifest';
import { fulfillDashboard } from './dashboard-fixture';
import { mockPublicAuthCsrf } from './public-auth-fixture';
import { pdfPreviewFixture, test as uploadTest } from './upload-fixture';

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
    profileStatus: 'DRAFT',
    profileReadStatus: 200,
    profileReads: 0,
    permitClosedTransport: false,
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
    const reply = r.fulfill({ json: state.draft });
    return state.permitClosedTransport ? reply.catch(() => {}) : reply;
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
  await page.route(`**/api/profiles/${profileId}`, (r) => {
    expect(r.request().method()).toBe('GET');
    state.profileReads++;
    return r.fulfill({
      status: state.profileReadStatus,
      json: { ...receipt(), status: state.profileStatus },
    });
  });
  await page.route(`**/api/onboarding/${type.toLowerCase()}/${profileId}`, async (r) => {
    state.submissions.push(r.request().postDataJSON());
    await state.submitGate;
    const reply = r.fulfill({ json: receipt() });
    return state.permitClosedTransport ? reply.catch(() => {}) : reply;
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

for (const locale of ['en', 'fa'] as const)
  for (const address of ['personal', 'official', 'representative'] as const) {
    test(`dependent ${address} city selection retains drafts through failure and ignores late replies (${locale})`, async ({
      page,
    }) => {
      const type = address === 'personal' ? 'INDIVIDUAL' : 'LEGAL';
      const state = await fixture(page, locale, type, type === 'INDIVIDUAL' ? individual : legal);
      const nextProvince = '44444444-4444-4444-8444-444444444444';
      let fail = true;
      let finish!: () => void;
      let requested!: () => void;
      const waiting = new Promise<void>((resolve) => {
        requested = resolve;
      });
      const held = new Promise<void>((resolve) => {
        finish = resolve;
      });
      await page.route('**/api/geography/provinces', (route) =>
        route.fulfill({
          json: [
            { id: provinceId, nameFa: 'تهران', nameEn: 'Tehran' },
            { id: nextProvince, nameFa: 'فارس', nameEn: 'Fars' },
          ],
        })
      );
      await page.route(`**/api/geography/provinces/${provinceId}/cities`, (route) => {
        if (!fail) return route.fallback();
        return address === 'personal'
          ? route.abort('failed')
          : route.fulfill({ status: 503, json: {} });
      });
      await page.route(`**/api/geography/provinces/${nextProvince}/cities`, async (route) => {
        requested();
        await held;
        await route.fulfill({
          json: [
            { id: 'late-city', provinceId: nextProvince, nameFa: 'شیراز', nameEn: 'Late city' },
          ],
        });
      });
      const prefix = address === 'personal' ? '' : address;
      const field = (suffix: string) =>
        prefix ? prefix + suffix[0]!.toUpperCase() + suffix.slice(1) : suffix;
      const stage = address === 'personal' ? 2 : address === 'official' ? 3 : 1;
      await page.goto(`/onboarding/${type.toLowerCase()}/${profileId}?step=${stage}`);
      const city = page.locator('#' + field('cityId'));
      const province = page.locator('#' + field('provinceId'));
      const full = page.locator('#' + field('fullAddress'));
      const retry = page.getByTestId(
        address === 'personal' ? 'onboarding-cities-retry' : `onboarding-${address}-cities-retry`
      );
      const connectionNotice = page
        .locator('[data-sonner-toast][data-type="info"]')
        .filter({ hasText: loadingText('connectionRetry', locale) });
      await expect(retry).toBeVisible();
      await expect(city).toBeDisabled();
      await expect(connectionNotice).toHaveCount(0);
      await full.fill('Retained address draft');
      fail = false;
      await retry.click();
      await expect(city).toBeEnabled();
      await expect(connectionNotice).toHaveCount(address === 'personal' ? 1 : 0);
      await expect(city).toHaveValue(cityId);
      await expect(full).toHaveValue('Retained address draft');
      await province.selectOption(nextProvince);
      await waiting;
      await expect(city).toBeDisabled();
      await expect(city).toHaveAttribute('aria-busy', 'true');
      await expect(city).toHaveValue('');
      await province.selectOption(provinceId);
      await expect(city).toBeEnabled();
      await expect(city).toHaveValue('');
      finish();
      await city.selectOption(cityId);
      await expect(city.locator('option[value="late-city"]')).toHaveCount(0);
      await expect(full).toHaveValue('Retained address draft');
      expect(state.submissions).toHaveLength(0);
      await expect(city).toHaveAttribute('data-slot', 'dependent-select');
      expect((await new AxeBuilder({ page }).include('.container').analyze()).violations).toEqual(
        []
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (address === 'official')
        await page.locator('.container').screenshot({
          path: `/tmp/barghsa-dependent-select-${locale}-${test.info().project.name}.png`,
        });
    });
  }

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
    await skipToMain(page, locale);
    await expect(page.locator('#fullAddress')).toHaveValue('Saved Street');
    await page.reload();
    await expect(page.locator('#fullAddress')).toBeVisible();
    await next(page, locale);
    await expect(page).toHaveURL(/\?step=3$/);
    await expect(page.locator('main form div[tabindex="-1"][aria-label]')).toBeFocused();
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

  test(`stalled company submission recovers only from the saved profile (${locale})`, async ({
    page,
  }) => {
    const state = await fixture(page, locale, 'LEGAL', { ...legal });
    state.permitClosedTransport = true;
    let finishSubmit!: () => void;
    state.submitGate = new Promise<void>((resolve) => {
      finishSubmit = resolve;
    });
    await page.clock.install();
    try {
      await page.goto(`/onboarding/legal/${profileId}?step=5`);
      await expect(page.locator('fieldset:not([hidden]) > section')).toContainText(legal.legalName);
      await submit(page, locale);
      await expect.poll(() => state.submissions.length).toBe(1);
      await page.clock.fastForward(15_200);
      const main = page.getByRole('main');
      const review = main.getByRole('button', { name: draftText('checkSubmission', locale) });
      const submitButton = main.getByRole('button', {
        name: t('onboarding.wizard.submit', locale),
        exact: true,
      });
      await expect(main.getByRole('alert')).toContainText(
        draftText('submissionUnconfirmed', locale)
      );
      await expect(submitButton).toBeDisabled();
      state.profileReadStatus = 503;
      await review.click();
      await expect(main.getByRole('alert')).toContainText(
        draftText('submissionCheckFailed', locale)
      );
      await expect(submitButton).toBeDisabled();
      expect(state.submissions).toHaveLength(1);
      expect(state.completeRequests).toBe(0);

      state.profileReadStatus = 200;
      state.profileStatus = 'PENDING_VERIFICATION';
      await review.click();
      await expect(page).toHaveURL(new RegExp(`/onboarding/complete\\?profileId=${profileId}$`));
      await expect(page.locator('dl[aria-label]')).toContainText(legal.legalName);
      expect(state.profileReads).toBe(2);
      expect(state.submissions).toHaveLength(1);
      expect(state.completeRequests).toBe(1);
    } finally {
      finishSubmit();
    }
  });

  test(`stalled draft save retains edits and rejects a stale retry (${locale})`, async ({
    page,
  }) => {
    const state = await fixture(page, locale, 'INDIVIDUAL', { ...individual });
    state.permitClosedTransport = true;
    let finishSave!: () => void;
    state.saveGate = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    await page.clock.install();
    try {
      await page.goto(`/onboarding/individual/${profileId}`);
      const firstName = page.locator('#firstName');
      await expect(firstName).toHaveValue(individual.firstName);
      await firstName.fill('Retained Person');
      await page
        .getByRole('button', { name: t('onboarding.wizard.save', locale), exact: true })
        .click();
      await expect.poll(() => state.saveRequests.length).toBe(1);
      await page.clock.fastForward(15_200);
      await expect(
        page.getByText(t('onboarding.draft.error', locale), { exact: true })
      ).toBeVisible();
      await expect(firstName).toHaveValue('Retained Person');
      expect(state.saveRequests).toHaveLength(1);
      finishSave();
      await expect.poll(() => state.draft.version).toBe(1);
      state.saveStatus = 409;
      await page
        .getByRole('button', { name: t('onboarding.draft.retry', locale), exact: true })
        .click();
      await expect(
        page.getByText(t('onboarding.draft.conflict', locale), { exact: true })
      ).toBeVisible();
      expect(state.saveRequests.map((entry) => entry.expectedVersion)).toEqual([0, 0]);
      await page
        .getByRole('button', { name: t('onboarding.draft.reload', locale), exact: true })
        .click();
      await expect(firstName).toHaveValue('Retained Person');
      await expect(
        page.getByText(t('onboarding.draft.saved', locale), { exact: true })
      ).toBeVisible();
      expect(state.submissions).toHaveLength(0);
    } finally {
      finishSave();
    }
  });
}

for (const locale of ['en', 'fa'] as const) {
  for (const type of ['INDIVIDUAL', 'LEGAL'] as const) {
    test(`shared FormStep checks current fields and recovers every invalid final field for ${type} (${locale})`, async ({
      page,
    }) => {
      const personal = type === 'INDIVIDUAL';
      const name = personal ? 'firstName' : 'representativeFirstName';
      const postal = personal ? 'postalCode' : 'officialPostalCode';
      const saved = { ...(personal ? individual : legal), [name]: '', [postal]: '' };
      const state = await fixture(page, locale, type, saved);
      await page.goto(`/onboarding/${type.toLowerCase()}/${profileId}?step=${personal ? 3 : 5}`);
      await submit(page, locale);
      await expect(page.locator(`#${name}`)).toBeFocused();
      await expect(page).toHaveURL(new RegExp('step=1$'));
      expect(state.submissions).toHaveLength(0);
      await page.locator(`#${name}`).fill('Recovered person');
      await next(page, locale);
      await expect(page).toHaveURL(new RegExp('step=2$'));
      if (!personal) {
        await expect(page.locator('#legalName')).toHaveValue('Saved Company');
        await next(page, locale);
        await expect(page).toHaveURL(new RegExp('step=3$'));
      }
      await next(page, locale, false);
      await expect(page.locator(`#${postal}`)).toBeFocused();
      expect(state.submissions).toHaveLength(0);
      await page.locator(`#${postal}`).fill(locale === 'fa' ? '۱۲۳۴۵۶۷۸۹۰' : '1234567890');
      await next(page, locale);
      if (!personal) await next(page, locale);
      await expect(page).toHaveURL(new RegExp(`step=${personal ? 3 : 5}$`));
      await expect(page.locator('fieldset:not([hidden]) > section')).toContainText(
        'Recovered person'
      );
      expect((await new AxeBuilder({ page }).include('form').analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await submit(page, locale);
      await expect(page).toHaveURL(new RegExp(`/onboarding/complete\\?profileId=${profileId}$`));
      expect(state.submissions).toHaveLength(1);
      expect(state.submissions[0]).toMatchObject({
        [name]: 'Recovered person',
        [postal]: '1234567890',
      });
    });
  }
}

for (const locale of ['en', 'fa'] as const) {
  test(`FormStep recovers an invalid optional personal title without losing saved identity (${locale})`, async ({
    page,
  }) => {
    const state = await fixture(page, locale, 'INDIVIDUAL', {
      ...individual,
      title: 'x'.repeat(51),
    });
    await page.goto(`/onboarding/individual/${profileId}?step=3`);
    await submit(page, locale);
    await expect(page.locator('#title')).toBeFocused();
    await expect(page.locator('#title')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#title-error')).toBeVisible();
    await expect(page.locator('#firstName')).toHaveValue('Person');
    expect(state.submissions).toHaveLength(0);
    await page.locator('#title').fill('Recovered title');
    await next(page, locale);
    await next(page, locale);
    await submit(page, locale);
    await expect(page).toHaveURL(new RegExp(`/onboarding/complete\\?profileId=${profileId}$`));
    expect(state.submissions[0]).toMatchObject({ title: 'Recovered title', firstName: 'Person' });
  });
  test(`FormStep focuses the company province and preserves its address during final validation (${locale})`, async ({
    page,
  }) => {
    const state = await fixture(page, locale, 'LEGAL', {
      ...legal,
      officialProvinceId: '',
      officialCityId: '',
    });
    await page.goto(`/onboarding/legal/${profileId}?step=5`);
    await submit(page, locale);
    await expect(page.locator('#officialProvinceId')).toBeFocused();
    await expect(page.locator('#officialProvinceId')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#officialProvinceId-error')).toBeVisible();
    await expect(page.locator('#officialFullAddress')).toHaveValue('Company Street');
    expect(state.submissions).toHaveLength(0);
    if (locale === 'fa')
      await page.screenshot({ path: '/tmp/barghsa-form-step-fa-province.png', fullPage: true });
    expect((await new AxeBuilder({ page }).include('form').analyze()).violations).toEqual([]);
    await page.locator('#officialProvinceId').selectOption(provinceId);
    await page.locator('#officialCityId').selectOption(cityId);
    await next(page, locale);
    await next(page, locale);
    await submit(page, locale);
    await expect(page).toHaveURL(new RegExp(`/onboarding/complete\\?profileId=${profileId}$`));
    expect(state.submissions[0]).toMatchObject({
      officialProvinceId: provinceId,
      officialCityId: cityId,
      officialFullAddress: 'Company Street',
    });
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
    const firstName = page.locator('#firstName');
    await expect(firstName).toBeFocused();
    await expect(firstName).toHaveAccessibleName(t('onboarding.individual.firstName', locale));
    await expect(firstName).toHaveAttribute('required', '');
    await expect(firstName).toHaveAttribute('aria-required', 'true');
    await expect(page.locator('#title')).not.toHaveAttribute('aria-required', 'true');
    for (const field of ['lastName', 'nationalId'] as const) {
      const input = page.locator(`#${field}`);
      await expect(input).toHaveAccessibleName(t(`onboarding.individual.${field}`, locale));
      await expect(input).toHaveAttribute('aria-required', 'true');
    }
    await expect(firstName).toHaveAttribute('aria-invalid', 'true');
    await expect(firstName).toHaveAccessibleDescription(
      t('onboarding.individual.error.required', locale)
    );
    expect(state.submissions).toHaveLength(0);
    await firstName.fill(individual.firstName);
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
    const province = page.locator('#provinceId');
    const city = page.locator('#cityId');
    await expect(province).toHaveAccessibleName(t('onboarding.individual.province', locale));
    await expect(city).toHaveAccessibleName(t('onboarding.individual.city', locale));
    await expect(province).toHaveAttribute('aria-required', 'true');
    await expect(city).toHaveAttribute('aria-required', 'true');
    await expect(city).toBeDisabled();
    await province.selectOption(provinceId);
    await expect(city).toBeEnabled();
    await city.selectOption(cityId);
    for (const [id, field] of [
      ['fullAddress', 'address'],
      ['postalCode', 'postalCode'],
    ] as const) {
      const input = page.locator(`#${id}`);
      await expect(input).toHaveAccessibleName(t(`onboarding.individual.${field}`, locale));
      await expect(input).toHaveAttribute('aria-required', 'true');
    }
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
    await page.getByRole('button', { name: draftText('checkSubmission', locale) }).click();
    await expect(page.getByText(draftText('submissionUnconfirmed', locale))).toHaveCount(0);
    expect(state.profileReads).toBe(1);
    expect(state.submissions).toHaveLength(1);
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
    await expect(page.locator('#representativeHonorific')).not.toHaveAttribute(
      'aria-required',
      'true'
    );
    for (const field of [
      'representativeFirstName',
      'representativeLastName',
      'representativeNationalId',
      'representativeProvinceId',
      'representativeCityId',
      'representativeFullAddress',
      'representativePostalCode',
    ] as const) {
      const input = page.locator(`#${field}`);
      await expect(input).toHaveAccessibleName(t(`onboarding.legal.${field}`, locale));
      await expect(input).toHaveAttribute('aria-required', 'true');
    }
    for (const field of ['representativeTitle', 'representativeRelationship']) {
      await expect(page.locator(`#${field}`)).toHaveAttribute('aria-required', 'true');
    }
    await next(page, locale);
    await expect(page.locator('#legalName')).toHaveValue('Saved Company');
    for (const field of ['legalName', 'nationalIdentifier', 'registrationNumber']) {
      await expect(page.locator(`#${field}`)).toHaveAttribute('aria-required', 'true');
    }
    const companyType = page.locator('#companyTypeId');
    await expect(companyType).toHaveAccessibleName(locale === 'fa' ? 'نوع شرکت' : 'Company Type');
    await expect(companyType).toHaveAttribute('aria-required', 'true');
    await companyType.selectOption('');
    await next(page, locale, false);
    await expect(companyType).toBeFocused();
    await expect(companyType).toHaveAccessibleDescription(
      locale === 'fa' ? 'نوع شرکت الزامی است' : 'Company type is required'
    );
    await companyType.selectOption(legal.companyTypeId);
    const date = page.locator('#registrationDate');
    await expect(date).not.toHaveAttribute('aria-required', 'true');
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
    const postal = page.locator('#officialPostalCode');
    await expect(postal).toHaveAccessibleName(locale === 'fa' ? 'کد پستی' : 'Postal Code');
    await expect(postal).toHaveAttribute('aria-required', 'true');
    for (const field of ['officialProvinceId', 'officialCityId', 'officialFullAddress']) {
      await expect(page.locator(`#${field}`)).toHaveAttribute('aria-required', 'true');
    }
    await expect(page.locator('#officialCityId')).toBeEnabled();
    await postal.clear();
    await next(page, locale, false);
    await expect(postal).toBeFocused();
    await expect(postal).toHaveAccessibleDescription(
      t('onboarding.legal.required.postalCode', locale)
    );
    await postal.fill(legal.officialPostalCode);
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

for (const locale of ['fa', 'en'] as const)
  for (const type of ['INDIVIDUAL', 'LEGAL'] as const) {
    uploadTest(
      `registration through ${type} onboarding and account handoff (${locale})`,
      async ({ page, uploadReceiver }) => {
        uploadTest.setTimeout(60_000);
        const state = await fixture(page, locale, type);
        const isLegal = type === 'LEGAL';
        const profileType = isLegal ? 'legal' : 'individual';
        const name = isLegal ? legal.legalName : `${individual.firstName} ${individual.lastName}`;
        const username = 'onboarding-registration@example.test';
        const password = 'Registration-browser-password-123!';
        const challengeId = '66666666-6666-4666-8666-666666666666';
        const termsId = '77777777-7777-4777-8777-777777777777';
        const csrf = 'registered-onboarding-session';
        const stamp = '2026-10-04T10:00:00.000Z';
        let registrationStarted = false;
        let signedIn = false;
        let created = false;
        let finished = false;
        let staff = false;
        const profile = () => ({
          id: profileId,
          profileType: type,
          status: state.profileStatus,
          isDefault: finished,
          ...(isLegal
            ? { title: name }
            : { firstName: individual.firstName, lastName: individual.lastName }),
        });
        const journey = () => ({
          id: journeyId,
          profiles: [profile()],
          completed: finished,
          selectedProfileId: finished ? profileId : null,
          activeProfileId: finished ? profileId : null,
        });
        const expectPost = (route: Route, token = csrf) => {
          expect(route.request().method()).toBe('POST');
          expect(route.request().headers()['x-csrf-token']).toBe(token);
        };
        await mockPublicAuthCsrf(page);
        await page.route('**/api/tos/current?*', (r) =>
          r.fulfill({
            json: {
              id: termsId,
              versionId: 'v1',
              content: 'Published test terms',
              updatedAt: stamp,
              publishedAt: stamp,
            },
          })
        );
        await page.route('**/api/auth/user', (r) =>
          r.fulfill(
            signedIn
              ? {
                  json: {
                    userId: staff ? 'verification-reviewer' : 'onboarding-viewer',
                    isStaff: staff,
                    requiresTosAcceptance: false,
                    operatingContext: staff ? 'staff' : 'customer',
                    navigation: staff
                      ? fullNavigation('staff')
                      : {
                          ...fullNavigation('customer', type),
                          profileId: finished ? profileId : null,
                        },
                  },
                }
              : { status: 401, json: {} }
          )
        );
        await page.route('**/api/auth/register', (r) => {
          expectPost(r, 'c'.repeat(64));
          expect(registrationStarted).toBe(false);
          expect(r.request().postDataJSON()).toEqual({ username, password, tosVersionId: termsId });
          registrationStarted = true;
          return r.fulfill({ json: { challengeId } });
        });
        await page.route('**/api/auth/register/verify', (r) => {
          expectPost(r, 'c'.repeat(64));
          expect(registrationStarted).toBe(true);
          expect(signedIn).toBe(false);
          expect(r.request().postDataJSON()).toEqual({ challengeId, otp: '123456' });
          signedIn = true;
          return r.fulfill({
            headers: { 'set-cookie': `barghsa_csrf=${csrf}; Path=/; SameSite=Lax` },
            json: {
              userId: 'onboarding-viewer',
              sessionId: 'test-session',
              csrfToken: csrf,
              expiresAt: '2030-01-01T00:00:00.000Z',
            },
          });
        });
        await page.route('**/api/profiles', (r) =>
          r.fulfill({
            json: {
              profiles: created ? [profile()] : [],
              activeProfileId: finished ? profileId : null,
              hasDefault: finished,
            },
          })
        );
        await page.route('**/api/onboarding/journeys/active', (r) =>
          r.fulfill({ json: { journey: created && !finished ? journey() : null } })
        );
        await page.route('**/api/onboarding/journeys', (r) => {
          expectPost(r);
          expect(signedIn && !created).toBe(true);
          expect(r.request().postDataJSON()).toEqual({
            profileTypes: [type],
            requestId: expect.stringMatching(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i),
          });
          created = true;
          return r.fulfill({ status: 201, json: journey() });
        });
        await page.route(`**/api/onboarding/${profileType}/${profileId}`, (r) => {
          expectPost(r);
          expect(created && state.profileStatus === 'DRAFT').toBe(true);
          const fields = isLegal
            ? {
                legalName: legal.legalName,
                nationalIdentifier: legal.nationalIdentifier,
                registrationNumber: legal.registrationNumber,
                companyTypeId: legal.companyTypeId,
                representativeNationalId: legal.representativeNationalId,
                representativeRelationship: legal.representativeRelationship,
                representativeFullAddress: legal.representativeFullAddress,
                officialFullAddress: legal.officialFullAddress,
                officialPostalCode: legal.officialPostalCode,
                documents: [],
              }
            : {
                firstName: individual.firstName,
                lastName: individual.lastName,
                nationalId: individual.nationalId,
                provinceId,
                cityId,
                fullAddress: individual.fullAddress,
                postalCode: individual.postalCode,
              };
          expect(r.request().postDataJSON()).toMatchObject({
            ...fields,
            draftVersion: state.draft.version,
          });
          state.submissions.push(r.request().postDataJSON());
          state.profileStatus = 'PENDING_VERIFICATION';
          return r.fulfill({ json: profile() });
        });
        await page.route(`**/api/onboarding/complete/${profileId}`, (r) => {
          expectPost(r);
          expect(state.profileStatus).toBe('PENDING_VERIFICATION');
          return r.fulfill({ json: { ...profile(), journey: journey() } });
        });
        await page.route(`**/api/onboarding/journeys/${journeyId}`, (r) =>
          r.fulfill({ json: journey() })
        );
        await page.route(`**/api/onboarding/journeys/${journeyId}/finish`, (r) => {
          expectPost(r);
          expect(finished).toBe(false);
          expect(state.profileStatus).toBe('PENDING_VERIFICATION');
          expect(r.request().postDataJSON()).toEqual({ selectedProfileId: profileId });
          finished = true;
          return r.fulfill({ json: journey() });
        });
        await page.route('**/api/profiles/verification-status', (r) =>
          r.fulfill({
            json: {
              activeProfileId: finished ? profileId : null,
              activeProfileName: name,
              profileStatus: state.profileStatus,
              isVerified: state.profileStatus === 'VERIFIED',
              verificationRequired: true,
            },
          })
        );
        await page.route('**/api/dashboard{,/**}', (r) => {
          expect(finished).toBe(true);
          return fulfillDashboard(r, { json: { profile: { id: profileId, name } } });
        });

        await page.goto('/register');
        await page.locator('#username').fill(username);
        await page.locator('#username').press('Tab');
        await page.locator('#password').fill(password);
        const strength = page.locator('#password-strength').getByRole('progressbar');
        await expect(strength).toHaveAttribute('aria-busy', 'false');
        await expect(strength).toHaveAttribute('aria-valuenow', '100');
        await page.getByRole('checkbox').check();
        await page.locator('main button[type=submit]').click();
        await expect(page).toHaveURL(/\/register\/verify\?/);
        expect(new URL(page.url()).searchParams.get('destination')).toContain('***');
        expect(page.url()).not.toContain(username);
        await page
          .locator('input[inputmode=numeric]')
          .first()
          .fill(locale === 'fa' ? '۱۲۳۴۵۶' : '123456');
        await expect(page).toHaveURL(/\/onboarding$/);
        await page
          .getByRole('checkbox', {
            name: t(`onboarding.profile.${profileType}`, locale),
            exact: true,
          })
          .check();
        await page
          .getByRole('button', { name: t('onboarding.type.continue', locale), exact: true })
          .click();
        await expect(page).toHaveURL(
          new RegExp(`/onboarding/${profileType}/${profileId}(?:\\?step=1)?$`)
        );

        const fill = async (values: Record<string, string>) => {
          for (const [key, value] of Object.entries(values))
            await page.locator(`#${key}`).fill(value);
        };
        const address = async (prefix: '' | 'representative' | 'official', street: string) => {
          const field = (key: string) =>
            prefix ? `${prefix}${key[0]!.toUpperCase()}${key.slice(1)}` : key;
          await page.locator(`#${field('provinceId')}`).selectOption(provinceId);
          await page.locator(`#${field('cityId')}`).selectOption(cityId);
          await fill({
            [field('fullAddress')]: street,
            [field('postalCode')]: individual.postalCode,
          });
        };
        if (isLegal) {
          await fill({
            representativeFirstName: legal.representativeFirstName,
            representativeLastName: legal.representativeLastName,
            representativeNationalId: legal.representativeNationalId,
            representativeTitle: legal.representativeTitle,
            representativeRelationship: legal.representativeRelationship,
          });
          await address('representative', legal.representativeFullAddress);
          await next(page, locale);
          await fill({
            legalName: name,
            nationalIdentifier: legal.nationalIdentifier,
            registrationNumber: legal.registrationNumber,
          });
          await page.locator('#companyTypeId').selectOption(legal.companyTypeId);
          await next(page, locale);
          await address('official', legal.officialFullAddress);
          await next(page, locale);
        } else {
          await fill({
            firstName: individual.firstName,
            lastName: individual.lastName,
            nationalId: individual.nationalId,
          });
          await next(page, locale);
          await address('', individual.fullAddress);
        }
        await next(page, locale);
        const reviewFields = page.locator('fieldset:not([hidden]) > section');
        for (const value of isLegal ? [name] : [individual.firstName, individual.lastName]) {
          await expect(reviewFields.getByText(value, { exact: true })).toBeVisible();
        }
        await submit(page, locale);
        await expect(
          page.getByRole('heading', { name: t('onboarding.complete.title', locale) })
        ).toBeVisible();
        await expect(page.locator('dl[aria-label]')).toContainText(
          t('onboarding.wizard.PENDING_VERIFICATION', locale)
        );
        expect(state.submissions).toHaveLength(1);
        await page
          .getByRole('button', { name: t('onboarding.journey.done', locale), exact: true })
          .click();
        await expect(page).toHaveURL(/\/app$/);
        const welcome = page.getByRole('heading', { name: new RegExp(name) });
        await expect(welcome).toBeVisible();
        if (!isLegal) return;

        const pendingNotice = page.getByTestId('verification-notice');
        await expect(pendingNotice).toBeVisible();
        const policy = structuredClone(DEFAULT_VERIFICATION_POLICY);
        policy.LEGAL.documents = ['registration_notice'];
        const key = 'uploads/document/legal-registration-review.pdf';
        const pdf = pdfPreviewFixture();
        let verificationWrites = 0;
        await page.route(`**/api/crm/profiles/${profileId}`, (r) =>
          r.fulfill({
            json: {
              profile: {
                ...profile(),
                archived: false,
                archivedAt: null,
                archivedReason: null,
                firstName: null,
                lastName: null,
                nationalId: null,
                contactEmail: username,
                contactMobile: null,
                createdAt: stamp,
                updatedAt: stamp,
              },
              user: {
                userId: 'onboarding-viewer',
                username,
                email: username,
                mobile: null,
                lastLogin: null,
                lastPasswordChange: null,
                isAdmin: false,
                createdAt: stamp,
              },
              viewerPermissions: {
                canVerify: true,
                canEdit: false,
                canManageUser: false,
                canOverrideVerification: false,
              },
              verificationPolicy: policy,
              verificationCurrent: state.profileStatus === 'VERIFIED',
              legalInfo: null,
              addresses: [],
              sessions: { count: 0, entries: [], lastActive: null },
              siblingProfiles: [],
              agentRelationships: { items: [], nextCursor: null },
              verificationHistory: { items: [], nextCursor: null },
            },
          })
        );
        await page.route('**/api/upload/presigned-url', (r) => {
          expectPost(r);
          expect(r.request().postDataJSON()).toMatchObject({
            profileId,
            purpose: 'verification_evidence',
            fileSize: pdf.length,
          });
          return r.fulfill({ json: { key, presignedUrl: uploadReceiver.url } });
        });
        await page.route(`**/api/upload/${encodeURIComponent(key)}/verify`, (r) => {
          expectPost(r);
          expect(uploadReceiver.uploads).toHaveLength(1);
          expect(uploadReceiver.uploads[0]).toMatchObject({ method: 'PUT', body: pdf });
          return r.fulfill({ json: { status: 'confirmed' } });
        });
        await page.route(`**/api/upload/${encodeURIComponent(key)}/record`, (r) => {
          expectPost(r);
          return r.fulfill({ status: 201, json: {} });
        });
        await page.route(`**/api/crm/profiles/${profileId}/verify`, (r) => {
          expectPost(r);
          expect(staff).toBe(true);
          expect(state.profileStatus).toBe('PENDING_VERIFICATION');
          expect(r.request().postDataJSON()).toEqual({
            action: 'verify',
            evidence: [{ type: 'registration_notice', key }],
          });
          verificationWrites++;
          state.profileStatus = 'VERIFIED';
          return r.fulfill({
            json: {
              success: true,
              profileId,
              previousStatus: 'PENDING_VERIFICATION',
              newStatus: 'VERIFIED',
              reason: null,
            },
          });
        });
        staff = true;
        await page.goto(`/admin/crm/profiles/${profileId}`);
        const review = page.getByRole('button', {
          name: crmText('crm.profile.verification.review', locale),
          exact: true,
        });
        const evidence = page.locator('#verification-file-registration_notice');
        await review.click();
        await expect(evidence).toBeFocused();
        await expect(evidence).toHaveAttribute('aria-invalid', 'true');
        expect(uploadReceiver.uploads).toHaveLength(0);
        expect(verificationWrites).toBe(0);
        await evidence.setInputFiles({
          name: 'registration-notice.pdf',
          mimeType: 'application/pdf',
          buffer: pdf,
        });
        await review.click();
        const confirmation = page.getByRole('dialog');
        await expect(confirmation).toBeVisible();
        expect(verificationWrites).toBe(0);
        await confirmation
          .getByRole('button', { name: adminText('team.confirm', locale), exact: true })
          .click();
        await expect(confirmation).toHaveCount(0);
        expect(verificationWrites).toBe(1);
        staff = false;
        const verifiedStatus = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === '/api/profiles/verification-status' &&
            response.request().method() === 'GET'
        );
        await page.goto('/app');
        const statusResponse = await verifiedStatus;
        expect(statusResponse.ok()).toBe(true);
        expect(await statusResponse.json()).toMatchObject({
          activeProfileId: profileId,
          profileStatus: 'VERIFIED',
          isVerified: true,
        });
        await expect(welcome).toBeVisible();
        await expect(pendingNotice).toHaveCount(0);
      }
    );
  }

async function combinedFixture(page: Page, locale: 'en' | 'fa') {
  const original = await fixture(page, locale, 'INDIVIDUAL', { ...individual });
  const state = {
    started: false,
    personalDone: false,
    companyDone: false,
    completed: false,
    active: profileId,
    selected: null as string | null,
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
    selectedProfileId: state.selected,
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
    state.selected = input.selectedProfileId;
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
  return Object.assign(state, { receipt: journey });
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
    await expect(page.locator('#firstName')).toHaveValue('Person');
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
    const heading = page.getByRole('heading', {
      name: t('onboarding.complete.title', locale),
      exact: true,
    });
    await heading.scrollIntoViewIfNeeded();
    const notice = page.locator('[data-sonner-toast][data-visible="true"]').first();
    await expect(notice).toBeVisible();
    await expect(page.locator('[data-sonner-toaster]').first()).toHaveCSS('position', 'fixed');
    await expect(page.locator('.animate-confetti-drop').first()).toHaveCSS(
      'animation-name',
      'confetti-drop'
    );
    await expect
      .poll(async () => {
        const headingBottom = await heading.evaluate(
          (element) => element.getBoundingClientRect().bottom
        );
        const noticeTop = await notice.evaluate((element) => element.getBoundingClientRect().top);
        return noticeTop - headingBottom;
      })
      .toBeGreaterThanOrEqual(15.5);
    const layering = await heading.evaluate((element) => {
      const particle = document.querySelector<HTMLElement>('.animate-confetti-drop')!;
      const saved = particle.getAttribute('style')!;
      const box = element.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const context = document.createElement('canvas').getContext('2d')!;
      context.fillStyle = getComputedStyle(element.parentElement!).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      try {
        // Put a real particle over the heading and temporarily enable hit testing.
        Object.assign(particle.style, {
          position: 'fixed',
          left: `${x - 10}px`,
          top: `${y - 10}px`,
          width: '20px',
          height: '20px',
          animation: 'none',
          opacity: '1',
          pointerEvents: 'auto',
        });
        return {
          headingOnTop: element.contains(document.elementFromPoint(x, y)),
          surfaceAlpha: context.getImageData(0, 0, 1, 1).data[3],
        };
      } finally {
        particle.setAttribute('style', saved);
      }
    });
    expect(layering).toEqual({ headingOnTop: true, surfaceAlpha: 255 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.animate-confetti-drop').first()).toBeHidden();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
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
        path: test.info().outputPath('onboarding-journeys-fa-summary.png'),
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
    let heldStart: Route | undefined;
    await page.route('**/api/onboarding/journeys', (route) => {
      state.starts.push(route.request().postDataJSON());
      state.started = true;
      heldStart = route;
    });
    await page.goto('/onboarding');
    await page
      .getByRole('checkbox', { name: locale === 'fa' ? 'حقیقی' : 'Individual', exact: true })
      .check();
    await page
      .getByRole('checkbox', { name: locale === 'fa' ? 'حقوقی' : 'Legal Entity', exact: true })
      .check();
    await page.clock.install();
    await page
      .getByRole('button', { name: locale === 'fa' ? 'ادامه' : 'Continue', exact: true })
      .click();
    await expect.poll(() => !!heldStart).toBe(true);
    await page.clock.fastForward(15_001);
    await expect(page.getByRole('alert')).toBeVisible();
    await heldStart!.fulfill({ status: 503, json: {} }).catch(() => {});
    await page
      .getByRole('button', { name: locale === 'fa' ? 'تلاش دوباره' : 'Retry', exact: true })
      .click();
    const resume = page.getByRole('button', {
      name: locale === 'fa' ? 'ادامه تنظیم پروفایل' : 'Resume profile setup',
      exact: true,
    });
    await resume.click();
    await expect(page).toHaveURL(new RegExp(`/onboarding/individual/${profileId}(?:\\?step=1)?$`));
    expect(state.starts).toHaveLength(1);
    await expect(
      page.getByRole('button', {
        name: locale === 'fa' ? 'ذخیره و ادامه' : 'Save and continue',
        exact: true,
      })
    ).toBeVisible();
    await page.goto('/onboarding');
    await expect(resume).toBeVisible();
    state.personalDone = true;
    state.companyDone = true;
    await page.reload();
    await resume.click();
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
      await page.goto(path);
      await expect(page).toHaveURL(/\/onboarding$/);
      await expect(page.getByRole('checkbox').first()).toBeEnabled();
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
for (const locale of ['en', 'fa'] as const) {
  test(`onboarding announces a held draft directory before enabling creation (${locale})`, async ({
    page,
  }) => {
    const state = await combinedFixture(page, locale);
    const manifest = await productionManifest();
    const file = manifest['src/components/OnboardingDraftList.tsx']!.file;
    let module: Route | undefined;
    let reads = 0;
    await page.route(`**/${file}`, (route) => {
      module = route;
    });
    await page.route('**/api/onboarding/drafts', (route) => {
      reads++;
      return route.fulfill({ json: { drafts: [], nextAfter: null } });
    });
    await page.goto('/onboarding', { waitUntil: 'commit' });
    await page.getByRole('checkbox', { name: t('onboarding.profile.individual', locale) }).check();
    const proceed = page.getByRole('button', { name: t('onboarding.type.continue', locale) });
    const loading = page.getByRole('status').filter({ hasText: draftText('loading', locale) });
    await expect.poll(() => !!module).toBe(true);
    await expect(loading).toBeVisible();
    await expect(proceed).toBeDisabled();
    expect(reads).toBe(0);
    await module!.continue();
    await expect(proceed).toBeEnabled();
    await expect(loading).toHaveCount(0);
    expect(reads).toBe(1);
    expect(state.starts).toHaveLength(0);
  });
}

test('a stalled or failed draft directory blocks new profiles until retry succeeds', async ({
  page,
}) => {
  const state = await combinedFixture(page, 'en');
  await page.clock.install();
  let reads = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finish!: () => void;
  const lateResponseAttempted = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route('**/api/onboarding/drafts', async (route) => {
    if (++reads === 1) {
      await held;
      await route
        .fulfill({ json: { drafts: [draftSummary(profileId, 'INDIVIDUAL')], nextAfter: null } })
        .catch(() => {})
        .finally(finish);
      return;
    }
    if (reads === 2) return route.fulfill({ status: 503, json: {} });
    return route.fulfill({ json: { drafts: [], nextAfter: null } });
  });
  await page.goto('/onboarding');
  await page.getByRole('checkbox', { name: 'Individual', exact: true }).check();
  const proceed = page.getByRole('button', { name: 'Continue', exact: true });
  const section = page.getByRole('region', { name: 'Unfinished profiles' });
  const retry = section.getByRole('button', { name: 'Retry' });
  try {
    await expect.poll(() => reads).toBe(1);
    await expect(proceed).toBeDisabled();
    await page.clock.fastForward(15_001);
    await expect(retry).toBeVisible();
    await expect(proceed).toBeDisabled();
    expect(state.starts).toHaveLength(0);
    await retry.click();
    await expect.poll(() => reads).toBe(2);
    await expect(retry).toBeVisible();
    await expect(proceed).toBeDisabled();
    await retry.click();
    await expect(proceed).toBeEnabled();
    expect(reads).toBe(3);
    expect(state.starts).toHaveLength(0);
  } finally {
    release();
  }
  await lateResponseAttempted;
  await expect(section).toHaveCount(0);
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

for (const locale of ['fa', 'en'] as const) {
  test(`an unconfirmed finish reloads the current profile without writing again (${locale})`, async ({
    page,
  }) => {
    const state = await combinedFixture(page, locale);
    state.personalDone = state.companyDone = true;
    let heldFinish: Route | undefined;
    await page.route(`**/api/onboarding/journeys/${journeyId}/finish`, (route) => {
      const input = route.request().postDataJSON();
      state.finishes.push(input);
      state.selected = state.active = input.selectedProfileId;
      state.completed = true;
      heldFinish = route;
    });
    await page.goto(`/onboarding/complete?journeyId=${journeyId}`);
    const company = page.getByRole('radio', { name: 'Saved Company', exact: true });
    const person = page.getByRole('radio', { name: 'Person Owner', exact: true });
    const done = page.getByRole('button', {
      name: t('onboarding.journey.done', locale),
      exact: true,
    });
    await company.check();
    await page.clock.install();
    await done.click();
    await expect.poll(() => !!heldFinish).toBe(true);
    await page.clock.fastForward(15_001);
    await expect(page.getByRole('alert')).toContainText(confirmationText('unconfirmed', locale));
    await expect(company).toBeChecked();
    await expect(person).toBeDisabled();
    await heldFinish!.fulfill({ json: state.receipt() }).catch(() => {});
    expect(state.finishes).toEqual([{ selectedProfileId: companyId }]);
    await expect(page).toHaveURL(/\/onboarding\/complete/);

    // Another tab switches the profile after the stored choice was applied.
    state.active = profileId;
    await page
      .getByRole('button', { name: confirmationText('checkStatus', locale), exact: true })
      .click();
    await expect(company).toBeChecked();
    await expect(person).toBeDisabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await done.click();
    await expect(page).toHaveURL(/\/app$/);
    expect(state.finishes).toHaveLength(1);
    expect(state.active).toBe(profileId);
  });

  test(`missing or conflicting completion targets return to setup without a write (${locale})`, async ({
    page,
  }) => {
    const state = await fixture(page, locale, 'INDIVIDUAL', individual);
    const requestPaths: string[] = [];
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname;
      if (
        pathname.startsWith('/api/onboarding/complete/') ||
        pathname.startsWith('/api/onboarding/journeys/')
      )
        requestPaths.push(pathname);
    });
    for (const query of ['', `?profileId=${profileId}&journeyId=${journeyId}`]) {
      await page.goto(`/onboarding/complete${query}`);
      await expect(page.getByRole('alert')).toContainText(
        t('onboarding.complete.missingProfile', locale)
      );
      await expect(
        page.getByRole('button', { name: t('onboarding.draft.retry', locale), exact: true })
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', {
          name: t('onboarding.complete.backToSetup', locale),
          exact: true,
        })
      ).toBeVisible();
      await expect(page.locator('.animate-confetti-drop')).toHaveCount(0);
    }
    expect(requestPaths).toEqual([]);
    expect(state.completeRequests).toBe(0);
  });

  test(`a stalled profile completion only retries the same profile explicitly (${locale})`, async ({
    page,
  }) => {
    const state = await fixture(page, locale, 'INDIVIDUAL', individual);
    const receipt = {
      id: profileId,
      profileType: 'INDIVIDUAL',
      status: 'ACTIVE',
      isDefault: true,
      firstName: 'Person',
      lastName: 'Owner',
    };
    let heldCompletion: Route | undefined;
    await page.route(`**/api/onboarding/complete/${profileId}`, (route) => {
      expect(route.request().method()).toBe('POST');
      if (++state.completeRequests > 1) return route.fulfill({ json: receipt });
      heldCompletion = route;
    });
    await page.clock.install();
    await page.goto(`/onboarding/complete?profileId=${profileId}`);
    await expect.poll(() => !!heldCompletion).toBe(true);
    await page.clock.fastForward(15_001);
    await expect(page.getByRole('alert')).toContainText(t('onboarding.complete.error', locale));
    await expect(page.locator('.animate-confetti-drop')).toHaveCount(0);
    await heldCompletion!.fulfill({ json: receipt }).catch(() => {});
    expect(state.completeRequests).toBe(1);
    await page
      .getByRole('button', { name: t('onboarding.draft.retry', locale), exact: true })
      .click();
    await expect(page.locator('dl[aria-label]')).toContainText('Person Owner');
    expect(state.completeRequests).toBe(2);
  });

  test(`a stalled completion read can be retried without sending a completion command (${locale})`, async ({
    page,
  }) => {
    const state = await combinedFixture(page, locale);
    state.personalDone = state.companyDone = true;
    let reads = 0;
    let release!: () => void;
    const held = new Promise<void>((done) => {
      release = done;
    });
    await page.route(`**/api/onboarding/journeys/${journeyId}`, async (route) => {
      expect(route.request().method()).toBe('GET');
      const receipt = {
        id: journeyId,
        completed: false,
        selectedProfileId: null,
        activeProfileId: profileId,
        profiles: [
          {
            id: profileId,
            profileType: 'INDIVIDUAL',
            status: 'ACTIVE',
            isDefault: true,
            firstName: 'Person',
            lastName: 'Owner',
          },
          {
            id: companyId,
            profileType: 'LEGAL',
            status: 'VERIFIED',
            isDefault: false,
            title: 'Saved Company',
          },
        ],
      };
      if (++reads !== 1) return route.fulfill({ json: receipt });
      await held;
      await route
        .fulfill({ json: { ...receipt, profiles: [receipt.profiles[0]] } })
        .catch(() => {});
    });
    await page.clock.install();
    await page.goto(`/onboarding/complete?journeyId=${journeyId}`);
    try {
      await expect.poll(() => reads).toBe(1);
      await expect(
        page.getByRole('status').filter({ hasText: t('onboarding.complete.finalizing', locale) })
      ).toBeVisible();
      await page.clock.fastForward(15_001);
      await expect(page.getByRole('alert')).toContainText(t('onboarding.complete.error', locale));
      expect(reads).toBe(1);
      await page
        .getByRole('button', { name: t('onboarding.draft.retry', locale), exact: true })
        .click();
      await expect(page.locator('dl[aria-label]')).toHaveCount(2);
      expect(reads).toBe(2);
    } finally {
      release();
    }
    await expect(page.locator('dl[aria-label]')).toHaveCount(2);
    expect(state.finishes).toHaveLength(0);
    expect(state.starts).toHaveLength(0);
  });
}
