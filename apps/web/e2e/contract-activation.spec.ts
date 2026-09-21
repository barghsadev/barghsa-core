import { test, expect } from './coverage-fixture';
import { en, fa } from '../../../packages/i18n/src/contracts';
import { t } from '../../../packages/i18n/src/app';
for (const locale of ['en', 'fa'] as const) {
  test(
    locale + ': staff configures optional prerequisites through password verification',
    async ({ page }) => {
      const words = locale === 'fa' ? fa : en;
      await page.addInitScript((language) => {
        if (document.documentElement) document.documentElement.lang = language;
        new MutationObserver(() => {
          if (document.documentElement) document.documentElement.lang = language;
        }).observe(document, { childList: true });
      }, locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/admin/contracts?*', (route) =>
        route.fulfill({ json: { contracts: [], nextBefore: null } })
      );
      const rules = [
        {
          serviceType: 'electricity',
          signatureRequired: false,
          paymentRequired: true,
          serviceStartRequired: false,
          revision: 2,
          updatedAt: '2026-09-21T00:00:00Z',
        },
        {
          serviceType: 'savings',
          signatureRequired: false,
          paymentRequired: false,
          serviceStartRequired: false,
          revision: 1,
          updatedAt: '2026-09-21T00:00:00Z',
        },
        {
          serviceType: 'solar',
          signatureRequired: true,
          paymentRequired: false,
          serviceStartRequired: false,
          revision: 3,
          updatedAt: '2026-09-21T00:00:00Z',
        },
      ];
      await page.route('**/api/admin/contract-activation-rules', (route) =>
        route.fulfill({ json: { rules, canEdit: true } })
      );
      let verified = false;
      const attempts: unknown[] = [];
      await page.route('**/api/admin/contract-activation-rules/electricity', (route) => {
        expect(route.request().method()).toBe('PUT');
        const body = route.request().postDataJSON();
        attempts.push(body);
        if (!verified)
          return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
        rules[0] = { ...rules[0]!, signatureRequired: body.signatureRequired, revision: 3 };
        return route.fulfill({ json: rules[0] });
      });
      await page.route('**/api/auth/step-up', (route) => {
        expect(route.request().postDataJSON()).toEqual({ password: 'Test-password' });
        verified = true;
        return route.fulfill({ json: { verified: true } });
      });
      await page.goto('/admin/contracts');
      await page.getByRole('button', { name: words.activationRules, exact: true }).click();
      const group = page.getByRole('group', { name: words.electricity, exact: true });
      await expect(
        group.getByRole('checkbox', { name: words['rule.paymentRequired'], exact: false })
      ).toBeDisabled();
      await expect(
        page
          .getByRole('group', { name: words.solar, exact: true })
          .getByRole('checkbox', { name: words['rule.signatureRequired'], exact: false })
      ).toBeDisabled();
      await expect(group.getByRole('button', { name: words.saveActivationRules })).toBeDisabled();
      await group
        .getByRole('checkbox', { name: words['rule.signatureRequired'], exact: true })
        .check();
      await group.getByRole('button', { name: words.saveActivationRules }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
      await dialog.locator('input[type=password]').fill('Test-password');
      await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(attempts).toHaveLength(2);
      expect(attempts[0]).toEqual(attempts[1]);
      expect(attempts[0]).toMatchObject({
        expectedRevision: 2,
        signatureRequired: true,
        paymentRequired: true,
        serviceStartRequired: false,
        idempotencyKey: expect.any(String),
      });
      await expect(
        group.getByRole('checkbox', { name: words['rule.signatureRequired'], exact: true })
      ).toBeChecked();
      await expect(group.getByRole('button', { name: words.saveActivationRules })).toBeDisabled();
    }
  );
  test(
    locale + ': customer sees missing payment separately from accepted contract',
    async ({ page }) => {
      const words = locale === 'fa' ? fa : en;
      await page.addInitScript((language) => {
        if (document.documentElement) document.documentElement.lang = language;
        new MutationObserver(() => {
          if (document.documentElement) document.documentElement.lang = language;
        }).observe(document, { childList: true });
      }, locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      const id = '11111111-1111-4111-8111-111111111111',
        version = '22222222-2222-4222-8222-222222222222';
      await page.route('**/api/contracts?*', (route) =>
        route.fulfill({
          json: {
            contracts: [
              {
                id,
                serviceType: 'electricity',
                state: 'Accepted',
                versionId: version,
                versionNumber: 1,
              },
            ],
            nextBefore: null,
          },
        })
      );
      const dto = {
        id,
        profileId: '33333333-3333-4333-8333-333333333333',
        serviceType: 'electricity',
        state: 'Accepted',
        canAccept: false,
        version: {
          id: version,
          versionNumber: 1,
          content: { text: 'Accepted terms' },
          createdAt: '2026-09-21T00:00:00Z',
          acceptedAt: '2026-09-21T01:00:00Z',
        },
      };
      await page.route(`**/api/contracts/${id}`, (route) => route.fulfill({ json: dto }));
      await page.route(`**/api/contracts/${id}/versions`, (route) =>
        route.fulfill({ json: { versions: [dto.version], nextBefore: null } })
      );
      await page.route('**/api/documents?*', (route) =>
        route.fulfill({ json: { documents: [], nextBefore: null } })
      );
      await page.route(`**/api/contracts/${id}/signature?*`, (route) =>
        route.fulfill({
          json: { request: null, signature: null, canRequest: false, canRecord: false },
        })
      );
      let paid = false;
      await page.route(`**/api/contracts/${id}/activation?*`, (route) => {
        expect(new URL(route.request().url()).searchParams.get('versionId')).toBe(version);
        return route.fulfill({
          json: {
            contractId: id,
            versionId: version,
            state: 'Accepted',
            isCurrent: true,
            ready: paid,
            ruleRevision: 1,
            initialInvoiceId: 'invoice',
            serviceStartsAt: null,
            evaluatedAt: '2026-09-21T12:00:00Z',
            checks: [
              { key: 'staffApproval', required: true, status: 'met' },
              { key: 'customerAcceptance', required: true, status: 'met' },
              { key: 'signature', required: false, status: 'not_required' },
              { key: 'initialPayment', required: true, status: paid ? 'met' : 'unmet' },
              { key: 'serviceStart', required: false, status: 'not_required' },
            ],
          },
        });
      });
      await page.goto('/contracts');
      await page
        .getByRole('button', {
          name: `${words.electricity} \u00b7 ${words.version} ${(1).toLocaleString(locale)}`,
          exact: true,
        })
        .click();
      const panel = page.getByRole('region', { name: words.activationTitle, exact: true });
      await expect(panel.getByRole('listitem')).toHaveCount(5);
      await expect(panel.getByText(words['prerequisite.unmet'], { exact: true })).toBeVisible();
      await expect(panel.getByText(words.activationNotice)).toBeVisible();
      paid = true;
      await panel.getByRole('button', { name: words.refresh, exact: true }).click();
      await expect(panel.getByText(words.prerequisitesReady, { exact: true })).toBeVisible();
      await expect(
        page
          .getByRole('region', { name: words.terms, exact: true })
          .getByText(words.Accepted, { exact: true })
          .first()
      ).toBeVisible();
    }
  );
}
