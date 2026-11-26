import { tPreferenceSettingsForms } from '@barghsa/i18n/preference-settings-forms';
import { test, expect } from './coverage-fixture';

for (const locale of ['en', 'fa'] as const) {
  test(`timezone load, keyboard selection and failed save remain recoverable (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      localStorage.setItem('barghsa.locale', value);
      if (document.documentElement) document.documentElement.lang = value;
      new MutationObserver(() => {
        document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    let failLoad = true;
    let failSave = true;
    let saved = 'Asia/Tehran';
    const writes: unknown[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: { userId: 'timezone-owner', isStaff: false, requiresTosAcceptance: false },
      })
    );
    await page.route('**/api/profiles', (route) =>
      route.fulfill({
        json: {
          profiles: [{ id: 'profile', isDefault: true }],
          activeProfileId: 'profile',
          hasDefault: true,
        },
      })
    );
    await page.route('**/api/user/settings/timezone', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill(failLoad ? { status: 503, json: {} } : { json: { timezone: saved } });
      }
      const body = route.request().postDataJSON();
      writes.push(body);
      if (failSave)
        return route.fulfill({ status: 503, json: fa ? { message: { invalid: true } } : {} });
      saved = body.timezone;
      return route.fulfill({ json: { timezone: saved } });
    });
    await page.goto('/settings/timezone');
    const main = page.locator('main[data-area=dashboard]');
    const save = main.getByRole('button', {
      name: fa ? 'ذخیره تغییرات' : 'Save Changes',
      exact: true,
    });
    await expect(save).toBeDisabled();
    await expect(main.getByRole('alert')).toContainText(
      fa ? 'خطا در بارگذاری منطقه زمانی' : 'Failed to load timezone'
    );
    failLoad = false;
    await main.getByRole('button', { name: fa ? 'تلاش دوباره' : 'Try again' }).click();
    const zones = main.getByRole('listbox');
    await expect(zones).toHaveValue('Asia/Tehran');
    await expect(zones).toHaveAttribute('aria-required', 'true');
    const search = main.getByRole('searchbox');
    await expect(search).not.toHaveAttribute('aria-required', 'true');
    await search.fill(' New York ');
    await expect(zones.getByRole('option', { name: /America\/New_York/ })).toHaveCount(1);
    await search.fill(fa ? 'استانبول' : 'Europe/Istanbul');
    await expect(zones.getByRole('option', { name: /Europe\/Istanbul/ })).toHaveCount(1);
    await zones.focus();
    await zones.press('ArrowDown');
    await expect(zones).toHaveValue('Europe/Istanbul');
    await expect(
      main.getByRole('region', { name: tPreferenceSettingsForms('timezonePreview', locale) })
    ).toContainText('Europe/Istanbul');
    await expect(main.getByText(fa ? 'منطقه زمانی ذخیره‌شده' : 'Saved time zone')).toContainText(
      'Asia/Tehran'
    );
    await search.fill('No matching city');
    await expect(
      main.getByText(tPreferenceSettingsForms('timezoneNoMatches', locale), { exact: true })
    ).toBeVisible();
    await expect(zones).toBeHidden();
    await search.press('Enter');
    await expect(search).toBeFocused();
    expect(writes).toEqual([]);
    await search.fill(fa ? 'استانبول' : 'Europe/Istanbul');
    await expect(zones).toHaveValue('Europe/Istanbul');
    await save.click();
    await expect(
      page.getByText(fa ? 'خطا در ذخیره تنظیمات منطقه زمانی' : 'Failed to save timezone settings', {
        exact: true,
      })
    ).toBeVisible();
    await expect(zones).toHaveValue('Europe/Istanbul');
    await main
      .getByRole('button', {
        name: locale === 'fa' ? 'بررسی تنظیمات ذخیره‌شده' : 'Check saved settings',
        exact: true,
      })
      .click();
    await main
      .getByRole('button', {
        name: locale === 'fa' ? 'بازگشت به ویرایش' : 'Return to editing',
        exact: true,
      })
      .click();
    await expect(save).toBeEnabled();
    failSave = false;
    await save.click();
    await expect.poll(() => saved).toBe('Europe/Istanbul');
    await expect(zones).toHaveValue('Europe/Istanbul');
    expect(writes).toEqual([{ timezone: 'Europe/Istanbul' }, { timezone: 'Europe/Istanbul' }]);
    await page.reload();
    await expect(main.getByRole('listbox')).toHaveValue('Europe/Istanbul');
  });
}
