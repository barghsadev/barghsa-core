import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { contractText } from '@barghsa/i18n/contracts';
import { t } from '@barghsa/i18n/app';
import {
  correctionStaffOrder,
  correctionOrder,
  correctionContract,
  correctionProfile,
  correctionVersion,
  correctionInvoice,
} from './electricity-correction-form-fixture';
for (const locale of ['en', 'fa'] as const)
  test(`reviewed electricity rejection preserves target, invoices and keyboard confirmation (${locale})`, async ({
    page,
  }) => {
    await setupCatalogueForms(page, locale, false);
    const word = (key: string) => contractText(key, locale),
      fingerprint = 'a'.repeat(64),
      intentId = '84000000-0000-4000-8000-000000000001';
    let intent: unknown = null;
    const writes: Array<Record<string, unknown>> = [];
    await page.route('**/api/staff/electricity/orders**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/comments')) return route.fulfill({ json: { comments: [] } });
      if (path.endsWith(correctionOrder)) return route.fulfill({ json: correctionStaffOrder() });
      return route.fulfill({ json: { orders: [correctionStaffOrder()], nextAfter: null } });
    });
    await page.route('**/api/admin/contracts/**', (route) => {
      const url = new URL(route.request().url()),
        path = url.pathname;
      if (path.endsWith('/cancellation-preview')) {
        expect(url.searchParams.get('terminalAction')).toBe('reject');
        return route.fulfill({
          json: {
            terminalAction: 'reject',
            contractId: correctionContract,
            profileId: correctionProfile,
            versionId: correctionVersion,
            serviceType: 'electricity',
            fingerprint,
            refundableAmount: '750000',
            blockers: [],
            invoices: [
              {
                id: correctionInvoice,
                paidAmount: '500000',
                refundedAmount: '0',
                availableRefundAmount: '500000',
                refundableAmount: '500000',
              },
              {
                id: '84000000-0000-4000-8000-000000000002',
                paidAmount: '250000',
                refundedAmount: '0',
                availableRefundAmount: '250000',
                refundableAmount: '250000',
              },
            ],
          },
        });
      }
      if (route.request().method() === 'GET') return route.fulfill({ json: { intent } });
      const command = route.request().postDataJSON() as Record<string, unknown>;
      writes.push(command);
      if (path.endsWith('/execute'))
        return route.fulfill({
          status: 201,
          json: {
            contractId: correctionContract,
            versionId: correctionVersion,
            intentId,
            state: 'Rejected',
          },
        });
      intent = {
        id: intentId,
        contractId: correctionContract,
        versionId: correctionVersion,
        terminalAction: 'reject',
        reason: command.reason,
        financialFingerprint: fingerprint,
        status: 'ready',
        approvalRequestId: null,
        refundDecision: {
          mode: 'full_wallet',
          refunds: [
            { invoiceId: correctionInvoice, amount: '500000', destination: 'wallet' },
            {
              invoiceId: '84000000-0000-4000-8000-000000000002',
              amount: '250000',
              destination: 'wallet',
            },
          ],
        },
      };
      return route.fulfill({ status: 201, json: intent });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/electricity-orders?orderId=' + correctionOrder);
    const summary = page.locator('summary').filter({ hasText: word('rejectionTitle') });
    await expect(summary).toBeVisible();
    await summary.focus();
    await summary.press('Enter');
    const region = page.locator('details').filter({ has: summary });
    await region
      .getByLabel(word('rejectionReason'), { exact: true })
      .fill('Reviewed rejection reason');
    await region.getByRole('button', { name: word('rejectionSave'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(word('rejectionFinancialReview'));
    await expect(dialog).toContainText(correctionInvoice);
    await expect(dialog).toContainText('84000000-0000-4000-8000-000000000002');
    expect(writes).toHaveLength(0);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[role=dialog]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations
    ).toEqual([]);
    await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes[0]).toMatchObject({
      terminalAction: 'reject',
      expectedVersionId: correctionVersion,
      expectedFingerprint: fingerprint,
      reason: 'Reviewed rejection reason',
      refundDecision: { mode: 'full_wallet' },
    });
    await region.getByRole('button', { name: word('rejectionConfirm'), exact: true }).click();
    await expect(dialog).toContainText(word('rejectionIrreversible'));
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(dialog).toContainText('Reviewed rejection reason');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({ intentId });
  });
