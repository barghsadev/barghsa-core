import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/admin-ui';
import { test, expect } from './coverage-fixture';
import {
  adjustmentId,
  creditAdjustmentId,
  cancelledAdjustmentId,
  contractId,
  profileId,
  versionId,
  periodEnd,
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
      let readStatus = 200;
      await page.route(
        `**/api/staff/electricity/contracts/${contractId}/price-adjustments`,
        (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          state.staffReads++;
          return readStatus === 200
            ? route.fulfill({
                json: {
                  contractId,
                  profileId,
                  versionId,
                  periodEnd,
                  canPropose: false,
                  canCancel: true,
                  canFinalize: true,
                  blockedByIncrease: false,
                  adjustments: state.rows,
                },
              })
            : route.fulfill({ status: readStatus, json: {} });
        }
      );
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/admin/electricity-price-adjustments?contractId=${contractId}`);
      const content = page.locator('[data-slot=list-content]');
      const records = content.locator(
        'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2)'
      );
      await expect(records).toHaveCount(3);
      await expect(content.getByRole('table')).toHaveAccessibleName(
        locale === 'fa' ? 'تاریخچه تعدیل قیمت برق' : 'Electricity price adjustment history'
      );
      const verify = async () => {
        const first = records.first();
        const plain = digits(await first.innerText()).replace('٫', '.');
        expect(plain).toContain('90071992547409912.05%');
        expect(plain).toContain(charge.adjustmentAmountIrR);
        await expect(first).toContainText(defaultPriceInput.reason);
        await expect(first.locator('script')).toHaveCount(0);
        await expect(first).toContainText(copy('noInvoice'));
        await expect(
          first.getByRole('button', { name: copy('finalize'), exact: true })
        ).toBeEnabled();
        await expect(
          records.nth(1).getByRole('button', { name: copy('finalize'), exact: true })
        ).toHaveCount(0);
        await expect(
          records.nth(2).getByRole('button', { name: copy('cancel'), exact: true })
        ).toHaveCount(0);
        await expect(
          records.nth(1).locator(`a[href="/admin/invoices?invoiceId=${linkedCreditId}"]`)
        ).toBeVisible();
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
      const openCredit = records.nth(1).getByRole('button', {
        name: `${copy('viewCalculation')} : ${creditAdjustmentId}`,
        exact: true,
      });
      expect(
        await openCredit.evaluate((button) => button.getBoundingClientRect().height)
      ).toBeGreaterThanOrEqual(44);
      await openCredit.click();
      let dialog = page.getByRole('dialog', { name: copy('viewCalculation'), exact: true });
      await expect(dialog).toContainText(creditAdjustmentId);
      await expect(dialog).toContainText(copy('source.original_invoice'));
      await expect(dialog).toContainText(invoiceId);
      await expect(dialog.locator('bdi[dir=ltr]').filter({ hasText: invoiceId })).toHaveText(
        invoiceId
      );
      await expect(dialog).toContainText(defaultPriceInput.contractualBasis);
      expect(digits(await dialog.innerText())).toContain(credit.adjustmentAmountIrR);
      await expect(dialog.locator('time')).toHaveCount(3);
      await expect(dialog.locator('form')).toHaveCount(0);
      expect(state.writes).toEqual([]);
      expect(state.previews).toEqual([]);
      expect(
        (
          await new AxeBuilder({ page })
            .include('[role=dialog]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations
      ).toEqual([]);
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: copy('closeCalculation'), exact: true }).click();
      await expect(
        records.nth(1).getByRole('button', {
          name: `${copy('viewCalculation')} : ${creditAdjustmentId}`,
          exact: true,
        })
      ).toBeFocused();
      expect(state.staffReads).toBe(initialReads);

      // The responsive adapter must preserve the original authorization-bound row.
      await records
        .first()
        .getByRole('button', { name: copy('finalize'), exact: true })
        .click();
      dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(contractId);
      expect(digits(await dialog.innerText())).toContain(charge.adjustmentAmountIrR);
      await expect(dialog).toContainText(defaultPriceInput.contractualBasis);
      state.writeMode = 'success';
      await dialog.locator('button[type=submit]').click();
      await expect(dialog).toHaveCount(0);
      expect(state.writes).toHaveLength(1);
      expect(state.writes[0]!.path).toContain(
        `/api/staff/electricity/price-adjustments/${adjustmentId}/finalize`
      );
      expect(state.writes[0]!.body).toEqual({
        idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
        expectedCalculationSha256: charge.calculationSha256,
      });
      await expect(records.first()).toContainText(copy('status.finalized'));
      await expect(
        records.first().getByRole('button', { name: copy('finalize'), exact: true })
      ).toHaveCount(0);

      await records
        .nth(2)
        .getByRole('button', {
          name: `${copy('viewCalculation')} : ${cancelledAdjustmentId}`,
          exact: true,
        })
        .click();
      dialog = page.getByRole('dialog', { name: copy('viewCalculation'), exact: true });
      await expect(dialog).toContainText(cancelledAdjustmentId);
      expect(digits(await dialog.innerText()).replace('٫', '.')).toContain('10.25%');
      if (
        locale === 'fa' &&
        info.project.name === 'mobile-safari' &&
        process.env.BARGHSA_SCREENSHOT_DIR
      ) {
        await page.setViewportSize({ width: 1100, height: 1800 });
        await dialog.screenshot({
          path: `${process.env.BARGHSA_SCREENSHOT_DIR}/price-calculation-fa-${dark ? 'dark' : 'light'}.png`,
        });
        await page.setViewportSize({ width: 1280, height: 900 });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await dialog.getByRole('button', { name: copy('closeCalculation'), exact: true }).click();
      const mobileInspect = records.nth(2).getByRole('button', {
        name: `${copy('viewCalculation')} : ${cancelledAdjustmentId}`,
        exact: true,
      });
      await expect(mobileInspect).toBeFocused();
      await mobileInspect.press('Enter');
      await expect(dialog).toBeVisible();
      // An external refresh can finish while a read-only calculation is open.
      readStatus = 503;
      await page
        .getByRole('button', { name: copy('refresh'), exact: true, includeHidden: true })
        .dispatchEvent('click');
      await expect(page.getByRole('alert', { includeHidden: true })).toContainText(copy('load'));
      await expect(dialog).toBeVisible();
      await expect(records).toHaveCount(3);
      expect(state.writes).toHaveLength(1);
      readStatus = 403;
      await page
        .getByRole('button', { name: copy('refresh'), exact: true, includeHidden: true })
        .dispatchEvent('click');
      await expect(dialog).toHaveCount(0);
      await expect(records).toHaveCount(0);
      await expect(page.getByRole('alert')).toContainText(copy('forbidden'));
      await expect(page.locator('main')).not.toContainText(defaultPriceInput.reason);
      readStatus = 200;
      await page.getByRole('button', { name: copy('refresh'), exact: true }).click();
      await expect(records).toHaveCount(3);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(state.writes).toHaveLength(1);
      expect(state.previews).toEqual([]);
    });
  }
