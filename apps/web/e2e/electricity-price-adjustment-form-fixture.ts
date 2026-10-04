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
export const adjustmentId = '88000000-0000-4000-8000-000000000001';
export const creditAdjustmentId = '88000000-0000-4000-8000-000000000002';
export const cancelledAdjustmentId = '88000000-0000-4000-8000-000000000003';
export const linkedInvoiceId = '88000000-0000-4000-8000-000000000004';
export const linkedCreditId = '88000000-0000-4000-8000-000000000005';
export const priceActor = '88000000-0000-4000-8000-000000000006';
const correlationId = '88000000-0000-4000-8000-000000000007';
export const defaultPriceInput = {
  expectedVersionId: versionId,
  effectiveFrom: '2026-10-09T08:30:00.000Z',
  percentageBps: '1000',
  reason: 'Disclosed <script> price reason',
  contractualBasis: 'Contract clause 7',
};
export type PriceInput = typeof defaultPriceInput;
function roundSigned(numerator: bigint, denominator: bigint) {
  const absolute = numerator < 0n ? -numerator : numerator;
  const rounded = (absolute + denominator / 2n) / denominator;
  return numerator < 0n ? -rounded : rounded;
}
export function priceCalculation(input = defaultPriceInput) {
  const remainingMs = BigInt(Date.parse(periodEnd) - Date.parse(input.effectiveFrom));
  const periodMs = BigInt(Date.parse(periodEnd) - Date.parse(periodStart));
  const oldFutureIrR = roundSigned(100000n * remainingMs, periodMs);
  const amountIrR = roundSigned(
    100000n * BigInt(input.percentageBps) * remainingMs,
    10000n * periodMs
  );
  // Preserve service/calculator insertion order: this raw stringify is the persisted SHA basis.
  return {
    schemaVersion: 1,
    contractId,
    versionId: input.expectedVersionId,
    originalInvoiceId: invoiceId,
    reason: input.reason,
    contractualBasis: input.contractualBasis,
    quote: {
      amountIrR: amountIrR.toString(),
      oldFutureIrR: oldFutureIrR.toString(),
      newFutureIrR: (oldFutureIrR + amountIrR).toString(),
      kind: amountIrR > 0n ? ('charge' as const) : ('credit' as const),
      percentageBps: input.percentageBps,
      effectiveFrom: input.effectiveFrom,
      rounding: 'half-up-to-nearest-IRR' as const,
      components: [
        {
          source: 'original_invoice' as const,
          invoiceId,
          basisIrR: '100000',
          periodStart,
          periodEnd,
          eligibleFrom: input.effectiveFrom,
          oldFutureIrR: oldFutureIrR.toString(),
          changeIrR: amountIrR.toString(),
          newFutureIrR: (oldFutureIrR + amountIrR).toString(),
          remainingMs: remainingMs.toString(),
          periodMs: periodMs.toString(),
        },
      ],
    },
  };
}
function ordered(value: unknown, reverse = false): unknown {
  if (Array.isArray(value)) return value.map((item) => ordered(item, reverse));
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  if (reverse) entries.reverse();
  return Object.fromEntries(entries.map(([key, item]) => [key, ordered(item, reverse)]));
}
export function priceReview(input = defaultPriceInput) {
  const body = ordered({
    schemaVersion: 1,
    scope: { action: 'electricity.price-adjustment-proposal', profileId, resourceId: contractId },
    data: {
      currency: 'IRR',
      profileId,
      orderId,
      periodStart,
      periodEnd,
      calculation: priceCalculation(input),
    },
  }) as Record<string, unknown>;
  return { ...body, hash: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
}
export function priceRow(input = defaultPriceInput, id = adjustmentId) {
  const calculation = priceCalculation(input);
  return {
    adjustmentId: id,
    contractId,
    status: 'proposed',
    effectiveFrom: input.effectiveFrom,
    periodEnd,
    percentageBps: input.percentageBps,
    reason: input.reason,
    contractualBasis: input.contractualBasis,
    calculation: ordered(calculation, true) as typeof calculation,
    calculationSha256: createHash('sha256').update(JSON.stringify(calculation)).digest('hex'),
    adjustmentAmountIrR: calculation.quote.amountIrR,
    adjustmentInvoiceId: null as string | null,
    adjustmentInvoiceState: null as string | null,
    proposedAt: '2026-10-04T10:00:00.000Z',
    finalizedAt: null as string | null,
    cancelledAt: null as string | null,
  };
}
export type PriceRow = ReturnType<typeof priceRow>;
export function finalizedPrice(row = priceRow()) {
  return {
    ...row,
    status: 'finalized',
    finalizedAt: '2026-10-04T10:05:00.000Z',
    adjustmentInvoiceId: BigInt(row.adjustmentAmountIrR) < 0n ? linkedCreditId : linkedInvoiceId,
    adjustmentInvoiceState: BigInt(row.adjustmentAmountIrR) < 0n ? 'Paid' : 'Unpaid',
  };
}
export function cancelledPrice(row = priceRow()) {
  return { ...row, status: 'cancelled', cancelledAt: '2026-10-04T10:05:00.000Z' };
}
type ReadMode = 'success' | 'malformed' | 'denied' | 'missing' | 'held' | 'transient';
type Mode = 'owned' | 'held' | 'success' | 'conflict';
export async function setupElectricityPriceAdjustmentForms(
  page: Page,
  locale: 'en' | 'fa',
  dark: boolean
) {
  const shell = await setupElectricityCorrectionForms(page, locale, dark);
  shell.state.actor = priceActor;
  shell.state.detail = {
    ...shell.state.detail,
    contractState: 'Active',
    electricityStatus: 'active',
    financialStatus: 'paid',
    nextAction: 'manage_contract',
  };
  const state = {
    auth: shell.state,
    rows: [] as PriceRow[],
    customerRows: [priceRow()] as unknown[],
    readMode: 'success' as ReadMode,
    reviewMode: 'owned' as Mode,
    writeMode: 'held' as Mode,
    readRoute: undefined as Route | undefined,
    previewRoute: undefined as Route | undefined,
    writeRoute: undefined as Route | undefined,
    previews: [] as PriceInput[],
    writes: [] as {
      kind: 'publish' | 'finalize' | 'cancel';
      path: string;
      body: Record<string, unknown>;
    }[],
    staffReads: 0,
    customerReads: 0,
    lastInput: defaultPriceInput,
    nextAdjustmentId: adjustmentId,
  };
  const error = (route: Route, status: number, code: string, fields?: string[]) =>
    route.fulfill({
      status,
      json: {
        error: {
          code,
          message: 'PRIVATE_SERVER_VALIDATION_TEXT',
          correlationId,
          ...(fields ? { fields } : {}),
        },
      },
    });
  await page.route(`**/api/electricity/contracts/${contractId}/increase`, (route) =>
    route.fulfill({
      json: {
        request: null,
        originalKwh: '10',
        maxPercentage: 20,
        canRequest: false,
        quote: null,
        review: null,
      },
    })
  );
  await page.route(`**/api/electricity/contracts/${contractId}/price-adjustments`, (route) => {
    state.customerReads++;
    if (state.readMode === 'held') {
      state.readRoute = route;
      return;
    }
    if (state.readMode === 'denied') return error(route, 403, ErrorCodes.AUTHZ_FORBIDDEN.code);
    if (state.readMode === 'missing') return error(route, 404, ErrorCodes.NOT_FOUND_RESOURCE.code);
    if (state.readMode === 'transient') return route.fulfill({ status: 503, json: {} });
    return route.fulfill({
      json: {
        adjustments:
          state.readMode === 'malformed'
            ? [{ ...priceRow(), adjustmentAmountIrR: 'INVALID_AMOUNT' }]
            : state.customerRows,
      },
    });
  });
  await page.route(
    `**/api/staff/electricity/contracts/${contractId}/price-adjustments`,
    (route) => {
      if (route.request().method() === 'GET') {
        state.staffReads++;
        return route.fulfill({
          json: {
            contractId,
            profileId,
            versionId,
            periodEnd,
            canPropose: !state.rows.some((row) => row.status === 'proposed'),
            canCancel: true,
            canFinalize: true,
            blockedByIncrease: false,
            adjustments: state.rows,
          },
        });
      }
      state.writes.push({
        kind: 'publish',
        path: route.request().url(),
        body: route.request().postDataJSON(),
      });
      if (state.writeMode === 'held') {
        state.writeRoute = route;
        return;
      }
      const existing = state.rows.find((row) => row.adjustmentId === state.nextAdjustmentId);
      const row = existing ?? priceRow(state.lastInput, state.nextAdjustmentId);
      if (!existing) state.rows = [row, ...state.rows];
      return route.fulfill({ status: 201, json: row });
    }
  );
  await page.route(
    `**/api/staff/electricity/contracts/${contractId}/price-adjustments/review`,
    (route) => {
      const body = route.request().postDataJSON() as PriceInput;
      state.previews.push(body);
      state.lastInput = body;
      if (state.reviewMode === 'owned')
        return error(route, 400, ErrorCodes.VALIDATION_INPUT_INVALID.code, ['reason']);
      if (state.reviewMode === 'conflict') return error(route, 409, ErrorCodes.CONFLICT_STATE.code);
      if (state.reviewMode === 'held') {
        state.previewRoute = route;
        return;
      }
      return route.fulfill({ json: priceReview(body) });
    }
  );
  for (const id of [adjustmentId, creditAdjustmentId, cancelledAdjustmentId]) {
    for (const kind of ['finalize', 'cancel'] as const) {
      await page.route(`**/api/staff/electricity/price-adjustments/${id}/${kind}`, (route) => {
        state.writes.push({
          kind,
          path: route.request().url(),
          body: route.request().postDataJSON(),
        });
        if (state.writeMode === 'held') {
          state.writeRoute = route;
          return;
        }
        const row = state.rows.find((item) => item.adjustmentId === id)!;
        const result = kind === 'finalize' ? finalizedPrice(row) : cancelledPrice(row);
        state.rows = state.rows.map((item) => (item.adjustmentId === id ? result : item));
        return route.fulfill({ status: 201, json: result });
      });
    }
  }
  return state;
}
