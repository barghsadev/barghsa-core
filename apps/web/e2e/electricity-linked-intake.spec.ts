import { test, expect } from './coverage-fixture';
import { contractText } from '@barghsa/i18n/contracts';
import { t } from '@barghsa/i18n/app';
import { setupCatalogueForms } from './catalogue-form-fixture';
import AxeBuilder from '@axe-core/playwright';
for (const locale of ['en', 'fa'] as const)
  test(`linked incomplete electricity intake reaches reviewed rejection (${locale})`, async ({
    page,
  }) => {
    await setupCatalogueForms(page, locale, false);
    const w = (key: string) => contractText(key, locale),
      id = '11111111-1111-4111-8111-111111111111',
      versionId = '22222222-2222-4222-8222-222222222222',
      profileId = '33333333-3333-4333-8333-333333333333',
      intentId = '44444444-4444-4444-8444-444444444444';
    const version = {
      id: versionId,
      versionNumber: 1,
      content: { text: 'Retained incomplete contract' },
      changeDescription: 'Retained draft',
      createdAt: '2026-10-01T00:00:00Z',
      acceptedAt: null,
    };
    let ended = false,
      prepared = false;
    const commands: unknown[] = [];
    const intent = () => ({
      id: intentId,
      contractId: id,
      versionId,
      terminalAction: 'reject',
      financialFingerprint: 'a'.repeat(64),
      reason: 'Discard incomplete order',
      status: 'ready',
      approvalRequestId: null,
      refundDecision: { mode: 'full_wallet', refunds: [] },
    });
    await page.route('**/api/admin/contracts**', (route) => {
      const url = new URL(route.request().url()),
        path = url.pathname;
      if (path === '/api/admin/contracts')
        return route.fulfill({
          json: {
            contracts: [
              {
                id,
                serviceType: 'electricity',
                state: ended ? 'Rejected' : 'Draft',
                versionId,
                versionNumber: 1,
              },
            ],
            nextBefore: null,
          },
        });
      if (path.endsWith('/versions'))
        return route.fulfill({ json: { versions: [version], nextBefore: null } });
      if (path.endsWith('/cancellation-status'))
        return route.fulfill({
          json: {
            contractId: id,
            serviceType: 'electricity',
            state: ended ? 'Rejected' : 'Draft',
            canCancel: !ended,
            canReject: !ended,
            cancelledAt: null,
            financialStatus: ended ? 'closed' : 'not_cancelled',
            financiallyClosed: ended,
            refundAmount: '0',
            returnedAmount: '0',
            refunds: [],
          },
        });
      if (path.endsWith('/cancellation-preview')) {
        expect(url.searchParams.get('terminalAction')).toBe('reject');
        return route.fulfill({
          json: {
            terminalAction: 'reject',
            contractId: id,
            profileId,
            versionId,
            fingerprint: 'a'.repeat(64),
            serviceType: 'electricity',
            refundableAmount: '0',
            blockers: [],
            invoices: [],
          },
        });
      }
      if (path.endsWith('/cancellations') && route.request().method() === 'GET')
        return route.fulfill({ json: { intent: prepared ? intent() : null } });
      if (path.endsWith('/cancellations')) {
        commands.push(route.request().postDataJSON());
        prepared = true;
        return route.fulfill({ status: 201, json: intent() });
      }
      if (path.endsWith('/execute')) {
        commands.push(route.request().postDataJSON());
        ended = true;
        return route.fulfill({
          status: 201,
          json: { contractId: id, versionId, intentId, state: 'Rejected' },
        });
      }
      if (path.endsWith('/activation'))
        return route.fulfill({
          json: {
            contractId: id,
            versionId,
            signingRequired: false,
            signed: false,
            startAt: '2026-12-01T00:00:00Z',
            endAt: null,
            initialInvoiceId: null,
            invoicePaid: false,
            postalRequired: false,
            postalApproved: false,
            canActivate: false,
            missing: [],
            state: 'Draft',
          },
        });
      if (path === `/api/admin/contracts/${id}`)
        return route.fulfill({
          json: {
            id,
            profileId,
            serviceType: 'electricity',
            state: ended ? 'Rejected' : 'Draft',
            currentVersionId: versionId,
            currentVersion: version,
          },
        });
      return route.fulfill({ status: 404, json: {} });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/contracts');
    await page
      .getByRole('button', {
        name: `${w('electricity')} · ${w('version')} ${(1).toLocaleString(locale)}`,
        exact: true,
      })
      .click();
    const panel = page.getByRole('region', { name: w('cancellationTitle'), exact: true });
    await panel.getByRole('button', { name: w('rejectionTitle'), exact: true }).click();
    await panel.getByLabel(w('rejectionReason'), { exact: true }).fill('Discard incomplete order');
    await panel.getByRole('button', { name: w('rejectionSave'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(w('rejectionFinancialReview'));
    await expect(dialog).toContainText(profileId);
    expect(commands).toHaveLength(0);
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
    expect(commands[0]).toMatchObject({
      terminalAction: 'reject',
      expectedVersionId: versionId,
      refundDecision: { mode: 'full_wallet' },
    });
    await panel.getByRole('button', { name: w('rejectionConfirm'), exact: true }).click();
    await expect(dialog).toContainText(w('rejectionIrreversible'));
    await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(commands).toHaveLength(2);
    await expect(panel).toContainText(w('rejectionServiceEnded'));
  });
