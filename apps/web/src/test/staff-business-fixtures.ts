export const firstWork = '83000000-0000-4000-8000-000000000001';
export const olderWork = '83000000-0000-4000-8000-000000000002';
export const workProfile = '83000000-0000-4000-8000-000000000003';
const stamp = '2026-09-23T10:00:00.000Z';
export function electricityWork(id = firstWork) {
  return {
    orderId: id,
    profileId: workProfile,
    customerName: id === firstWork ? 'First buyer' : 'Older buyer',
    commercialStatus: 'awaiting_staff_review',
    financialStatus: 'unpaid',
    contractId: null,
    contractState: 'AwaitingStaffReview',
    invoiceId: firstWork,
    invoiceState: 'Unpaid',
    nextAction: 'review_order',
    submittedAt: stamp,
    periodStart: stamp,
    periodEnd: '2026-09-30T10:00:00.000Z',
    totalKwh: '10',
    totalIrR: '1000',
    paidIrR: '0',
    fullAddress: 'Installation address',
    pricingSnapshot: { lines: [] },
    settingsSnapshot: {},
    contractSnapshot: {},
    versionId: firstWork,
    timeline: [],
  };
}
export function savingWork(id = firstWork) {
  return {
    id,
    orderId: id,
    profileId: workProfile,
    customerName: id === firstWork ? 'First buyer' : 'Older buyer',
    status: 'awaiting_staff_review',
    financialStatus: 'unpaid',
    submittedAt: stamp,
    billIdentifier: '1234567890123',
    addressSnapshot: { full_address: 'Installation address' },
    installationAddressId: firstWork,
    hardwareProductId: firstWork,
    hardwareTitle: { en: 'Device', fa: 'دستگاه' },
    pricingSnapshot: { plan: { title: { en: 'Saving plan', fa: 'طرح صرفه‌جویی' } } },
    versionId: firstWork,
    invoiceState: 'Unpaid',
    contractState: 'AwaitingStaffReview',
    totalIrR: '1000',
    paidIrR: '0',
    stages: [],
    events: [],
    revisions: [],
    addressAmendments: [],
    hardwareAmendments: [],
    hardwareUpgrades: [],
    addressOptions: [],
    hardwareOptions: [],
    canAmendAddress: false,
    canAmendHardware: false,
  };
}
export function consultationWork(id = firstWork) {
  return {
    id,
    profile_id: workProfile,
    profile_name: id === firstWork ? 'First buyer' : 'Older buyer',
    status: 'under_review',
    product_snapshot: { title: { en: 'Consultation', fa: 'مشاوره' } },
    staff_owner_id: null,
    staff_team: null,
    submitted_at: stamp,
    priority: 'normal',
    scope: 'Site survey',
    deliverables: 'Report',
    fee: '100000',
    invoice_id: null,
    invoice_state: null,
    has_paid_invoice: false,
    uncovered_credit: '0',
    offer_valid_until: '2099-01-01T12:30:00.000Z',
    expected_next_step: null,
  };
}
