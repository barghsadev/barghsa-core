import { approveRiskConfirmation } from './confirmation-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { test, expect } from './coverage-fixture';
import {
  correctionOrder,
  setupElectricityCorrectionForms,
} from './electricity-correction-form-fixture';

for (const [locale, theme] of [
  ['en', 'light'],
  ['fa', 'dark'],
] as const) {
  test(`staff rejects an approved electricity order with its exact confirmed state (${locale})`, async ({
    page,
  }, info) => {
    const { state } = await setupElectricityCorrectionForms(page, locale, theme === 'dark');
    state.context = 'staff';
    state.staff.commercialStatus = 'approved';
    state.staff.contractState = 'AwaitingCustomerAcceptance';
    state.staffReviewMode = 'success';
    state.staffWriteMode = 'success';
    const copy = (key: string) => adminText(`admin.electricityOrders.${key}`, locale);
    await page.goto(`/admin/electricity-orders?orderId=${correctionOrder}`);
    await expect(page.getByRole('button', { name: copy('approve'), exact: true })).toBeDisabled();
    await expect(
      page.getByRole('button', { name: copy('request-changes'), exact: true })
    ).toBeDisabled();
    const form = page.getByTestId('electricity-staff-reason-form');
    const reason = page.locator('#electricity-review-reason');
    await expect(reason).toHaveAttribute('aria-required', 'true');
    await page.getByRole('button', { name: copy('reject'), exact: true }).click();
    await expect(reason).toBeFocused();
    await expect(reason).toHaveAttribute('aria-describedby', /-message/);
    expect(state.staffPreviews).toHaveLength(0);
    expect(state.staffWrites).toHaveLength(0);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[data-testid="electricity-staff-reason-form"]')
          .analyze()
      ).violations
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await reason.fill('Unable to deliver approved supply');
    await page.getByRole('button', { name: copy('reject'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Unable to deliver approved supply');
    await dialog.screenshot({ path: info.outputPath(`approved-rejection-review-${locale}.png`) });
    const confirm = dialog.locator('button[type=submit]');
    await expect(confirm).toBeDisabled();
    expect(state.staffWrites).toHaveLength(0);
    await approveRiskConfirmation(page, locale, 'both');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(state.staffWrites).toHaveLength(1);
    expect(state.staffWrites[0]).toMatchObject({
      expectedVersionId: state.staff.versionId,
      expectedReviewHash: 'b'.repeat(64),
      reason: 'Unable to deliver approved supply',
    });
    await expect(page.locator('main[data-area=admin]')).toContainText(copy('commercial.rejected'));
    await expect(form).toHaveCount(0);
  });
}
