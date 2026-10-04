import { savingHardwareOrder } from './saving-hardware-form-fixtures.js';
import type {
  SavingOperationIntent,
  SavingOperationSource,
  SavingOperationStage,
} from '../lib/saving-staff-operation-form.js';

const stages: SavingOperationStage[] = [
  'request_confirmation',
  'product_delivery',
  'installation_and_document_upload',
  'equipment_handover',
  'process_completion',
];
export function savingOperationOrder(
  kind: 'decision' | 'stage' = 'decision',
  active: SavingOperationStage = 'equipment_handover',
  paid = '0'
) {
  const source = savingHardwareOrder();
  return {
    ...source,
    pricingSnapshot: {
      ...source.pricingSnapshot,
      lines: [
        {
          title: { fa: 'طرح', en: 'Saving plan' },
          amountIrR: '100000',
          discountIrR: '0',
          netIrR: '100000',
          vatIrR: '0',
        },
        {
          title: source.hardwareTitle,
          amountIrR: '200000',
          discountIrR: '0',
          netIrR: '200000',
          vatIrR: '0',
        },
      ],
    },
    status: kind === 'decision' ? 'awaiting_staff_review' : 'in_progress',
    invoiceState: kind === 'decision' ? (paid === '0' ? 'Unpaid' : 'Paid') : 'Paid',
    paidIrR: kind === 'decision' ? paid : source.totalIrR,
    contractState: kind === 'decision' ? 'AwaitingStaffReview' : 'Active',
    canAmendAddress: kind === 'stage' && active === 'product_delivery',
    canAmendHardware: kind === 'stage' && active === 'product_delivery',
    stages: stages.map((stage) => ({
      stage,
      status:
        kind === 'decision'
          ? 'pending'
          : stages.indexOf(stage) < stages.indexOf(active)
            ? 'completed'
            : stage === active
              ? 'in_progress'
              : 'pending',
      completed_at: null,
      explanation: null,
      handover_description: null,
    })),
  };
}
export function savingDecisionReview(
  source: SavingOperationSource,
  action: 'approve' | 'reject',
  reason = ''
) {
  const refund = action === 'reject' ? BigInt(source.paidIrR) - BigInt(source.refundedIrR) : 0n;
  return {
    schemaVersion: 1,
    scope: {
      action: `saving.staff-review.${action}`,
      profileId: source.profileId,
      resourceId: source.id,
    },
    data: {
      action,
      reason: action === 'reject' ? reason.trim() : '',
      customerName: source.customerName,
      profileName: source.customerName,
      billIdentifier: source.billIdentifier,
      hardwareTitle: source.hardwareTitle,
      addressSnapshot: source.addressSnapshot,
      pricingSnapshot: source.pricingSnapshot,
      agreementSnapshot: source.agreementSnapshot,
      contractId: source.contractId,
      contractState: source.contractState,
      versionId: source.versionId,
      versionNumber: 2,
      contractSnapshot: {},
      invoiceId: source.invoiceId,
      invoiceState: source.invoiceState,
      invoiceTotal: source.totalIrR,
      paidAmount: source.paidIrR,
      refundedAmount: source.refundedIrR,
      pendingRefundAmount: source.pendingRefundIrR,
      outcome:
        action === 'approve'
          ? 'publish_contract'
          : refund > 0n
            ? 'refund_obligation'
            : 'cancel_invoice',
      refundAmount: refund.toString(),
      releasesGiftCode: false,
    },
    hash: 'd'.repeat(64),
  };
}
export function savingStageReview(
  source: SavingOperationSource,
  stage: SavingOperationStage,
  action: 'complete' | 'skip',
  explanation: string,
  handover?: string
) {
  const nextStage = stages[stages.indexOf(stage) + 1] ?? null;
  return {
    schemaVersion: 1,
    scope: {
      action: 'saving.staff-fulfillment-stage-transition',
      profileId: source.profileId,
      resourceId: source.id,
    },
    data: {
      customerName: source.customerName,
      profileName: source.customerName,
      billIdentifier: source.billIdentifier,
      addressSnapshot: source.addressSnapshot,
      hardwareTitle: source.hardwareTitle,
      pricingSnapshot: source.pricingSnapshot,
      agreementSnapshot: source.agreementSnapshot,
      contractId: source.contractId,
      contractState: source.contractState,
      versionId: source.versionId,
      versionNumber: 2,
      contractSnapshot: {},
      invoiceId: source.invoiceId,
      invoiceState: source.invoiceState,
      invoiceTotalIrR: source.totalIrR,
      paidAmountIrR: source.paidIrR,
      refundedAmountIrR: source.refundedIrR,
      pendingRefundAmountIrR: source.pendingRefundIrR,
      orderStatus: source.status,
      stages: source.stages
        .map(({ stage, status }) => ({ stage, status }))
        .sort((a, b) => a.stage.localeCompare(b.stage)),
      hasPendingUpgrade: source.hardwareUpgrades.some((row) => row.status === 'awaiting_payment'),
      stage,
      action,
      currentStatus: 'in_progress',
      nextStatus: action === 'skip' ? 'skipped' : 'completed',
      nextStage,
      commercialStatus: nextStage ? 'in_progress' : 'completed',
      explanation: explanation.trim(),
      handoverDescription: handover?.trim() ?? null,
    },
    hash: 'e'.repeat(64),
  };
}
export const operationRefundId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
export function savingOperationReceipt(
  source: SavingOperationSource,
  intent: SavingOperationIntent
) {
  if (intent.kind === 'decision')
    return {
      savingOrderId: source.id,
      status: intent.action === 'approve' ? 'approved' : 'rejected',
      refundId:
        intent.action === 'reject' && BigInt(source.paidIrR) > BigInt(source.refundedIrR)
          ? operationRefundId
          : null,
    };
  const nextStage = stages[stages.indexOf(intent.stage) + 1] ?? null;
  return {
    savingOrderId: source.id,
    status: nextStage ? 'in_progress' : 'completed',
    stage: intent.stage,
    stageStatus: intent.action === 'skip' ? 'skipped' : 'completed',
    nextStage,
  };
}
