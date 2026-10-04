import {
  parseSavingStaffDecisionReview,
  parseSavingFulfillmentStageReview,
  type SavingStaffDecisionReview,
  type SavingFulfillmentStageReview,
} from '@barghsa/shared/finance';
import { sameFormData } from './form-receipt.js';
import { savingAddressUuid } from './saving-address-amendment-form.js';
export {
  publicSavingAddressError as publicSavingOperationError,
  definitiveSavingAddressRejection as definitiveSavingOperationRejection,
} from './saving-address-amendment-form.js';

export type SavingOperationStage = SavingFulfillmentStageReview['data']['stage'];
export type SavingOperationDraft = { note: string; handover: string };
export type SavingOperationIntent =
  | { kind: 'decision'; action: 'approve' | 'reject' }
  | { kind: 'stage'; stage: SavingOperationStage; action: 'complete' | 'skip' };
export type SavingOperationReview =
  | { kind: 'decision'; value: SavingStaffDecisionReview }
  | { kind: 'stage'; value: SavingFulfillmentStageReview };
export interface SavingOperationSource {
  id: string;
  profileId: string;
  versionId: string;
  status: string;
  customerName: string;
  billIdentifier: string;
  hardwareTitle: { fa: string; en: string };
  addressSnapshot: Record<string, unknown>;
  pricingSnapshot: Record<string, unknown>;
  agreementSnapshot: string;
  contractId: string;
  contractState: string;
  invoiceId: string;
  invoiceState: string;
  totalIrR: string;
  paidIrR: string;
  refundedIrR: string;
  pendingRefundIrR: string;
  stages: Array<{
    stage: SavingOperationStage;
    status: string;
    explanation: string | null;
    handover_description: string | null;
  }>;
  hardwareUpgrades: Array<{ status: string }>;
}

function sameSnapshot(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (Array.isArray(actual) || Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      Array.isArray(expected) &&
      actual.length === expected.length &&
      actual.every((value, index) => sameSnapshot(value, expected[index]))
    );
  if (!actual || !expected || typeof actual !== 'object' || typeof expected !== 'object')
    return false;
  const row = actual as Record<string, unknown>,
    source = expected as Record<string, unknown>;
  return (
    Object.keys(row).length === Object.keys(source).length &&
    Object.keys(source).every(
      (key) => Object.hasOwn(row, key) && sameSnapshot(row[key], source[key])
    )
  );
}

export function savingOperationPreviewBody(
  intent: SavingOperationIntent,
  draft: SavingOperationDraft
) {
  return intent.kind === 'decision'
    ? { action: intent.action, reason: intent.action === 'reject' ? draft.note.trim() : '' }
    : {
        expectedStatus: 'in_progress',
        explanation: draft.note.trim(),
        ...(draft.handover.trim() ? { handoverDescription: draft.handover.trim() } : {}),
      };
}

export function savingOperationFields(fields: unknown[], intent: SavingOperationIntent) {
  const owned: Record<string, keyof SavingOperationDraft> =
    intent.kind === 'decision'
      ? intent.action === 'reject'
        ? { reason: 'note' }
        : {}
      : { explanation: 'note', handoverDescription: 'handover' };
  return fields.length &&
    fields.every((field) => typeof field === 'string' && Object.hasOwn(owned, field))
    ? fields.map((field) => owned[field as string]!)
    : null;
}

export function matchedSavingOperationReview(
  value: unknown,
  source: SavingOperationSource,
  intent: SavingOperationIntent,
  draft: SavingOperationDraft
): SavingOperationReview | null {
  const decision = intent.kind === 'decision' ? parseSavingStaffDecisionReview(value) : null;
  const stage = intent.kind === 'stage' ? parseSavingFulfillmentStageReview(value) : null;
  const review = decision ?? stage;
  if (
    !review ||
    review.scope.profileId !== source.profileId ||
    review.scope.resourceId !== source.id ||
    review.data.versionId !== source.versionId ||
    review.data.customerName !== source.customerName ||
    review.data.billIdentifier !== source.billIdentifier ||
    !sameFormData(review.data.hardwareTitle, source.hardwareTitle) ||
    !sameFormData(review.data.addressSnapshot, source.addressSnapshot) ||
    !sameSnapshot(review.data.pricingSnapshot, source.pricingSnapshot) ||
    review.data.agreementSnapshot !== source.agreementSnapshot ||
    review.data.contractId !== source.contractId ||
    review.data.contractState !== source.contractState ||
    review.data.invoiceId !== source.invoiceId ||
    review.data.invoiceState !== source.invoiceState
  )
    return null;
  if (intent.kind === 'decision') {
    const expectedOutcome =
      intent.action === 'approve'
        ? 'publish_contract'
        : BigInt(source.paidIrR) > BigInt(source.refundedIrR)
          ? 'refund_obligation'
          : ['Draft', 'Unpaid', 'Overdue'].includes(source.invoiceState)
            ? 'cancel_invoice'
            : 'reject_without_refund';
    if (
      !decision ||
      source.status !== 'awaiting_staff_review' ||
      decision.data.action !== intent.action ||
      decision.data.reason !== (intent.action === 'reject' ? draft.note.trim() : '') ||
      decision.data.invoiceTotal !== source.totalIrR ||
      decision.data.paidAmount !== source.paidIrR ||
      decision.data.refundedAmount !== source.refundedIrR ||
      decision.data.pendingRefundAmount !== source.pendingRefundIrR ||
      decision.data.outcome !== expectedOutcome
    )
      return null;
    return { kind: 'decision', value: decision };
  }
  const stageOrder: SavingOperationStage[] = [
    'request_confirmation',
    'product_delivery',
    'installation_and_document_upload',
    'equipment_handover',
    'process_completion',
  ];
  const expectedNext = stageOrder[stageOrder.indexOf(intent.stage) + 1] ?? null;
  if (
    !stage ||
    !['approved', 'in_progress'].includes(source.status) ||
    stage.data.orderStatus !== source.status ||
    stage.data.stage !== intent.stage ||
    stage.data.action !== intent.action ||
    intent.stage === 'request_confirmation' ||
    !source.stages.some((row) => row.stage === intent.stage && row.status === 'in_progress') ||
    stage.data.nextStage !== expectedNext ||
    stage.data.nextStatus !== (intent.action === 'skip' ? 'skipped' : 'completed') ||
    stage.data.commercialStatus !== (expectedNext ? 'in_progress' : 'completed') ||
    stage.data.explanation !== draft.note.trim() ||
    stage.data.handoverDescription !== (draft.handover.trim() || null) ||
    stage.data.invoiceTotalIrR !== source.totalIrR ||
    stage.data.paidAmountIrR !== source.paidIrR ||
    stage.data.refundedAmountIrR !== source.refundedIrR ||
    stage.data.pendingRefundAmountIrR !== source.pendingRefundIrR ||
    stage.data.hasPendingUpgrade !==
      source.hardwareUpgrades.some((row) => row.status === 'awaiting_payment') ||
    new Set(source.stages.map((row) => row.stage)).size !== source.stages.length ||
    new Set(stage.data.stages.map((row) => row.stage)).size !== stage.data.stages.length ||
    stage.data.stages.length !== source.stages.length ||
    !stage.data.stages.every((row) =>
      source.stages.some((current) => current.stage === row.stage && current.status === row.status)
    )
  )
    return null;
  return { kind: 'stage', value: stage };
}

export function matchedSavingOperationReceipt(value: unknown, review: SavingOperationReview) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (row.savingOrderId !== review.value.scope.resourceId) return false;
  if (review.kind === 'decision') {
    const data = review.value.data;
    return (
      Object.keys(row).length === 3 &&
      row.status === (data.action === 'approve' ? 'approved' : 'rejected') &&
      (data.outcome === 'refund_obligation'
        ? savingAddressUuid(row.refundId)
        : row.refundId === null)
    );
  }
  const data = review.value.data;
  return (
    Object.keys(row).length === 5 &&
    row.status === data.commercialStatus &&
    row.stage === data.stage &&
    row.stageStatus === data.nextStatus &&
    row.nextStage === data.nextStage
  );
}
