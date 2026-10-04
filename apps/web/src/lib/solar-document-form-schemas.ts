import { z } from 'zod/mini';
import {
  suggestionLines,
  type SolarGuidanceDraft,
  type SolarReviewDraft,
  type SolarReviewIntent,
} from './solar-document-form.js';

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
export function solarGuidanceSchema(messages: Record<keyof SolarGuidanceDraft, string>) {
  return z.custom<SolarGuidanceDraft>().check((ctx) => {
    for (const field of ['fa', 'en'] as const) {
      const raw = ctx.value?.[field];
      if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > 4000)
        ctx.issues.push({ code: 'custom', input: raw, path: [field], message: messages[field] });
    }
    const fa =
      typeof ctx.value?.faSuggestions === 'string'
        ? suggestionLines(ctx.value.faSuggestions)
        : null;
    const en =
      typeof ctx.value?.enSuggestions === 'string'
        ? suggestionLines(ctx.value.enSuggestions)
        : null;
    for (const [field, lines] of [
      ['faSuggestions', fa],
      ['enSuggestions', en],
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
