import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';
import { fullNavigation } from './navigation-fixture';
import { t } from '@barghsa/i18n/app';
import { t as crmText } from '@barghsa/i18n/crm';
import { tSettingsForms } from '@barghsa/i18n/settings-forms';

const profileId = '11111111-1111-4111-8111-111111111111';
const p1 = '22222222-2222-4222-8222-222222222222';
const p2 = '33333333-3333-4333-8333-333333333333';
const c1 = '44444444-4444-4444-8444-444444444444';
const c2 = '55555555-5555-4555-8555-555555555555';
type Locale = 'fa' | 'en';
async function fixture(page: Page, locale: Locale) {
  const state = {
    provinceFailed: true,
    cityInvalid: true,
    writeFailed: true,
    validationFields: [] as string[],
    writeGate: null as Promise<void> | null,
    writes: [] as Record<string, string>[],
    keyedWrites: [] as { raw: string; key: unknown }[],
  };
  let address = {
    id: '66666666-6666-4666-8666-666666666666',
    profileId,
    provinceId: p1,
    cityId: c1,
    fullAddress: 'Saved address',
    postalCode: '1234567890',
    mainAddress: true,
    provinceNameFa: 'تهران',
    provinceNameEn: 'Tehran',
    cityNameFa: 'تهران',
    cityNameEn: 'Tehran',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };
  const addresses = [address];
  let profileUpdatedAt = '2026-10-01T00:00:00Z';
  const profile = () => ({
    id: profileId,
    profileType: 'INDIVIDUAL',
    title: 'Customer',
    firstName: 'Sara',
    lastName: 'Example',
    nationalId: '0010350829',
    status: 'ACTIVE',
    isDefault: true,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: profileUpdatedAt,
    addresses,
    legalInfo: null,
    canEditIdentity: false,
  });
  await page.addInitScript((language) => {
    localStorage.setItem('barghsa.locale', language);
  }, locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
      json: {
        appTitle: 'Barghsa',
        appTitleFa: 'برقسا',
        supportEmail: 'support@example.test',
        supportPhone: '02112345678',
        supportMobile: '09123456789',
        slogan: '',
        primaryColor: '#176b5b',
        secondaryColor: '#547467',
        accentColor: '#d6a74e',
        backgroundColor: '#f6f7f4',
        darkBackgroundColor: '#15201c',
        logoUrl: null,
        faviconUrl: null,
        darkMode: locale === 'fa',
        numberStyle: 'locale',
      },
    })
  );
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'buyer',
        isStaff: false,
        requiresTosAcceptance: false,
        navigation: { ...fullNavigation('customer'), profileId },
      },
    })
  );
  await page.route('**/api/invitations/pending', (route) =>
    route.fulfill({ json: { invitations: [] } })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({ json: { profiles: [profile()], activeProfileId: profileId, hasDefault: true } })
  );
  async function write(route: import('@playwright/test').Route) {
    const captured = route.request().postDataJSON();
    state.keyedWrites.push({ raw: route.request().postData()!, key: captured.idempotencyKey });
    const body = Object.fromEntries(
      Object.entries(captured).filter(([key]) => key !== 'idempotencyKey')
    ) as Record<string, string>;
    state.writes.push(body);
    if (state.writeGate) await state.writeGate;
    if (state.validationFields.length)
      return route.fulfill({
        status: 400,
        json: {
          error: {
            code: 'VALIDATION:INPUT:INVALID',
            fields: state.validationFields,
            message: 'private-server-detail',
          },
        },
      });
    if (state.writeFailed) return route.fulfill({ status: 503, json: {} });
    const addressWrite = route.request().url().includes('/addresses');
    if (!addressWrite || route.request().method() === 'POST') {
      if (!addressWrite) for (const previous of addresses) previous.mainAddress = false;
      address = {
        ...address,
        ...body,
        id: '77777777-7777-4777-8777-777777777777',
        mainAddress: !addressWrite,
        updatedAt: '2026-10-01T00:01:00Z',
      };
      addresses.push(address);
    } else Object.assign(address, body, { updatedAt: '2026-10-01T00:01:00Z' });
    if (body.provinceId === p2)
      Object.assign(address, {
        provinceNameFa: 'فارس',
        provinceNameEn: 'Fars',
        cityNameFa: 'شیراز',
        cityNameEn: 'Shiraz',
      });
    if (!addressWrite) profileUpdatedAt = address.updatedAt;
    const current = profile();
    return route.fulfill({
      status: addressWrite && route.request().method() === 'POST' ? 201 : 200,
      json: addressWrite
        ? address
        : {
            id: current.id,
            profileType: current.profileType,
            isDefault: current.isDefault,
            status: current.status,
            title: current.title,
            firstName: current.firstName,
            lastName: current.lastName,
            nationalId: current.nationalId,
            updatedAt: address.updatedAt,
          },
    });
  }
  await page.route(`**/api/profiles/${profileId}`, (route) =>
    route.request().method() === 'PUT' ? write(route) : route.fulfill({ json: profile() })
  );
  await page.route(`**/api/profiles/${profileId}/addresses`, (route) =>
    route.request().method() === 'POST' ? write(route) : route.fulfill({ json: { addresses } })
  );
  await page.route(`**/api/profiles/${profileId}/addresses/${address.id}`, (route) => write(route));
  await page.route('**/api/geography/provinces', (route) =>
    route.fulfill({
      status: state.provinceFailed ? 503 : 200,
      json: [
        { id: p1, nameFa: 'تهران', nameEn: 'Tehran' },
        { id: p2, nameFa: 'فارس', nameEn: 'Fars' },
      ],
    })
  );
  for (const [provinceId, cityId, nameFa, nameEn] of [
    [p1, c1, 'تهران', 'Tehran'],
    [p2, c2, 'شیراز', 'Shiraz'],
  ] as const)
    await page.route(`**/api/geography/provinces/${provinceId}/cities`, (route) =>
      route.fulfill({
        json: [
          {
            id: cityId,
            provinceId: provinceId === p2 && state.cityInvalid ? p1 : provinceId,
            nameFa,
            nameEn,
          },
        ],
      })
    );
  return state;
}

for (const locale of ['en', 'fa'] as const)
  for (const surface of ['addresses', 'profile'] as const) {
    test(`customer ${surface} validates dependent options and retains fields through read/write recovery (${locale})`, async ({
      page,
    }) => {
      const state = await fixture(page, locale);
      await page.goto(`/settings/${surface}`);
      await expect
        .poll(() => page.locator('html').evaluate((root) => root.classList.contains('dark')))
        .toBe(locale === 'fa');
      if (surface === 'addresses')
        await page
          .getByRole('button', { name: t('settings.addresses.add', locale), exact: true })
          .click();
      const province = page.locator(
        surface === 'addresses' ? '#addresses-field-1' : '#profile-province'
      );
      const city = page.locator(surface === 'addresses' ? '#addresses-field-2' : '#profile-city');
      const full = page.locator(
        surface === 'addresses' ? '#addresses-field-3' : '#profile-address'
      );
      const postal = page.locator(
        surface === 'addresses' ? '#addresses-field-4' : '#profile-postal-code'
      );
      await full.fill('Retained address draft');
      await postal.fill('2345678901');
      await expect(province).toBeDisabled();
      const geographyError = (key: string) =>
        page.getByRole('alert').filter({ hasText: t(key, locale) });
      await expect(geographyError('settings.addresses.error.loadProvinces')).toBeVisible();
      state.provinceFailed = false;
      const retry = () =>
        page.getByRole('button', { name: t('settings.addresses.retry', locale), exact: true });
      await retry().click();
      await expect(province).toBeEnabled();
      await province.selectOption(p2);
      await expect(geographyError('settings.addresses.error.loadCities')).toBeVisible();
      await expect(city).toBeDisabled();
      await expect(city).toHaveValue('');
      const save = () =>
        surface === 'addresses'
          ? page
              .getByRole('dialog')
              .getByRole('button', { name: t('settings.addresses.form.save', locale), exact: true })
          : page.getByRole('button', {
              name: crmText('settings.profile.save', locale),
              exact: true,
            });
      if (surface === 'addresses') await expect(save()).toBeDisabled();
      else {
        await save().click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(city).toHaveAttribute('aria-invalid', 'true');
        await expect(
          page.getByRole('alert').filter({ hasText: tSettingsForms('cityIdInvalid', locale) })
        ).toBeVisible();
      }
      expect(state.writes).toHaveLength(0);
      state.cityInvalid = false;
      await retry().click();
      await expect(city).toBeEnabled();
      await city.selectOption(c2);
      await expect(full).toHaveValue('Retained address draft');
      await expect(city).toHaveAttribute('data-slot', 'dependent-select');
      const scan = new AxeBuilder({ page }).include(
        surface === 'addresses' ? '[role=dialog]' : '.container'
      );
      expect((await scan.withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual(
        []
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await (
        surface === 'addresses' ? page.getByRole('dialog') : page.locator('.container').last()
      ).screenshot({
        path: `/tmp/barghsa-order-address-${surface}-${locale}-${test.info().project.name}.png`,
      });
      await save().click();
      if (surface === 'profile')
        await page
          .getByRole('dialog')
          .getByRole('button', { name: crmText('settings.profile.save', locale), exact: true })
          .click();
      await expect.poll(() => state.writes.length).toBe(1);
      if (surface === 'addresses') {
        await expect(
          page
            .getByRole('dialog')
            .getByRole('alert')
            .filter({ hasText: tSettingsForms('uncertain', locale) })
        ).toBeVisible();
        expect(
          await page.getByRole('dialog').evaluate((dialog) => {
            const bounds = dialog.getBoundingClientRect();
            return bounds.top >= 0 && bounds.bottom <= innerHeight;
          })
        ).toBe(true);
      }
      await expect(full).toHaveValue('Retained address draft');
      state.writeFailed = false;
      await page
        .getByRole('button', { name: tSettingsForms('retryOriginal', locale), exact: true })
        .click();
      await expect.poll(() => state.writes.length).toBe(2);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(state.writes).toEqual(
        Array(2).fill({
          provinceId: p2,
          cityId: c2,
          fullAddress: 'Retained address draft',
          postalCode: '2345678901',
        })
      );
      expect(state.keyedWrites[0]!.key).toMatch(/^[0-9a-f-]{36}$/i);
      expect(state.keyedWrites[1]).toEqual(state.keyedWrites[0]);
      if (surface === 'profile') await expect(city).toHaveValue(c2);
      else await expect(page.locator('.container').last()).toContainText('Retained address draft');
    });
  }

for (const locale of ['en', 'fa'] as const)
  for (const operation of ['create', 'edit'] as const)
    test(`address ${operation} validates inline, retains server-rejected values and blocks busy submits (${locale})`, async ({
      page,
    }) => {
      const state = await fixture(page, locale);
      state.provinceFailed = state.cityInvalid = state.writeFailed = false;
      await page.goto('/settings/addresses');
      await expect
        .poll(() => page.locator('html').evaluate((root) => root.classList.contains('dark')))
        .toBe(locale === 'fa');
      await page
        .getByRole('button', {
          name: t(
            operation === 'create' ? 'settings.addresses.add' : 'settings.addresses.edit',
            locale
          ),
          exact: true,
        })
        .click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
      const province = dialog.locator('#addresses-field-1');
      const city = dialog.locator('#addresses-field-2');
      const full = dialog.locator('#addresses-field-3');
      const postal = dialog.locator('#addresses-field-4');
      const save = dialog.getByRole('button', {
        name: t('settings.addresses.form.save', locale),
        exact: true,
      });
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      if (operation === 'edit') {
        await expect(full).toHaveValue('Saved address');
        await expect(postal).toHaveValue('1234567890');
      }
      await province.selectOption(p2);
      await expect(city).toHaveValue('');
      await expect(city).toBeEnabled();
      await city.selectOption(c2);
      await full.fill(' ');
      await postal.fill('0000000000');
      await save.click();
      await expect(full).toBeFocused();
      await expect(full).toHaveAttribute('aria-invalid', 'true');
      await expect(
        dialog
          .getByRole('alert')
          .filter({ hasText: t('settings.addresses.validation.fullAddress', locale) })
      ).toBeVisible();
      await expect(postal).toHaveAttribute('aria-describedby', 'addresses-field-4-message');
      expect(state.writes).toHaveLength(0);
      await full.fill('  Retained address correction  ');
      await postal.fill('2345678901');
      state.validationFields = ['postalCode'];
      await save.click();
      await expect.poll(() => state.writes.length).toBe(1);
      await expect(postal).toBeFocused();
      await expect(postal).toHaveAttribute('aria-invalid', 'true');
      await expect(full).toHaveValue('  Retained address correction  ');
      await expect(dialog).not.toContainText('private-server-detail');
      expect(
        (
          await new AxeBuilder({ page })
            .include('[role=dialog]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await dialog.screenshot({
        path: `/tmp/barghsa-form-${operation}-${locale}-${test.info().project.name}.png`,
      });
      state.validationFields = [];
      let release!: () => void;
      state.writeGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await save.click();
      await expect.poll(() => state.writes.length).toBe(2);
      const saving = dialog.getByRole('button', {
        name: t('settings.addresses.form.saving', locale),
        exact: true,
      });
      await expect(saving).toBeDisabled();
      await expect(saving).toHaveAttribute('aria-busy', 'true');
      await expect(full).toBeDisabled();
      await expect(postal).toBeDisabled();
      await expect(province).toBeDisabled();
      await expect(city).toBeDisabled();
      for (const cancel of await dialog
        .getByRole('button', { name: t('settings.addresses.form.cancel', locale), exact: true })
        .all())
        await expect(cancel).toBeDisabled();
      await dialog.locator('form').evaluate((form: HTMLFormElement) => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      expect(state.writes).toHaveLength(2);
      release();
      await expect(dialog).toHaveCount(0);
      expect(state.writes).toEqual(
        Array(2).fill({
          provinceId: p2,
          cityId: c2,
          fullAddress: 'Retained address correction',
          postalCode: '2345678901',
        })
      );
      await expect(page.locator('.container').last()).toContainText('Retained address correction');
    });
