import type { SavingChangeQuote, SavingChangeSource } from './saving-change-form.js';
export const ids = {
  orderId: '11111111-1111-4111-8111-111111111111',
  profileId: '22222222-2222-4222-8222-222222222222',
  planId: '33333333-3333-4333-8333-333333333333',
  hardware: '44444444-4444-4444-8444-444444444444',
  nextHardware: '55555555-5555-4555-8555-555555555555',
  address: '66666666-6666-4666-8666-666666666666',
  nextAddress: '77777777-7777-4777-8777-777777777777',
  version: '88888888-8888-4888-8888-888888888888',
  invoice: '99999999-9999-4999-8999-999999999999',
  agreement: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  province: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  city: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  newVersion: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  emptyHardware: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
};
export const source: SavingChangeSource = {
  orderId: ids.orderId,
  profileId: ids.profileId,
  planId: ids.planId,
  currentHardwareId: ids.hardware,
  currentAddressId: ids.address,
  currentVersionId: ids.version,
  invoiceId: ids.invoice,
  billIdentifier: '123456',
  agreementVersionId: ids.agreement,
};
export const draft = {
  hardwareProductId: ids.nextHardware,
  installationAddressId: ids.nextAddress,
};
export const address = {
  profileId: ids.profileId,
  id: ids.nextAddress,
  provinceId: ids.province,
  cityId: ids.city,
  fullAddress: 'New street',
  postalCode: '9876543210',
};
export const product = (id: string, title: string, available_count = 1) => ({
  id,
  title: { fa: title, en: title },
  status: 'active',
  price: '300000',
  stock_tracking: true,
  available_count,
});
export const plans = {
  plans: [
    {
      id: ids.planId,
      status: 'active',
      price: '100000',
      hardware: [
        product(ids.hardware, 'Current'),
        product(ids.nextHardware, 'Next'),
        product(ids.emptyHardware, 'Empty', 0),
      ],
    },
  ],
};
export const addresses = {
  addresses: [
    { ...address, id: ids.address, fullAddress: 'Old street', postalCode: '1234567890' },
    address,
  ],
};
export function fullQuote(): SavingChangeQuote {
  return {
    plan: { id: ids.planId, title: { fa: 'طرح', en: 'Plan' } },
    hardware: { id: ids.nextHardware, title: { fa: 'دستگاه', en: 'Device' } },
    billIdentifier: '123456',
    address: {
      id: ids.nextAddress,
      province_id: ids.province,
      city_id: ids.city,
      full_address: 'New street',
      postal_code: '9876543210',
    },
    agreement: {
      versionId: ids.agreement,
      title: 'Accepted terms',
      body: 'Original accepted agreement body',
    },
    lines: [
      {
        type: 'plan_price',
        productId: ids.planId,
        title: { fa: 'طرح', en: 'Plan' },
        amountIrR: '100000',
        discountIrR: '7500',
        netIrR: '92500',
        vatRateBps: 0,
        vatIrR: '0',
      },
      {
        type: 'hardware_price',
        productId: ids.nextHardware,
        title: { fa: 'دستگاه', en: 'Device' },
        amountIrR: '300000',
        discountIrR: '22500',
        netIrR: '277500',
        vatRateBps: 300,
        vatIrR: '8325',
      },
    ],
    subtotalIrR: '400000',
    discountIrR: '30000',
    vatIrR: '8325',
    totalIrR: '378325',
    giftCodeId: ids.profileId,
    baseVersionId: ids.version,
    reviewDigest: 'a'.repeat(64),
  };
}
export const receipt = () => ({
  savingOrderId: ids.orderId,
  contractVersionId: ids.newVersion,
  invoiceId: ids.invoice,
  ...fullQuote(),
});
