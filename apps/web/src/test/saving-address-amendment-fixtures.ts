export const savingAddressOrderId = '11111111-1111-4111-8111-111111111111';
export const savingAddressProfileId = '22222222-2222-4222-8222-222222222222';
export const savingAddressVersionId = '33333333-3333-4333-8333-333333333333';
export const savingPreviousAddressId = '44444444-4444-4444-8444-444444444444';
export const savingReplacementAddress = {
  id: '55555555-5555-4555-8555-555555555555',
  province_id: '66666666-6666-4666-8666-666666666666',
  city_id: '77777777-7777-4777-8777-777777777777',
  full_address: 'Replacement installation address',
  postal_code: '9876543210',
};
export function staffSavingAddressOrder() {
  return {
    id: savingAddressOrderId,
    orderId: savingAddressOrderId,
    profileId: savingAddressProfileId,
    customerName: 'Buyer Company',
    status: 'in_progress',
    financialStatus: 'paid',
    submittedAt: '2026-10-01T00:00:00.000Z',
    billIdentifier: '1234567890123',
    addressSnapshot: { full_address: 'Previous address', postal_code: '1234567890' },
    installationAddressId: savingPreviousAddressId,
    hardwareProductId: '88888888-8888-4888-8888-888888888888',
    hardwareTitle: { en: 'Device', fa: 'دستگاه' },
    pricingSnapshot: { plan: { title: { en: 'Saving plan', fa: 'طرح صرفه‌جویی' } } },
    versionId: savingAddressVersionId,
    invoiceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    invoiceState: 'Paid',
    contractId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    contractState: 'Active',
    totalIrR: '300000',
    paidIrR: '300000',
    stages: [
      {
        stage: 'product_delivery',
        status: 'in_progress',
        completed_at: null,
        explanation: null,
        handover_description: null,
      },
    ],
    events: [],
    revisions: [],
    addressAmendments: [],
    hardwareAmendments: [],
    hardwareUpgrades: [],
    addressOptions: [
      { id: savingPreviousAddressId, fullAddress: 'Previous address', postalCode: '1234567890' },
      {
        id: savingReplacementAddress.id,
        fullAddress: savingReplacementAddress.full_address,
        postalCode: savingReplacementAddress.postal_code,
      },
    ],
    hardwareOptions: [
      {
        id: '99999999-9999-4999-8999-999999999999',
        title: { en: 'New device', fa: 'دستگاه جدید' },
        priceDeltaIrR: '50000',
      },
    ],
    canAmendAddress: true,
    canAmendHardware: true,
  };
}
export function staffSavingAddressReview(reason = 'Address correction') {
  const order = staffSavingAddressOrder();
  return {
    schemaVersion: 1,
    scope: {
      action: 'saving.staff-address-amendment',
      profileId: order.profileId,
      resourceId: order.id,
    },
    data: {
      reason,
      customerName: order.customerName,
      profileName: 'Buyer Company',
      billIdentifier: order.billIdentifier,
      orderId: order.orderId,
      hardwareTitle: order.hardwareTitle,
      pricingSnapshot: order.pricingSnapshot,
      agreementSnapshot: 'Accepted agreement',
      contractId: order.contractId,
      contractState: order.contractState,
      versionId: order.versionId,
      versionNumber: 1,
      contractSnapshot: {},
      invoiceId: order.invoiceId,
      invoiceState: 'Paid',
      invoiceTotalIrR: order.totalIrR,
      paidAmountIrR: order.paidIrR,
      refundedAmountIrR: '0',
      pendingRefundAmountIrR: '0',
      previousAddressId: order.installationAddressId,
      previousAddress: order.addressSnapshot,
      replacementAddressId: savingReplacementAddress.id,
      replacementAddress: savingReplacementAddress,
      outcome: 'update_installation_address_without_repricing',
    },
    hash: 'a'.repeat(64),
  };
}
export const staffSavingAddressReceipt = () => ({
  amendmentId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  savingOrderId: savingAddressOrderId,
  address: { ...savingReplacementAddress },
});
