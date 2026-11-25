import { confirmationText } from '@barghsa/i18n/confirmation';
import { t } from '@barghsa/i18n/app';
import { electricityCancellationText } from '@barghsa/i18n/electricity-cancellation-customer';
import { loadingText } from '@barghsa/i18n/loading-feedback';
import { approveRiskConfirmation } from './confirmation-fixture';
import { test, expect } from './coverage-fixture';
import type { Route } from '@playwright/test';
import {
  correctionOrder as orderId,
  setupElectricityCorrectionForms,
} from './electricity-correction-form-fixture';

for (const locale of ['en', 'fa'] as const) {
  test(`stalled customer cancellation rechecks the order and replays the exact review (${locale})`, async ({
    page,
  }) => {
    const { state } = await setupElectricityCorrectionForms(page, locale, locale === 'fa');
    const detail = state.detail;
    const hash = 'c'.repeat(64);
    const reason = 'Customer needs to cancel';
    const writes: Array<string | null> = [];
    const receipt = { orderId, status: 'cancelled', refundId: null };
    let held: Route | undefined;
    await page.route(`**/api/electricity/orders/${orderId}/cancel-review`, (route) =>
      route.fulfill({
        json: {
          schemaVersion: 1,
          hash,
          scope: {
            action: 'electricity.customer-cancel',
            profileId: detail.profileId,
            resourceId: orderId,
          },
          data: {
            reason: route.request().postDataJSON().reason,
            profileName: detail.profileName,
            commercialStatus: detail.commercialStatus,
            contractId: detail.contractId,
            contractState: detail.contractState,
            versionId: detail.versionId,
            contractSnapshot: {},
            invoiceId: detail.invoiceId,
            invoiceState: detail.invoiceState,
            invoiceTotal: detail.totalIrR,
            paidAmount: '0',
            refundedAmount: '0',
            pendingRefundAmount: '0',
            periodStart: detail.periodStart,
            periodEnd: detail.periodEnd,
            totalKwh: detail.totalKwh,
            pricingSnapshot: detail.pricingSnapshot,
            outcome: 'cancel_invoice',
            refundAmount: '0',
            releasesGiftCode: false,
          },
        },
      })
    );
    await page.route(`**/api/electricity/orders/${orderId}/cancel`, async (route) => {
      writes.push(route.request().postData());
      if (writes.length === 1) {
        held = route;
        return;
      }
      state.detail = { ...detail, electricityStatus: 'cancelled' };
      await route.fulfill({ json: receipt });
    });
    await page.goto(`/electricity/orders/${orderId}`);
    const copy = (key: string) => t(`electricity.order.detail.${key}`, locale);
    const cancellationCopy = (key: Parameters<typeof electricityCancellationText>[0]) =>
      electricityCancellationText(key, locale);
    await page.getByRole('link', { name: copy('cancel'), exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/electricity/orders/${orderId}/cancel$`));
    await expect(page.getByRole('heading', { name: copy('cancel'), exact: true })).toBeVisible();
    await expect(
      page.getByText(cancellationCopy('cancelPreviewHint'), { exact: true })
    ).toBeVisible();
    await page.getByLabel(copy('cancelReason'), { exact: true }).fill(reason);
    await page
      .getByRole('button', { name: cancellationCopy('cancelReviewAction'), exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    const submit = dialog.getByRole('button', { name: copy('cancel'), exact: true });
    await approveRiskConfirmation(page, locale, 'both');
    await page.clock.install();
    await submit.click();
    await expect.poll(() => writes.length).toBe(1);
    await page.clock.fastForward(15_001);
    await expect(dialog).toContainText(confirmationText('unconfirmed', locale));
    await expect(submit).toBeDisabled();
    await expect(
      dialog.getByRole('link', { name: cancellationCopy('cancelRecoveryHelp') })
    ).toHaveAttribute('target', '_blank');
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        window.addEventListener('popstate', () => resolve(), { once: true });
        window.history.back();
      });
    });
    await expect(page).toHaveURL(new RegExp(`/electricity/orders/${orderId}/cancel$`));
    await held!.fulfill({ json: receipt }).catch(() => {});
    await expect(dialog).toBeVisible();
    const read = page.waitForRequest(
      (request) =>
        request.method() === 'GET' &&
        new URL(request.url()).pathname === `/api/electricity/orders/${orderId}`
    );
    await dialog.getByRole('button', { name: confirmationText('checkStatus', locale) }).click();
    await read;
    await expect(submit).toBeDisabled();
    expect(writes).toHaveLength(1);
    await approveRiskConfirmation(page, locale, 'both');
    await submit.click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole('status').filter({ hasText: t('electricity.order.status.cancelled', locale) })
    ).toBeVisible();
    await page
      .getByRole('link', { name: cancellationCopy('cancelBackToOrder'), exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/electricity/orders/${orderId}$`));
    await expect(page.getByRole('link', { name: copy('cancel'), exact: true })).toHaveCount(0);
    expect(writes).toEqual([writes[0], writes[0]]);
    expect(JSON.parse(writes[0]!)).toMatchObject({
      expectedReviewHash: hash,
      expectedVersionId: detail.versionId,
      reason,
      idempotencyKey: expect.stringMatching(/^[a-f0-9-]{36}$/),
    });
  });
}

test('a direct cancellation URL respects the current order state and access', async ({ page }) => {
  const { state } = await setupElectricityCorrectionForms(page, 'en', false);
  state.detail = { ...state.detail, electricityStatus: 'approved' };
  const url = `/electricity/orders/${orderId}/cancel`;
  await page.goto(url);
  await expect(
    page.getByText(electricityCancellationText('cancelUnavailable', 'en'))
  ).toBeVisible();
  await expect(page.getByLabel(t('electricity.order.detail.cancelReason', 'en'))).toHaveCount(0);

  await page.route(`**/api/electricity/orders/${orderId}`, (route) =>
    route.fulfill({ status: 404 })
  );
  await page.reload();
  await expect(page.getByText(loadingText('recordUnavailable', 'en'))).toBeVisible();
  await expect(page.getByText(state.detail.profileName, { exact: true })).toHaveCount(0);
});
