import { test, expect } from './coverage-fixture';
import { en, fa } from '../../../packages/i18n/src/contracts';
import { t } from '../../../packages/i18n/src/app';
for (const locale of ['en', 'fa'] as const)
  test(
    locale +
      ': customer request survives step-up, staff declines and later fulfills through cancellation',
    async ({ page }, testInfo) => {
      const w = locale === 'fa' ? fa : en,
        id = '11111111-1111-4111-8111-111111111111',
        versionId = '22222222-2222-4222-8222-222222222222';
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
        content: { text: 'Published terms', price: '100' },
        changeDescription: 'Original',
        createdAt: '2026-09-21T00:00:00Z',
        acceptedAt: null,
      };
      let request: null | {
        id: string;
        contractId: string;
        versionId: string;
        reason: string;
        preferredDestination: string;
        status: string;
        resolutionReason: string | null;
        contractState: string;
        stale: boolean;
      } = null;
      let verified = false,
        cancelled = false,
        prepared = false;
      const attempts: unknown[] = [];
      const decision = () => ({
        id: 'intent',
        customerRequestId: request!.id,
        versionId,
        financialFingerprint: 'a'.repeat(64),
        reason: 'Approved customer request',
        status: 'ready',
        approvalRequestId: null,
        refundDecision: { mode: 'full_wallet', refunds: [] },
      });
      for (const staff of [false, true]) {
        const base = staff ? '/api/admin/contracts' : '/api/contracts';
        await page.route(`**${base}?*`, (route) =>
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
        await page.route(`**${base}/${id}`, (route) =>
          route.fulfill({
            json: {
              id,
              profileId: '33333333-3333-4333-8333-333333333333',
              serviceType: 'electricity',
              state: cancelled ? 'Cancelled' : 'Active',
              ...(staff
                ? { currentVersionId: versionId, currentVersion: version }
                : { version, canAccept: false }),
            },
          })
        );
        await page.route(`**${base}/${id}/versions`, (route) =>
          route.fulfill({ json: { versions: [version], nextBefore: null } })
        );
        await page.route(`**${base}/${id}/activation?*`, (route) =>
          route.fulfill({
            json: {
              checks: [],
              isCurrent: true,
              ready: false,
              evaluatedAt: '2026-09-21T00:00:00Z',
            },
          })
        );
        await page.route(`**${base}/${id}/cancellation-status`, (route) =>
          route.fulfill({
            json: {
              contractId: id,
              state: cancelled ? 'Cancelled' : 'Active',
              cancelledAt: cancelled ? '2026-09-21T00:00:00Z' : null,
              financialStatus: cancelled ? 'closed' : 'not_cancelled',
              financiallyClosed: cancelled,
              refundAmount: '0',
              returnedAmount: '0',
              refunds: [],
              canCancel: staff && !cancelled,
              canChooseRefund: staff,
            },
          })
        );
        await page.route(`**${base}/${id}/cancellation-requests`, (route) => {
          if (route.request().method() === 'GET')
            return route.fulfill({
              json: { request, canRequest: !cancelled && request?.status !== 'Pending' },
            });
          const body = route.request().postDataJSON();
          attempts.push(body);
          if (!verified)
            return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
          expect(body).toMatchObject({
            expectedVersionId: versionId,
            reason: 'Please end service',
            preferredDestination: 'external_bank',
          });
          request = {
            id: crypto.randomUUID(),
            contractId: id,
            versionId,
            reason: body.reason,
            preferredDestination: body.preferredDestination,
            status: 'Pending',
            resolutionReason: null,
            contractState: 'Active',
            stale: false,
          };
          return route.fulfill({ status: 201, json: request });
        });
      }
      await page.route('**/api/auth/step-up', (route) => {
        expect(route.request().postDataJSON()).toEqual({ password: 'Test-password' });
        verified = true;
        return route.fulfill({ json: { verified: true } });
      });
      await page.route('**/api/admin/contract-cancellation-requests', (route) =>
        route.fulfill({
          json: { requests: request?.status === 'Pending' ? [request] : [], nextBefore: null },
        })
      );
      await page.route('**/api/admin/contract-cancellation-requests/*/reject', (route) => {
        expect(route.request().postDataJSON().reason).toBe('Please contact support');
        request = { ...request!, status: 'Rejected', resolutionReason: 'Please contact support' };
        return route.fulfill({ status: 201, json: request });
      });
      await page.route(`**/api/admin/contracts/${id}/cancellation-preview`, (route) =>
        route.fulfill({
          json: {
            versionId,
            fingerprint: 'a'.repeat(64),
            serviceType: 'electricity',
            refundableAmount: '0',
            blockers: [],
            invoices: [],
          },
        })
      );
      await page.route(`**/api/admin/contracts/${id}/cancellations`, (route) => {
        if (route.request().method() === 'GET')
          return route.fulfill({ json: { intent: prepared ? decision() : null } });
        expect(route.request().postDataJSON()).toMatchObject({
          customerRequestId: request!.id,
          expectedVersionId: versionId,
          reason: 'Approved customer request',
        });
        prepared = true;
        return route.fulfill({ status: 201, json: decision() });
      });
      await page.route(`**/api/admin/contracts/${id}/cancellations/execute`, (route) => {
        expect(request?.status).toBe('Pending');
        expect(prepared).toBe(true);
        cancelled = true;
        request = {
          ...request!,
          status: 'Fulfilled',
          contractState: 'Cancelled',
          resolutionReason: 'Approved customer request',
        };
        return route.fulfill({ status: 201, json: { state: 'Cancelled' } });
      });
      const customerOpen = async () => {
        await page.goto('/contracts');
        await page
          .getByRole('button', {
            name: `${w.electricity} · ${w.version} ${(1).toLocaleString(locale)}`,
            exact: true,
          })
          .click();
      };
      const requestPanel = page.getByRole('region', {
        name: w.cancellationRequestTitle,
        exact: true,
      });
      const confirm = async () =>
        page
          .getByRole('dialog')
          .getByRole('button', { name: t('team.confirm', locale), exact: true })
          .click();
      const customerSubmit = async () => {
        await requestPanel
          .getByLabel(w.cancellationReason, { exact: true })
          .fill('Please end service');
        await requestPanel
          .getByLabel(w.cancellationRequestPreference, { exact: true })
          .selectOption('external_bank');
        await requestPanel
          .getByRole('button', { name: w.cancellationRequestSubmit, exact: true })
          .click();
        await confirm();
      };
      await customerOpen();
      await customerSubmit();
      await page.getByRole('dialog').locator('input[type=password]').fill('Test-password');
      await confirm();
      await expect(
        requestPanel.getByText(w['cancellationRequest.Pending'], { exact: true })
      ).toBeVisible();
      expect(attempts).toHaveLength(2);
      expect(attempts[0]).toEqual(attempts[1]);
      await page.reload();
      await page
        .getByRole('button', {
          name: `${w.electricity} · ${w.version} ${(1).toLocaleString(locale)}`,
          exact: true,
        })
        .click();
      await expect(
        requestPanel.getByText(w['cancellationRequest.Pending'], { exact: true })
      ).toBeVisible();
      const staffOpen = async () => {
        await page.goto('/admin/contracts');
        await page
          .getByRole('region', { name: w.cancellationRequestQueue, exact: true })
          .getByRole('button', { name: w.cancellationRequestOpen, exact: true })
          .click();
      };
      await staffOpen();
      await requestPanel
        .getByRole('button', { name: w.cancellationRequestReject, exact: true })
        .click();
      await expect(requestPanel.getByRole('alert')).toContainText(w.cancellationInvalid);
      await requestPanel
        .getByLabel(w.cancellationRequestRejectReason, { exact: true })
        .fill('Please contact support');
      await requestPanel
        .getByRole('button', { name: w.cancellationRequestReject, exact: true })
        .click();
      await confirm();
      await customerOpen();
      await expect(
        requestPanel.getByText(w['cancellationRequest.Rejected'], { exact: true })
      ).toBeVisible();
      await expect(requestPanel).toContainText('Please contact support');
      await customerSubmit();
      await expect(
        requestPanel.getByText(w['cancellationRequest.Pending'], { exact: true })
      ).toBeVisible();
      await staffOpen();
      await requestPanel
        .getByRole('button', { name: w.cancellationRequestReview, exact: true })
        .click();
      const cancellation = page.getByRole('region', { name: w.cancellationTitle, exact: true });
      await cancellation
        .getByLabel(w.cancellationReason, { exact: true })
        .fill('Approved customer request');
      await cancellation.getByRole('button', { name: w.cancellationSave, exact: true }).click();
      await confirm();
      await cancellation.getByRole('button', { name: w.cancellationConfirm, exact: true }).click();
      await confirm();
      await expect(
        cancellation.getByText(w.cancellationServiceEnded, { exact: true })
      ).toBeVisible();
      await customerOpen();
      await expect(
        requestPanel.getByText(w['cancellationRequest.Fulfilled'], { exact: true })
      ).toBeVisible();
      await expect(
        requestPanel.getByRole('button', { name: w.cancellationRequestSubmit, exact: true })
      ).toHaveCount(0);
      await requestPanel.screenshot({
        path: testInfo.outputPath('customer-cancellation-' + locale + '.png'),
      });
    }
  );
