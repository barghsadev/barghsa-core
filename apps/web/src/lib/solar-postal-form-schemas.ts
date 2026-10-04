import { z } from 'zod/mini';
import {
  receiptUuid,
  utcCalendarDay,
  type ShipmentDraft,
  type PostalGuidanceDraft,
} from './solar-postal-form.js';
import { suggestionLines } from './solar-document-form.js';
export function shipmentSchema(messages: Record<keyof ShipmentDraft, string>, today: string) {
  return z.custom<ShipmentDraft>().check((ctx) => {
    for (const [field, max] of [
      ['courier', 100],
      ['trackingNumber', 200],
    ] as const) {
      const value = ctx.value?.[field];
      if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
        ctx.issues.push({ code: 'custom', input: value, path: [field], message: messages[field] });
    }
    const day = ctx.value?.sendDate;
    if (typeof day !== 'string' || !utcCalendarDay(day) || day > today)
      ctx.issues.push({
        code: 'custom',
        input: day,
        path: ['sendDate'],
        message: messages.sendDate,
      });
    const receipt = ctx.value?.receiptImageId;
    if (typeof receipt !== 'string' || (receipt && !receiptUuid(receipt)))
      ctx.issues.push({
        code: 'custom',
        input: receipt,
        path: ['receiptImageId'],
        message: messages.receiptImageId,
      });
  });
}
export function postalGuidanceSchema(messages: Record<keyof PostalGuidanceDraft, string>) {
  return z.custom<PostalGuidanceDraft>().check((ctx) => {
    for (const [field, max, required] of [
      ['fa', 4000, true],
      ['en', 4000, true],
      ['destinationAddress', 2000, false],
      ['contactDetails', 1000, false],
    ] as const) {
      const value = ctx.value?.[field];
      if (typeof value !== 'string' || (required && !value.trim()) || value.trim().length > max)
        ctx.issues.push({ code: 'custom', input: value, path: [field], message: messages[field] });
    }
    const fa =
      typeof ctx.value?.originalsFa === 'string' ? suggestionLines(ctx.value.originalsFa) : null;
    const en =
      typeof ctx.value?.originalsEn === 'string' ? suggestionLines(ctx.value.originalsEn) : null;
    for (const [field, lines] of [
      ['originalsFa', fa],
      ['originalsEn', en],
    ] as const)
      if (
        !lines ||
        lines.length > 30 ||
        lines.some((line) => line.length > 200) ||
        (fa && en && fa.length !== en.length)
      )
        ctx.issues.push({
          code: 'custom',
          input: ctx.value?.[field],
          path: [field],
          message: messages[field],
        });
  });
}
export function postalReasonSchema(message: string) {
  return z.custom<{ reason: string }>().check((ctx) => {
    const value = ctx.value?.reason;
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 1000)
      ctx.issues.push({ code: 'custom', input: value, path: ['reason'], message });
  });
}
