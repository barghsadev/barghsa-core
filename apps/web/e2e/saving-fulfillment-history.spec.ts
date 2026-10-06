import { fullNavigation } from './navigation-fixture';
import { test, expect, type Page } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { crmShell } from './crm-shell-fixture';
import { t } from '@barghsa/i18n/app';
import { tSaving } from '@barghsa/i18n/saving';

const id = '81111111-1111-4111-8111-111111111111';
const profileId = '82222222-2222-4222-8222-222222222222';
const at = '2026-10-02T23:30:00.000Z';
const names = [
  'request_confirmation',
  'product_delivery',
  'installation_and_document_upload',
  'equipment_handover',
  'process_completion',
];
const events = [
  {
    id: '1',
    stage: 'request_confirmation',
    from_status: 'pending',
    to_status: 'completed',
    explanation: 'Staff approved request',
    created_at: at,
    noteKind: 'confirmed',
    actorName: null,
    actor_context: 'staff',
  },
  {
    id: '2',
    stage: 'equipment_handover',
    from_status: 'in_progress',
    to_status: 'skipped',
    explanation: 'Customer retained <script> equipment',
    handover_description: null,
    created_at: at,
    noteKind: 'recorded',
    actorName: 'کارشناس <img src=x>',
    actor_context: 'staff',
  },
];
const stages = names.map((stage, i) => ({
  stage,
  status: i === 3 ? 'skipped' : i === 4 ? 'in_progress' : 'completed',
  started_at: at,
  completed_at: i === 4 ? null : at,
  explanation: null,
  handover_description: null,
}));
const staffDetail = {
  id,
  orderId: id,
  profileId,
  customerName: 'Saving customer',
  status: 'in_progress',
  financialStatus: 'paid',
  submittedAt: at,
  billIdentifier: '1234567890123',
  addressSnapshot: { full_address: 'Installation address' },
  installationAddressId: id,
  hardwareProductId: id,
  hardwareTitle: { fa: 'دستگاه', en: 'Device' },
  pricingSnapshot: { plan: { title: { fa: 'طرح خانه', en: 'Home plan' } } },
  versionId: id,
  invoiceState: 'Paid',
  contractState: 'Active',
  totalIrR: '300000',
  paidIrR: '300000',
  stages,
  events,
  eventsTruncated: false,
  revisions: [],
  addressAmendments: [],
  hardwareAmendments: [],
  hardwareUpgrades: [],
  addressOptions: [],
  hardwareOptions: [],
  canAmendAddress: false,
  canAmendHardware: false,
};
const customerDetail = {
  id,
  order_id: id,
  profile_id: profileId,
  saving_plan_id: id,
  hardware_product_id: id,
  current_hardware_title: staffDetail.hardwareTitle,
  installation_address_id: id,
  can_edit: false,
  bill_identifier: staffDetail.billIdentifier,
  submitted_at: at,
  address_snapshot: { full_address: 'Installation address', postal_code: '1234567890' },
  pricing_snapshot: {
    plan: staffDetail.pricingSnapshot.plan,
    hardware: { title: staffDetail.hardwareTitle },
    subtotalIrR: '300000',
    discountIrR: '0',
    vatIrR: '0',
    totalIrR: '300000',
  },
  verification_result: { status: 'verified' },
  agreement_snapshot: 'Accepted agreement',
  agreement_updated: false,
  contract_version_id: id,
  contract_id: id,
  contract_state: 'Active',
  invoice_id: id,
  invoice_state: 'Paid',
  cancellation_pending: false,
  status: 'in_progress',
  financial_status: 'paid',
  stages,
  events,
  eventsTruncated: false,
  revisions: [],
  addressAmendments: [],
  hardwareAmendments: [],
  hardwareUpgrades: [],
};
async function fixture(page: Page, locale: 'en' | 'fa') {
  await crmShell(page, locale);
  let context = 'staff';
  await page.route('**/api/auth/user', (r) =>
    r.fulfill({
      json: {
        userId: 'customer',
        isStaff: true,
        operatingContext: context,
        navigation: fullNavigation(context === 'staff' ? 'staff' : 'customer'),
        canSwitchContext: true,
        requiresTosAcceptance: false,
      },
    })
  );
  await page.route('**/api/profiles', (r) =>
    r.fulfill({
      json: {
        profiles: [{ id: profileId, profileType: 'INDIVIDUAL', title: 'Saving customer' }],
        activeProfileId: profileId,
        hasDefault: true,
      },
    })
  );
  await page.route('**/api/profiles/verification-status', (r) =>
    r.fulfill({
      json: {
        activeProfileId: profileId,
        profileStatus: 'ACTIVE',
        verificationRequired: false,
        isVerified: true,
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (r) =>
    r.fulfill({ json: { timezone: 'Pacific/Kiritimati' } })
  );
  await page.route('**/api/staff/saving/orders?*', (r) =>
    r.fulfill({ json: { orders: [staffDetail], nextAfter: null } })
  );
  await page.route(`**/api/staff/saving/orders/${id}`, (r) => r.fulfill({ json: staffDetail }));
  return {
    customer: () => {
      context = 'customer';
    },
  };
}
for (const locale of ['en', 'fa'] as const) {
  test(`${locale}: staff and customer read the same recorded fulfillment and optional skip without exposing identifiers`, async ({
    page,
  }, info) => {
    const copy = (key: string) => tSaving(key, locale);
    const shell = await fixture(page, locale);
    let response = structuredClone(customerDetail);
    await page.route(`**/api/saving/orders/${id}`, (r) => r.fulfill({ json: response }));
    await page.goto('/admin/saving-orders?lane=fulfillment');
    await page
      .getByRole('button', { name: /Saving customer.*Home plan|Saving customer.*طرح خانه/ })
      .click();
    const staffHistory = page.getByRole('region', { name: copy('staffHistory') });
    await expect(staffHistory).toContainText('کارشناس <img src=x>');
    await expect(staffHistory).toContainText(copy('stageConfirmedNote'));
    await expect(staffHistory).toContainText(t('history.context.staff', locale));
    await expect(staffHistory).toContainText('Customer retained <script> equipment');
    await expect(staffHistory).not.toContainText('in_progress');
    await expect(staffHistory.locator('img,script')).toHaveCount(0);
    expect(
      (await new AxeBuilder({ page }).include('[data-slot=status-timeline]').analyze()).violations
    ).toEqual([]);
    shell.customer();
    await page.goto(`/savings/orders/${id}`);
    const progress = page.getByRole('region', { name: copy('fulfillment'), exact: true });
    await expect(progress.locator('[data-slot=progress-stepper]>li')).toHaveCount(5);
    await expect(progress.locator('[data-state=skipped]')).toContainText(copy('skipped'));
    await expect(progress.locator('[aria-current=step]')).toContainText(copy('process_completion'));
    await expect(progress).toContainText('کارشناس <img src=x>');
    await expect(progress).not.toContainText('in_progress');
    await expect(progress.locator('time').first()).toHaveAttribute('datetime', at);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[aria-label="' + copy('fulfillment') + '"]')
          .analyze()
      ).violations
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true
    );
    await progress.screenshot({
      path: `/tmp/barghsa-saving-history-${locale}-${info.project.name}.png`,
    });
    response = {
      ...response,
      events: response.events.map((e) => ({ ...e, actorName: null })),
      status: 'cancelled',
    };
    await page.reload();
    await expect(progress).toContainText(copy('stageStopped'));
    await expect(progress.locator('[aria-current=step]')).toHaveCount(0);
    await expect(progress).not.toContainText('کارشناس <img src=x>');
    await expect(progress).toContainText(t('history.context.staff', locale));
    await expect(progress).toContainText('Customer retained <script> equipment');
    response = {
      ...response,
      events: response.events.map((e) => ({ ...e, actor_context: 'unknown' })),
    };
    await page.reload();
    await expect(progress).toContainText(t('history.context.unknown', locale));
    await expect(progress).not.toContainText(t('history.context.staff', locale));
  });

  test(`${locale}: denied history clears detail and a failed read can be retried safely`, async ({
    page,
  }) => {
    const shell = await fixture(page, locale);
    shell.customer();
    let denied = false,
      failed = true;
    await page.route(`**/api/saving/orders/${id}`, (r) =>
      r.fulfill(
        denied
          ? { status: 403, json: {} }
          : failed
            ? { status: 503, json: {} }
            : { json: customerDetail }
      )
    );
    await page.goto(`/savings/orders/${id}`);
    await expect(
      page.getByRole('alert').filter({ hasText: tSaving('error', locale) })
    ).toBeVisible();
    failed = false;
    await page.getByRole('button', { name: tSaving('retry', locale), exact: true }).click();
    await expect(
      page.getByRole('region', { name: tSaving('fulfillment', locale), exact: true })
    ).toContainText('کارشناس <img src=x>');
    denied = true;
    await page.reload();
    await expect(
      page.getByRole('alert').filter({ hasText: tSaving('error', locale) })
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: tSaving('fulfillment', locale), exact: true })
    ).toHaveCount(0);
    await expect(page.getByText('کارشناس <img src=x>', { exact: false })).toHaveCount(0);
  });
}
