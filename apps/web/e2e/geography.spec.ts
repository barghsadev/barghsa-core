import { approveRiskConfirmation } from './confirmation-fixture';
import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { crmShell } from './crm-shell-fixture';
test.use({ viewport: { width: 390, height: 844 } });

for (const locale of ['en', 'fa'] as const) {
  test(`province creation opens a localized page from the keyboard (${locale})`, async ({
    page,
  }) => {
    await crmShell(page, locale);
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
    const heading = locale === 'fa' ? 'مدیریت استان‌ها' : 'Province Management';
    const addName = locale === 'fa' ? 'افزودن استان' : 'Add Province';
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    const add = page.getByRole('link', { name: addName, exact: true });
    await add.focus();
    await add.press('Enter');
    await expect(page).toHaveURL('/admin/geography/provinces/new');
    const createPage = page.getByRole('heading', { name: addName, level: 1, exact: true });
    await expect(createPage).toBeFocused();
    await expect(page.getByLabel(locale === 'fa' ? 'نام فارسی' : 'Persian Name')).toBeVisible();
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    await page
      .getByRole('button', { name: locale === 'fa' ? 'انصراف' : 'Cancel', exact: true })
      .click();
    await expect(page).toHaveURL('/admin/geography');
    await expect(add).toBeVisible();
  });
}

for (const locale of ['en', 'fa'] as const) {
  test(`province CRUD preserves input after failures (${locale})`, async ({ page }) => {
    const fa = locale === 'fa';
    let rows: { id: string; nameFa: string; nameEn: string; status: string }[] = [];
    let creates = 0;
    await crmShell(page, locale);
    await page.route('**/api/admin/geography/provinces**', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        const path = new URL(route.request().url()).pathname;
        const json = path.endsWith('/cities')
          ? { cities: [], total: 0 }
          : path.endsWith('/province-1')
            ? rows[0]
            : { provinces: rows, total: rows.length };
        return route.fulfill({ json });
      }
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
    await page
      .getByRole('link', { name: fa ? 'افزودن استان' : 'Add Province', exact: true })
      .click();
    const form = page.getByRole('main').getByRole('form');
    const create = form.getByRole('button', { name: fa ? 'ایجاد' : 'Create', exact: true });
    await create.click();
    await expect(form.getByRole('alert').first()).toBeVisible();
    expect(creates).toBe(0);
    await form.getByLabel(fa ? 'نام فارسی' : 'Persian Name').fill('تهران');
    await form.getByLabel(fa ? 'نام انگلیسی' : 'English Name').fill('Tehran');
    await create.click();
    await expect(form.getByRole('alert').first()).toBeVisible();
    await expect(form).not.toContainText('private database error');
    await expect(form.getByLabel(fa ? 'نام انگلیسی' : 'English Name')).toHaveValue('Tehran');
    await create.click();
    await expect(form).toHaveCount(0);
    await expect(page).toHaveURL('/admin/geography/provinces/province-1');
    await page
      .getByRole('main')
      .getByRole('link', { name: fa ? 'ویرایش استان' : 'Edit Province', exact: true })
      .click();
    await form.getByLabel(fa ? 'نام انگلیسی' : 'English Name').fill('Tehran Province');
    await form.getByRole('button', { name: fa ? 'ذخیره' : 'Save', exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(page.getByRole('main')).toContainText('Tehran Province');
    await page
      .getByRole('main')
      .getByRole('link', { name: fa ? 'مدیریت استان‌ها' : 'Province Management', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    const row = page
      .locator('table:visible tbody tr, ol[role=list]:visible > li')
      .filter({ hasText: 'Tehran' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Tehran Province');
    await row
      .getByRole('button', { name: fa ? 'غیرفعال‌سازی' : 'Deactivate', exact: true })
      .click();
    const deactivate = dialog.getByRole('button', {
      name: fa ? 'غیرفعال‌سازی' : 'Deactivate',
      exact: true,
    });
    await expect(deactivate).toBeDisabled();
    await approveRiskConfirmation(page, locale, 'destructive');
    await expect(deactivate).toBeEnabled();
    await deactivate.click();
    await expect(dialog).toHaveCount(0);
    await expect(row.getByText(fa ? 'غیرفعال' : 'Inactive', { exact: true })).toBeVisible();
  });
}

test('province list retries malformed data and applies pagination and filters', async ({
  page,
}) => {
  let broken = true;
  const queries: string[] = [];
  await crmShell(page, 'en');
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
  await expect(page.getByRole('alert')).toContainText('The request could not be completed');
  broken = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(
    page.locator('table:visible, ol[role=list]:visible').getByText('Tehran', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(
    page.locator('table:visible, ol[role=list]:visible').getByText('Second Page', { exact: true })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeEnabled();
  await expect(
    page.locator('table:visible, ol[role=list]:visible').getByText('Second Page', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(
    page.locator('table:visible, ol[role=list]:visible').getByText('Tehran', { exact: true })
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Filter by status', exact: true })
    .selectOption('inactive');
  await expect.poll(() => new URLSearchParams(queries.at(-1)).get('status')).toBe('inactive');
  await page.getByRole('searchbox', { name: 'Search provinces', exact: true }).fill('تهران');
  await expect.poll(() => new URLSearchParams(queries.at(-1)).get('search')).toBe('تهران');
  expect(new URLSearchParams(queries.at(-1)).get('page')).toBe('1');
});

test('city pagination resets only when the search changes', async ({ page }) => {
  const queries: string[] = [];
  await crmShell(page, 'en');
  await page.route('**/api/admin/geography/provinces?*', (route) =>
    route.fulfill({
      json: {
        provinces: [{ id: 'p1', nameFa: 'تهران', nameEn: 'Tehran', status: 'active' }],
        total: 1,
      },
    })
  );
  await page.route('**/api/admin/geography/provinces/p1', (route) =>
    route.fulfill({ json: { id: 'p1', nameFa: 'تهران', nameEn: 'Tehran', status: 'active' } })
  );
  await page.route('**/api/admin/geography/provinces/p1/cities?*', (route) => {
    const query = new URL(route.request().url()).searchParams;
    queries.push(query.toString());
    return route.fulfill({
      json: {
        cities: [
          {
            id: 'c1',
            provinceId: 'p1',
            nameFa: 'ری',
            nameEn: query.get('page') === '2' ? 'Second City Page' : 'Rey',
            status: 'active',
          },
        ],
        total: 21,
      },
    });
  });
  await page.goto('/admin/geography');
  await page.getByRole('link', { name: 'Cities', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Cities — Tehran', exact: true });
  await expect(
    panel.locator('table:visible, ol[role=list]:visible').getByText('Rey', { exact: true })
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(
    panel
      .locator('table:visible, ol[role=list]:visible')
      .getByText('Second City Page', { exact: true })
  ).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Previous', exact: true })).toBeEnabled();
  await expect(
    panel
      .locator('table:visible, ol[role=list]:visible')
      .getByText('Second City Page', { exact: true })
  ).toBeVisible();
  await panel.getByRole('searchbox', { name: 'Search cities', exact: true }).fill('Rey');
  await expect.poll(() => new URLSearchParams(queries.at(-1)).get('search')).toBe('Rey');
  expect(new URLSearchParams(queries.at(-1)).get('page')).toBe('1');
  await expect(panel.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled();
});

for (const locale of ['en', 'fa'] as const) {
  test(`cities can be edited and imported with accessible localized pages (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    let rows = [{ id: 'city-1', provinceId: 'p1', nameFa: 'ری', nameEn: 'Rey', status: 'active' }];
    let imports = 0;
    await crmShell(page, locale);
    await page.route('**/api/admin/geography/provinces?*', (route) =>
      route.fulfill({
        json: {
          provinces: [{ id: 'p1', nameFa: 'تهران', nameEn: 'Tehran', status: 'active' }],
          total: 1,
        },
      })
    );
    await page.route('**/api/admin/geography/provinces/p1', (route) =>
      route.fulfill({ json: { id: 'p1', nameFa: 'تهران', nameEn: 'Tehran', status: 'active' } })
    );
    await page.route('**/api/admin/geography/provinces/p1/cities**', async (route) => {
      const req = route.request();
      if (req.method() === 'GET') {
        const path = new URL(req.url()).pathname;
        return route.fulfill({
          json: path.endsWith('/cities')
            ? { cities: rows, total: rows.length }
            : rows.find((row) => row.id === path.split('/').at(-1)),
        });
      }
      if (req.url().endsWith('/import')) {
        imports++;
        if (imports === 1) return route.fulfill({ status: 409, json: {} });
        const added = req
          .postDataJSON()
          .cities.map((c: { nameFa: string; nameEn: string }, i: number) => ({
            id: `import-${i}`,
            provinceId: 'p1',
            ...c,
            status: 'active',
          }));
        rows.push(...added);
        return route.fulfill({ status: 201, json: { imported: added.length } });
      }
      if (req.method() === 'POST') {
        const added = { id: 'new-city', provinceId: 'p1', ...req.postDataJSON(), status: 'active' };
        rows.push(added);
        return route.fulfill({ status: 201, json: added });
      }
      const id = req.url().split('/').at(-1);
      rows = rows.map((row) =>
        row.id !== id
          ? row
          : { ...row, ...(req.method() === 'DELETE' ? { status: 'inactive' } : req.postDataJSON()) }
      );
      return route.fulfill({
        json: req.method() === 'DELETE' ? { success: true } : rows.find((row) => row.id === id),
      });
    });
    await page.goto('/admin/geography');
    await page.getByRole('link', { name: fa ? 'شهرها' : 'Cities', exact: true }).click();
    const panel = page.getByRole('region', {
      name: fa ? 'شهرها — تهران' : 'Cities — Tehran',
      exact: true,
    });
    const addName = fa ? 'افزودن شهر' : 'Add City';
    const editName = fa ? 'ویرایش شهر' : 'Edit City';
    const main = page.getByRole('main');
    await panel.getByRole('link', { name: addName, exact: true }).click();
    const form = main.getByRole('form');
    const nameFa = form.getByLabel(fa ? 'نام فارسی' : 'Persian Name');
    const nameEn = form.getByLabel(fa ? 'نام انگلیسی' : 'English Name');
    await expect(main.getByRole('heading', { name: addName, level: 1, exact: true })).toBeFocused();
    await nameFa.fill('تجریش');
    await nameEn.fill('Tajrish');
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    await form.getByRole('button', { name: fa ? 'ایجاد' : 'Create', exact: true }).click();
    await expect(page).toHaveURL('/admin/geography/provinces/p1/cities/new-city');
    await main.getByRole('link', { name: editName, exact: true }).click();
    await nameEn.fill('Tajrish City');
    await form.getByRole('button', { name: fa ? 'ذخیره' : 'Save', exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(main).toContainText('Tajrish City');
    await main.getByRole('link', { name: fa ? 'تهران' : 'Tehran', exact: true }).click();
    const row = panel
      .locator('table:visible tbody tr, ol[role=list]:visible > li')
      .filter({ hasText: 'Tajrish City' });
    const dialog = page.getByRole('dialog');
    await row
      .getByRole('button', { name: fa ? 'غیرفعال‌سازی' : 'Deactivate', exact: true })
      .click();
    const deactivate = dialog.getByRole('button', {
      name: fa ? 'غیرفعال‌سازی' : 'Deactivate',
      exact: true,
    });
    await expect(deactivate).toBeDisabled();
    await approveRiskConfirmation(page, locale, 'destructive');
    await expect(deactivate).toBeEnabled();
    await deactivate.click();
    await expect(dialog).toHaveCount(0);
    await expect(row.getByText(fa ? 'غیرفعال' : 'Inactive', { exact: true })).toBeVisible();
    const importName = fa ? 'ورود گروهی شهرها' : 'Import Cities';
    const importButton = panel.getByRole('link', { name: importName, exact: true });
    await importButton.click();
    const input = form.getByLabel(fa ? 'ردیف‌های شهر' : 'City rows');
    await expect(
      main.getByRole('heading', { name: importName, level: 1, exact: true })
    ).toBeFocused();
    await form.getByRole('button', { name: importName, exact: true }).click();
    await expect(form.getByRole('alert').first()).toBeVisible();
    expect(imports).toBe(0);
    await input.fill('اسلامشهر\tEslamshahr\nورامین\tVaramin');
    await expect(form.getByRole('table').getByRole('row')).toHaveCount(3);
    await form.getByRole('button', { name: importName, exact: true }).click();
    await expect(form.getByRole('alert').first()).toBeVisible();
    await expect(input).toHaveValue(/Eslamshahr/);
    await form.getByRole('button', { name: importName, exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(importButton).toBeVisible();
    await expect(
      panel.locator('table:visible, ol[role=list]:visible').getByText('Varamin', { exact: true })
    ).toBeVisible();
  });
}
