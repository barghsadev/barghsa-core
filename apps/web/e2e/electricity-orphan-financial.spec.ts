import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { t } from '@barghsa/i18n/app';
const orderId = '84000000-0000-4000-8000-000000000001',
  profileId = '85000000-0000-4000-8000-000000000001',
  invoiceId = '86000000-0000-4000-8000-000000000001',
  refundId = '87000000-0000-4000-8000-000000000001',
  approvalId = '88000000-0000-4000-8000-000000000001';
for (const locale of ['en', 'fa'] as const)
  test(`funded orphan approval and exact wallet receipt in the production shell (${locale})`, async ({
    page,
  }) => {
    await setupCatalogueForms(page, locale, false);
    const word = (key: string) => t('electricity.rawDraft.' + key, locale),
      writes: Array<{ path: string; body: unknown }> = [];
    let approval: string | null = null,
      ended = false;
    await page.route('**/api/staff/electricity/orders**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/drafts'))
        return route.fulfill({
          json: {
            drafts: ended
              ? []
              : [
                  {
                    orderId,
                    profileId,
                    mode: 'simple',
                    createdAt: '2026-10-06T12:00:00Z',
                    updatedAt: '2026-10-06T12:00:00Z',
                  },
                ],
            nextAfter: null,
          },
        });
      if (path.endsWith('/review'))
        return route.fulfill({
          json: {
            hash: 'a'.repeat(64),
            scope: { action: 'electricity.draft-terminal.reject', resourceId: orderId, profileId },
            approval: approval ? { id: approvalId, status: approval } : null,
            data: {
              action: 'reject',
              reason: 'Reviewed funded draft',
              fromState: 'draft',
              toState: 'rejected',
              mode: 'simple',
              stateFingerprint: 'b'.repeat(64),
              createsContract: false,
              createsInvoice: false,
              collectsPayment: false,
              changesSavedWizardProgress: false,
              refundAmount: '100000',
              approvalRequired: true,
              invoices: [{ id: invoiceId, refundableAmount: '100000' }],
              gift: null,
            },
          },
        });
      if (path.endsWith('/approval')) {
        writes.push({ path, body: route.request().postDataJSON() });
        approval = 'pending';
        return route.fulfill({
          status: 201,
          json: { approvalRequestId: approvalId, status: 'pending', reviewHash: 'a'.repeat(64) },
        });
      }
      if (path.endsWith('/draft-terminal')) {
        writes.push({ path, body: route.request().postDataJSON() });
        ended = true;
        return route.fulfill({
          json: {
            orderId,
            status: 'rejected',
            refundId,
            financiallyClosed: false,
            refunds: [{ id: refundId, invoiceId, amount: '100000' }],
          },
        });
      }
      return route.fulfill({ json: { orders: [], nextAfter: null } });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/electricity-orders');
    const summary = page.locator('summary').filter({ hasText: word('title') }),
      details = page.locator('details').filter({ has: summary });
    await summary.click();
    await details.getByRole('button', { name: word('reject'), exact: true }).click();
    await details.getByLabel(word('reason'), { exact: true }).fill('Reviewed funded draft');
    await details.getByRole('button', { name: word('review'), exact: true }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(word('requestApproval'));
    await expect(dialog).toContainText(word('approvalSummary'));
    await expect(dialog).toContainText(invoiceId);
    await expect(dialog).toContainText(word('walletReturn'));
    expect(
      (
        await new AxeBuilder({ page })
          .include('[role=dialog]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations
    ).toEqual([]);
    expect(writes).toHaveLength(0);
    await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(details).toContainText(word('awaitingApproval'));
    expect(writes).toHaveLength(1);
    expect(writes[0]!.path).toContain('/approval');
    await details.getByRole('button', { name: word('review'), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toHaveLength(1);
    approval = 'approved';
    await details.getByRole('button', { name: word('review'), exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(word('approvalRequired'));
    await expect(dialog).toContainText(orderId);
    await expect(dialog).toContainText(profileId);
    await expect(dialog).toContainText(invoiceId);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(details).toContainText(word('empty'));
    expect(writes).toHaveLength(2);
    expect(writes[1]!.body).toMatchObject({
      action: 'reject',
      reason: 'Reviewed funded draft',
      expectedReviewHash: 'a'.repeat(64),
      approvalRequestId: approvalId,
    });
  });
