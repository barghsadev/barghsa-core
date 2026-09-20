import type { Page, Route } from '@playwright/test';
import { test, expect } from './coverage-fixture';
const profileId = '11111111-1111-4111-8111-111111111111';
const addressId = '22222222-2222-4222-8222-222222222222';
const p1 = '33333333-3333-4333-8333-333333333333',
  p2 = '44444444-4444-4444-8444-444444444444';
const c1 = '55555555-5555-4555-8555-555555555555',
  c2 = '66666666-6666-4666-8666-666666666666';
type Locale = 'fa' | 'en';
async function setup(page: Page, locale: Locale, allowed = true, archived = false) {
  await page.addInitScript((lang) => {
    if (document.documentElement) document.documentElement.lang = lang;
    new MutationObserver(() => {
      document.documentElement.lang = lang;
    }).observe(document, { childList: true });
  }, locale);
  const original = { nameFa: 'محل قبلی', nameEn: 'Original place' };
  const next = { nameFa: 'محل جدید', nameEn: 'New place' };
  const current = {
    profile: {
      id: profileId,
      isDefault: true,
      archived,
      archivedAt: null,
      archivedReason: null,
      profileType: 'INDIVIDUAL',
      status: 'ACTIVE',
      title: 'Customer',
      contactEmail: 'office@example.test',
      contactMobile: null,
      firstName: 'Customer',
      lastName: 'Example',
      nationalId: '0012345678',
      createdAt: '2026-08-01T01:00:00Z',
      updatedAt: '2026-08-01T01:00:00Z',
    },
    user: {
      userId: 'owner',
      username: 'owner@example.test',
      email: 'owner@example.test',
      mobile: null,
      lastLogin: null,
      lastPasswordChange: null,
      isAdmin: false,
      createdAt: '2026-08-01T01:00:00Z',
    },
    viewerPermissions: { canEdit: allowed, canVerify: false, canManageUser: false },
    legalInfo: null,
    addresses: [
      {
        id: addressId,
        provinceId: p1,
        cityId: c1,
        provinceName: original,
        cityName: original,
        fullAddress: 'Original street',
        postalCode: '1234567890',
        mainAddress: true,
        createdAt: '2026-08-01T01:00:00Z',
        updatedAt: '2026-08-01T01:00:00.123456Z',
      },
    ],
    sessions: { count: 0, lastActive: null, entries: [] },
    siblingProfiles: [],
  };
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'UTC' } })
  );
  let write: ((route: Route) => Promise<void>) | undefined;
  await page.route(`**/api/crm/profiles/${profileId}`, (route) =>
    route.request().method() === 'PUT' && write ? write(route) : route.fulfill({ json: current })
  );
  await page.route('**/api/geography/provinces', (route) =>
    route.fulfill({
      json: [
        { id: p1, ...original },
        { id: p2, ...next },
      ],
    })
  );
  for (const [provinceId, cityId, names] of [
    [p1, c1, original],
    [p2, c2, next],
  ] as const)
    await page.route(`**/api/geography/provinces/${provinceId}/cities`, (route) =>
      route.fulfill({ json: [{ id: cityId, provinceId, ...names }] })
    );
  const open = async () => {
    await page.goto(`/admin/crm/profiles/${profileId}`);
    await page
      .getByRole('tab', { name: locale === 'fa' ? 'آدرس‌ها' : 'Addresses', exact: true })
      .click();
  };
  return {
    current,
    next,
    open,
    setWrite: (callback: (route: Route) => Promise<void>) => {
      write = callback;
    },
  };
}
for (const locale of ['fa', 'en'] as const) {
  test(`CRM inline address edit retains drafts, validates geography and confirms retries (${locale})`, async ({
    page,
  }) => {
    const fixture = await setup(page, locale);
    let provinceAttempts = 0,
      cityAttempts = 0;
    await page.route('**/api/geography/provinces', async (route) => {
      if (++provinceAttempts === 1) return route.fulfill({ status: 503, json: {} });
      return route.fallback();
    });
    await page.route(`**/api/geography/provinces/${p2}/cities`, async (route) => {
      if (++cityAttempts === 1) return route.fulfill({ status: 503, json: {} });
      return route.fallback();
    });
    const writes: Record<string, unknown>[] = [];
    fixture.setWrite(async (route) => {
      const body = route.request().postDataJSON();
      writes.push(body);
      if (writes.length === 1)
        return route.fulfill({ status: 403, json: { error: { code: 'AUTHZ:STEP_UP_REQUIRED' } } });
      if (writes.length === 2) return route.fulfill({ status: 500, json: {} });
      const saved = {
        ...fixture.current.addresses[0]!,
        ...body.address,
        provinceName: fixture.next,
        cityName: fixture.next,
        updatedAt: '2026-09-01T01:00:00.654321Z',
      };
      if (writes.length === 3)
        return route.fulfill({
          json: {
            updated: true,
            profile: fixture.current.profile,
            address: { ...saved, id: 'another-address' },
          },
        });
      fixture.current.addresses = [saved];
      return route.fulfill({
        json: { updated: true, profile: fixture.current.profile, address: saved },
      });
    });
    await page.route('**/api/auth/step-up', (route) => route.fulfill({ json: { success: true } }));
    await fixture.open();
    const panel = page.locator('#panel-addresses');
    const edit = panel.getByRole('button', {
      name: locale === 'fa' ? 'ویرایش آدرس' : 'Edit address',
      exact: true,
    });
    await edit.click();
    const full = panel.getByLabel(locale === 'fa' ? 'آدرس کامل' : 'Full address', { exact: true });
    await full.fill('Discard this draft');
    await expect(page.getByTestId('crm-address-province-retry')).toBeVisible();
    await page.getByTestId('crm-address-province-retry').click();
    await expect(
      panel.getByLabel(locale === 'fa' ? 'استان' : 'Province', { exact: true })
    ).toBeEnabled();
    await expect(full).toHaveValue('Discard this draft');
    await panel
      .getByRole('button', { name: locale === 'fa' ? 'لغو' : 'Cancel', exact: true })
      .click();
    await expect(panel).toContainText('Original street');
    expect(writes).toEqual([]);
    await edit.click();
    await full.fill('New street');
    // Hiding the address tab must not discard an open draft.
    await page
      .getByRole('tab', { name: locale === 'fa' ? 'خلاصه' : 'Overview', exact: true })
      .click();
    await page
      .getByRole('tab', { name: locale === 'fa' ? 'آدرس‌ها' : 'Addresses', exact: true })
      .click();
    await expect(full).toHaveValue('New street');
    const province = panel.getByLabel(locale === 'fa' ? 'استان' : 'Province', { exact: true });
    const city = panel.getByLabel(locale === 'fa' ? 'شهر' : 'City', { exact: true });
    // A new editor loads its own current geography options.
    await expect(province).toBeEnabled();
    await province.selectOption(p2);
    await expect(city).toHaveValue('');
    await expect(page.getByTestId('crm-address-city-retry')).toBeVisible();
    await page.getByTestId('crm-address-city-retry').click();
    await city.selectOption(c2);
    const postal = panel.getByLabel(locale === 'fa' ? 'کد پستی' : 'Postal code', { exact: true });
    await postal.fill('0123456789');
    const save = panel.getByRole('button', {
      name: locale === 'fa' ? 'ذخیره تغییرات' : 'Save Changes',
      exact: true,
    });
    await save.click();
    await expect(postal).toHaveAttribute('aria-invalid', 'true');
    await expect(panel.getByRole('alert')).toContainText(
      locale === 'fa' ? 'کد پستی ۱۰ رقمی' : '10-digit postal code'
    );
    expect(writes).toEqual([]);
    await postal.fill('2345678901');
    await panel.getByRole('form').screenshot({
      path: '/tmp/barghsa-crm-address-' + locale + '-' + test.info().project.name + '.png',
    });
    await save.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Original street');
    await expect(dialog).toContainText('New street');
    await expect(dialog).toContainText(locale === 'fa' ? fixture.next.nameFa : fixture.next.nameEn);
    const confirm = dialog.getByRole('button', {
      name: locale === 'fa' ? 'تأیید' : 'Confirm',
      exact: true,
    });
    await confirm.click();
    await dialog.locator('input[type="password"]').fill('fixture-password-only');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(full).toHaveValue('New street');
    await dialog.locator('input[type="password"]').fill('fixture-password-only');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(
      panel.getByText(locale === 'fa' ? 'آدرس ذخیره شد.' : 'Address saved.', { exact: true })
    ).toHaveCount(0);
    await dialog.locator('input[type="password"]').fill('fixture-password-only');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(panel.getByRole('status')).toHaveText(
      locale === 'fa' ? 'آدرس ذخیره شد.' : 'Address saved.'
    );
    await expect(panel).toContainText('New street');
    await expect(panel).toContainText('2345678901');
    expect(writes).toEqual(
      Array(4).fill({
        address: {
          id: addressId,
          expectedUpdatedAt: '2026-08-01T01:00:00.123456Z',
          provinceId: p2,
          cityId: c2,
          fullAddress: 'New street',
          postalCode: '2345678901',
        },
      })
    );
    await edit.click();
    await expect(full).toHaveValue('New street');
  });
  for (const archived of [false, true])
    test(`CRM address edit is unavailable without write access or on an archived profile (${locale}, ${archived})`, async ({
      page,
    }) => {
      const fixture = await setup(page, locale, archived, archived);
      await fixture.open();
      await expect(
        page.getByRole('tabpanel').getByRole('button', {
          name: locale === 'fa' ? 'ویرایش آدرس' : 'Edit address',
          exact: true,
        })
      ).toHaveCount(0);
      await expect(page.getByRole('tabpanel')).toContainText('Original street');
    });
  test(`CRM stale address edits retain the draft until explicit reload (${locale})`, async ({
    page,
  }) => {
    const fixture = await setup(page, locale);
    fixture.setWrite(async (route) => {
      fixture.current.addresses[0]!.fullAddress = 'Concurrent street';
      fixture.current.addresses[0]!.updatedAt = '2026-09-01T01:00:00.222222Z';
      return route.fulfill({ status: 409, json: { error: { code: 'CONFLICT:STATE' } } });
    });
    await fixture.open();
    const panel = page.locator('#panel-addresses');
    await panel
      .getByRole('button', { name: locale === 'fa' ? 'ویرایش آدرس' : 'Edit address', exact: true })
      .click();
    const full = panel.getByLabel(locale === 'fa' ? 'آدرس کامل' : 'Full address', { exact: true });
    await full.fill('Stale draft');
    await panel
      .getByRole('button', {
        name: locale === 'fa' ? 'ذخیره تغییرات' : 'Save Changes',
        exact: true,
      })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toContainText(
      locale === 'fa' ? 'این رکورد تغییر کرده است' : 'This record has changed'
    );
    await dialog
      .getByRole('button', { name: locale === 'fa' ? 'انصراف' : 'Cancel', exact: true })
      .click();
    await expect(full).toHaveValue('Stale draft');
    await panel
      .getByRole('button', {
        name:
          locale === 'fa'
            ? 'بارگذاری دوباره پروفایل و کنار گذاشتن ویرایش‌ها'
            : 'Reload profile and discard edits',
        exact: true,
      })
      .click();
    await page
      .getByRole('tab', { name: locale === 'fa' ? 'آدرس‌ها' : 'Addresses', exact: true })
      .click();
    await expect(panel).toContainText('Concurrent street');
    await expect(panel).not.toContainText('Stale draft');
  });
}
