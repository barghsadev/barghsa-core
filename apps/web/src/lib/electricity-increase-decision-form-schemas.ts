import { z } from 'zod/mini';
import {
  increaseEffectiveFrom,
  type IncreaseDecisionDraft,
  type IncreaseDecision,
} from './electricity-increase-decision-form.js';

export const inactiveIncreaseDecisionSchema = z.custom<IncreaseDecisionDraft>();
export function increaseDecisionSchema(decision: IncreaseDecision, message: string) {
  return z.custom<IncreaseDecisionDraft>().check((ctx) => {
    const name = decision === 'approve' ? 'effectiveDate' : 'reason';
    const value = ctx.value[name];
    if (
      typeof value !== 'string' ||
      (decision === 'approve'
        ? increaseEffectiveFrom(value) === null
        : !value.trim() || value.trim().length > 1000)
    )
      ctx.issues.push({ code: 'custom', input: value, path: [name], message });
  });
}
