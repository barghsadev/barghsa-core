import { createHash } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  correctionContract as contractId,
  correctionInvoice as invoiceId,
  correctionOrder as orderId,
  correctionProfile as profileId,
  correctionVersion as versionId,
  correctionPeriodStart as periodStart,
  correctionPeriodEnd as periodEnd,
  setupElectricityCorrectionForms,
} from './electricity-correction-form-fixture';

export { contractId, invoiceId, orderId, profileId, versionId, periodStart, periodEnd };
export const increaseRequestId = '87000000-0000-4000-8000-000000000001';
export const otherIncreaseRequestId = '87000000-0000-4000-8000-000000000002';
export const increaseCustomerId = '87000000-0000-4000-8000-000000000003';
export const increaseStaffId = '87000000-0000-4000-8000-000000000004';
const sessionId = '87000000-0000-4000-8000-000000000005';
const adjustmentInvoiceId = '87000000-0000-4000-8000-000000000006';
const effectiveFrom = '2026-10-09T08:30:00.000Z';
const createdAt = '2026-10-04T10:00:00.000Z';
const reviewedAt = '2026-10-04T10:05:00.000Z';
const signedAt = '2026-10-04T10:10:00.000Z';

export function increaseRequest(id = increaseRequestId) {
  return {
    requestId: id,
    contractId: id === increaseRequestId ? contractId : '87000000-0000-4000-8000-000000000008',
    orderId: id === increaseRequestId ? orderId : '87000000-0000-4000-8000-000000000009',
    profileId,
    versionId: id === increaseRequestId ? versionId : '87000000-0000-4000-8000-000000000010',
    originalKwh: '10',
    requestedKwh: '12',
    maxPercentage: 20,
    effectiveFrom,
    periodEnd,
    status: 'pending',
    reviewReason: null as string | null,
    createdAt,
    reviewedAt: null as string | null,
    reviewedBy: null as string | null,
    requestedBy: increaseCustomerId,
    amendmentDocument: null as Record<string, unknown> | null,
    amendmentSha256: null as string | null,
    signatureEvidence: null as Record<string, unknown> | null,
    signedAt: null as string | null,
    pricingSnapshot: null as Record<string, unknown> | null,
    adjustmentAmount: null as string | null,
    adjustmentInvoiceId: null as string | null,
    effectiveAt: null as string | null,
    expiredAt: null as string | null,
    adjustmentInvoiceState: null as string | null,
    adjustmentPaidAmount: null as string | null,
    financialFollowUp: false,
    contractState: 'Active',
  };
}
type IncreaseRow = ReturnType<typeof increaseRequest>;

export function approvedIncrease(
  row = increaseRequest(),
  date = row.effectiveFrom,
  reason = 'Capacity reviewed'
) {
  const amendment = {
    schemaVersion: 1,
    kind: 'electricity_quantity_increase',
    requestId: row.requestId,
    contractId: row.contractId,
    orderId: row.orderId,
    contractVersionId: row.versionId,
    requestedBy: row.requestedBy,
    approvedBy: increaseStaffId,
    approvedAt: reviewedAt,
    approvalReason: reason,
    originalKwh: row.originalKwh,
    requestedKwh: row.requestedKwh,
    incrementalKwh: '2',
    increaseBasisPoints: '2000',
    maxPercentageAtRequest: row.maxPercentage,
    maxPercentageAtApproval: 20,
    earliestEffectiveFrom: date,
    periodEnd: row.periodEnd,
    pricingRule:
      'Paid original invoice and finalized price adjustments, prorated for the added quantity over each remaining eligible period at signature',
    activationRule:
      'Quantity increases only after customer signature and full adjustment payment, no earlier than the effective date',
  };
  const serialized = JSON.stringify(
    Object.fromEntries(Object.entries(amendment).sort(([a], [b]) => a.localeCompare(b)))
  );
  return {
    ...row,
    status: 'awaiting_signature',
    reviewReason: reason,
    effectiveFrom: date,
    reviewedAt,
    reviewedBy: increaseStaffId,
    amendmentDocument: amendment,
    amendmentSha256: createHash('sha256').update(serialized).digest('hex'),
  };
}
export function increaseSigningReview(row: IncreaseRow) {
  const periodMs = BigInt(Date.parse(periodEnd) - Date.parse(periodStart));
  const remainingMs = BigInt(Date.parse(row.periodEnd) - Date.parse(row.effectiveFrom));
  const denominator = 10n * periodMs;
  const amount = ((100000n * 2n * remainingMs + denominator / 2n) / denominator).toString();
  return {
    schemaVersion: 1,
    hash: 'b'.repeat(64),
    scope: { action: 'electricity.quantity-increase-sign', profileId, resourceId: contractId },
    data: {
      currency: 'IRR',
      profileId,
      contractId,
      orderId,
      versionId,
      requestId: row.requestId,
      amendmentSha256: row.amendmentSha256,
      originalInvoiceId:
        row.requestId === increaseRequestId ? invoiceId : '87000000-0000-4000-8000-000000000011',
      originalInvoiceIrR: '100000',
      originalKwh: row.originalKwh,
      requestedKwh: row.requestedKwh,
      incrementalKwh: '2',
      effectiveFrom: row.effectiveFrom,
      eligibleFrom: row.effectiveFrom,
      periodStart,
      periodEnd,
      remainingMs: remainingMs.toString(),
      periodMs: periodMs.toString(),
      baseShareIrR: amount,
      priceAdjustments: [],
      adjustmentIrR: amount,
      activationRule: 'after-signature-full-payment-and-effective-date',
    },
  };
}
export function signedIncrease(row: IncreaseRow) {
  const review = increaseSigningReview(row);
  return {
    ...row,
    status: 'awaiting_effective_date',
    signedAt,
    signatureEvidence: {
      schemaVersion: 1,
      amendmentSha256: row.amendmentSha256,
      signedBy: row.requestedBy,
      sessionId,
      signedAt,
      ip: '127.0.0.1',
      adjustmentIrR: review.data.adjustmentIrR,
    },
    pricingSnapshot: {
      schemaVersion: 1,
      amendmentSha256: row.amendmentSha256,
      originalInvoiceId: invoiceId,
      originalInvoiceIrR: '100000',
      originalKwh: row.originalKwh,
      requestedKwh: row.requestedKwh,
      eligibleFrom: row.effectiveFrom,
      periodStart,
      periodEnd,
      remainingMs: review.data.remainingMs,
      periodMs: review.data.periodMs,
      priceAdjustments: [],
      rounding: 'half-up-to-nearest-IRR',
      adjustmentIrR: review.data.adjustmentIrR,
      financialReview: review,
    },
    adjustmentAmount: review.data.adjustmentIrR,
    adjustmentInvoiceId,
    adjustmentInvoiceState: 'Paid',
    adjustmentPaidAmount: review.data.adjustmentIrR,
  };
}
export function increaseDecisionReview(
  row: IncreaseRow,
  action: 'approve' | 'reject',
  body: Record<string, unknown>
) {
  return {
    schemaVersion: 1,
    hash: 'a'.repeat(64),
    scope: {
      action: 'electricity.quantity-increase-staff-decision',
      profileId: row.profileId,
      resourceId: row.requestId,
    },
    data: {
      action,
      reason: body.reason,
      requestId: row.requestId,
      profileId: row.profileId,
      contractId: row.contractId,
      versionId: row.versionId,
      orderId: row.orderId,
      contractState: row.contractState,
      electricityStatus: 'active',
      originalKwh: row.originalKwh,
      requestedKwh: row.requestedKwh,
      incrementalKwh: '2',
      maxPercentageAtRequest: row.maxPercentage,
      maxPercentageAtDecision: action === 'approve' ? 20 : null,
      requestedEffectiveFrom: row.effectiveFrom,
      effectiveFrom: action === 'approve' ? (body.effectiveFrom ?? row.effectiveFrom) : null,
      periodStart,
      periodEnd: row.periodEnd,
      originalInvoiceId:
        row.requestId === increaseRequestId ? invoiceId : '87000000-0000-4000-8000-000000000011',
      originalInvoiceState: 'Paid',
      originalInvoiceTotalIrR: '100000',
      originalInvoicePaidIrR: '100000',
      originalInvoiceRefundedIrR: '0',
      outcome:
        action === 'approve'
          ? 'publish_amendment_for_customer_signature'
          : 'reject_without_adjustment',
      adjustmentRule: 'prorated_at_customer_signature',
    },
  };
}
type Mode = 'owned' | 'unsafe' | 'held' | 'success' | 'stepup' | 'conflict';
export async function setupElectricityQuantityIncreaseForms(
  page: Page,
  locale: 'en' | 'fa',
  dark: boolean
) {
  const shell = await setupElectricityCorrectionForms(page, locale, dark);
  shell.state.actor = increaseCustomerId;
  shell.state.detail = {
    ...shell.state.detail,
    contractState: 'Active',
    electricityStatus: 'active',
    financialStatus: 'paid',
    nextAction: 'manage_contract',
  };
  const state = {
    auth: shell.state,
    request: null as IncreaseRow | null,
    rows: [increaseRequest(), increaseRequest(otherIncreaseRequestId)],
    queueDenied: false,
    requestMode: 'owned' as Mode,
    signMode: 'held' as Mode,
    decisionMode: 'owned' as Mode,
    decisionWriteMode: 'held' as Mode,
    requestRoute: undefined as Route | undefined,
    signRoute: undefined as Route | undefined,
    decisionRoute: undefined as Route | undefined,
    decisionWriteRoute: undefined as Route | undefined,
    requestWrites: [] as Record<string, unknown>[],
    signWrites: [] as Record<string, unknown>[],
    decisionPreviews: [] as {
      id: string;
      action: 'approve' | 'reject';
      body: Record<string, unknown>;
    }[],
    decisionWrites: [] as {
      id: string;
      action: 'approve' | 'reject';
      body: Record<string, unknown>;
    }[],
    customerReads: 0,
  };
  const invalid = (route: Route, fields?: string[]) =>
    route.fulfill({
      status: 400,
      json: {
        error: {
          code: fields ? ErrorCodes.VALIDATION_INPUT_INVALID.code : 'VALIDATION:INPUT_INVALID',
          ...(fields ? { fields } : {}),
          message: 'PRIVATE_SERVER_VALIDATION_TEXT',
          correlationId: '87000000-0000-4000-8000-000000000007',
        },
      },
    });
  await page.route(`**/api/electricity/contracts/${contractId}/price-adjustments`, (route) =>
    route.fulfill({ json: { adjustments: [] } })
  );
  await page.route(`**/api/electricity/contracts/${contractId}/increase`, (route) => {
    if (route.request().method() === 'GET') {
      state.customerReads++;
      const review =
        state.request?.status === 'awaiting_signature'
          ? increaseSigningReview(state.request)
          : null;
      return route.fulfill({
        json: {
          request: state.request,
          quote: review
            ? { adjustmentIrR: review.data.adjustmentIrR, eligibleFrom: review.data.eligibleFrom }
            : null,
          review,
          maxPercentage: 20,
          originalKwh: '10',
          canRequest: !state.request,
        },
      });
    }
    state.requestWrites.push(route.request().postDataJSON());
    if (state.requestMode === 'owned') return invalid(route, ['requestedKwh']);
    if (state.requestMode === 'unsafe') return invalid(route);
    if (state.requestMode === 'held') {
      state.requestRoute = route;
      return;
    }
    state.request ??= increaseRequest();
    return route.fulfill({ status: 201, json: state.request });
  });
  await page.route(`**/api/electricity/contracts/${contractId}/increase/sign`, (route) => {
    state.signWrites.push(route.request().postDataJSON());
    if (state.signMode === 'stepup')
      return route.fulfill({
        status: 403,
        json: {
          requiresStepUp: true,
          error: {
            code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code,
            message: 'Additional authentication is required',
            correlationId: '87000000-0000-4000-8000-000000000007',
          },
        },
      });
    if (state.signMode === 'held') {
      state.signRoute = route;
      return;
    }
    state.request = signedIncrease(state.request!);
    return route.fulfill({ status: 201, json: state.request });
  });
  await page.route('**/api/staff/electricity/increase-requests?*', (route) =>
    state.queueDenied
      ? route.fulfill({ status: 403, json: {} })
      : route.fulfill({ json: { requests: state.rows, nextBefore: null } })
  );
  for (const row of state.rows) {
    for (const action of ['approve', 'reject'] as const) {
      const path = `**/api/staff/electricity/increase-requests/${row.requestId}/${action}`;
      await page.route(`${path}/review`, (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        state.decisionPreviews.push({ id: row.requestId, action, body });
        if (state.decisionMode === 'conflict')
          return route.fulfill({
            status: 409,
            json: {
              error: {
                code: ErrorCodes.CONFLICT_STATE.code,
                message: 'Effective date must be in the remaining delivery period',
                correlationId: '87000000-0000-4000-8000-000000000007',
              },
            },
          });
        if (state.decisionMode === 'owned')
          return invalid(route, [action === 'approve' ? 'effectiveFrom' : 'reason']);
        if (state.decisionMode === 'unsafe') return invalid(route);
        if (state.decisionMode === 'held') {
          state.decisionRoute = route;
          return;
        }
        return route.fulfill({ json: increaseDecisionReview(row, action, body) });
      });
      await page.route(path, (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        state.decisionWrites.push({ id: row.requestId, action, body });
        if (state.decisionWriteMode === 'held') {
          state.decisionWriteRoute = route;
          return;
        }
        const result =
          action === 'approve'
            ? approvedIncrease(
                row,
                String(body.effectiveFrom ?? row.effectiveFrom),
                String(body.reason)
              )
            : {
                ...row,
                status: 'rejected',
                reviewReason: String(body.reason),
                reviewedAt,
                reviewedBy: increaseStaffId,
              };
        state.rows = state.rows.filter((current) => current.requestId !== row.requestId);
        return route.fulfill({ status: 201, json: result });
      });
    }
  }
  return state;
}
