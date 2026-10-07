import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { t } from '@barghsa/i18n/app';
import { contractText } from '@barghsa/i18n/contracts';
import {
  setupElectricityQuantityIncreaseForms,
  contractId,
  orderId,
  profileId,
  versionId,
} from './electricity-quantity-increase-form-fixture';

const historicalId = '89000000-0000-4000-8000-000000000001';
for (const locale of ['en', 'fa'] as const) {
  test(`active contract opens the shared one-time increase flow and keeps history read-only (${locale})`, async ({
    page,
  }, info) => {
    const state = await setupElectricityQuantityIncreaseForms(page, locale, locale === 'fa');
    state.requestMode = 'success';
    const version = {
      id: versionId,
      contractId,
      versionNumber: 2,
      content: { text: 'Accepted electricity terms' },
      changeDescription: 'Current terms',
      createdAt: '2026-10-04T08:00:00Z',
      publishedAt: '2026-10-04T08:00:00Z',
      acceptedAt: '2026-10-04T08:05:00Z',
      createdBy: 'legal-reviewer',
    };
    const historical = {
      ...version,
      id: historicalId,
      versionNumber: 1,
      changeDescription: 'Previous terms',
    };
    await page.route(`**/api/contracts/${contractId}`, (route) =>
      route.fulfill({
        json: {
          id: contractId,
          contractNumber: '9007199254740993',
          profileId,
          orderId,
          serviceType: 'electricity',
          state: 'Active',
          version,
          canAccept: false,
          amendment: null,
        },
      })
    );
    await page.route(`**/api/contracts/${contractId}/versions`, (route) =>
      route.fulfill({ json: { versions: [version, historical], nextBefore: null } })
    );
    await page.route(`**/api/contracts/${contractId}/versions/*`, (route) =>
      route.fulfill({
        json: {
          id: contractId,
          contractNumber: '9007199254740993',
          profileId,
          orderId,
          serviceType: 'electricity',
          state: 'Active',
          version: new URL(route.request().url()).pathname.endsWith(historicalId)
            ? historical
            : version,
          canAccept: false,
          amendment: null,
        },
      })
    );
    await page.route(`**/api/contracts/${contractId}/signature?*`, (route) =>
      route.fulfill({
        json: {
          contractId,
          versionId: new URL(route.request().url()).searchParams.get('versionId'),
          state: 'Active',
          isCurrent: true,
          isAmendment: false,
          canRequest: false,
          canRecord: false,
          request: null,
          signature: null,
        },
      })
    );
    await page.route(`**/api/contracts/${contractId}/activation?*`, (route) =>
      route.fulfill({
        json: {
          contractId,
          versionId,
          state: 'Active',
          isCurrent: true,
          ready: true,
          ruleRevision: 1,
          initialInvoiceId: null,
          serviceStartsAt: null,
          serviceEndsAt: null,
          evaluatedAt: '2026-10-04T08:00:00Z',
          checks: [
            'staffApproval',
            'customerAcceptance',
            'signature',
            'initialPayment',
            'serviceStart',
          ].map((key) => ({ key, required: true, status: 'met' })),
        },
      })
    );
    await page.route(`**/api/contracts/${contractId}/cancellation-status`, (route) =>
      route.fulfill({
        json: {
          contractId,
          state: 'Active',
          cancelledAt: null,
          financialStatus: 'not_cancelled',
          financiallyClosed: false,
          refundAmount: '0',
          returnedAmount: '0',
          canCancel: false,
          canChooseRefund: false,
          refunds: [],
        },
      })
    );
    await page.route('**/api/documents?*', (route) =>
      route.fulfill({ json: { documents: [], nextBefore: null } })
    );
    await page.goto(`/contracts?contractId=${contractId}`);
    await page
      .getByRole('button', { name: t('electricity.increase.submit', locale), exact: true })
      .click();
    const form = page.getByTestId('electricity-increase-form');
    await expect(form).toBeVisible();
    await page
      .getByRole('button', {
        name: `${contractText('version', locale)} ${(1).toLocaleString(locale)}`,
        exact: true,
      })
      .click();
    await expect(form).toHaveCount(0);
    expect(state.requestWrites).toEqual([]);
    await page
      .getByRole('button', {
        name: `${contractText('version', locale)} ${(2).toLocaleString(locale)}`,
        exact: true,
      })
      .click();
    await page
      .getByRole('button', { name: t('electricity.increase.submit', locale), exact: true })
      .click();
    const quantity = page.locator('#electricity-increase-kwh');
    await expect(quantity).toBeVisible();
    await quantity.fill('12');
    expect(
      (
        await new AxeBuilder({ page })
          .include('[data-testid="electricity-increase-form"]')
          .analyze()
      ).violations
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await form.screenshot({ path: info.outputPath('contract-increase.png') });
    await form
      .getByRole('button', { name: t('electricity.increase.submit', locale), exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => state.requestWrites.length).toBe(1);
    expect(state.requestWrites[0]).toEqual({
      requestedKwh: '12',
      expectedVersionId: versionId,
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    await expect(form).toHaveCount(0);
    await expect(
      page.getByText(t('electricity.increase.status.pending', locale), { exact: true })
    ).toBeVisible();
  });
}
