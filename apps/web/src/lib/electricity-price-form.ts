import {
  parseElectricityPriceAdjustmentReview,
  type ElectricityPriceAdjustmentCalculation,
} from '@barghsa/shared/finance';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  parseElectricityPriceAdjustmentRow,
  sameElectricityPriceCalculation,
  type ElectricityPriceAdjustmentRow,
} from './electricity-price-adjustment-row.js';
export { increaseEffectiveFrom as priceEffectiveFrom } from './electricity-increase-decision-form.js';

export type PriceDraft = {
  percentage: string;
  effectiveFrom: string;
  reason: string;
  basis: string;
};
export type PriceContractDraft = { contractId: string };
export interface StaffPriceState {
  contractId: string;
  profileId: string;
  versionId: string;
  periodEnd: string;
  canPropose: boolean;
  canCancel: boolean;
  canFinalize: boolean;
  blockedByIncrease: boolean;
  adjustments: ElectricityPriceAdjustmentRow[];
}
export function percentToBps(value: string): string | null {
  const match = /^(-?)(\d{1,16})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const absolute = BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0') || '0');
  const signed = match[1] === '-' ? -absolute : absolute;
  return signed === 0n || signed <= -10_000n || signed > 9_223_372_036_854_775_807n
    ? null
    : signed.toString();
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseStaffPriceState(value: unknown, contractId: string): StaffPriceState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    raw.contractId !== contractId ||
    typeof raw.profileId !== 'string' ||
    !uuid.test(raw.profileId) ||
    typeof raw.versionId !== 'string' ||
    !uuid.test(raw.versionId) ||
    typeof raw.periodEnd !== 'string' ||
    !Number.isFinite(Date.parse(raw.periodEnd)) ||
    ['canPropose', 'canCancel', 'canFinalize', 'blockedByIncrease'].some(
      (name) => typeof raw[name] !== 'boolean'
    ) ||
    !Array.isArray(raw.adjustments)
  )
    return null;
  const adjustments = raw.adjustments.map(parseElectricityPriceAdjustmentRow);
  if (
    adjustments.some((row) => !row || row.contractId !== contractId) ||
    new Set(adjustments.map((row) => row?.adjustmentId)).size !== adjustments.length
  )
    return null;
  return {
    contractId,
    profileId: raw.profileId,
    versionId: raw.versionId,
    periodEnd: raw.periodEnd,
    canPropose: raw.canPropose as boolean,
    canCancel: raw.canCancel as boolean,
    canFinalize: raw.canFinalize as boolean,
    blockedByIncrease: raw.blockedByIncrease as boolean,
    adjustments: adjustments.filter((row): row is ElectricityPriceAdjustmentRow => row !== null),
  };
}
export function boundPriceReview(
  value: unknown,
  state: StaffPriceState,
  proposal: {
    expectedVersionId: string;
    effectiveFrom: string;
    percentageBps: string;
    reason: string;
    contractualBasis: string;
  }
) {
  const review = parseElectricityPriceAdjustmentReview(value);
  const calculation = review?.data.calculation;
  return review &&
    calculation &&
    review.scope.resourceId === state.contractId &&
    review.scope.profileId === state.profileId &&
    Date.parse(review.data.periodEnd) === Date.parse(state.periodEnd) &&
    calculation.versionId === proposal.expectedVersionId &&
    calculation.quote.effectiveFrom === proposal.effectiveFrom &&
    calculation.quote.percentageBps === proposal.percentageBps &&
    calculation.reason === proposal.reason &&
    calculation.contractualBasis === proposal.contractualBasis
    ? review
    : null;
}
/** The shared review parser reconstructs the service's constructor order. Never sort this JSON. */
export async function priceCalculationDigest(calculation: ElectricityPriceAdjustmentCalculation) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(calculation))
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function matchedPriceReceipt(
  value: unknown,
  expected: {
    operation: 'publish' | 'finalize' | 'cancel';
    contractId: string;
    adjustmentId?: string | undefined;
    periodEnd: string;
    calculation: ElectricityPriceAdjustmentCalculation;
    calculationSha256: string;
  }
) {
  const row = parseElectricityPriceAdjustmentRow(value);
  return row &&
    row.contractId === expected.contractId &&
    (!expected.adjustmentId || row.adjustmentId === expected.adjustmentId) &&
    Date.parse(row.periodEnd) === Date.parse(expected.periodEnd) &&
    row.calculationSha256 === expected.calculationSha256 &&
    sameElectricityPriceCalculation(row.calculation, expected.calculation) &&
    (expected.operation === 'publish' ||
      row.status === (expected.operation === 'finalize' ? 'finalized' : 'cancelled'))
    ? row
    : null;
}
function publicPriceError(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
  const details = error as Record<string, unknown>;
  return typeof details.code === 'string' &&
    typeof details.message === 'string' &&
    typeof details.correlationId === 'string' &&
    uuid.test(details.correlationId)
    ? details
    : null;
}
export function definitivePriceRejection(value: unknown) {
  const error = publicPriceError(value);
  return (
    !!error &&
    [
      ErrorCodes.VALIDATION_INPUT_INVALID.code,
      'VALIDATION:INPUT_INVALID',
      ErrorCodes.CONFLICT_STATE.code,
      ErrorCodes.CONFLICT_VERSION.code,
    ].some((code) => code === error.code)
  );
}
export function definitiveMissingPrice(value: unknown) {
  return publicPriceError(value)?.code === ErrorCodes.NOT_FOUND_RESOURCE.code;
}
