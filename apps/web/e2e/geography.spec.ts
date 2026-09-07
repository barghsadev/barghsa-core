import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';

for (const locale of ['en', 'fa'] as const) {
  test(`province dialogs are localized and restore keyboard focus (${locale})`, async ({
    page,
  }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/admin/geography/provinces?*', (route) =>
      route.fulfill({
        json: {
          provinces: [],
          total: 0,
          page: 1,
          limit: 20,
        },
      })
    );
    await page.goto('/admin/geography');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    const heading = locale === 'fa' ? 'مدیریت استان‌ها' : 'Province Management';
    const addName = locale === 'fa' ? 'افزودن استان' : 'Add Province';
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    const add = page.getByRole('button', { name: addName, exact: true });
    await add.focus();
    await add.press('Enter');
    const dialog = page.getByRole('dialog', { name: addName, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(locale === 'fa' ? 'نام فارسی' : 'Persian Name')).toBeFocused();
    await dialog.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => {}))
      );
    });
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations
    ).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();
  });
}

for (const locale of ['en', 'fa'] as const) {
  test(`province CRUD preserves input after failures (${locale})`, async ({ page }) => {
    const fa = locale === 'fa';
    let rows: { id: string; nameFa: string; nameEn: string; status: string }[] = [];
    let creates = 0;
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/admin/geography/provinces**', async (route) => {
      const method = route.request().method();
      if (method === 'GET') return route.fulfill({ json: { provinces: rows, total: rows.length } });
      if (method === 'POST') {
        creates++;
        if (creates === 1)
          return route.fulfill({ status: 409, json: { message: 'private database error' } });
        rows = [{ id: 'province-1', ...route.request().postDataJSON(), status: 'active' }];
        return route.fulfill({ json: rows[0] });
      }
      if (method === 'PATCH') rows = [{ ...rows[0]!, ...route.request().postDataJSON() }];
      if (method === 'DELETE') rows = [{ ...rows[0]!, status: 'inactive' }];
      return route.fulfill({ json: method === 'DELETE' ? { success: true } : rows[0] });
    });
    await page.goto('/admin/geography');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    await page
      .getByRole('button', { name: fa ? 'افزودن استان' : 'Add Province', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    const create = dialog.getByRole('button', { name: fa ? 'ایجاد' : 'Create', exact: true });
    await create.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(creates).toBe(0);
    await dialog.getByLabel(fa ? 'نام فارسی' : 'Persian Name').fill('تهران');
    await dialog.getByLabel(fa ? 'نام انگلیسی' : 'English Name').fill('Tehran');
    await create.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog).not.toContainText('private database error');
    await expect(dialog.getByLabel(fa ? 'نام انگلیسی' : 'English Name')).toHaveValue('Tehran');
    await create.click();
    await expect(dialog).toHaveCount(0);
    const row = page.getByRole('row').filter({ hasText: 'Tehran' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: fa ? 'ویرایش' : 'Edit', exact: true }).click();
    await dialog.getByLabel(fa ? 'نام انگلیسی' : 'English Name').fill('Tehran Province');
    await dialog.getByRole('button', { name: fa ? 'ذخیره' : 'Save', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toContainText('Tehran Province');
    await row
      .getByRole('button', { name: fa ? 'غیرفعال‌سازی' : 'Deactivate', exact: true })
      .click();
    await dialog
      .getByRole('button', { name: fa ? 'غیرفعال‌سازی' : 'Deactivate', exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(
      row.getByRole('cell', { name: fa ? 'غیرفعال' : 'Inactive', exact: true })
    ).toBeVisible();
  });
}

test('province list retries malformed data and applies pagination and filters', async ({
  page,
}) => {
  let broken = true;
  const queries: string[] = [];
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/admin/geography/provinces?*', (route) => {
    const query = new URL(route.request().url()).searchParams;
    queries.push(query.toString());
    if (broken) return route.fulfill({ json: null });
    return route.fulfill({
      json: {
        provinces: [
          {
            id: 'p1',
            nameFa: 'تهران',
            nameEn: query.get('page') === '2' ? 'Second Page' : 'Tehran',
            status: 'active',
          },
        ],
        total: 21,
      },
    });
  });
  await page.goto('/admin/geography');
  await page.evaluate(() => {
    document.documentElement.lang = 'en';
  });
  await expect(page.getByRole('alert')).toContainText('The request could not be completed');
  broken = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Tehran', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Second Page', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Tehran', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('inactive');
  await expect.poll(() => new URLSearchParams(queries.at(-1)).get('status')).toBe('inactive');
  await page.getByRole('textbox', { name: 'Search provinces', exact: true }).fill('تهران');
  await expect.poll(() => new URLSearchParams(queries.at(-1)).get('search')).toBe('تهران');
  expect(new URLSearchParams(queries.at(-1)).get('page')).toBe('1');
});
