import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { mockOtpStepUp, completeOtp } from './otp-step-up-fixture';
import { tWalletReceipts as text } from '@barghsa/i18n/wallet-receipts';
import { t as appText } from '@barghsa/i18n/app';
import { ErrorCodes } from '@barghsa/shared/errors';

const path = '**/api/admin/config/dual-approval-threshold';
async function shell(page: Page, locale: 'en' | 'fa' = 'en') {
  await crmShell(page, locale);
  await page.route('**/api/admin/approval-requests?*', (route) => route.fulfill({ json: [] }));
}

for (const locale of ['en', 'fa'] as const) {
  test(`threshold validates money and verifies before saving the captured value (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    const auth = await mockOtpStepUp(page);
    const writes: unknown[] = [];
    await page.route(path, (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: { thresholdIrR: 100000 } });
      expect(auth.verified).toBe(true);
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
      await save.click();
      await expect(field).toHaveAttribute('aria-invalid', 'true');
      await expect(field).toBeFocused();
      await expect(panel.getByRole('alert')).toHaveText(
        text('admin.receiptThreshold.invalid', locale)
      );
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(writes).toEqual([]);
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
    await completeOtp(dialog, locale);
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

for (const locale of ['en', 'fa'] as const) {
  for (const darkMode of [false, true]) {
    test(`threshold retains draft through field and service failures (${locale}, ${darkMode ? 'dark' : 'light'})`, async ({
      page,
    }) => {
      await shell(page, locale);
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            appTitle: 'Finance',
            appTitleFa: 'امور مالی',
            supportEmail: 'support@example.test',
            supportPhone: '+982112345678',
            supportMobile: '+989121234567',
            backgroundColor: '#f6f7f4',
            darkBackgroundColor: '#15201c',
            fontFamily: 'vazirmatn',
            borderRadiusRem: 0.75,
            spacingScale: 1,
            numberStyle: 'locale',
            slogan: '',
            primaryColor: '#2563eb',
            secondaryColor: '#64748b',
            accentColor: '#f59e0b',
            logoUrl: null,
            faviconUrl: null,
            darkMode,
          },
        })
      );
      const auth = await mockOtpStepUp(page);
      const writes: unknown[] = [];
      let mode: 'field' | 'mixed' | 'service' | 'mismatch' | 'success' = 'field';
      await page.route(path, (route) => {
        if (route.request().method() === 'GET')
          return route.fulfill({ json: { thresholdIrR: 100000 } });
        expect(auth.verified).toBe(true);
        writes.push(route.request().postDataJSON());
        if (mode === 'field' || mode === 'mixed')
          return route.fulfill({
            status: 400,
            json: {
              error: {
                code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
                fields: mode === 'field' ? ['thresholdIrR'] : ['thresholdIrR', 'actorUserId'],
              },
              message: 'private-threshold-diagnostic',
            },
          });
        if (mode === 'service')
          return route.fulfill({ status: 503, json: { message: 'private-threshold-diagnostic' } });
        return route.fulfill({ json: { thresholdIrR: mode === 'mismatch' ? 250001 : 250000 } });
      });
      await page.goto('/admin/approval-requests');
      await expect(page.locator('html')).toHaveClass(darkMode ? /dark/ : /^(?!.*\bdark\b)/);
      const panel = page.getByRole('region', {
        name: text('admin.receiptThreshold.title', locale),
        includeHidden: true,
      });
      const field = page.locator('#receipt-threshold');
      const save = panel.getByRole('button', {
        name: text('admin.receiptThreshold.save', locale),
        includeHidden: true,
      });
      await expect(field).toHaveValue('100000');
      await field.fill('-1');
      const beforeFeedback = await save.boundingBox();
      await field.blur();
      await expect(field).toHaveAttribute('aria-invalid', 'true');
      expect((await save.boundingBox())!.y).toBeCloseTo(beforeFeedback!.y, 1);
      await expect(panel.getByRole('alert')).toHaveText(
        text('admin.receiptThreshold.invalid', locale)
      );
      const raw = locale === 'fa' ? ' ۲۵۰٬۰۰۰ ' : ' 250,000 ';
      await field.fill(raw);
      await expect(panel.getByRole('alert')).toHaveCount(0);
      await save.click();
      await expect(field).toBeDisabled();
      await expect(save).toHaveAttribute('aria-busy', 'true');
      expect(writes).toEqual([]);
      let dialog = page.getByRole('dialog');
      await completeOtp(dialog, locale);
      await expect(dialog).toHaveCount(0);
      await expect(field).toHaveValue(raw);
      await expect(field).toBeFocused();
      await expect(field).toBeEnabled();
      await expect(panel.getByRole('alert')).toHaveText(
        text('admin.receiptThreshold.invalid', locale)
      );
      const ids = (await field.getAttribute('aria-describedby'))!.split(' ');
      expect(await panel.getByRole('alert').getAttribute('id')).toBe(ids.at(-1));
      expect(
        (
          await new AxeBuilder({ page })
            .include('[aria-labelledby="receipt-threshold-title"]')
            .analyze()
        ).violations
      ).toEqual([]);
      const bounds = await field.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      await expect(panel).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
      await expect(page.getByText('private-threshold-diagnostic')).toHaveCount(0);
      if (locale === 'fa' && darkMode && test.info().project.name === 'mobile-safari') {
        await field.scrollIntoViewIfNeeded();
        await page.screenshot({ path: '/tmp/barghsa-threshold-validation-fa-dark-mobile.png' });
      }
      // Reopening captures the retained valid input; unknown metadata stays in the dialog.
      mode = 'mixed';
      await save.click();
      dialog = page.getByRole('dialog');
      await completeOtp(dialog, locale);
      await expect(dialog.getByRole('alert')).toHaveText(appText('team.error', locale));
      await expect(field).toHaveValue(raw);
      await expect(page.getByText('private-threshold-diagnostic')).toHaveCount(0);
      mode = 'service';
      await dialog
        .getByRole('button', { name: appText('team.confirm', locale), exact: true })
        .click();
      await expect(dialog.getByRole('alert')).toHaveText(appText('team.error', locale));
      mode = 'mismatch';
      await dialog
        .getByRole('button', { name: appText('team.confirm', locale), exact: true })
        .click();
      await expect(dialog.getByRole('alert')).toHaveText(appText('team.error', locale));
      await expect(panel.getByRole('status', { includeHidden: true })).toHaveCount(0);
      expect(writes).toHaveLength(4);
      mode = 'success';
      await dialog
        .getByRole('button', { name: appText('team.confirm', locale), exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(panel.getByRole('status')).toHaveText(
        text('admin.receiptThreshold.saved', locale)
      );
      await expect(field).toHaveValue('250000');
      await expect(field).toBeEnabled();
      expect(writes).toEqual(Array.from({ length: 5 }, () => ({ threshold_irr: 250000 })));
    });
  }
}

for (const status of [401, 403]) {
  test(`threshold command denial ${status} clears private draft`, async ({ page }) => {
    await shell(page);
    await mockOtpStepUp(page);
    let writes = 0;
    await page.route(path, (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: { thresholdIrR: 100000 } });
      writes++;
      return route.fulfill({ status, json: { error: { code: ErrorCodes.AUTHZ_FORBIDDEN.code } } });
    });
    await page.goto('/admin/approval-requests');
    const panel = page.getByRole('region', { name: 'Dual-approval threshold' });
    await panel.getByLabel('Threshold (IRR)').fill('250000');
    await panel.getByRole('button', { name: 'Save threshold' }).click();
    await completeOtp(page.getByRole('dialog'), 'en');
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Threshold saved.', { exact: true })).toHaveCount(0);
    expect(writes).toBe(1);
  });
}
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
  await mockOtpStepUp(page);
  await page.goto('/admin/approval-requests');
  const field = page.getByLabel('Threshold (IRR)');
  await field.fill('250000');
  await page.getByRole('button', { name: 'Save threshold' }).click();
  const dialog = page.getByRole('dialog');
  await completeOtp(dialog, 'en');
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(page.getByText('Threshold saved.', { exact: true })).toHaveCount(0);
  await expect(field).toHaveValue('250000');
});
