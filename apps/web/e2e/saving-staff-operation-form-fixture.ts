import { createHash } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { SavingFulfillmentEvent } from '../src/lib/saving-fulfillment';
import type { HardwareDetail } from './saving-hardware-form-fixture';
import { setupSavingHardwareForms } from './saving-hardware-form-fixture';
import {
  savingChangeOrder,
  otherSavingChangeOrder,
  changeVersion,
} from './saving-change-address-form-fixture';
export { savingChangeOrder, otherSavingChangeOrder, changeVersion };
const uuid = (n: number) => `89400000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const generated = (n: number) => uuid(n).replace('-4000-', '-7000-');
export const refundId = generated(1);
const correlationId = uuid(2),
  stamp = '2026-10-05T10:00:00.000Z';
export const stageNames = [
  'request_confirmation',
  'product_delivery',
  'installation_and_document_upload',
  'equipment_handover',
  'process_completion',
] as const;
export type StageName = (typeof stageNames)[number];
export type Decision = 'approve' | 'reject';
export type StageAction = 'complete' | 'skip';
export type DecisionDraft = { action: Decision; reason: string };
export type DecisionCommand = {
  idempotencyKey: string;
  expectedVersionId: string;
  expectedReviewHash: string;
  reason?: string;
};
export type StageDraft = {
  expectedStatus: 'in_progress';
  explanation: string;
  handoverDescription?: string;
};
export type StageCommand = StageDraft & { idempotencyKey: string; expectedReviewHash: string };
type Mode = 'success' | 'owned' | 'held' | 'foreign' | 'malformed' | 'denied' | 'missing';
type WriteMode = 'success' | 'held' | 'malformed' | 'rejected';
type Call<T, A> = { id: string; action: A; body: T; raw: string; csrf: string };
export type OperationDetail = Omit<HardwareDetail, 'stages' | 'events'> & {
  stages: Array<{
    stage: StageName;
    status: string;
    completed_at: string | null;
    explanation: string | null;
    handover_description: string | null;
  }>;
  events: SavingFulfillmentEvent[];
};
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])])
    );
  return value;
}
function snapshot(action: string, row: OperationDetail, data: Record<string, unknown>) {
  const body = {
    schemaVersion: 1,
    scope: { action, profileId: row.profileId, resourceId: row.id },
    data,
  };
  return {
    ...body,
    hash: createHash('sha256')
      .update(JSON.stringify(canonical(body)))
      .digest('hex'),
  };
}
function financial(row: OperationDetail) {
  return {
    customerName: row.customerName,
    profileName: 'Change Buyer',
    billIdentifier: row.billIdentifier,
    hardwareTitle: row.hardwareTitle,
    addressSnapshot: row.addressSnapshot,
    pricingSnapshot: row.pricingSnapshot,
    agreementSnapshot: row.agreementSnapshot,
    contractId: row.contractId,
    contractState: row.contractState,
    versionId: row.versionId,
    versionNumber: 1,
    contractSnapshot: {},
    invoiceId: row.invoiceId,
    invoiceState: row.invoiceState,
  };
}
export function operationDecisionReview(row: OperationDetail, body: DecisionDraft) {
  const refund = body.action === 'reject' ? BigInt(row.paidIrR) - BigInt(row.refundedIrR) : 0n;
  return snapshot(`saving.staff-review.${body.action}`, row, {
    ...financial(row),
    action: body.action,
    reason: body.action === 'approve' ? '' : body.reason.trim(),
    invoiceTotal: row.totalIrR,
    paidAmount: row.paidIrR,
    refundedAmount: row.refundedIrR,
    pendingRefundAmount: row.pendingRefundIrR,
    outcome:
      body.action === 'approve'
        ? 'publish_contract'
        : refund > 0n
          ? 'refund_obligation'
          : ['Draft', 'Unpaid', 'Overdue'].includes(row.invoiceState)
            ? 'cancel_invoice'
            : 'reject_without_refund',
    refundAmount: refund.toString(),
    releasesGiftCode: body.action === 'reject' && row.paidIrR === '0',
  });
}
export function operationStageReview(
  row: OperationDetail,
  stage: StageName,
  action: StageAction,
  body: StageDraft
) {
  const nextStage = stageNames[stageNames.indexOf(stage) + 1] ?? null;
  return snapshot('saving.staff-fulfillment-stage-transition', row, {
    ...financial(row),
    invoiceTotalIrR: row.totalIrR,
    paidAmountIrR: row.paidIrR,
    refundedAmountIrR: row.refundedIrR,
    pendingRefundAmountIrR: row.pendingRefundIrR,
    orderStatus: row.status,
    // The service review uses ORDER BY text stage; public detail uses business CASE order.
    stages: row.stages
      .map(({ stage, status }) => ({ stage, status }))
      .sort((a, b) => a.stage.localeCompare(b.stage)),
    hasPendingUpgrade: row.hardwareUpgrades.some(
      (upgrade) => upgrade.status === 'awaiting_payment'
    ),
    stage,
    action,
    currentStatus: 'in_progress',
    nextStatus: action === 'skip' ? 'skipped' : 'completed',
    nextStage,
    commercialStatus: nextStage ? 'in_progress' : 'completed',
    explanation: body.explanation.trim(),
    handoverDescription: body.handoverDescription?.trim() ?? null,
  });
}
function stages(current: StageName | null) {
  const position = current ? stageNames.indexOf(current) : -1;
  return stageNames.map((stage, index) => ({
    stage,
    status: index < position ? 'completed' : index === position ? 'in_progress' : 'pending',
    completed_at: index < position ? stamp : null,
    explanation: null,
    handover_description: null,
  }));
}
export async function setupSavingStaffOperations(
  page: Page,
  locale: 'en' | 'fa',
  story: 'decision' | 'stage'
) {
  const shell = await setupSavingHardwareForms(page, locale);
  const details = new Map<string, OperationDetail>(
    [...shell.state.details].map(([id, row]) => {
      const isDecision = story === 'decision';
      const unpaid = isDecision && id === otherSavingChangeOrder && locale === 'fa';
      const other = id === otherSavingChangeOrder;
      return [
        id,
        {
          ...row,
          status: isDecision ? 'awaiting_staff_review' : 'in_progress',
          customerId: other ? 'other-saving-operation-buyer' : row.customerId,
          versionId: other ? uuid(7) : row.versionId,
          contractId: other ? uuid(8) : row.contractId,
          invoiceId: other ? uuid(9) : row.invoiceId,
          pricingSnapshot: {
            ...row.pricingSnapshot,
            baseVersionId: other ? uuid(7) : row.versionId,
          },
          contractState: isDecision ? 'AwaitingStaffReview' : 'Active',
          invoiceState: unpaid ? 'Unpaid' : 'Paid',
          paidIrR: unpaid ? '0' : row.totalIrR,
          financialStatus: unpaid ? 'unpaid' : 'paid',
          stages: stages(
            isDecision ? null : id === savingChangeOrder ? 'equipment_handover' : 'product_delivery'
          ),
          canAmendAddress: !isDecision && id === otherSavingChangeOrder,
          canAmendHardware: !isDecision && id === otherSavingChangeOrder,
        },
      ];
    })
  );
  const state = {
    details,
    stepUp: shell.state.stepUp,
    reads: [] as string[],
    needsStepUp: false,
    decisionMode: 'success' as Mode,
    stageMode: 'success' as Mode,
    decisionWriteMode: 'success' as WriteMode,
    stageWriteMode: 'success' as WriteMode,
    ownedFields: ['reason'] as string[],
    decisionPreviews: [] as Array<Call<DecisionDraft, Decision>>,
    stagePreviews: [] as Array<Call<StageDraft, StageAction> & { stage: StageName }>,
    decisionWrites: [] as Array<Call<DecisionCommand, Decision>>,
    stageWrites: [] as Array<Call<StageCommand, StageAction> & { stage: StageName }>,
    heldPreview: undefined as Route | undefined,
    heldWrite: undefined as Route | undefined,
    decisionReceipts: new Map<string, Record<string, unknown>>(),
    stageReceipts: new Map<string, Record<string, unknown>>(),
  };
  const failure = (route: Route, status: number, code: string, fields?: string[]) =>
    route.fulfill({
      status,
      json: {
        error: {
          code,
          correlationId,
          message: 'PRIVATE_OPERATION_SERVER_TEXT',
          ...(fields ? { fields } : {}),
        },
      },
    });
  function addEvent(
    row: OperationDetail,
    stage: string,
    from: string,
    to: string,
    explanation: string,
    handover: string | null,
    noteKind: 'started' | 'confirmed' | 'recorded'
  ) {
    row.events.unshift({
      id: generated(20 + row.events.length),
      stage,
      from_status: from,
      to_status: to,
      explanation,
      handover_description: handover,
      created_at: stamp,
      actorName: 'Review staff',
      noteKind,
    });
  }
  function persistDecision(call: Call<DecisionCommand, Decision>) {
    const cached = state.decisionReceipts.get(call.body.idempotencyKey);
    if (cached) return cached;
    const row = state.details.get(call.id)!;
    const refunded = call.action === 'reject' && BigInt(row.paidIrR) > BigInt(row.refundedIrR);
    const receipt = {
      savingOrderId: row.id,
      status: call.action === 'approve' ? 'approved' : 'rejected',
      refundId: refunded ? refundId : null,
    };
    if (call.action === 'approve') {
      row.status = 'approved';
      row.contractState = 'AwaitingCustomerAcceptance';
      row.stages = stages('product_delivery');
      row.stages[0]!.explanation = 'Staff approved request';
      row.canAmendAddress = true;
      row.canAmendHardware = true;
      addEvent(
        row,
        'request_confirmation',
        'pending',
        'completed',
        'Staff approved request',
        null,
        'confirmed'
      );
      addEvent(
        row,
        'product_delivery',
        'pending',
        'in_progress',
        'Request approved',
        null,
        'started'
      );
    } else {
      row.status = 'rejected';
      row.contractState = 'Rejected';
      if (refunded) {
        row.financialStatus = 'refund_pending';
        row.pendingRefundIrR = (BigInt(row.paidIrR) - BigInt(row.refundedIrR)).toString();
      } else if (['Draft', 'Unpaid', 'Overdue'].includes(row.invoiceState))
        row.invoiceState = 'Cancelled';
      row.canAmendAddress = false;
      row.canAmendHardware = false;
    }
    state.decisionReceipts.set(call.body.idempotencyKey, receipt);
    return receipt;
  }
  function persistStage(call: Call<StageCommand, StageAction> & { stage: StageName }) {
    const cached = state.stageReceipts.get(call.body.idempotencyKey);
    if (cached) return cached;
    const row = state.details.get(call.id)!;
    const reviewed = operationStageReview(row, call.stage, call.action, call.body);
    const receipt = {
      savingOrderId: row.id,
      status: reviewed.data.commercialStatus,
      stage: call.stage,
      stageStatus: reviewed.data.nextStatus,
      nextStage: reviewed.data.nextStage,
    };
    const current = row.stages.find((x) => x.stage === call.stage)!;
    current.status = String(receipt.stageStatus);
    current.completed_at = stamp;
    current.explanation = call.body.explanation;
    current.handover_description = call.body.handoverDescription ?? null;
    if (receipt.nextStage)
      row.stages.find((x) => x.stage === receipt.nextStage)!.status = 'in_progress';
    row.status = String(receipt.status);
    row.canAmendAddress = false;
    row.canAmendHardware = false;
    addEvent(
      row,
      call.stage,
      'in_progress',
      current.status,
      call.body.explanation,
      current.handover_description,
      'recorded'
    );
    if (receipt.nextStage)
      addEvent(
        row,
        String(receipt.nextStage),
        'pending',
        'in_progress',
        'Previous stage finished',
        null,
        'started'
      );
    state.stageReceipts.set(call.body.idempotencyKey, receipt);
    return receipt;
  }
  await page.route(/\/api\/staff\/saving\/orders(?:\?[^/]*)?$/, (route) => {
    state.reads.push(route.request().url());
    return route.fulfill({ json: { orders: [...state.details.values()], nextAfter: null } });
  });
  await page.route(/\/api\/staff\/saving\/orders\/[^/?]+$/, (route) => {
    state.reads.push(route.request().url());
    return route.fulfill({
      json: state.details.get(new URL(route.request().url()).pathname.split('/').at(-1)!),
    });
  });
  async function preview(route: Route, mode: Mode, value: Record<string, unknown>) {
    if (mode === 'held') {
      state.heldPreview = route;
      return;
    }
    if (mode === 'owned')
      return failure(route, 400, ErrorCodes.VALIDATION_INPUT_INVALID.code, state.ownedFields);
    if (mode === 'denied' || mode === 'missing')
      return failure(
        route,
        mode === 'missing' ? 404 : 403,
        mode === 'missing' ? ErrorCodes.NOT_FOUND_RESOURCE.code : ErrorCodes.AUTHZ_FORBIDDEN.code
      );
    return route.fulfill({
      json:
        mode === 'foreign'
          ? {
              ...value,
              scope: {
                profileId: details.get(savingChangeOrder)!.profileId,
                resourceId: uuid(99),
                action: (value.scope as { action: string }).action,
              },
            }
          : mode === 'malformed'
            ? { ...value, hash: 'not-a-hash' }
            : value,
    });
  }
  await page.route(/\/api\/staff\/saving\/orders\/[^/]+\/financial-review$/, (route) => {
    const body = route.request().postDataJSON() as DecisionDraft,
      id = new URL(route.request().url()).pathname.split('/')[5]!;
    state.decisionPreviews.push({
      id,
      action: body.action,
      body,
      raw: route.request().postData()!,
      csrf: route.request().headers()['x-csrf-token'] ?? '',
    });
    return preview(route, state.decisionMode, operationDecisionReview(details.get(id)!, body));
  });
  await page.route(
    /\/api\/staff\/saving\/orders\/[^/]+\/stages\/[^/]+\/(complete|skip)\/review$/,
    (route) => {
      const parts = new URL(route.request().url()).pathname.split('/'),
        id = parts[5]!,
        stage = parts[7] as StageName,
        action = parts[8] as StageAction;
      const body = route.request().postDataJSON() as StageDraft;
      state.stagePreviews.push({
        id,
        stage,
        action,
        body,
        raw: route.request().postData()!,
        csrf: route.request().headers()['x-csrf-token'] ?? '',
      });
      return preview(
        route,
        state.stageMode,
        operationStageReview(details.get(id)!, stage, action, body)
      );
    }
  );
  async function write(route: Route, mode: WriteMode, receipt: () => Record<string, unknown>) {
    if (state.needsStepUp && !state.stepUp.verified)
      return route.fulfill({
        status: 403,
        json: {
          error: {
            code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code,
            message: 'Step-up required',
            correlationId,
          },
          requiresStepUp: true,
        },
      });
    if (mode === 'held') {
      state.heldWrite = route;
      return;
    }
    if (mode === 'rejected') return failure(route, 409, ErrorCodes.CONFLICT_STATE.code);
    const value = receipt();
    return route.fulfill({
      json: mode === 'malformed' ? { ...value, savingOrderId: uuid(99) } : value,
    });
  }
  await page.route(/\/api\/staff\/saving\/orders\/[^/]+\/(approve|reject)$/, (route) => {
    const parts = new URL(route.request().url()).pathname.split('/'),
      id = parts[5]!,
      action = parts[6] as Decision;
    const call = {
      id,
      action,
      body: route.request().postDataJSON() as DecisionCommand,
      raw: route.request().postData()!,
      csrf: route.request().headers()['x-csrf-token'] ?? '',
    };
    state.decisionWrites.push(call);
    return write(route, state.decisionWriteMode, () => persistDecision(call));
  });
  await page.route(
    /\/api\/staff\/saving\/orders\/[^/]+\/stages\/[^/]+\/(complete|skip)$/,
    (route) => {
      const parts = new URL(route.request().url()).pathname.split('/'),
        id = parts[5]!,
        stage = parts[7] as StageName,
        action = parts[8] as StageAction;
      const call = {
        id,
        stage,
        action,
        body: route.request().postDataJSON() as StageCommand,
        raw: route.request().postData()!,
        csrf: route.request().headers()['x-csrf-token'] ?? '',
      };
      state.stageWrites.push(call);
      return write(route, state.stageWriteMode, () => persistStage(call));
    }
  );
  return { state, persistDecision, persistStage };
}
