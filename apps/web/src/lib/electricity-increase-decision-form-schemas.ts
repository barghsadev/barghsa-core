import { z } from 'zod/mini';
import {
  increaseEffectiveFrom,
  type IncreaseDecisionDraft,
  type IncreaseDecision,
} from './electricity-increase-decision-form.js';

export const inactiveIncreaseDecisionSchema = z.custom<IncreaseDecisionDraft>();
export function increaseDecisionSchema(
  decision: IncreaseDecision,
  message: string,
  timezone: string | null,
  reasonMessage = message
) {
  return z.custom<IncreaseDecisionDraft>().check((ctx) => {
    const reason = ctx.value.reason;
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 1000)
      ctx.issues.push({ code: 'custom', input: reason, path: ['reason'], message: reasonMessage });
    if (
      decision === 'approve' &&
      (typeof ctx.value.effectiveDate !== 'string' ||
        increaseEffectiveFrom(ctx.value.effectiveDate, timezone) === null)
    )
      ctx.issues.push({
        code: 'custom',
        input: ctx.value.effectiveDate,
        path: ['effectiveDate'],
        message,
      });
  });
}
