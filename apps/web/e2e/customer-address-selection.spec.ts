import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';
import { fullNavigation } from './navigation-fixture';
import { t } from '@barghsa/i18n/app';
import { t as crmText } from '@barghsa/i18n/crm';

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
    writes: [] as Record<string, string>[],
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
    updatedAt: '2026-10-01T00:00:00Z',
    addresses: [address],
    legalInfo: null,
  });
  await page.addInitScript((language) => {
    localStorage.setItem('barghsa.locale', language);
    localStorage.setItem('theme', language === 'fa' ? 'dark' : 'light');
  }, locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
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
    const body = route.request().postDataJSON();
    state.writes.push(body);
    if (state.writeFailed) return route.fulfill({ status: 503, json: {} });
    address = { ...address, ...body };
    return route.fulfill({ json: route.request().method() === 'POST' ? address : profile() });
  }
  await page.route(`**/api/profiles/${profileId}`, (route) =>
    route.request().method() === 'PUT' ? write(route) : route.fulfill({ json: profile() })
  );
  await page.route(`**/api/profiles/${profileId}/addresses`, (route) =>
    route.request().method() === 'POST'
      ? write(route)
      : route.fulfill({ json: { addresses: [address] } })
  );
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
        await page
          .getByRole('dialog')
          .getByRole('button', { name: crmText('settings.profile.save', locale), exact: true })
          .click();
        await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
        await page
          .getByRole('dialog')
          .getByRole('button', { name: crmText('crm.profile.edit.cancel', locale), exact: true })
          .click();
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
      await expect(full).toHaveValue('Retained address draft');
      state.writeFailed = false;
      await (
        surface === 'addresses'
          ? save()
          : page
              .getByRole('dialog')
              .getByRole('button', { name: crmText('settings.profile.save', locale), exact: true })
      ).click();
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
      if (surface === 'profile') await expect(city).toHaveValue(c2);
      else await expect(page.locator('.container').last()).toContainText('Retained address draft');
    });
  }
