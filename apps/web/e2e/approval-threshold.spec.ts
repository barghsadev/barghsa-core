import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';

const path = '**/api/admin/config/dual-approval-threshold';
async function shell(page: Page, locale = 'en') {
  await page.addInitScript((value) => {
    const apply = () => {
      if (document.documentElement) document.documentElement.lang = value;
    };
    apply();
    new MutationObserver(apply).observe(document, { childList: true });
  }, locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/admin/approval-requests?*', (route) => route.fulfill({ json: [] }));
}
for (const locale of ['en', 'fa']) {
  test(`threshold validates money and verifies before saving the captured value (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    let verified = false;
    const writes: unknown[] = [];
    await page.route('**/api/auth/step-up', (route) => {
      verified = true;
      return route.fulfill({ json: { verified: true } });
    });
    await page.route(path, (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: { thresholdIrR: 100000 } });
      expect(verified).toBe(true);
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: { thresholdIrR: 250000 } });
    });
    await page.goto('/admin/approval-requests');
    const panel = page.getByRole('region', {
      name: locale === 'en' ? 'Dual-approval threshold' : 'آستانه تأیید دو نفره',
    });
    const field = panel.getByLabel(locale === 'en' ? 'Threshold (IRR)' : 'آستانه (ریال)');
    const save = panel.getByRole('button', {
      name: locale === 'en' ? 'Save threshold' : 'ذخیره آستانه',
    });
    await expect(field).toHaveValue('100000');
    for (const invalid of ['', '-10', '1e3', '12.5', '12,5', '9007199254740992']) {
      await field.fill(invalid);
      await expect(save).toBeDisabled();
    }
    await field.fill('۰');
    await expect(panel).toContainText(
      locale === 'en'
        ? 'Existing pending approvals still require a decision.'
        : 'درخواست‌های تأیید موجود همچنان به تصمیم نیاز دارند.'
    );
    await field.fill(locale === 'en' ? '250,000' : '۲۵۰٬۰۰۰');
    await expect(panel.locator('#receipt-threshold-value')).toContainText(
      locale === 'en' ? '250,000' : '۲۵۰٬۰۰۰'
    );
    expect(
      (
        await new AxeBuilder({ page })
          .include('[aria-labelledby="receipt-threshold-title"]')
          .analyze()
      ).violations
    ).toEqual([]);
    await save.click();
    expect(writes).toEqual([]);
    await expect(page.locator('#receipt-threshold')).toBeDisabled();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByLabel(locale === 'en' ? 'Confirm your password' : 'رمز عبور خود را تأیید کنید')
      .fill('Test-password-123!');
    await dialog
      .getByRole('button', { name: locale === 'en' ? 'Confirm' : 'تأیید', exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(panel.getByRole('status')).toHaveText(
      locale === 'en' ? 'Threshold saved.' : 'آستانه ذخیره شد.'
    );
    expect(writes).toEqual([{ threshold_irr: 250000 }]);
  });
}
test('threshold load failure assumes no value and can retry; denied permission hides editing', async ({
  page,
}) => {
  await shell(page);
  let state = 'failed';
  await page.route(path, (route) =>
    route.fulfill(
      state === 'failed'
        ? { status: 503, json: {} }
        : state === 'forbidden'
          ? { status: 403, json: {} }
          : { json: { thresholdIrR: 0 } }
    )
  );
  await page.goto('/admin/approval-requests');
  await expect(page.getByRole('alert')).toHaveText(
    'Threshold unavailable. No setting has been assumed.'
  );
  await expect(page.getByLabel('Threshold (IRR)')).toHaveCount(0);
  state = 'valid';
  await page.getByRole('button', { name: 'Retry loading threshold' }).click();
  await expect(page.getByLabel('Threshold (IRR)')).toHaveValue('0');
  state = 'forbidden';
  const denied = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/admin/config/dual-approval-threshold') &&
      response.status() === 403
  );
  await page.reload();
  await denied;
  await expect(page.getByRole('region', { name: 'Dual-approval threshold' })).toHaveCount(0);
});
test('failed threshold save never reports success or changes the loaded value', async ({
  page,
}) => {
  await shell(page);
  await page.route(path, (route) =>
    route.fulfill(
      route.request().method() === 'GET'
        ? { json: { thresholdIrR: 100000 } }
        : { status: 500, json: {} }
    )
  );
  await page.route('**/api/auth/step-up', (route) => route.fulfill({ json: { verified: true } }));
  await page.goto('/admin/approval-requests');
  const field = page.getByLabel('Threshold (IRR)');
  await field.fill('250000');
  await page.getByRole('button', { name: 'Save threshold' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Confirm your password').fill('Test-password-123!');
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(page.getByText('Threshold saved.', { exact: true })).toHaveCount(0);
  await expect(field).toHaveValue('250000');
});
