import { test, expect } from './coverage-fixture';
import { en, fa } from '../../../packages/i18n/src/contracts';
import { t } from '../../../packages/i18n/src/app';

for (const locale of ['en', 'fa'] as const) {
  test(
    locale + ': staff edits a draft context in the account timezone with a version-bound retry',
    async ({ page }) => {
      const words = locale === 'fa' ? fa : en;
      const id = '11111111-1111-4111-8111-111111111111';
      const firstId = '22222222-2222-4222-8222-222222222222';
      const secondId = '44444444-4444-4444-8444-444444444444';
      await page.addInitScript((language) => {
        localStorage.setItem('barghsa.locale', language);
        if (document.documentElement) document.documentElement.lang = language;
        new MutationObserver(() => {
          if (document.documentElement) document.documentElement.lang = language;
        }).observe(document, { childList: true });
      }, locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/auth/user', (route) =>
        route.fulfill({
          json: {
            userId: 'contract-context-staff',
            isStaff: true,
            operatingContext: 'staff',
            canSwitchContext: true,
            requiresTosAcceptance: false,
          },
        })
      );

      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'Asia/Tehran' } })
      );
      const original = {
        id: firstId,
        contractId: id,
        createdBy: 'contract-context-staff',
        versionNumber: 1,
        content: { price: '123', deliveryZone: 'Northern district' },
        changeDescription: 'Original terms',
        createdAt: '2026-09-21T00:00:00Z',
        acceptedAt: null,
      };
      let current = original;
      const versions = [original];
      const originalContext = {
        initialInvoiceId: null,
        serviceStartsAt: '2026-09-22T00:00:35.123Z',
        serviceEndsAt: '2026-10-22T00:00:00Z',
      };
      let context = { ...originalContext };
      const dto = () => ({
        id,
        contractNumber: '1',
        profileId: '33333333-3333-4333-8333-333333333333',
        orderId: null,
        serviceType: 'savings',
        state: 'Draft',
        currentVersionId: current.id,
        currentVersion: current,
        createdAt: '2026-09-21T00:00:00Z',
        updatedAt: '2026-09-21T00:00:00Z',
        submittedAt: null,
        acceptedAt: null,
        signedAt: null,
        activatedAt: null,
        completedAt: null,
        cancelledAt: null,
        amendmentSupported: true,
        linkedOrderStatus: null,
        acceptedParty: null,
        pendingAmendment: null,
      });
      let verified = false;
      const attempts: Array<Record<string, unknown>> = [];
      await page.route('**/api/admin/contracts?*', (route) =>
        route.fulfill({
          json: {
            contracts: [
              {
                id,
                serviceType: 'savings',
                state: 'Draft',
                versionId: current.id,
                versionNumber: current.versionNumber,
              },
            ],
            nextBefore: null,
          },
        })
      );
      await page.route(`**/api/admin/contracts/${id}`, (route) => {
        if (route.request().method() === 'PATCH') {
          const body = route.request().postDataJSON();
          attempts.push(body);
          if (!verified)
            return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
          current = {
            ...original,
            id: secondId,
            versionNumber: 2,
            changeDescription: body.changeDescription,
          };
          versions.unshift(current);
          context = body.activationContext;
          return route.fulfill({ json: dto() });
        }
        return route.fulfill({ json: dto() });
      });
      await page.route(`**/api/admin/contracts/${id}/versions`, (route) =>
        route.fulfill({ json: { versions, nextBefore: null } })
      );
      await page.route(`**/api/admin/contracts/${id}/versions/${firstId}`, (route) =>
        route.fulfill({ json: original })
      );
      await page.route(`**/api/admin/contracts/${id}/activation?*`, (route) => {
        const selected = new URL(route.request().url()).searchParams.get('versionId');
        return route.fulfill({
          json: {
            contractId: id,
            versionId: selected,
            state: 'Draft',
            isCurrent: selected === current.id,
            ready: false,
            ruleRevision: 1,
            ...(selected === current.id ? context : originalContext),
            evaluatedAt: '2026-09-21T00:00:00Z',
            checks: [
              { key: 'staffApproval', required: true, status: 'unmet' },
              { key: 'customerAcceptance', required: true, status: 'unmet' },
              { key: 'signature', required: false, status: 'not_required' },
              { key: 'initialPayment', required: false, status: 'not_required' },
              { key: 'serviceStart', required: false, status: 'not_required' },
            ],
          },
        });
      });
      await page.route(`**/api/admin/contracts/${id}/signature?*`, (route) =>
        route.fulfill({
          json: {
            contractId: id,
            versionId: new URL(route.request().url()).searchParams.get('versionId'),
            state: 'Draft',
            isCurrent: new URL(route.request().url()).searchParams.get('versionId') === current.id,
            isAmendment: false,
            request: null,
            signature: null,
            canRequest: false,
            canRecord: false,
          },
        })
      );
      await page.route('**/api/admin/documents?*', (route) =>
        route.fulfill({ json: { documents: [], nextBefore: null } })
      );
      await page.route('**/api/auth/step-up', (route) => {
        expect(route.request().postDataJSON()).toEqual({ password: 'Test-password' });
        verified = true;
        return route.fulfill({ json: { verified: true } });
      });
      await page.goto('/admin/contracts');
      await page
        .getByRole('button', {
          name: `${words.savings} \u00b7 ${words.version} ${(1).toLocaleString(locale)}`,
          exact: true,
        })
        .click();
      const panel = page.getByRole('region', { name: words.activationTitle, exact: true });
      await panel.getByRole('button', { name: words.editContext, exact: true }).click();
      await expect(page.locator('#contract-context-start')).toHaveValue('2026-09-22T03:30');
      await expect(
        panel.getByRole('button', { name: words.saveContext, exact: true })
      ).toBeDisabled();
      await page.locator('#contract-context-end').fill('2026-11-22T03:30');
      await page.getByLabel(words.contextReason, { exact: true }).fill('Extend service term');
      await panel.getByRole('button', { name: words.saveContext, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
      await dialog.locator('input[type=password]').fill('Test-password');
      await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(attempts).toHaveLength(2);
      expect(attempts[0]).toEqual(attempts[1]);
      expect(attempts[0]).toMatchObject({
        expectedVersionId: firstId,
        content: original.content,
        changeDescription: 'Extend service term',
        idempotencyKey: expect.any(String),
        activationContext: {
          initialInvoiceId: null,
          serviceStartsAt: originalContext.serviceStartsAt,
          serviceEndsAt: '2026-11-22T00:00:00.000Z',
        },
      });
      await expect(
        page.getByRole('heading', {
          name: `${words.version} ${(2).toLocaleString(locale)} \u00b7 ${words.current}`,
          exact: true,
        })
      ).toBeVisible();
      await page
        .getByRole('button', {
          name: `${words.version} ${(1).toLocaleString(locale)}`,
          exact: true,
        })
        .click();
      await expect(panel.getByText(words.historicalRequirements, { exact: true })).toBeVisible();
      await expect(panel.getByRole('button', { name: words.editContext, exact: true })).toHaveCount(
        0
      );
    }
  );
}
