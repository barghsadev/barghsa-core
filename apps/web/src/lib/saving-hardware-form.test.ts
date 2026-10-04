import { expect, it } from 'vitest';
import {
  matchedSavingHardwareReview,
  matchedSavingHardwareReceipt,
} from './saving-hardware-form.js';
import { savingHardwareSchema } from './saving-hardware-form-schemas.js';
import {
  savingHardwareOrder,
  savingHardwareReview,
  savingHardwareReceipt,
  savingCancellationReview,
  savingCancellationReceipt,
  savingPendingUpgrade,
} from '../test/saving-hardware-form-fixtures.js';
const source = savingHardwareOrder();
const draft = { hardwareProductId: source.hardwareOptions[0]!.id, reason: ' Hardware change ' };
it('retains raw draft and validates available different hardware plus trimmed 1000/1001 reasons', () => {
  const schema = savingHardwareSchema(source.hardwareProductId, [draft.hardwareProductId], false, {
    hardwareProductId: 'hardware',
    reason: 'reason',
  });
  expect(schema.parse({ ...draft, reason: ` ${'x'.repeat(1000)} ` }).reason).toBe(
    ` ${'x'.repeat(1000)} `
  );
  expect(schema.safeParse({ ...draft, reason: 'x'.repeat(1001) }).success).toBe(false);
  for (const hardwareProductId of [source.hardwareProductId, '', 'foreign'])
    expect(schema.safeParse({ ...draft, hardwareProductId }).success).toBe(false);
  expect(
    savingHardwareSchema('', [], true, {
      hardwareProductId: 'hardware',
      reason: 'reason',
    }).safeParse({ hardwareProductId: '', reason: ' Cancel charge ' }).success
  ).toBe(true);
});
it('binds the complete review to offered prices, VAT, stock and current original invoice/source', () => {
  expect(matchedSavingHardwareReview(savingHardwareReview(), source, draft)).not.toBeNull();
  const baseline = savingHardwareReview();
  for (const edit of [
    { customerName: 'Foreign customer' },
    { agreementSnapshot: 'Changed agreement' },
    { refundedAmount: '1' },
    { pendingRefundAmount: '1' },
    { versionId: source.profileId },
    { contractId: source.profileId },
    { contractState: 'Completed' },
    { invoiceId: source.profileId },
    { invoiceState: 'Unpaid' },
    { paidAmount: '0' },
    { invoiceTotal: '1' },
    { targetHardwarePriceIrR: '1' },
    { targetHardwareVatRateBps: 100 },
    { targetAvailableCount: 1 },
    { billIdentifier: 'PRIVATE' },
    { currentHardwareTitle: { en: 'Foreign', fa: 'بیگانه' } },
    { addressSnapshot: { full_address: 'Foreign' } },
    { reason: 'Different' },
  ])
    expect(
      matchedSavingHardwareReview(
        { ...baseline, data: { ...baseline.data, ...edit } },
        source,
        draft
      )
    ).toBeNull();
});
it('allows latest amended hardware totals that differ from the original paid invoice', () => {
  const order = savingHardwareOrder('50000');
  order.hardwareOptions[0]!.totalIrR = '300000';
  const review = savingHardwareReview();
  review.data.currentOrderTotalIrR = '250000';
  review.data.targetOrderTotalIrR = '300000';
  review.data.currentHardwarePriceIrR = '150000';
  expect(matchedSavingHardwareReview(review, order, draft)).not.toBeNull();
});
it.each(['50000', '0', '-50000'])(
  'proves the actual hardware receipt branch for delta %s',
  (delta) => {
    const review = matchedSavingHardwareReview(
      savingHardwareReview(draft.reason, delta),
      savingHardwareOrder(delta),
      draft
    )!;
    const receipt = savingHardwareReceipt(delta);
    expect(matchedSavingHardwareReceipt(receipt, review)).toBe(true);
    for (const edit of [
      { savingOrderId: source.profileId },
      { hardwareProductId: source.hardwareProductId },
      { priceDeltaIrR: '1' },
      { adjustmentInvoiceId: delta === '0' ? source.profileId : null },
      ...(delta === '50000'
        ? [{ status: 'applied' }, { upgradeId: 'foreign' }]
        : [{ amendmentId: 'foreign' }]),
    ])
      expect(matchedSavingHardwareReceipt({ ...receipt, ...edit }, review)).toBe(false);
  }
);
it('binds cancellation to the current unpaid upgrade and exact scoped receipt', () => {
  const upgrade = savingPendingUpgrade();
  const draft = { hardwareProductId: '', reason: ' Cancel charge ' };
  const value = savingCancellationReview();
  const review = matchedSavingHardwareReview(value, source, draft, upgrade)!;
  expect(review).not.toBeNull();
  expect(matchedSavingHardwareReceipt(savingCancellationReceipt(), review)).toBe(true);
  expect(
    matchedSavingHardwareReceipt(
      { ...savingCancellationReceipt(), upgradeId: source.profileId },
      review
    )
  ).toBe(false);
  for (const edit of [
    { customerName: 'Foreign customer' },
    { agreementSnapshot: 'Changed agreement' },
    { adjustmentInvoiceId: source.invoiceId },
    { adjustmentInvoiceState: 'Overdue' },
    { additionalChargeIrR: '1' },
    { invoicePaidIrR: '1' },
    { previousHardware: { title: source.hardwareOptions[0]!.title } },
  ])
    expect(
      matchedSavingHardwareReview(
        { ...value, data: { ...value.data, ...edit } },
        source,
        draft,
        upgrade
      )
    ).toBeNull();
  expect(
    matchedSavingHardwareReview(value, source, draft, { ...upgrade, status: 'expired' })
  ).toBeNull();
});
