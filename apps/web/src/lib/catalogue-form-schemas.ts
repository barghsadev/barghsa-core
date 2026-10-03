import { custom } from 'zod/mini';
import type { Draft, PriceDraft, ProductType } from './catalogue-form.js';
export function productFormSchema(
  context: { type: ProductType; isNew: boolean; categories: string[]; hardwareIds: string[] },
  messages: Record<keyof Draft, string>,
  integer: (raw: string) => string | null
) {
  return custom<Draft>().check((ctx) => {
    const issue = (field: keyof Draft) =>
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        path: [field],
        message: messages[field],
      });
    for (const field of ['titleFa', 'titleEn'] as const)
      if (!ctx.value[field].trim() || ctx.value[field].trim().length > 300) issue(field);
    for (const field of ['descriptionFa', 'descriptionEn'] as const)
      if (ctx.value[field].length > 4000) issue(field);
    if (context.isNew && ctx.value.price.trim() && integer(ctx.value.price) === null)
      issue('price');
    if (
      ctx.value.categories.length > 10 ||
      new Set(ctx.value.categories).size !== ctx.value.categories.length ||
      ctx.value.categories.some((value) => !context.categories.includes(value))
    )
      issue('categories');
    if (
      context.type === 'saving_plan' &&
      (!ctx.value.hardwareIds.length ||
        ctx.value.hardwareIds.length > 100 ||
        new Set(ctx.value.hardwareIds).size !== ctx.value.hardwareIds.length ||
        ctx.value.hardwareIds.some((value) => !context.hardwareIds.includes(value)))
    )
      issue('hardwareIds');
    if (context.type === 'electricity' && ctx.value.configureLimits) {
      const min = integer(ctx.value.minKwh),
        max = integer(ctx.value.maxKwh);
      if (min === null) issue('minKwh');
      if (max === null) issue('maxKwh');
      if (
        min !== null &&
        max !== null &&
        ((BigInt(min) === 0n && BigInt(max) === 0n) ||
          (BigInt(max) > 0n && BigInt(min) > BigInt(max)))
      ) {
        issue('minKwh');
        issue('maxKwh');
      }
    }
  });
}
export function priceFormSchema(
  messages: Record<keyof PriceDraft, string>,
  integer: (raw: string) => string | null,
  resolve: (draft: PriceDraft) => string | null
) {
  return custom<PriceDraft>().check((ctx) => {
    const issue = (field: keyof PriceDraft) =>
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        path: [field],
        message: messages[field],
      });
    if (integer(ctx.value.price) === null) issue('price');
    if (ctx.value.scheduled) {
      if (!ctx.value.date || !Number.isFinite(ctx.value.date.getTime())) issue('date');
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(ctx.value.time)) issue('time');
      else if (ctx.value.date && !resolve(ctx.value)) issue('date');
    }
  });
}
