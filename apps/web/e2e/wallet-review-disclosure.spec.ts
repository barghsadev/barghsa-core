import AxeBuilder from '@axe-core/playwright';
import type { Page, Locator } from '@playwright/test';
import { t } from '@barghsa/i18n/app';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';
import { test, expect } from './coverage-fixture';
import {
  setupElectricityCorrectionForms,
  correctionOrder,
} from './electricity-correction-form-fixture';
import {
  setupSavingStaffOperations,
  savingChangeOrder,
} from './saving-staff-operation-form-fixture';
import {
  setupConsultationFeeOffers,
  informationRequest,
} from './consultation-fee-offer-form-fixture';
import { setupSolarContractIssue, templateVersion } from './solar-contract-issue-form-fixture';

async function balanceRoute(page: Page) {
  const reads: string[] = [];
  let denied = false;
  await page.route('**/api/staff/profiles/*/wallet-balance', async (route) => {
    expect(route.request().method()).toBe('GET');
    const profileId = new URL(route.request().url()).pathname.split('/')[4]!;
    reads.push(profileId);
    await route.fulfill(
      denied ? { status: 403, json: {} } : { json: { profileId, currency: 'IRR', balance: '1000' } }
    );
  });
  return {
    reads,
    deny: () => {
      denied = true;
    },
  };
}
async function inspect(
  page: Page,
  panel: Locator,
  locale: 'en' | 'fa',
  amount: string,
  path: string
) {
  await expect(panel).toContainText(t('wallet.funding.balance', locale));
  await expect(panel).toContainText(formatCurrencyIrr('1000', locale));
  await expect(panel).toContainText(formatCurrencyIrr((BigInt(amount) - 1000n).toString(), locale));
  await expect(panel).toContainText(t('wallet.funding.customerMethods', locale));
  await expect(panel.locator('a[href^="/wallet"]')).toHaveCount(0);
  expect(
    (await new AxeBuilder({ page }).include('[data-testid="order-wallet-balance"]').analyze())
      .violations
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const refresh = panel.getByRole('button', {
    name: t('wallet.funding.refresh', locale),
    exact: true,
  });
  await refresh.focus();
  await expect(refresh).toBeFocused();
  await panel.screenshot({ path });
}
for (const locale of ['en', 'fa'] as const) {
  test(`staff electricity and saving wallet disclosure (${locale})`, async ({ page }, info) => {
    const { state } = await setupElectricityCorrectionForms(page, locale, locale === 'fa');
    state.context = 'staff';
    const route = await balanceRoute(page);
    await page.goto(`/admin/electricity-orders?orderId=${correctionOrder}`);
    let panel = page.getByTestId('order-wallet-balance');
    await inspect(
      page,
      panel,
      locale,
      state.staff.totalIrR,
      info.outputPath(`electricity-wallet-${locale}.png`)
    );
    expect(route.reads).toEqual([state.staff.profileId]);
    route.deny();
    await panel
      .getByRole('button', { name: t('wallet.funding.refresh', locale), exact: true })
      .click();
    await expect(panel).toContainText(t('wallet.funding.denied', locale));
    await expect(panel).not.toContainText(formatCurrencyIrr('1000', locale));
    expect(state.staffWrites).toEqual([]);

    const saving = await setupSavingStaffOperations(page, locale, 'decision');
    const detail = saving.state.details.get(savingChangeOrder)!;
    detail.paidIrR = '0';
    const savingRoute = await balanceRoute(page);
    await page.goto(`/admin/saving-orders?lane=review&orderId=${savingChangeOrder}`);
    panel = page.getByTestId('order-wallet-balance');
    await inspect(
      page,
      panel,
      locale,
      detail.totalIrR,
      info.outputPath(`saving-wallet-${locale}.png`)
    );
    expect(savingRoute.reads).toEqual([detail.profileId]);
    expect(saving.state.decisionWrites).toEqual([]);
  });
  test(`staff consultation and solar captured review funding (${locale})`, async ({
    page,
  }, info) => {
    const consultation = await setupConsultationFeeOffers(page, locale);
    const route = await balanceRoute(page);
    await page.goto(`/admin/consultations?requestId=${informationRequest}`);
    await page.locator('#consultation-fee').fill('600000');
    await page.locator('#consultation-scope').fill('Supply assessment');
    await page.locator('#consultation-deliverables').fill('Written energy report');
    await page.locator('#consultation-valid-until').fill('2030-03-01T12:17');
    await page.getByTestId('consultation-fee-form').locator('button[type=submit]').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await inspect(
      page,
      page.getByRole('dialog').getByTestId('order-wallet-balance'),
      locale,
      '600000',
      info.outputPath(`consultation-wallet-${locale}.png`)
    );
    expect(route.reads).toEqual([consultation.state.rows[informationRequest]!.profile_id]);
    expect(consultation.state.writes).toEqual([]);

    const solar = await setupSolarContractIssue(page, locale);
    const solarRoute = await balanceRoute(page);
    await page.goto('/admin/solar-postal');
    await page.getByRole('button', { name: /First solar buyer/ }).click();
    await page.locator('#solar-contract-source').selectOption(`template:${templateVersion}`);
    await page.locator('#solar-contract-title').fill('Solar installation agreement');
    await page.locator('#solar-contract-text').fill('Install the agreed solar equipment.');
    await page.locator('#solar-contract-reason').fill('Initial contract and invoice');
    await page.locator('#solar-contract-value-kind').selectOption('fixed');
    await page.locator('#solar-contract-fixed-amount').fill('250000');
    await page.locator('#solar-contract-line-0-description').fill('Panel installation');
    await page.locator('#solar-contract-line-0-quantity').fill('2');
    await page.locator('#solar-contract-line-0-unit-price').fill('125000');
    await page.locator('#solar-contract-line-0-vat-rate').fill('900');
    await page.locator('#solar-contract-line-0-taxable').check();
    await page.getByTestId('solar-contract-form').locator('button[type=submit]').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await inspect(
      page,
      page.getByRole('dialog').getByTestId('order-wallet-balance'),
      locale,
      '272500',
      info.outputPath(`solar-wallet-${locale}.png`)
    );
    expect(solarRoute.reads).toHaveLength(1);
    expect(solar.state.writes).toEqual([]);
  });
}
