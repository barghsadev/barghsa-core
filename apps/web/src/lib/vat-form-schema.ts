import { custom } from 'zod/mini';
import type { VatDraft, VatFormContext } from './vat-form.js';

export function vatFormSchema(
  context: VatFormContext,
  messages: Record<keyof VatDraft, string>,
  parse: {
    basisPoints: (raw: string) => number | null;
    instant: (draft: VatDraft, context: VatFormContext) => string | null;
  }
) {
  return custom<VatDraft>().check((ctx) => {
    const issue = (field: keyof VatDraft) =>
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        path: [field],
        message: messages[field],
      });
    if (context.kind === 'rate') {
      if (!context.categories.includes(ctx.value.category)) issue('category');
      if (parse.basisPoints(ctx.value.percent) === null) issue('percent');
    }
    if (context.kind === 'override') {
      if (!context.productIds.includes(ctx.value.productId)) issue('productId');
      if (!context.rateIds.includes(ctx.value.rateId)) issue('rateId');
    }
    if (ctx.value.scheduled) {
      if (!ctx.value.date || !Number.isFinite(ctx.value.date.getTime())) issue('date');
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(ctx.value.time)) issue('time');
      else if (ctx.value.date && !parse.instant(ctx.value, context)) issue('date');
    }
  });
}
