import { test, expect } from './coverage-fixture';
for (const locale of ['en', 'fa'])
  test(`catalogue editor retries captured settings (${locale})`, async ({ page }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    let failed = true,
      verified = false,
      denied = false;
    const attempts: unknown[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'Asia/Tehran' } })
    );
    await page.route('**/api/admin/catalogue/products*', (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill(
          denied ? { status: 403, json: {} } : failed ? { status: 503, json: {} } : { json: [] }
        );
      attempts.push(route.request().postDataJSON());
      if (!verified)
        return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
      denied = true;
      return route.fulfill({ status: 201, json: {} });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = route.request().postDataJSON().password === 'correct';
      return route.fulfill({ status: verified ? 200 : 401, json: {} });
    });
    await page.goto('/admin/catalogue');
    await expect(page.getByRole('alert')).toBeVisible();
    failed = false;
    await page.getByRole('button', { name: fa ? 'تازه‌سازی' : 'Refresh', exact: true }).click();
    await page
      .getByRole('button', { name: fa ? 'افزودن محصول' : 'Add product', exact: true })
      .click();
    await page
      .getByLabel(fa ? 'عنوان فارسی' : 'Persian title', { exact: true })
      .fill('  Local FA  ');
    await page
      .getByLabel(fa ? 'عنوان انگلیسی' : 'English title', { exact: true })
      .fill('  Local EN  ');
    await page
      .getByRole('button', { name: fa ? 'ذخیره محصول' : 'Save product', exact: true })
      .click();
    const dialog = page.getByRole('dialog'),
      confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    await confirm.click();
    await dialog.locator('input[type="password"]').fill('wrong');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.locator('input[type="password"]').fill('correct');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toEqual(
      Array(2).fill({
        title: { fa: 'Local FA', en: 'Local EN' },
        description: { fa: '', en: '' },
        categories: [],
        type: 'consultation',
        price: null,
        status: 'inactive',
      })
    );
    await expect(page.getByRole('alert')).toContainText(
      fa ? 'اجازه مدیریت' : 'permission to manage'
    );
    await expect(
      page.getByRole('form', { name: fa ? 'ویرایش محصول' : 'Product editor' })
    ).toHaveCount(0);
  });

for (const locale of ['en', 'fa'])
  test(`catalogue tabs support keyboard navigation (${locale})`, async ({ page }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'Asia/Tehran' } })
    );
    await page.route('**/api/admin/catalogue/products*', (route) => route.fulfill({ json: [] }));
    await page.goto('/admin/catalogue');
    const consultation = page.getByRole('tab', {
      name: fa ? 'مشاوره' : 'Consultation',
      exact: true,
    });
    await consultation.focus();
    await page.keyboard.press(fa ? 'ArrowLeft' : 'ArrowRight');
    await expect(
      page.getByRole('tab', { name: fa ? 'برق' : 'Electricity', exact: true })
    ).toBeFocused();
    await expect(page.getByRole('tabpanel')).toHaveAttribute(
      'aria-labelledby',
      'catalogue-tab-electricity'
    );
    await page.keyboard.press('End');
    await expect(
      page.getByRole('tab', { name: fa ? 'طرح‌های صرفه‌جویی' : 'Saving plans', exact: true })
    ).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(consultation).toBeFocused();
    await page.keyboard.press(fa ? 'ArrowRight' : 'ArrowLeft');
    await expect(
      page.getByRole('tab', { name: fa ? 'طرح‌های صرفه‌جویی' : 'Saving plans', exact: true })
    ).toBeFocused();
  });
