import { staffSavingAddressOrder } from './saving-address-amendment-fixtures.js';
import type { SavingHardwareUpgrade } from '../components/SavingHardwareUpgradeHistory.js';
export const upgradeId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const adjustmentId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export const amendmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export function savingHardwareOrder(delta = '50000') {
  const source = staffSavingAddressOrder();
  const hardwareUpgrades: SavingHardwareUpgrade[] = [];
  return {
    ...source,
    agreementSnapshot: 'Accepted agreement',
    refundedIrR: '0',
    pendingRefundIrR: '0',
    hardwareUpgrades,
    hardwareOptions: [
      {
        ...source.hardwareOptions[0]!,
        priceIrR: (200000n + BigInt(delta)).toString(),
        vatRateBps: 0,
        totalIrR: (300000n + BigInt(delta)).toString(),
        priceDeltaIrR: delta,
        stockTracking: true,
        availableCount: 2,
      },
    ],
  };
}
export function savingPendingUpgrade(): SavingHardwareUpgrade {
  const source = savingHardwareOrder();
  return {
    id: upgradeId,
    status: 'awaiting_payment',
    createdAt: '2026-10-05T00:00:00.000Z',
    reason: 'Requested a better device',
    priceDeltaIrR: '50000',
    adjustmentInvoiceId: adjustmentId,
    invoiceState: 'Unpaid',
    paidIrR: '0',
    previousTitle: source.hardwareTitle,
    hardwareTitle: source.hardwareOptions[0]!.title,
  };
}
export function savingHardwareReview(reason = ' Hardware change ', delta = '50000') {
  const source = savingHardwareOrder(delta),
    option = source.hardwareOptions[0]!;
  return {
    schemaVersion: 1,
    scope: {
      action: 'saving.staff-hardware-amendment',
      profileId: source.profileId,
      resourceId: source.id,
    },
    data: {
      reason: reason.trim(),
      customerName: source.customerName,
      profileName: source.customerName,
      billIdentifier: source.billIdentifier,
      addressSnapshot: source.addressSnapshot,
      agreementSnapshot: 'Accepted agreement',
      contractId: source.contractId,
      contractState: source.contractState,
      versionId: source.versionId,
      versionNumber: 2,
      contractSnapshot: {},
      invoiceId: source.invoiceId,
      invoiceState: source.invoiceState,
      invoiceTotal: source.totalIrR,
      paidAmount: source.paidIrR,
      refundedAmount: '0',
      pendingRefundAmount: '0',
      currentHardwareId: source.hardwareProductId,
      currentHardwareTitle: source.hardwareTitle,
      currentHardwarePriceIrR: '200000',
      currentHardwareVatRateBps: 0,
      currentOrderTotalIrR: '300000',
      targetHardwareId: option.id,
      targetHardwareTitle: option.title,
      targetHardwarePriceIrR: option.priceIrR,
      targetHardwareVatRateBps: option.vatRateBps,
      targetOrderTotalIrR: option.totalIrR,
      priceDeltaIrR: delta,
      targetStockTracking: option.stockTracking,
      targetAvailableCount: option.availableCount,
      outcome:
        BigInt(delta) > 0n
          ? 'additional_charge'
          : BigInt(delta) < 0n
            ? 'credit_note'
            : 'swap_without_price_change',
    },
    hash: 'b'.repeat(64),
  };
}
export function savingCancellationReview(
  reason = ' Cancel charge ',
  upgrade = savingPendingUpgrade()
) {
  const source = savingHardwareOrder();
  return {
    schemaVersion: 1,
    scope: {
      action: 'saving.staff-hardware-upgrade-cancellation',
      profileId: source.profileId,
      resourceId: source.id,
    },
    data: {
      reason: reason.trim(),
      customerName: source.customerName,
      profileName: source.customerName,
      billIdentifier: source.billIdentifier,
      addressSnapshot: source.addressSnapshot,
      agreementSnapshot: 'Accepted agreement',
      contractId: source.contractId,
      contractState: source.contractState,
      versionId: source.versionId,
      versionNumber: 2,
      contractSnapshot: {},
      upgradeVersionId: source.versionId,
      upgradeId: upgrade.id,
      previousHardware: { title: upgrade.previousTitle },
      replacementHardware: { title: upgrade.hardwareTitle },
      stockReserved: true,
      adjustmentInvoiceId: upgrade.adjustmentInvoiceId,
      adjustmentInvoiceState: upgrade.invoiceState,
      additionalChargeIrR: upgrade.priceDeltaIrR,
      invoiceTotalIrR: upgrade.priceDeltaIrR,
      invoicePaidIrR: '0',
      outcome: 'cancel_unpaid_charge_and_release_reservation',
    },
    hash: 'c'.repeat(64),
  };
}
export function savingHardwareReceipt(delta = '50000') {
  const source = savingHardwareOrder(delta);
  return {
    ...(BigInt(delta) > 0n ? { upgradeId, status: 'awaiting_payment' } : { amendmentId }),
    savingOrderId: source.id,
    hardwareProductId: source.hardwareOptions[0]!.id,
    priceDeltaIrR: delta,
    adjustmentInvoiceId: delta === '0' ? null : adjustmentId,
  };
}
export const savingCancellationReceipt = () => ({
  savingOrderId: savingHardwareOrder().id,
  upgradeId,
  status: 'cancelled',
});
