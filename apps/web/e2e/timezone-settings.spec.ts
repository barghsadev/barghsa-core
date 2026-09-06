import { test, expect } from '@playwright/test';

for (const locale of ['en', 'fa'] as const) {
  test(`timezone load, keyboard selection and failed save remain recoverable (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    let failLoad = true;
    let failSave = true;
    let saved = 'Asia/Tehran';
    const writes: unknown[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
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
    const main = page.locator('#dashboard-content');
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
    const search = main.getByRole('searchbox');
    await search.fill('Europe/Istanbul');
    await zones.focus();
    await zones.press('Home');
    await expect(zones).toHaveValue('Europe/Istanbul');
    await save.click();
    await expect(
      page.getByText(fa ? 'خطا در ذخیره تنظیمات منطقه زمانی' : 'Failed to save timezone settings', {
        exact: true,
      })
    ).toBeVisible();
    await expect(zones).toHaveValue('Europe/Istanbul');
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
