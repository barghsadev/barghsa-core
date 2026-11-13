import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { mockOtpStepUp, completeOtp } from './otp-step-up-fixture';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import { tWalletLimit } from '@barghsa/i18n/wallet-limit';
import { tWalletReceipts } from '@barghsa/i18n/wallet-receipts';

for (const locale of ['en', 'fa'] as const) {
  test(`contract limit recovery activates a reviewed draft separately (${locale})`, async ({
    page,
  }) => {
    await setupCatalogueForms(page, locale, locale === 'fa');
    const label = (key: string) => adminText(`admin.contractLimits.${key}`, locale);
    const config = { maxQuantityIncreasePercent: 20, maxContractDuration: 24, leadTimeDays: 3 };
    const sourceId = '73c785ad-6059-4055-9a19-5ad1d4b534c3';
    const draftId = '03899b68-02b2-4ff9-a52f-420ae91d5df0';
    const draft = { id: draftId, baseVersion: 2, sourceId, sourceVersion: 1, config };
    let active = { ...config, leadTimeDays: 14 };
    let baseVersion = 2;
    let pending: typeof draft | null = null;
    const path = '**/api/admin/config/contract-electricity-limits';
    await page.route(path, (route) => route.fulfill({ json: active }));
    await page.route(`${path}/rollback-history`, (route) =>
      route.fulfill({
        json: {
          baseVersion,
          items: [{ id: sourceId, version: 1, config }],
          draft: pending,
          nextBeforeVersion: null,
        },
      })
    );
    await page.route(`${path}/rollback-draft`, (route) => {
      expect(route.request().postDataJSON()).toEqual({ sourceId, expectedVersion: 2 });
      pending = draft;
      return route.fulfill({ status: 201, json: draft });
    });
    await page.route(`${path}/rollback-activate`, (route) => {
      expect(route.request().postDataJSON()).toEqual({ draftId, expectedVersion: 2 });
      pending = null;
      active = config;
      baseVersion = 3;
      return route.fulfill({ json: { config, version: 3, draftId } });
    });
    const toggle = page.getByRole('button', { name: label('recoveryTitle'), exact: true });
    const field = page.getByLabel(label('leadTimeDays'), { exact: true });
    const activate = page.getByRole('button', { name: label('recoveryActivate'), exact: true });
    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', {
      name: appText('team.confirm', locale),
      exact: true,
    });
    await page.goto('/admin/contract-limits');
    await expect(field).toHaveValue('14');
    await toggle.focus();
    await toggle.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page
      .getByRole('button', {
        name: label('recoveryStage').replace('{version}', locale === 'fa' ? '۱' : '1'),
        exact: true,
      })
      .click();
    await expect(dialog).toContainText(label('recoveryStageConfirm'));
    await confirm.click();
    await expect(activate).toBeVisible();
    await expect(field).toHaveValue('14');
    expect(
      (await new AxeBuilder({ page }).include('#contract-limit-recovery').analyze()).violations
    ).toEqual([]);
    await activate.click();
    await expect(dialog).toContainText(label('recoveryActivateConfirm'));
    await confirm.click();
    await expect(field).toHaveValue('3');
    await expect(activate).toHaveCount(0);
  });
}

for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    const contract = (key: string) => adminText(`admin.contractLimits.${key}`, locale);
    const wallet = (key: string) => tWalletLimit(`admin.walletLimit.${key}`, locale);
    const threshold = (key: string) => tWalletReceipts(`admin.receiptThreshold.${key}`, locale);
    const cases = [
      {
        name: 'contract',
        url: '/admin/contract-limits',
        path: 'contract-electricity-limits',
        form: adminText('admin.settings.contractTerms', locale),
        label: contract,
        selector: '#contract-limit-leadTimeDays',
        field: 'leadTimeDays',
        raw: locale === 'fa' ? ' ۱۴ ' : ' 14 ',
        invalid: '1e3',
        initial: { maxQuantityIncreasePercent: 20, maxContractDuration: 24, leadTimeDays: 0 },
        receipt: { maxQuantityIncreasePercent: 20, maxContractDuration: 24, leadTimeDays: 14 },
        body: {
          max_quantity_increase_percent: 20,
          max_contract_duration_months: 24,
          lead_time_days: 14,
        },
      },
      {
        name: 'wallet',
        url: '/admin/wallet-receipts',
        path: 'wallet-top-up-limit',
        form: wallet('title'),
        label: wallet,
        selector: '#online-top-up-limit',
        field: 'limitIrR',
        raw: locale === 'fa' ? ' ۲۵۰٬۰۰۰ ' : ' 250,000 ',
        invalid: '12,5',
        initial: { limitIrR: 2_000_000_000, version: 0 },
        receipt: { limitIrR: 250000, version: 1 },
        body: { limit_irr: 250000, expected_version: 0 },
      },
      {
        name: 'threshold',
        url: '/admin/approval-requests',
        path: 'dual-approval-threshold',
        form: threshold('title'),
        label: threshold,
        selector: '#receipt-threshold',
        field: 'thresholdIrR',
        raw: locale === 'fa' ? ' ٢٥٠٬٠٠٠ ' : ' 250,000 ',
        invalid: '9007199254740992',
        initial: { thresholdIrR: 100000 },
        receipt: { thresholdIrR: 250000 },
        body: { threshold_irr: 250000 },
      },
    ];
    for (const item of cases) {
      test(`${item.name} limit retains raw input and saves reviewed values (${locale}, dark=${dark})`, async ({
        page,
      }, info) => {
        await setupCatalogueForms(page, locale, dark);
        const otp = await mockOtpStepUp(page);
        await page.route('**/api/admin/approval-requests?*', (route) =>
          route.fulfill({ json: [] })
        );
        let value: unknown = item.initial,
          mode = 'field',
          reads = 0;
        const writes: unknown[] = [];
        await page.route(`**/api/admin/config/${item.path}`, (route) => {
          if (route.request().method() === 'GET') {
            reads++;
            return route.fulfill({ json: value });
          }
          if (item.name === 'threshold') expect(otp.verified).toBe(true);
          writes.push(route.request().postDataJSON());
          if (mode === 'field')
            return route.fulfill({
              status: 400,
              json: {
                error: { code: 'VALIDATION:INPUT:INVALID', fields: [item.field] },
                message: 'private-config-diagnostic',
              },
            });
          value = item.receipt;
          return route.fulfill({ json: value });
        });
        await page.goto(item.url);
        await expect(page.locator('html')).toHaveClass(dark ? /dark/ : /^(?!.*\bdark\b)/);
        const form = page.getByRole('form', { name: item.form, exact: true, includeHidden: true });
        const field = page.locator(item.selector),
          save = form.getByRole('button', {
            name: item.label('save'),
            exact: true,
            includeHidden: true,
          });
        await field.fill(item.invalid);
        await save.click();
        await expect(field).toHaveAttribute('aria-invalid', 'true');
        await expect(field).toBeFocused();
        await expect(field).toHaveValue(item.invalid);
        expect(writes).toEqual([]);
        await field.fill(item.raw);
        await save.click();
        let dialog = page.getByRole('dialog');
        if (item.name === 'threshold') await completeOtp(dialog, locale);
        else
          await dialog
            .getByRole('button', { name: appText('team.confirm', locale), exact: true })
            .click();
        await expect(dialog).toHaveCount(0);
        await expect(field).toBeFocused();
        await expect(field).toHaveValue(item.raw);
        await expect(field).toBeEnabled();
        expect(writes).toEqual([item.body]);
        expect(reads).toBe(1);
        await expect(page.getByText('private-config-diagnostic')).toHaveCount(0);
        const error = form.getByRole('alert');
        await expect(error).toBeVisible();
        expect((await field.getAttribute('aria-describedby'))!.split(' ')).toContain(
          await error.getAttribute('id')
        );
        expect(
          (await new AxeBuilder({ page }).include(`form:has(${item.selector})`).analyze())
            .violations
        ).toEqual([]);
        const bounds = await field.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
        if (locale === 'fa' && dark && info.project.name === 'mobile-safari') {
          const viewport = page.viewportSize()!;
          await page.setViewportSize({ ...viewport, height: 1400 });
          await form.screenshot({
            path: `/tmp/barghsa-limit-settings-${item.name}-fa-dark-mobile.png`,
          });
          await page.setViewportSize(viewport);
        }
        mode = 'success';
        await save.click();
        dialog = page.getByRole('dialog');
        if (item.name === 'threshold') await completeOtp(dialog, locale);
        else
          await dialog
            .getByRole('button', { name: appText('team.confirm', locale), exact: true })
            .click();
        await expect(dialog).toHaveCount(0);
        expect(writes).toEqual([item.body, item.body]);
        await expect(field).toBeEnabled();
        await expect(
          page
            .getByRole('status')
            .filter({ hasText: item.label('saved') })
            .first()
        ).toBeVisible();
        await field.fill('2');
        await expect(
          page
            .locator('main')
            .getByRole('status')
            .filter({ hasText: item.label('saved') })
        ).toHaveCount(0);
      });
    }
  }
