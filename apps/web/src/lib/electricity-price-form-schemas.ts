import { z } from 'zod/mini';
import {
  percentToBps,
  priceEffectiveFrom,
  type PriceDraft,
  type PriceContractDraft,
} from './electricity-price-form.js';
import { staffOrderId } from './staff-order-list-query.js';
export const inactivePriceSchema = z.custom<PriceDraft>();
export const inactivePriceContractSchema = z.custom<PriceContractDraft>();
export function priceContractSchema(message: string) {
  return z.custom<PriceContractDraft>().check((ctx) => {
    const value = ctx.value?.contractId;
    if (typeof value !== 'string' || !staffOrderId(value.trim()))
      ctx.issues.push({ code: 'custom', input: value, path: ['contractId'], message });
  });
}
export function priceProposalSchema(
  messages: Record<keyof PriceDraft, string>,
  timezone: string | null
) {
  return z.custom<PriceDraft>().check((ctx) => {
    const values = ctx.value;
    const invalid = (name: keyof PriceDraft) =>
      ctx.issues.push({
        code: 'custom',
        input: values?.[name],
        path: [name],
        message: messages[name],
      });
    if (typeof values?.percentage !== 'string' || percentToBps(values.percentage) === null)
      invalid('percentage');
    if (
      typeof values?.effectiveFrom !== 'string' ||
      !priceEffectiveFrom(values.effectiveFrom, timezone)
    )
      invalid('effectiveFrom');
    if (
      typeof values?.reason !== 'string' ||
      !values.reason.trim() ||
      values.reason.trim().length > 1000
    )
      invalid('reason');
    if (
      typeof values?.basis !== 'string' ||
      !values.basis.trim() ||
      values.basis.trim().length > 2000
    )
      invalid('basis');
  });
}
