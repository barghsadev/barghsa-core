import { z } from 'zod/mini';
import {
  receiptUuid,
  utcCalendarDay,
  type ShipmentDraft,
  type PostalGuidanceDraft,
} from './solar-postal-form.js';
import { guidanceItemsSchema, guidanceTextSchema } from './solar-document-form-schemas.js';
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
  return z.object({
    fa: guidanceTextSchema(4000, true, messages.fa),
    en: guidanceTextSchema(4000, true, messages.en),
    destinationAddress: guidanceTextSchema(2000, false, messages.destinationAddress),
    contactDetails: guidanceTextSchema(1000, false, messages.contactDetails),
    items: guidanceItemsSchema(messages.items),
  });
}
export function postalReasonSchema(message: string) {
  return z.custom<{ reason: string }>().check((ctx) => {
    const value = ctx.value?.reason;
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 1000)
      ctx.issues.push({ code: 'custom', input: value, path: ['reason'], message });
  });
}
