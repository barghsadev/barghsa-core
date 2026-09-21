import { test, expect } from './coverage-fixture';
import { en, fa } from '../../../packages/i18n/src/contracts';
import { t } from '../../../packages/i18n/src/app';
for (const locale of ['en', 'fa'] as const)
  test(
    locale +
      ': cancellation survives step-up and reload, waits for approval and distinguishes refund completion',
    async ({ page }) => {
      const w = locale === 'fa' ? fa : en,
        id = '11111111-1111-4111-8111-111111111111',
        versionId = '22222222-2222-4222-8222-222222222222',
        invoiceId = '44444444-4444-4444-8444-444444444444';
      await page.addInitScript((language) => {
        if (document.documentElement) document.documentElement.lang = language;
        new MutationObserver(() => {
          if (document.documentElement) document.documentElement.lang = language;
        }).observe(document, { childList: true });
      }, locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'Asia/Tehran' } })
      );
      const version = {
        id: versionId,
        versionNumber: 1,
        content: { price: '100', deliveryZone: 'Northern district' },
        changeDescription: 'Original terms',
        createdAt: '2026-09-21T00:00:00Z',
        acceptedAt: null,
      };
      let verified = false,
        prepared = false,
        approved = false,
        cancelled = false,
        returned = false;
      const attempts: Array<Record<string, unknown>> = [];
      const decision = () => ({
        id: '55555555-5555-4555-8555-555555555555',
        versionId,
        financialFingerprint: 'a'.repeat(64),
        reason: 'Service no longer needed',
        status: approved ? 'ready' : 'awaiting_approval',
        approvalRequestId: 'approval',
        refundDecision: {
          mode: 'full_wallet',
          refunds: [{ invoiceId, amount: '100', destination: 'wallet' }],
        },
      });
      await page.route('**/api/admin/contracts?*', (route) =>
        route.fulfill({
          json: {
            contracts: [
              {
                id,
                serviceType: 'electricity',
                state: cancelled ? 'Cancelled' : 'Active',
                versionId,
                versionNumber: 1,
              },
            ],
            nextBefore: null,
          },
        })
      );
      await page.route(`**/api/admin/contracts/${id}`, (route) =>
        route.fulfill({
          json: {
            id,
            profileId: '33333333-3333-4333-8333-333333333333',
            serviceType: 'electricity',
            state: cancelled ? 'Cancelled' : 'Active',
            currentVersionId: versionId,
            currentVersion: version,
          },
        })
      );
      await page.route(`**/api/admin/contracts/${id}/versions`, (route) =>
        route.fulfill({ json: { versions: [version], nextBefore: null } })
      );
      await page.route(`**/api/admin/contracts/${id}/activation?*`, (route) =>
        route.fulfill({
          json: {
            contractId: id,
            versionId,
            state: cancelled ? 'Cancelled' : 'Active',
            isCurrent: true,
            ready: false,
            ruleRevision: 1,
            initialInvoiceId: invoiceId,
            serviceStartsAt: null,
            serviceEndsAt: null,
            evaluatedAt: '2026-09-21T00:00:00Z',
            checks: [],
          },
        })
      );
      await page.route(`**/api/admin/contracts/${id}/signature?*`, (route) =>
        route.fulfill({
          json: { request: null, signature: null, canRequest: false, canRecord: false },
        })
      );
      await page.route('**/api/admin/documents?*', (route) =>
        route.fulfill({ json: { documents: [], nextBefore: null } })
      );
      await page.route(`**/api/admin/contracts/${id}/cancellation-status`, (route) =>
        route.fulfill({
          json: {
            contractId: id,
            state: cancelled ? 'Cancelled' : 'Active',
            cancelledAt: cancelled ? '2026-09-21T01:00:00Z' : null,
            financialStatus: cancelled
              ? returned
                ? 'closed'
                : 'refunds_pending'
              : 'not_cancelled',
            financiallyClosed: returned,
            refundAmount: cancelled ? '100' : '0',
            returnedAmount: returned ? '100' : '0',
            canCancel: !cancelled,
            canChooseRefund: false,
            refunds: cancelled
              ? [
                  {
                    id: 'refund',
                    invoiceId,
                    amount: '100',
                    destination: 'wallet',
                    state: returned ? 'Completed' : 'Processing',
                    transactionState: returned ? 'Completed' : 'Pending',
                  },
                ]
              : [],
          },
        })
      );
      await page.route(`**/api/admin/contracts/${id}/cancellation-preview`, (route) =>
        route.fulfill({
          json: {
            versionId,
            fingerprint: 'a'.repeat(64),
            serviceType: 'electricity',
            refundableAmount: '100',
            blockers: [],
            invoices: [
              {
                id: invoiceId,
                paidAmount: '100',
                refundedAmount: '0',
                availableRefundAmount: '100',
                refundableAmount: '100',
              },
            ],
          },
        })
      );
      await page.route(`**/api/admin/contracts/${id}/cancellations`, (route) => {
        if (route.request().method() === 'GET')
          return route.fulfill({ json: { intent: prepared ? decision() : null } });
        const body = route.request().postDataJSON();
        attempts.push(body);
        if (!verified)
          return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
        expect(body).toMatchObject({
          expectedVersionId: versionId,
          expectedFingerprint: 'a'.repeat(64),
          refundDecision: { mode: 'full_wallet' },
          reason: 'Service no longer needed',
        });
        prepared = true;
        return route.fulfill({ status: 201, json: decision() });
      });
      await page.route(`**/api/admin/contracts/${id}/cancellations/execute`, (route) => {
        expect(approved).toBe(true);
        expect(route.request().postDataJSON().intentId).toBe(decision().id);
        cancelled = true;
        return route.fulfill({ status: 201, json: { state: 'Cancelled' } });
      });
      await page.route('**/api/auth/step-up', (route) => {
        expect(route.request().postDataJSON()).toEqual({ password: 'Test-password' });
        verified = true;
        return route.fulfill({ json: { verified: true } });
      });
      const open = async () => {
        await page
          .getByRole('button', {
            name: `${w.electricity} · ${w.version} ${(1).toLocaleString(locale)}`,
            exact: true,
          })
          .click();
      };
      await page.goto('/admin/contracts');
      await open();
      const panel = page.getByRole('region', { name: w.cancellationTitle, exact: true });
      await panel.getByRole('button', { name: w.cancellationReview, exact: true }).click();
      await expect(panel.getByText(w.cancellationElectricity, { exact: true })).toBeVisible();
      await panel
        .getByLabel(w.cancellationReason, { exact: true })
        .fill('Service no longer needed');
      await panel.getByRole('button', { name: w.cancellationSave, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
      await dialog.locator('input[type=password]').fill('Test-password');
      await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
      await expect(panel.getByText(w.cancellationApprovalNotice, { exact: true })).toBeVisible();
      expect(attempts).toHaveLength(2);
      expect(attempts[0]).toEqual(attempts[1]);
      await page.reload();
      await open();
      await panel.getByRole('button', { name: w.cancellationReview, exact: true }).click();
      await expect(panel.getByText(w.cancellationApprovalNotice, { exact: true })).toBeVisible();
      await expect(
        panel.getByRole('button', { name: w.cancellationConfirm, exact: true })
      ).toHaveCount(0);
      approved = true;
      await panel.getByRole('button', { name: w.cancellationRefresh, exact: true }).click();
      await panel.getByRole('button', { name: w.cancellationConfirm, exact: true }).click();
      await expect(dialog).toContainText(w.cancellationIrreversible);
      await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
      await expect(panel.getByText(w.cancellationServiceEnded, { exact: true })).toBeVisible();
      await expect(
        panel.getByText(w['cancellation.refunds_pending'], { exact: true })
      ).toBeVisible();
      await expect(panel.getByText(w['cancellation.closed'], { exact: true })).toHaveCount(0);
      returned = true;
      await panel.getByRole('button', { name: w.refresh, exact: true }).click();
      await expect(panel.getByText(w['cancellation.closed'], { exact: true })).toBeVisible();
      await expect(
        panel.getByText(w['cancellation.refund.Completed'], { exact: true })
      ).toBeVisible();
    }
  );
