import { approveRiskConfirmation } from './confirmation-fixture';
import { checkRoutePresentation } from './route-presentation';
import AxeBuilder from '@axe-core/playwright';
import { adminText as t } from '@barghsa/i18n/electricity-price-forms';
import { test, expect } from './coverage-fixture';
import {
  adjustmentId,
  creditAdjustmentId,
  cancelledAdjustmentId,
  contractId,
  invoiceId,
  linkedCreditId,
  defaultPriceInput,
  priceRow,
  finalizedPrice,
  cancelledPrice,
  setupElectricityPriceAdjustmentForms,
} from './electricity-price-adjustment-form-fixture';

test.use({ timezoneId: 'America/Los_Angeles' });
const digits = (value: string) =>
  value
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[,٬\u200e\u200f\u061c]/g, '')
    .replace(/٫/g, '.')
    .replace(/−/g, '-')
    .replace(/(?:IRR|ریال)\s*/g, '');
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    test(`staff price history keeps exact calculations and scoped actions (${locale}, dark=${dark})`, async ({
      page,
    }, info) => {
      const copy = (key: string) => t(`admin.electricityPrice.${key}`, locale);
      const state = await setupElectricityPriceAdjustmentForms(page, locale, dark);
      state.auth.context = 'staff';
      const charge = priceRow({ ...defaultPriceInput, percentageBps: '9007199254740991205' });
      const credit = finalizedPrice(
        priceRow({ ...defaultPriceInput, percentageBps: '-5000' }, creditAdjustmentId)
      );
      const cancelled = cancelledPrice(
        priceRow({ ...defaultPriceInput, percentageBps: '1025' }, cancelledAdjustmentId)
      );
      state.rows = [charge, credit, cancelled];
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/admin/electricity-price-adjustments?contractId=${contractId}`);
      const content = page.locator('[data-slot=list-content]');
      const records = content.locator(
        'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2)'
      );
      await expect(records).toHaveCount(3);
      await checkRoutePresentation(page, test.info(), locale);
      if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
        await page.setViewportSize({ width: 320, height: 900 });
        const invoiceLinks = page.locator('main a[href^="/admin/invoices/"]:visible');
        await expect(invoiceLinks).toHaveCount(2);
        const spacing = await page.evaluate(() =>
          document.documentElement.style.getPropertyValue('--spacing')
        );
        try {
          for (const density of [spacing, '0.21875rem']) {
            await page.evaluate((value) => {
              document.documentElement.style.setProperty('--spacing', value);
            }, density);
            for (const link of await invoiceLinks.all()) {
              const { width, height } = (await link.boundingBox())!;
              expect(width).toBeGreaterThanOrEqual(44);
              expect(height).toBeGreaterThanOrEqual(44);
            }
          }
        } finally {
          await page.evaluate((value) => {
            document.documentElement.style.setProperty('--spacing', value);
          }, spacing);
        }
        await page.setViewportSize({ width: 1280, height: 900 });
      }
      await expect(content.getByRole('table')).toHaveAccessibleName(
        locale === 'fa' ? 'تاریخچه تعدیل قیمت برق' : 'Electricity price adjustment history'
      );
      const verify = async () => {
        const first = records.first();
        const plain = digits(await first.innerText());
        expect(plain).toContain('90071992547409912.05%');
        expect(plain).toContain(charge.adjustmentAmountIrR);
        await expect(first).toContainText(defaultPriceInput.reason);
        await expect(first.locator('script')).toHaveCount(0);
        await expect(first).toContainText(copy('noInvoice'));
        await expect(
          first.getByRole('link', { name: new RegExp(copy('viewCalculation')) })
        ).toBeVisible();
        await expect(first.getByRole('link', { name: copy('finalize'), exact: true })).toHaveCount(
          0
        );
        await expect(
          records.nth(1).getByRole('link', { name: copy('finalize'), exact: true })
        ).toHaveCount(0);
        await expect(
          records.nth(2).getByRole('link', { name: copy('cancel'), exact: true })
        ).toHaveCount(0);
        await expect(
          records.nth(1).locator(`a[href="/admin/invoices/${linkedCreditId}"]`)
        ).toBeVisible();
        await expect(
          records.nth(1).getByRole('link', { name: copy('refundCredit'), exact: true })
        ).toHaveAttribute('href', `/admin/invoices/${invoiceId}`);
        for (const [index, value] of [
          [0, charge.proposedAt],
          [1, credit.finalizedAt],
          [2, cancelled.cancelledAt],
        ] as const) {
          const expected = await page.evaluate(
            ({ value, locale }) =>
              new Intl.DateTimeFormat(locale, {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'Asia/Tehran',
              }).format(new Date(value!)),
            { value, locale }
          );
          await expect(records.nth(index).locator(`time[datetime="${value}"]`).first()).toHaveText(
            expected
          );
        }
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-slot=list-content]')
              .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
              .analyze()
          ).violations
        ).toEqual([]);
      };
      await verify();
      const initialReads = state.staffReads;
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(content.getByRole('table')).toHaveCount(0);
      await verify();
      expect(state.staffReads).toBe(initialReads);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (
        locale === 'fa' &&
        !dark &&
        info.project.name === 'mobile-safari' &&
        process.env.BARGHSA_SCREENSHOT_DIR
      ) {
        await page.setViewportSize({ width: 390, height: 2600 });
        await records
          .nth(1)
          .screenshot({ path: `${process.env.BARGHSA_SCREENSHOT_DIR}/price-history-fa-light.png` });
        await page.setViewportSize({ width: 390, height: 844 });
      }
      const openCredit = records.nth(1).getByRole('link', {
        name: `${copy('viewCalculation')} ${creditAdjustmentId}`,
        exact: true,
      });
      expect(
        await openCredit.evaluate((link) => link.getBoundingClientRect().height)
      ).toBeGreaterThanOrEqual(44);
      await openCredit.click();
      const record = page.locator('[data-slot=electricity-price-record]');
      await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
      expect(new URL(page.url()).pathname).toBe(
        `/admin/electricity-price-adjustments/${contractId}/${creditAdjustmentId}`
      );
      await expect(record).toContainText(copy('source.original_invoice'));
      await expect(record).toContainText(invoiceId);
      await expect(record.locator('bdi[dir=ltr]').filter({ hasText: invoiceId })).toHaveText(
        invoiceId
      );
      await expect(record).toContainText(defaultPriceInput.contractualBasis);
      expect(digits(await record.innerText())).toContain(credit.adjustmentAmountIrR);
      await expect(record.locator('form')).toHaveCount(0);
      expect(state.writes).toEqual([]);
      expect(state.previews).toEqual([]);
      expect(state.staffReads).toBe(initialReads);
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-slot=electricity-price-record]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations
      ).toEqual([]);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.getByRole('link', { name: copy('backToHistory'), exact: true }).click();
      await expect(records).toHaveCount(3);

      await records
        .first()
        .getByRole('link', { name: new RegExp(copy('viewCalculation')) })
        .click();
      await record.getByRole('link', { name: copy('finalize'), exact: true }).click();
      const path = `/admin/electricity-price-adjustments/${contractId}/${adjustmentId}`;
      await expect(page).toHaveURL(`${path}/finalize`);
      const decision = page.locator('[data-slot=electricity-price-decision]');
      expect(digits(await decision.innerText())).toContain(charge.adjustmentAmountIrR);
      await expect(decision).toContainText(defaultPriceInput.contractualBasis);
      await decision.getByText(copy('viewCalculation'), { exact: true }).click();
      await expect(decision.getByText(contractId, { exact: true })).toBeVisible();
      await decision.getByText(copy('viewCalculation'), { exact: true }).click();
      state.writeMode = 'success';
      const form = page.getByRole('form', { name: copy('finalize'), exact: true });
      const confirm = form.locator('button[type=submit]');
      await expect(confirm).toBeDisabled();
      await approveRiskConfirmation(page, locale, 'financial');
      await confirm.click();
      await expect(page).toHaveURL(path);
      await expect(form).toHaveCount(0);
      expect(state.writes).toHaveLength(1);
      expect(state.writes[0]!.path).toContain(
        `/api/staff/electricity/price-adjustments/${adjustmentId}/finalize`
      );
      expect(state.writes[0]!.body).toEqual({
        idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
        expectedCalculationSha256: charge.calculationSha256,
      });
      await expect(record).toContainText(copy('status.finalized'));
      await page.getByRole('link', { name: copy('backToHistory'), exact: true }).click();
      await expect(records.first()).toContainText(copy('status.finalized'));
      await expect(
        records.first().getByRole('link', { name: copy('finalize'), exact: true })
      ).toHaveCount(0);

      let recordStatus = 200;
      await page.route(
        `**/api/staff/electricity/contracts/${contractId}/price-adjustments/${cancelledAdjustmentId}`,
        (route) =>
          recordStatus === 200
            ? route.fallback()
            : route.fulfill({ status: recordStatus, json: {} })
      );
      await page.setViewportSize({ width: 390, height: 844 });
      const mobileInspect = records.nth(2).getByRole('link', {
        name: `${copy('viewCalculation')} ${cancelledAdjustmentId}`,
        exact: true,
      });
      await mobileInspect.focus();
      await expect(mobileInspect).toBeFocused();
      await mobileInspect.press('Enter');
      await expect(record).toContainText(copy('status.cancelled'));
      expect(digits(await record.innerText()).replace('٫', '.')).toContain('10.25%');
      if (
        locale === 'fa' &&
        info.project.name === 'mobile-safari' &&
        process.env.BARGHSA_SCREENSHOT_DIR
      ) {
        await page.setViewportSize({ width: 1100, height: 1800 });
        await record.screenshot({
          path: `${process.env.BARGHSA_SCREENSHOT_DIR}/price-calculation-fa-${dark ? 'dark' : 'light'}.png`,
        });
        await page.setViewportSize({ width: 390, height: 844 });
      }
      const refresh = page.getByRole('button', { name: copy('refresh'), exact: true });
      recordStatus = 503;
      await refresh.click();
      await expect(page.getByRole('alert')).toContainText(copy('load'));
      await expect(record).toBeVisible();
      recordStatus = 403;
      await refresh.click();
      await expect(record).toHaveCount(0);
      await expect(page.getByRole('alert')).toContainText(copy('forbidden'));
      await expect(page.locator('main')).not.toContainText(defaultPriceInput.reason);
      recordStatus = 200;
      await refresh.click();
      await expect(record).toContainText(copy('status.cancelled'));
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.goto(`${path}/finalize`);
      await expect(decision.getByRole('status')).toContainText(copy('decisionUnavailable'));
      await expect(form).toHaveCount(0);
      expect(state.writes).toHaveLength(1);
      expect(state.previews).toEqual([]);
    });
  }
