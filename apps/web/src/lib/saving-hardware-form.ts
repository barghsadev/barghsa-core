import {
  parseSavingHardwareAmendmentReview,
  parseSavingHardwareUpgradeCancellationReview,
  type SavingHardwareAmendmentReview,
  type SavingHardwareUpgradeCancellationReview,
} from '@barghsa/shared/finance';
import type { SavingHardwareUpgrade } from '../components/SavingHardwareUpgradeHistory.js';
import { sameFormData } from './form-receipt.js';
export {
  savingAddressUuid as savingHardwareUuid,
  publicSavingAddressError as publicSavingHardwareError,
  definitiveSavingAddressRejection as definitiveSavingHardwareRejection,
} from './saving-address-amendment-form.js';
import { savingAddressUuid } from './saving-address-amendment-form.js';

export type SavingHardwareDraft = { hardwareProductId: string; reason: string };
export interface SavingHardwareOption {
  id: string;
  title: { fa: string; en: string };
  priceIrR: string;
  vatRateBps: number;
  totalIrR: string;
  priceDeltaIrR: string;
  stockTracking: boolean;
  availableCount: number;
}
export interface SavingHardwareSource {
  id: string;
  profileId: string;
  customerName: string;
  agreementSnapshot: string;
  refundedIrR: string;
  pendingRefundIrR: string;
  versionId: string;
  hardwareProductId: string;
  hardwareTitle: { fa: string; en: string };
  billIdentifier: string;
  addressSnapshot: Record<string, unknown>;
  contractId: string;
  contractState: string;
  invoiceId: string;
  invoiceState: string;
  totalIrR: string;
  paidIrR: string;
  canAmendHardware: boolean;
  hardwareOptions: SavingHardwareOption[];
}
export interface SavingHardwareOwner {
  attempted: boolean;
  uncertain: boolean;
  kind?: 'hardware' | 'cancellation';
}
export type SavingHardwareReview =
  | { kind: 'hardware'; value: SavingHardwareAmendmentReview }
  | { kind: 'cancellation'; value: SavingHardwareUpgradeCancellationReview };
export interface SavingHardwareDraftCache {
  baseScope: string;
  scope: string;
  value: SavingHardwareDraft;
}
export function cancellableSavingUpgrade(upgrade: SavingHardwareUpgrade) {
  return (
    upgrade.status === 'awaiting_payment' &&
    upgrade.paidIrR === '0' &&
    ['Unpaid', 'Overdue'].includes(upgrade.invoiceState)
  );
}

export function matchedSavingHardwareReview(
  value: unknown,
  source: SavingHardwareSource,
  draft: SavingHardwareDraft,
  upgrade?: SavingHardwareUpgrade
): SavingHardwareReview | null {
  const cancellation = upgrade ? parseSavingHardwareUpgradeCancellationReview(value) : null;
  const hardware = upgrade ? null : parseSavingHardwareAmendmentReview(value);
  const review = cancellation ?? hardware;
  if (
    !review ||
    review.scope.profileId !== source.profileId ||
    review.scope.resourceId !== source.id ||
    review.data.reason !== draft.reason.trim() ||
    review.data.versionId !== source.versionId ||
    review.data.contractId !== source.contractId ||
    review.data.contractState !== source.contractState ||
    review.data.customerName !== source.customerName ||
    review.data.agreementSnapshot !== source.agreementSnapshot ||
    review.data.billIdentifier !== source.billIdentifier ||
    !sameFormData(review.data.addressSnapshot, source.addressSnapshot)
  )
    return null;
  if (upgrade) {
    if (
      !cancellation ||
      !cancellableSavingUpgrade(upgrade) ||
      cancellation.data.upgradeId !== upgrade.id ||
      cancellation.data.adjustmentInvoiceId !== upgrade.adjustmentInvoiceId ||
      cancellation.data.adjustmentInvoiceState !== upgrade.invoiceState ||
      cancellation.data.invoicePaidIrR !== upgrade.paidIrR ||
      cancellation.data.additionalChargeIrR !== upgrade.priceDeltaIrR ||
      !sameFormData(cancellation.data.previousHardware.title, upgrade.previousTitle) ||
      !sameFormData(cancellation.data.replacementHardware.title, upgrade.hardwareTitle)
    )
      return null;
    return { kind: 'cancellation', value: cancellation };
  }
  const option = source.hardwareOptions.find((item) => item.id === draft.hardwareProductId);
  if (
    !hardware ||
    !source.canAmendHardware ||
    !option ||
    option.id === source.hardwareProductId ||
    hardware.data.invoiceId !== source.invoiceId ||
    hardware.data.invoiceState !== source.invoiceState ||
    hardware.data.invoiceTotal !== source.totalIrR ||
    hardware.data.paidAmount !== source.paidIrR ||
    hardware.data.refundedAmount !== source.refundedIrR ||
    hardware.data.pendingRefundAmount !== source.pendingRefundIrR ||
    hardware.data.currentHardwareId !== source.hardwareProductId ||
    !sameFormData(hardware.data.currentHardwareTitle, source.hardwareTitle) ||
    hardware.data.targetHardwareId !== option.id ||
    !sameFormData(hardware.data.targetHardwareTitle, option.title) ||
    hardware.data.targetHardwarePriceIrR !== option.priceIrR ||
    hardware.data.targetHardwareVatRateBps !== option.vatRateBps ||
    hardware.data.targetOrderTotalIrR !== option.totalIrR ||
    hardware.data.priceDeltaIrR !== option.priceDeltaIrR ||
    hardware.data.targetStockTracking !== option.stockTracking ||
    hardware.data.targetAvailableCount !== option.availableCount
  )
    return null;
  return { kind: 'hardware', value: hardware };
}

export function matchedSavingHardwareReceipt(value: unknown, review: SavingHardwareReview) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  if (receipt.savingOrderId !== review.value.scope.resourceId) return false;
  if (review.kind === 'cancellation')
    return (
      Object.keys(receipt).length === 3 &&
      receipt.upgradeId === review.value.data.upgradeId &&
      receipt.status === 'cancelled'
    );
  const data = review.value.data;
  if (
    receipt.hardwareProductId !== data.targetHardwareId ||
    receipt.priceDeltaIrR !== data.priceDeltaIrR
  )
    return false;
  if (data.outcome === 'additional_charge')
    return (
      Object.keys(receipt).length === 6 &&
      savingAddressUuid(receipt.upgradeId) &&
      savingAddressUuid(receipt.adjustmentInvoiceId) &&
      receipt.status === 'awaiting_payment'
    );
  return (
    Object.keys(receipt).length === 5 &&
    savingAddressUuid(receipt.amendmentId) &&
    (data.outcome === 'credit_note'
      ? savingAddressUuid(receipt.adjustmentInvoiceId)
      : receipt.adjustmentInvoiceId === null)
  );
}
