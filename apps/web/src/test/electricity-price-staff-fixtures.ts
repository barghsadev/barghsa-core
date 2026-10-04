import { createHash } from 'node:crypto';
import type { ElectricityPriceAdjustmentReview } from '@barghsa/shared/finance';
import {
  priceCalculation,
  priceAdjustmentRow,
  priceContractId,
  priceProfileId,
  priceVersionId,
} from './electricity-price-adjustment-fixtures.js';
import type { StaffPriceState } from '../lib/electricity-price-form.js';
export function staffPriceState(
  adjustments = [] as ReturnType<typeof priceAdjustmentRow>[]
): StaffPriceState {
  return {
    contractId: priceContractId,
    profileId: priceProfileId,
    versionId: priceVersionId,
    periodEnd: priceCalculation().quote.components[0]!.periodEnd,
    canPropose: true,
    canCancel: true,
    canFinalize: true,
    blockedByIncrease: false,
    adjustments,
  };
}
export function staffPriceReview(
  body: Record<string, string> = {}
): ElectricityPriceAdjustmentReview {
  const calculation = priceCalculation(body.percentageBps?.startsWith('-') ? 'credit' : 'charge');
  calculation.reason = body.reason ?? calculation.reason;
  calculation.contractualBasis = body.contractualBasis ?? calculation.contractualBasis;
  calculation.versionId = body.expectedVersionId ?? calculation.versionId;
  calculation.quote.percentageBps = body.percentageBps ?? calculation.quote.percentageBps;
  calculation.quote.effectiveFrom = body.effectiveFrom ?? calculation.quote.effectiveFrom;
  for (const component of calculation.quote.components) {
    component.eligibleFrom = calculation.quote.effectiveFrom;
    component.remainingMs = String(
      Date.parse(component.periodEnd) - Date.parse(component.eligibleFrom)
    );
  }
  return {
    schemaVersion: 1,
    hash: 'b'.repeat(64),
    scope: {
      action: 'electricity.price-adjustment-proposal',
      resourceId: priceContractId,
      profileId: priceProfileId,
    },
    data: {
      currency: 'IRR',
      profileId: priceProfileId,
      orderId: '77777777-7777-4777-8777-777777777777',
      periodStart: calculation.quote.components[0]!.periodStart,
      periodEnd: calculation.quote.components[0]!.periodEnd,
      calculation,
    },
  };
}
export function staffPriceReceipt(
  review = staffPriceReview(),
  status: ReturnType<typeof priceAdjustmentRow>['status'] = 'proposed'
) {
  const calculation = review.data.calculation;
  return {
    ...priceAdjustmentRow(status, calculation.quote.kind),
    calculation,
    calculationSha256: createHash('sha256').update(JSON.stringify(calculation)).digest('hex'),
    effectiveFrom: calculation.quote.effectiveFrom,
    percentageBps: calculation.quote.percentageBps,
    reason: calculation.reason,
    contractualBasis: calculation.contractualBasis,
    adjustmentAmountIrR: calculation.quote.amountIrR,
  };
}
export function deepSorted<T>(value: T): T {
  if (Array.isArray(value)) return value.map(deepSorted) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, deepSorted(nested)])
    ) as T;
  return value;
}
