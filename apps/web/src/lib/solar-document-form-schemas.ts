import { z } from 'zod/mini';
import { type SolarReviewDraft, type SolarReviewIntent } from './solar-document-form.js';

export function solarReviewSchema(intent: SolarReviewIntent, message: string) {
  return z.custom<SolarReviewDraft>().check((ctx) => {
    const raw = ctx.value?.reason;
    if (
      typeof raw !== 'string' ||
      !raw.trim() ||
      raw.trim().length > (intent === 'reject' ? 1000 : 2000)
    )
      ctx.issues.push({ code: 'custom', input: raw, path: ['reason'], message });
  });
}
export const guidanceTextSchema = (max: number, required: boolean, message: string) =>
  z.string({ message }).check(
    z.refine((value) => {
      const length = value.trim().length;
      return length <= max && (!required || length > 0);
    }, message)
  );

export function guidanceItemsSchema(message: string) {
  const translation = guidanceTextSchema(200, true, message);
  return z
    .array(z.object({ fa: translation, en: translation }), { message })
    .check(z.maxLength(30, message));
}

export function solarGuidanceSchema(messages: { fa: string; en: string; items: string }) {
  return z.object({
    fa: guidanceTextSchema(4000, true, messages.fa),
    en: guidanceTextSchema(4000, true, messages.en),
    items: guidanceItemsSchema(messages.items),
  });
}
