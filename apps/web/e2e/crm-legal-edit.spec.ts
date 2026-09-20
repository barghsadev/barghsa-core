import type { Page, Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/crm';
import { test, expect } from './coverage-fixture';

const profileId = '11111111-1111-4111-8111-111111111111';
const p1 = '33333333-3333-4333-8333-333333333333',
  p2 = '44444444-4444-4444-8444-444444444444';
const c1 = '55555555-5555-4555-8555-555555555555',
  c2 = '66666666-6666-4666-8666-666666666666';
type Locale = 'fa' | 'en';
const oldName = { nameFa: 'محل قبلی', nameEn: 'Original place' };
const newName = { nameFa: 'محل جدید', nameEn: 'New place' };
const changes = {
  registrationNumber: 'REG-NEW',
  companyTypeId: 'new-company',
  registrationDate: '2026-08-02',
  economicCode: '123456789012',
  officialPhone: '02126658042',
  officialEmail: 'office@example.test',
  officialProvinceId: p2,
  officialCityId: c2,
  officialFullAddress: 'New office street',
  officialPostalCode: '2345678901',
  representativeHonorific: 'Dr',
  representativeFirstName: 'Sara',
  representativeLastName: 'Example',
  representativeNationalId: '0010350829',
  representativeTitle: 'Director',
  representativeRelationship: 'Employee',
  representativeProvinceId: p2,
  representativeCityId: c2,
  representativeFullAddress: 'New representative street',
  representativePostalCode: '3456789012',
};
const label = (key: string, locale: Locale) =>
  t(
    'crm.profile.field.' +
      (key === 'companyTypeId' ? 'companyType' : key.replace(/(Province|City)Id$/, '$1')),
    locale
  );

async function setup(page: Page, locale: Locale, dark = false, allowed = true, archived = false) {
  await page.addInitScript(
    ({ locale, dark }) => {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
      const apply = () => {
        document.documentElement.lang = locale;
        document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
        document.documentElement.classList.toggle('dark', dark);
      };
      if (document.documentElement) apply();
      new MutationObserver(apply).observe(document, { childList: true });
    },
    { locale, dark }
  );
  const current = {
    profile: {
      id: profileId,
      profileType: 'LEGAL',
      title: 'Legal customer',
      status: 'VERIFIED',
      archived,
      isDefault: true,
      archivedAt: null,
      archivedReason: null,
      firstName: null,
      lastName: null,
      nationalId: null,
      contactEmail: null,
      contactMobile: null,
      createdAt: '2026-08-01T01:00:00Z',
      updatedAt: '2026-08-01T01:00:00Z',
    },
    user: {
      userId: 'owner',
      username: 'owner@example.test',
      email: 'owner@example.test',
      mobile: null,
      isAdmin: false,
      lastLogin: null,
      lastPasswordChange: null,
      createdAt: '2026-08-01T01:00:00Z',
    },
    viewerPermissions: {
      canEdit: allowed,
      canEditIdentity: allowed,
      canVerify: false,
      canManageUser: false,
      canReadDocuments: false,
    },
    legalInfo: {
      ...changes,
      legalName: 'Protected company',
      nationalIdentifier: '12345678901',
      registrationNumber: 'REG-OLD',
      companyTypeId: 'old-company',
      registrationDate: null,
      economicCode: null,
      officialPhone: null,
      officialEmail: null,
      officialProvinceId: p1,
      officialCityId: c1,
      officialFullAddress: 'Old office street',
      officialPostalCode: null,
      representativeHonorific: null,
      representativeFirstName: null,
      representativeLastName: null,
      representativeNationalId: null,
      representativeTitle: 'CEO',
      representativeRelationship: 'Owner',
      representativeProvinceId: p1,
      representativeCityId: c1,
      representativeFullAddress: null,
      representativePostalCode: null,
      companyTypeName: oldName,
      officialProvinceName: oldName,
      officialCityName: oldName,
      representativeProvinceName: oldName,
      representativeCityName: oldName,
      createdAt: '2026-08-01T01:00:00Z',
      updatedAt: '2026-08-01T01:00:00.123456Z',
    },
    addresses: [],
    sessions: { count: 0, lastActive: null, entries: [] },
    siblingProfiles: [],
  };
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'UTC' } })
  );
  let write: ((route: Route) => Promise<void>) | undefined;
  await page.route('**/api/crm/profiles/' + profileId, (route) =>
    route.request().method() === 'PUT' && write ? write(route) : route.fulfill({ json: current })
  );
  await page.route('**/api/geography/provinces', (route) =>
    route.fulfill({
      json: [
        { id: p1, ...oldName },
        { id: p2, ...newName },
      ],
    })
  );
  await page.route('**/api/geography/company-types', (route) =>
    route.fulfill({
      json: [
        { id: 'old-company', ...oldName },
        { id: 'new-company', ...newName },
      ],
    })
  );
  for (const [provinceId, cityId, names] of [
    [p1, c1, oldName],
    [p2, c2, newName],
  ] as const)
    await page.route('**/api/geography/provinces/' + provinceId + '/cities', (route) =>
      route.fulfill({ json: [{ id: cityId, provinceId, ...names }] })
    );
  const open = async () => {
    await page.goto('/admin/crm/profiles/' + profileId);
    await page
      .getByRole('tab', { name: t('crm.profile.tab.details', locale), exact: true })
      .click();
  };
  return {
    current,
    open,
    setWrite: (callback: (route: Route) => Promise<void>) => {
      write = callback;
    },
  };
}

for (const locale of ['fa', 'en'] as const) {
  for (const dark of [false, true]) {
    test(
      'CRM legal fields validate, confirm and survive retries (' + locale + ', dark=' + dark + ')',
      async ({ page }) => {
        const fixture = await setup(page, locale, dark);
        let companies = 0;
        await page.route('**/api/geography/company-types', (route) =>
          ++companies === 1 ? route.fulfill({ status: 503, json: {} }) : route.fallback()
        );
        const writes: unknown[] = [];
        fixture.setWrite(async (route) => {
          const body = route.request().postDataJSON();
          writes.push(body);
          if (writes.length === 1)
            return route.fulfill({
              status: 403,
              json: { error: { code: 'AUTHZ:STEP_UP_REQUIRED' } },
            });
          if (writes.length === 2) return route.fulfill({ status: 500, json: {} });
          const saved = {
            ...fixture.current.legalInfo,
            ...body.legal.changes,
            companyTypeName: newName,
            officialProvinceName: newName,
            officialCityName: newName,
            representativeProvinceName: newName,
            representativeCityName: newName,
            updatedAt: '2026-09-01T01:00:00.654321Z',
          };
          if (writes.length === 3)
            return route.fulfill({
              json: {
                updated: true,
                profile: fixture.current.profile,
                legalInfo: { ...saved, legalName: 'Wrong company' },
              },
            });
          fixture.current.legalInfo = saved;
          return route.fulfill({
            json: { updated: true, profile: fixture.current.profile, legalInfo: saved },
          });
        });
        await page.route('**/api/auth/step-up', (route) =>
          route.fulfill({ json: { success: true } })
        );
        await fixture.open();
        const panel = page.locator('#panel-details');
        const edit = panel.getByRole('button', { name: t('crm.legal.edit', locale), exact: true });
        await edit.click();
        // The open confirmation makes its background inert; still check that the draft survives.
        const form = panel.getByRole('form', {
          name: t('crm.legal.edit', locale),
          exact: true,
          includeHidden: true,
        });
        await expect(form.getByLabel(label('legalName', locale), { exact: true })).toHaveCount(0);
        await expect(
          panel.getByRole('link', { name: t('crm.corrections.request', locale) })
        ).toHaveCount(2);
        const registry = form.getByLabel(label('registrationNumber', locale), { exact: true });
        await registry.fill('Discard this draft');
        await expect(page.getByTestId('crm-legal-companyTypeId-retry')).toBeVisible();
        await page.getByTestId('crm-legal-companyTypeId-retry').click();
        await expect(
          form.getByLabel(label('companyTypeId', locale), { exact: true })
        ).toBeEnabled();
        await expect(registry).toHaveValue('Discard this draft');
        await form
          .getByRole('button', { name: t('crm.profile.edit.cancel', locale), exact: true })
          .click();
        await expect(edit).toBeFocused();
        await edit.click();
        await expect(registry).toHaveValue('REG-OLD');
        for (const [field, value] of Object.entries(changes)) {
          const control = form.getByLabel(label(field, locale), { exact: true });
          if (field.endsWith('Id') && field !== 'representativeNationalId') {
            await expect(control).toBeEnabled();
            await control.selectOption(value);
          } else await control.fill(value);
        }
        await page
          .getByRole('tab', { name: t('crm.profile.tab.overview', locale), exact: true })
          .click();
        await page
          .getByRole('tab', { name: t('crm.profile.tab.details', locale), exact: true })
          .click();
        await expect(registry).toHaveValue('REG-NEW');
        const postal = form.getByLabel(label('officialPostalCode', locale), { exact: true });
        await postal.fill('0123456789');
        const save = form.getByRole('button', {
          name: t('crm.profile.edit.save', locale),
          exact: true,
        });
        await save.click();
        await expect(postal).toHaveAttribute('aria-invalid', 'true');
        expect(writes).toEqual([]);
        await postal.fill(changes.officialPostalCode);
        const widths = await form.evaluate((element) => ({
          editor: element.clientWidth,
          available: element.parentElement!.clientWidth,
        }));
        expect(widths.editor / widths.available).toBeGreaterThan(0.95);
        await registry.scrollIntoViewIfNeeded();
        await page.screenshot({
          path:
            '/tmp/barghsa-crm-legal-edit-' +
            locale +
            '-' +
            dark +
            '-' +
            test.info().project.name +
            '.png',
        });
        expect(
          (await new AxeBuilder({ page }).include('form[aria-label]').analyze()).violations
        ).toEqual([]);
        await save.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toContainText('REG-OLD');
        await expect(dialog).toContainText('REG-NEW');
        await expect(dialog).toContainText(locale === 'fa' ? newName.nameFa : newName.nameEn);
        await dialog
          .getByRole('button', { name: locale === 'fa' ? 'انصراف' : 'Cancel', exact: true })
          .click();
        await expect(save).toBeFocused();
        await expect(registry).toHaveValue('REG-NEW');
        await save.click();
        const confirm = dialog.getByRole('button', {
          name: locale === 'fa' ? 'تأیید' : 'Confirm',
          exact: true,
        });
        await confirm.click();
        await expect(dialog.locator('input[type=password]')).toBeVisible();
        for (let i = 0; i < 3; i++) {
          await dialog.locator('input[type=password]').fill('fixture-password-only');
          await confirm.click();
          if (i < 2) {
            await expect(dialog.getByRole('alert')).toBeVisible();
            await expect(registry).toHaveValue('REG-NEW');
            await expect(panel.getByRole('status')).toHaveCount(0);
          }
        }
        await expect(dialog).toHaveCount(0);
        await expect(edit).toBeFocused();
        await expect(panel.getByRole('status')).toHaveText(t('crm.profile.edit.saved', locale));
        expect(writes).toEqual(
          Array(4).fill({ legal: { expectedUpdatedAt: '2026-08-01T01:00:00.123456Z', changes } })
        );
        await fixture.open();
        await expect(panel).toContainText('REG-NEW');
        await edit.click();
        for (const [field, value] of Object.entries(changes))
          await expect(form.getByLabel(label(field, locale), { exact: true })).toHaveValue(value);
      }
    );
  }

  for (const archived of [false, true])
    test(
      'CRM legal editing unavailable without permission or after archive (' +
        locale +
        ', archived=' +
        archived +
        ')',
      async ({ page }) => {
        const fixture = await setup(page, locale, false, archived, archived);
        await fixture.open();
        await expect(
          page.getByRole('button', { name: t('crm.legal.edit', locale), exact: true })
        ).toHaveCount(0);
        await expect(page.locator('#panel-details')).toContainText('Protected company');
      }
    );

  test('CRM legal stale draft requires reload (' + locale + ')', async ({ page }) => {
    const fixture = await setup(page, locale);
    Object.assign(fixture.current.legalInfo, {
      officialEmail: 'LEGACY@example.test',
      economicCode: '',
    });
    fixture.setWrite(async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        legal: {
          expectedUpdatedAt: '2026-08-01T01:00:00.123456Z',
          changes: { registrationNumber: 'STALE' },
        },
      });
      fixture.current.legalInfo.registrationNumber = 'CONCURRENT';
      fixture.current.legalInfo.updatedAt = '2026-09-01T01:00:00.222222Z';
      return route.fulfill({ status: 409, json: { error: { code: 'CONFLICT:STATE' } } });
    });
    await fixture.open();
    const panel = page.locator('#panel-details');
    const edit = panel.getByRole('button', { name: t('crm.legal.edit', locale), exact: true });
    await edit.click();
    const form = panel.getByRole('form');
    const registry = form.getByLabel(label('registrationNumber', locale), { exact: true });
    await registry.fill('STALE');
    await form
      .getByRole('button', { name: t('crm.profile.edit.save', locale), exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toHaveText(t('crm.legal.conflict', locale));
    await dialog
      .getByRole('button', { name: locale === 'fa' ? 'انصراف' : 'Cancel', exact: true })
      .click();
    await expect(registry).toHaveValue('STALE');
    await form
      .getByRole('button', { name: t('crm.profile.edit.cancel', locale), exact: true })
      .click();
    await expect(edit).toBeFocused();
    await fixture.open();
    await expect(panel).toContainText('CONCURRENT');
    await edit.click();
    await expect(registry).toHaveValue('CONCURRENT');
  });
}
